import test from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  computeMean,
  computeMedian,
  computeP90,
  calculateCycleTime,
  calculateGrossMargin,
  formatRupees,
  formatUsd,
  formatDays,
  formatPercentage,
} from "./funnel-analytics.ts";
import {
  recordStageTransition,
  recordPlacement,
  updatePlacementLifecycle,
  getFunnelAnalytics,
} from "./funnel-analytics.server.ts";

function uid(): string {
  return crypto.randomUUID();
}

async function seedTestOrgAndRole(opts?: {
  companyName?: string;
  clientId?: string;
  mandateNumber?: number;
  isRepeatMandate?: boolean;
}): Promise<{ orgId: string; roleId: string; userId: string }> {
  const sql = await getSql();
  const orgId = uid();
  const userId = uid();
  const roleId = uid();

  await sql`
    insert into organizations (id, name, slug, created_by, created_at, updated_at)
    values (${orgId}, 'Enterprise Jio TA Corp', ${`slug-${orgId}`}, ${userId}, now(), now())`;

  await sql`
    insert into organization_members (id, org_id, user_id, role, status, joined_at, updated_at)
    values (${uid()}, ${orgId}, ${userId}, 'owner', 'active', now(), now())`;

  await sql`
    insert into roles (
      id, org_id, user_id, company_name, company_stage, title, location,
      work_mode, employment_type, compensation_band, stack, must_haves,
      nice_to_haves, jd_text, status, client_id, mandate_number,
      is_repeat_mandate, target_hire_count, placement_fee_percentage, billing_currency,
      created_at, updated_at
    ) values (
      ${roleId}, ${orgId}, ${userId}, ${opts?.companyName ?? "Jio Platforms"}, 'series_b',
      'Senior Cloud Architect', 'Mumbai', 'hybrid', 'full_time', '₹40-50 LPA',
      '[]', '[]', '[]', 'JD for Senior Cloud Architect', 'open',
      ${opts?.clientId ?? "jio-digital"}, ${opts?.mandateNumber ?? 1},
      ${opts?.isRepeatMandate ?? false}, 2, 15.0, 'INR', now(), now()
    )`;

  return { orgId, roleId, userId };
}

async function seedCandidateAndApp(
  orgId: string,
  roleId: string,
  userId: string,
  fullName: string,
): Promise<{ candidateId: string; applicationId: string }> {
  const sql = await getSql();
  const candidateId = uid();
  const applicationId = uid();

  const email = `${candidateId.slice(0, 8)}@jio.com`;

  await sql`
    insert into candidates (
      id, org_id, user_id, full_name, email, phone, location, linkedin_url,
      current_title, current_company, years_experience, resume_text,
      parsed_json, status, created_at, updated_at
    ) values (
      ${candidateId}, ${orgId}, ${userId}, ${fullName}, ${email},
      '+919876543210', 'Mumbai', 'https://linkedin.com/in/test',
      'Cloud Architect', 'Reliance Industries', 8.5, 'Resume content',
      '{}', 'active', now(), now()
    )`;

  await sql`
    insert into applications (
      id, org_id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json,
      created_at, updated_at
    ) values (
      ${applicationId}, ${orgId}, ${userId}, ${roleId}, ${candidateId},
      'ingested', 85, '{}', now(), now()
    )`;

  return { candidateId, applicationId };
}

// ---------------------------------------------------------------------------
// 1. Mathematical and Statistical Formulas
// ---------------------------------------------------------------------------

test("Statistical Formulas: computeMean, computeMedian, computeP90 and formatting", () => {
  // Odd length array
  assert.equal(computeMedian([2, 5, 8]), 5);
  // Even length array
  assert.equal(computeMedian([2, 4, 6, 8]), 5);
  // Single element
  assert.equal(computeMedian([12]), 12);
  assert.equal(computeMedian([]), 0);

  // Mean
  assert.equal(computeMean([10, 20, 30]), 20);
  assert.equal(computeMean([]), 0);

  // P90
  const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(computeP90(sample), 9);

  // Cycle time builder
  const ct = calculateCycleTime([3, 5, 7, 10, 15]);
  assert.equal(ct.medianDays, 7);
  assert.equal(ct.meanDays, 8);
  assert.equal(ct.sampleCount, 5);

  // Formatting helpers
  assert.equal(formatDays(0.5), "12 hrs");
  assert.equal(formatDays(4.2), "4.2 days");
  assert.equal(formatPercentage(84.321), "84.3%");
  assert.ok(
    formatRupees(1500000).includes("15,00,000") || formatRupees(1500000).includes("1,500,000"),
  );
  assert.ok(formatUsd(25000).includes("25,000"));
});

test("Financial Formulas: calculateGrossMargin with direct costs & recruiter commission", () => {
  // 15% placement fee on 20,00,000 CTC = 3,00,000 gross fee
  // Direct cost: 25,000, Recruiter Commission: 50,000
  // Net margin = 3,00,000 - 75,000 = 2,25,000 (75% margin)
  const margin = calculateGrossMargin({
    offeredCtc: 2000000,
    feePercentage: 15.0,
    directCost: 25000,
    recruiterCommission: 50000,
  });

  assert.equal(margin.grossFee, 300000);
  assert.equal(margin.marginAmount, 225000);
  assert.equal(margin.marginPercentage, 75.0);

  // 0 direct cost
  const cleanMargin = calculateGrossMargin({
    offeredCtc: 100000,
    feePercentage: 20.0,
  });
  assert.equal(cleanMargin.grossFee, 20000);
  assert.equal(cleanMargin.marginAmount, 20000);
  assert.equal(cleanMargin.marginPercentage, 100.0);
});

// ---------------------------------------------------------------------------
// 2. Stage Events & Chronological Audit Logging
// ---------------------------------------------------------------------------

test("Stage Transitions: records audit-logged events and updates application status", async () => {
  const { orgId, roleId, userId } = await seedTestOrgAndRole();
  const { candidateId, applicationId } = await seedCandidateAndApp(
    orgId,
    roleId,
    userId,
    "Rohit Sharma",
  );

  const t1 = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(); // 2 days ago
  const t2 = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(); // 1 day ago

  // Step 1: Sourced -> Shortlisted
  const ev1 = await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "shortlisted",
    fromStage: "ingested",
    actorUserId: userId,
    reason: "Matched Kubernetes & AWS requirements",
    timestamp: t1,
  });

  assert.equal(ev1.toStage, "shortlisted");
  assert.equal(ev1.fromStage, "ingested");
  assert.equal(ev1.reason, "Matched Kubernetes & AWS requirements");

  // Step 2: Shortlisted -> Interview
  const ev2 = await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "interview",
    actorUserId: userId,
    timestamp: t2,
  });

  assert.equal(ev2.toStage, "interview");

  // Verify application record was updated in database
  const sql = await getSql();
  const appRows = await sql<{ pipeline_status: string }>`
    select pipeline_status from applications where id = ${applicationId}`;
  assert.equal(appRows[0]?.pipeline_status, "interview");
});

// ---------------------------------------------------------------------------
// 3. Cycle Times Analytics (Velocity Metrics)
// ---------------------------------------------------------------------------

test("Cycle Times: calculates time-to-shortlist, shortlist-to-interview, interview-to-offer", async () => {
  const { orgId, roleId, userId } = await seedTestOrgAndRole();
  const { candidateId, applicationId } = await seedCandidateAndApp(
    orgId,
    roleId,
    userId,
    "Ananya Deshmukh",
  );

  const MS_DAY = 1000 * 60 * 60 * 24;
  const baseTime = Date.now() - 30 * MS_DAY;

  const tSourced = new Date(baseTime).toISOString();
  const tShortlisted = new Date(baseTime + 3 * MS_DAY).toISOString(); // 3 days to shortlist
  const tInterview = new Date(baseTime + 7 * MS_DAY).toISOString(); // 4 days shortlist to interview
  const tOffered = new Date(baseTime + 15 * MS_DAY).toISOString(); // 8 days interview to offer
  const tAccepted = new Date(baseTime + 18 * MS_DAY).toISOString(); // 3 days offer to acceptance
  const tJoined = new Date(baseTime + 30 * MS_DAY).toISOString(); // 12 days acceptance to joining

  await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "sourced",
    timestamp: tSourced,
  });

  await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "shortlisted",
    timestamp: tShortlisted,
  });

  await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "interview",
    timestamp: tInterview,
  });

  await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "offered",
    timestamp: tOffered,
  });

  await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "offer_accepted",
    timestamp: tAccepted,
  });

  await recordStageTransition({
    orgId,
    applicationId,
    candidateId,
    roleId,
    toStage: "joined",
    timestamp: tJoined,
  });

  const report = await getFunnelAnalytics({ orgId, roleId });

  // Assert exact calculated cycle times
  assert.equal(report.cycleTimes.timeToShortlist.meanDays, 3.0);
  assert.equal(report.cycleTimes.shortlistToInterview.meanDays, 4.0);
  assert.equal(report.cycleTimes.interviewToOffer.meanDays, 8.0);
  assert.equal(report.cycleTimes.offerToAcceptance.meanDays, 3.0);
  assert.equal(report.cycleTimes.acceptanceToJoining.meanDays, 12.0);
  assert.equal(report.cycleTimes.totalTimeToHire.meanDays, 30.0);

  // Conversion rates check
  assert.equal(report.conversionRates.offerAcceptanceRate, 100.0);
  assert.equal(report.conversionRates.joiningRatio, 100.0);
  assert.equal(report.conversionRates.postOfferRenegeRate, 0.0);
});

// ---------------------------------------------------------------------------
// 4. Offer Acceptance & Post-Offer Renege / Drop-off Tracking
// ---------------------------------------------------------------------------

test("Offer Acceptance & Joining: detects offer rejections and post-acceptance reneges", async () => {
  const { orgId, roleId, userId } = await seedTestOrgAndRole();

  // Candidate A: Accepts offer and joins
  const candA = await seedCandidateAndApp(orgId, roleId, userId, "Candidate A (Joins)");
  await recordStageTransition({
    orgId,
    applicationId: candA.applicationId,
    candidateId: candA.candidateId,
    roleId,
    toStage: "offered",
  });
  await recordStageTransition({
    orgId,
    applicationId: candA.applicationId,
    candidateId: candA.candidateId,
    roleId,
    toStage: "offer_accepted",
  });
  await recordStageTransition({
    orgId,
    applicationId: candA.applicationId,
    candidateId: candA.candidateId,
    roleId,
    toStage: "joined",
  });

  // Candidate B: Declines the offer (Offer rejected)
  const candB = await seedCandidateAndApp(orgId, roleId, userId, "Candidate B (Declines)");
  await recordStageTransition({
    orgId,
    applicationId: candB.applicationId,
    candidateId: candB.candidateId,
    roleId,
    toStage: "offered",
  });
  await recordStageTransition({
    orgId,
    applicationId: candB.applicationId,
    candidateId: candB.candidateId,
    roleId,
    toStage: "offer_declined",
    reason: "Accepted higher counter-offer",
  });

  // Candidate C: Accepts offer but reneges before Day 1
  const candC = await seedCandidateAndApp(orgId, roleId, userId, "Candidate C (Reneges)");
  await recordStageTransition({
    orgId,
    applicationId: candC.applicationId,
    candidateId: candC.candidateId,
    roleId,
    toStage: "offered",
  });
  await recordStageTransition({
    orgId,
    applicationId: candC.applicationId,
    candidateId: candC.candidateId,
    roleId,
    toStage: "offer_accepted",
  });
  await recordStageTransition({
    orgId,
    applicationId: candC.applicationId,
    candidateId: candC.candidateId,
    roleId,
    toStage: "reneged",
    reason: "Did not show up on Day 1 DOJ",
  });

  const report = await getFunnelAnalytics({ orgId, roleId });

  // 3 offers extended: 2 accepted, 1 declined -> Offer acceptance = 2/3 = 66.7%
  assert.equal(report.stageCounts.totalOffered, 3);
  assert.equal(report.stageCounts.totalAccepted, 2);
  assert.equal(report.conversionRates.offerAcceptanceRate, 66.7);

  // 2 accepted offers: 1 joined, 1 reneged -> Joining ratio = 1/2 = 50%, Renege rate = 1/2 = 50%
  assert.equal(report.stageCounts.totalJoined, 1);
  assert.equal(report.stageCounts.totalReneged, 1);
  assert.equal(report.conversionRates.joiningRatio, 50.0);
  assert.equal(report.conversionRates.postOfferRenegeRate, 50.0);
});

// ---------------------------------------------------------------------------
// 5. Retention Milestones & Clawback Adjustments
// ---------------------------------------------------------------------------

test("Retention & Clawback: tracks 30/60/90-day milestones and early attrition deductions", async () => {
  const { orgId, roleId, userId } = await seedTestOrgAndRole();

  // Candidate 1: Retained past 90 days
  const cand1 = await seedCandidateAndApp(orgId, roleId, userId, "Pooja Hegde (Retained 90d)");
  await recordStageTransition({
    orgId,
    applicationId: cand1.applicationId,
    toStage: "joined",
  });
  await recordStageTransition({
    orgId,
    applicationId: cand1.applicationId,
    toStage: "retained_90d",
  });

  await recordPlacement({
    orgId,
    roleId,
    candidateId: cand1.candidateId,
    applicationId: cand1.applicationId,
    offeredCtc: 3000000, // ₹30 LPA
    feePercentage: 15.0, // ₹4.5L gross fee
    directSourcingCost: 30000,
    recruiterCommission: 70000,
    currency: "INR",
  });

  await updatePlacementLifecycle({
    applicationId: cand1.applicationId,
    joiningStatus: "joined",
    retentionStatus: "retained_90d",
    retentionDays: 95,
  });

  // Candidate 2: Early attrition at day 45 with clawback penalty
  const cand2 = await seedCandidateAndApp(orgId, roleId, userId, "Vikram Rathore (Early Attrited)");
  await recordStageTransition({
    orgId,
    applicationId: cand2.applicationId,
    toStage: "joined",
  });
  await recordStageTransition({
    orgId,
    applicationId: cand2.applicationId,
    toStage: "attrited_early",
    reason: "Resigned during probation on day 45",
  });

  await recordPlacement({
    orgId,
    roleId,
    candidateId: cand2.candidateId,
    applicationId: cand2.applicationId,
    offeredCtc: 2400000, // ₹24 LPA
    feePercentage: 15.0, // ₹3.6L gross fee
    directSourcingCost: 20000,
    recruiterCommission: 50000,
    currency: "INR",
  });

  // Client issues 50% clawback refund because candidate left before 90 days
  await updatePlacementLifecycle({
    applicationId: cand2.applicationId,
    joiningStatus: "joined",
    retentionStatus: "attrited_early",
    retentionDays: 45,
    clawbackAmount: 180000, // ₹1.8L refund to client
  });

  const report = await getFunnelAnalytics({ orgId, roleId });

  // Retention assertions
  assert.equal(report.stageCounts.totalJoined, 2);
  assert.equal(report.stageCounts.totalRetained90d, 1);
  assert.equal(report.stageCounts.totalEarlyAttrition, 1);
  assert.equal(report.conversionRates.retention90dRate, 50.0);

  // Financial clawback accounting
  assert.equal(report.grossMargin.totalClawbackLossInr, 180000);
});

// ---------------------------------------------------------------------------
// 6. Repeat Mandates Analytics across Corporate Accounts
// ---------------------------------------------------------------------------

test("Repeat Mandates: tracks mandates count, repeat mandate rate, and client breakdown", async () => {
  const sql = await getSql();
  const orgId = uid();
  const userId = uid();

  await sql`
    insert into organizations (id, name, slug, created_by, created_at, updated_at)
    values (${orgId}, 'Enterprise Staffing India', ${`slug-${orgId}`}, ${userId}, now(), now())`;

  // Mandate 1 for Reliance Retail (First mandate from client)
  await sql`
    insert into roles (
      id, org_id, user_id, company_name, company_stage, title, location,
      work_mode, employment_type, compensation_band, stack, must_haves,
      nice_to_haves, jd_text, status, client_id, mandate_number,
      is_repeat_mandate, created_at, updated_at
    ) values (
      ${uid()}, ${orgId}, ${userId}, 'Reliance Retail', 'series_b', 'Store GM', 'Mumbai',
      'onsite', 'full_time', '₹35 LPA', '[]', '[]', '[]', 'JD', 'open',
      'client-reliance-retail', 1, false, now(), now()
    )`;

  // Mandate 2 for Reliance Retail (Repeat mandate!)
  await sql`
    insert into roles (
      id, org_id, user_id, company_name, company_stage, title, location,
      work_mode, employment_type, compensation_band, stack, must_haves,
      nice_to_haves, jd_text, status, client_id, mandate_number,
      is_repeat_mandate, created_at, updated_at
    ) values (
      ${uid()}, ${orgId}, ${userId}, 'Reliance Retail', 'series_b', 'Supply Chain VP', 'Mumbai',
      'hybrid', 'full_time', '₹60 LPA', '[]', '[]', '[]', 'JD', 'open',
      'client-reliance-retail', 2, true, now(), now()
    )`;

  // Mandate 3 for Jio Platforms (First mandate)
  await sql`
    insert into roles (
      id, org_id, user_id, company_name, company_stage, title, location,
      work_mode, employment_type, compensation_band, stack, must_haves,
      nice_to_haves, jd_text, status, client_id, mandate_number,
      is_repeat_mandate, created_at, updated_at
    ) values (
      ${uid()}, ${orgId}, ${userId}, 'Jio Platforms', 'series_b', '5G Telecom Lead', 'Navi Mumbai',
      'onsite', 'full_time', '₹45 LPA', '[]', '[]', '[]', 'JD', 'open',
      'client-jio-platforms', 1, false, now(), now()
    )`;

  const report = await getFunnelAnalytics({ orgId });

  // Total 3 mandates, 1 repeat mandate -> Repeat mandate rate = 1/3 = 33.3%
  assert.equal(report.repeatMandates.totalMandates, 3);
  assert.equal(report.repeatMandates.repeatMandates, 1);
  assert.equal(report.repeatMandates.newClientMandates, 2);
  assert.equal(report.repeatMandates.repeatMandateRate, 33.3);
  assert.equal(report.repeatMandates.activeClientsCount, 2);
  assert.equal(report.repeatMandates.repeatClientsCount, 1);

  const relianceClient = report.repeatMandates.clientBreakdown.find(
    (c) => c.clientId === "client-reliance-retail",
  );
  assert.ok(relianceClient);
  assert.equal(relianceClient?.totalMandates, 2);
  assert.equal(relianceClient?.isRepeatClient, true);
});

// ---------------------------------------------------------------------------
// 7. Gross Margin & Commercial Accounting (INR and USD)
// ---------------------------------------------------------------------------

test("Gross Margin Accounting: records fees, recruiter commissions, direct costs, and net margin", async () => {
  const { orgId, roleId, userId } = await seedTestOrgAndRole();

  // Placement 1 in INR: ₹20L CTC @ 15% = ₹3,00,000 gross fee
  // Direct cost: ₹25,000, Commission: ₹50,000 -> Margin = ₹2,25,000
  const candInr = await seedCandidateAndApp(orgId, roleId, userId, "Aarav Patel (INR Placement)");
  const pInr = await recordPlacement({
    orgId,
    roleId,
    candidateId: candInr.candidateId,
    applicationId: candInr.applicationId,
    offeredCtc: 2000000,
    feePercentage: 15.0,
    directSourcingCost: 25000,
    recruiterCommission: 50000,
    currency: "INR",
  });

  assert.equal(pInr.grossPlacementFee, 300000);
  assert.equal(pInr.grossMarginAmount, 225000);
  assert.equal(pInr.grossMarginPercentage, 75.0);

  // Placement 2 in USD: $120,000 CTC @ 20% = $24,000 gross fee
  // Direct cost: $1,500, Commission: $3,500 -> Margin = $19,000 (79.2%)
  const candUsd = await seedCandidateAndApp(orgId, roleId, userId, "John Doe (USD Placement)");
  const pUsd = await recordPlacement({
    orgId,
    roleId,
    candidateId: candUsd.candidateId,
    applicationId: candUsd.applicationId,
    offeredCtc: 120000,
    feePercentage: 20.0,
    directSourcingCost: 1500,
    recruiterCommission: 3500,
    currency: "USD",
  });

  assert.equal(pUsd.grossPlacementFee, 24000);
  assert.equal(pUsd.grossMarginAmount, 19000);
  assert.equal(pUsd.grossMarginPercentage, 79.2);

  const report = await getFunnelAnalytics({ orgId, roleId });

  // INR totals
  assert.equal(report.grossMargin.totalGrossPlacementFeeInr, 300000);
  assert.equal(report.grossMargin.totalDirectCostInr, 25000);
  assert.equal(report.grossMargin.totalRecruiterCommissionInr, 50000);
  assert.equal(report.grossMargin.netGrossMarginAmountInr, 225000);

  // USD totals
  assert.equal(report.grossMargin.totalGrossPlacementFeeUsd, 24000);
  assert.equal(report.grossMargin.totalDirectCostUsd, 1500);
  assert.equal(report.grossMargin.totalRecruiterCommissionUsd, 3500);
  assert.equal(report.grossMargin.netGrossMarginAmountUsd, 19000);

  // Placements count & Role breakdown
  assert.equal(report.grossMargin.totalPlacements, 2);
  assert.equal(report.grossMargin.roleBreakdown.length, 1);
  assert.equal(report.grossMargin.roleBreakdown[0]?.placementsCount, 2);
});
