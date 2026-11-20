import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import {
  createOrUpdatePreboardingOffer,
  getPreboardingOffers,
  getPreboardingOfferById,
  logPreboardingSignal,
  getPreboardingSignals,
  getPreboardingInterventions,
  executeInterventionPlaybook,
  getPreboardingDashboardSummary,
  getSilverMedalistCandidates,
  warmSilverMedalistStandby,
  updateTutorialProgress,
  getTutorialProgress,
} from "./offer-guard.server.ts";

test("Offer Guard Server: Full preboarding lifecycle, telemetry signals, hazard escalation, and silver medalist standby", async () => {
  const sql = await getSql();
  const orgId = `org_${randomUUID().slice(0, 8)}`;
  const userId = `usr_${randomUUID().slice(0, 8)}`;
  const roleId = `role_${randomUUID().slice(0, 8)}`;
  const candId1 = `cand_${randomUUID().slice(0, 8)}`;
  const candId2 = `cand_${randomUUID().slice(0, 8)}`;
  const appId1 = `app_${randomUUID().slice(0, 8)}`;
  const appId2 = `app_${randomUUID().slice(0, 8)}`;

  // 1. Setup organization, role, candidates and applications
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, 'Zepto Tech', ${`org-slug-${randomUUID().slice(0, 8)}`}, ${userId}, 30)
  `;

  await sql`
    insert into roles (
      id, user_id, org_id, company_name, company_stage, title, location,
      work_mode, employment_type, stack, must_haves, jd_text, created_at, updated_at
    ) values (
      ${roleId}, ${userId}, ${orgId}, 'Zepto', 'Series B',
      'Staff Backend Engineer', 'Bengaluru', 'onsite', 'full_time',
      '["Go", "PostgreSQL", "Redis"]', '["High-throughput systems"]',
      'Looking for a Staff Engineer.', now(), now()
    )
  `;

  // Candidate 1 (Offered)
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, current_title, current_company, resume_text)
    values (${candId1}, ${userId}, ${orgId}, 'Rahul Sharma', 'rahul@example.com', '+919876543210', 'Senior Engineer', 'TCS', 'Experienced engineer in TCS serving 75-day notice')
  `;

  await sql`
    insert into applications (id, user_id, role_id, candidate_id, rank_score, pipeline_status)
    values (${appId1}, ${userId}, ${roleId}, ${candId1}, 92, 'offered')
  `;

  // Candidate 2 (Silver Medalist)
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, current_title, current_company, resume_text)
    values (${candId2}, ${userId}, ${orgId}, 'Priya Patel', 'priya@example.com', '+919876543211', 'Senior Backend Engineer', 'Swiggy', 'Experienced engineer in Swiggy')
  `;

  await sql`
    insert into applications (id, user_id, role_id, candidate_id, rank_score, pipeline_status)
    values (${appId2}, ${userId}, ${roleId}, ${candId2}, 88, 'shortlisted')
  `;

  // 2. Create Preboarding Offer for Candidate 1
  const targetJoining = new Date(Date.now() + 75 * 24 * 60 * 60 * 1000).toISOString();
  const offer = await createOrUpdatePreboardingOffer({
    orgId,
    roleId,
    candidateId: candId1,
    applicationId: appId1,
    targetJoiningDate: targetJoining,
    totalNoticeDays: 75,
    offeredCtc: 4500000, // ₹45 Lakh
    currentCtc: 3200000, // ₹32 Lakh (40% hike)
    placementFee: 675000, // ₹6.75 Lakh fee protected
    currency: "INR",
    currentEmployerType: "tier1_it_services",
    notes: "Accepted offer on Friday; needs to submit resignation",
  });

  assert.equal(offer.orgId, orgId);
  assert.equal(offer.totalNoticeDays, 75);
  assert.equal(offer.offeredCtc, 4500000);
  assert.equal(offer.placementFee, 675000);
  assert.ok(offer.hazardScore > 0, "Should have computed baseline hazard");

  // 3. Verify Dashboard Aggregations
  const dashboard = await getPreboardingDashboardSummary(orgId);
  assert.equal(dashboard.activeOffers, 1);
  assert.equal(dashboard.totalFeeProtected, 675000);
  assert.equal(dashboard.avgNoticeDays, 75);

  // 4. Log Micro-Telemetry Signal: Response Latency Drift (2.8x slower)
  const signalResult1 = await logPreboardingSignal({
    offerId: offer.id,
    signalType: "response_latency",
    signalValue: 2.8,
    notes: "Candidate took 28 hours to reply to pre-boarding WhatsApp check-in",
  });

  assert.equal(signalResult1.signal.signalType, "response_latency");
  assert.equal(signalResult1.signal.signalValue, 2.8);
  assert.ok(
    signalResult1.updatedAssessment.hazardScore >= offer.hazardScore,
    "Hazard score should escalate when response latency drifts",
  );

  // 5. Log Evasive Recruiter Notes
  const signalResult2 = await logPreboardingSignal({
    offerId: offer.id,
    signalType: "recruiter_sentiment",
    signalValue: 1.0,
    notes: "Candidate mentioned manager is proposing an internal retention retention bonus",
  });

  assert.ok(signalResult2.updatedAssessment.primaryDrivers.length > 0);

  // 6. Check Interventions generated
  const interventions = await getPreboardingInterventions(offer.id);
  assert.ok(interventions.length > 0, "Intervention playbooks should be recommended");

  // 7. Execute / Complete an Intervention
  const completed = await executeInterventionPlaybook({
    interventionId: interventions[0].id,
    status: "completed",
    actorUserId: userId,
    outcomeNotes: "Spoke with candidate and reinforced engineering ownership scope",
  });
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt !== null);

  // 8. Find Silver Medalists for this role
  const silverList = await getSilverMedalistCandidates(roleId, candId1);
  assert.equal(silverList.length, 1);
  assert.equal(silverList[0].candidateName, "Priya Patel");
  assert.equal(silverList[0].rankScore, 88);

  // 9. Warm Silver Medalist Standby
  await warmSilverMedalistStandby(offer.id, silverList[0].id);
  const refreshedOffer = await getPreboardingOfferById(offer.id);
  assert.equal(refreshedOffer?.silverMedalistAppId, silverList[0].id);
  assert.equal(refreshedOffer?.silverMedalistWarmed, true);

  // 10. Tutorial Progress persistence
  await updateTutorialProgress(orgId, userId, "tut-new-1", true);
  const tutProgress = await getTutorialProgress(orgId, userId);
  assert.equal(tutProgress["tut-new-1"], true);
});
