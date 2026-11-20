import assert from "node:assert/strict";
import test from "node:test";
import {
  STATUTORY_PENALTIES,
  calculateComplianceScore,
  classifyBreachSeverity,
  generateDpbiBreachReport,
  getRule4NoticeSpec,
  validateProvenance,
} from "./dpdp.ts";

test("calculateComplianceScore: fully compliant organization scores 100 with zero penalty exposure", () => {
  const result = calculateComplianceScore({
    dpaSigned: true,
    dpaSignedVersion: "2026.11",
    totalCandidates: 50,
    unconsentedCandidates: 0,
    unverifiedScrapedCandidates: 0,
    retentionDays: 180,
    candidatesExceedingRetention: 0,
    dpoConfigured: true,
    pendingDsarCount: 0,
    overdueDsarCount: 0,
    unresolvedBreachesCount: 0,
  });

  assert.equal(result.overallScore, 100);
  assert.equal(result.tier, "COMPLIANT");
  assert.equal(result.penaltyExposureTier, "NONE");
  assert.equal(result.maxPotentialPenaltyInr, 0);
  assert.equal(result.breakdown.dpaAndLegal.status, "PASS");
  assert.equal(result.breakdown.consentAndProvenance.status, "PASS");
  assert.equal(result.breakdown.retentionHygiene.status, "PASS");
  assert.equal(result.breakdown.candidateRightsAndDpo.status, "PASS");
  assert.equal(result.breakdown.securityAndSafeguards.status, "PASS");
  assert.equal(result.remediationActions.length, 0);
});

test("calculateComplianceScore: unsigned DPA penalizes score and marks elevated penalty exposure", () => {
  const result = calculateComplianceScore({
    dpaSigned: false,
    totalCandidates: 20,
    unconsentedCandidates: 0,
    unverifiedScrapedCandidates: 0,
    retentionDays: 365,
    candidatesExceedingRetention: 0,
    dpoConfigured: true,
    pendingDsarCount: 0,
    overdueDsarCount: 0,
    unresolvedBreachesCount: 0,
  });

  assert.equal(result.overallScore, 80);
  assert.equal(result.tier, "GOOD");
  assert.equal(result.penaltyExposureTier, "ELEVATED");
  assert.equal(result.breakdown.dpaAndLegal.status, "FAIL");
  assert(result.remediationActions.some((a) => a.includes("Data Processing Addendum")));
});

test("calculateComplianceScore: mass scraping risk penalizes score and elevates penalty tier", () => {
  const result = calculateComplianceScore({
    dpaSigned: true,
    totalCandidates: 100,
    unconsentedCandidates: 20,
    unverifiedScrapedCandidates: 30, // 30% unverified scrapes
    retentionDays: 365,
    candidatesExceedingRetention: 0,
    dpoConfigured: true,
    pendingDsarCount: 0,
    overdueDsarCount: 0,
    unresolvedBreachesCount: 0,
  });

  assert(result.overallScore < 85);
  assert.equal(result.penaltyExposureTier, "ELEVATED");
  assert(result.remediationActions.some((a) => a.includes("mass-scraping liability")));
});

test("calculateComplianceScore: unresolved breach triggers CRITICAL penalty exposure up to ₹250 Cr", () => {
  const result = calculateComplianceScore({
    dpaSigned: true,
    totalCandidates: 100,
    unconsentedCandidates: 0,
    unverifiedScrapedCandidates: 0,
    retentionDays: 365,
    candidatesExceedingRetention: 0,
    dpoConfigured: true,
    pendingDsarCount: 0,
    overdueDsarCount: 0,
    unresolvedBreachesCount: 1, // Active breach!
  });

  assert.equal(result.penaltyExposureTier, "CRITICAL");
  assert.equal(
    result.maxPotentialPenaltyInr,
    STATUTORY_PENALTIES.BREACH_SECURITY_SAFEGUARD_FAILURE.maxPenaltyInr,
  );
  assert(result.remediationActions.some((a) => a.includes("IMMEDIATE: Address unresolved security incidents")));
});

test("calculateComplianceScore: overdue DSAR drops rights score and triggers remediation", () => {
  const result = calculateComplianceScore({
    dpaSigned: true,
    totalCandidates: 50,
    unconsentedCandidates: 0,
    unverifiedScrapedCandidates: 0,
    retentionDays: 180,
    candidatesExceedingRetention: 0,
    dpoConfigured: true,
    pendingDsarCount: 2,
    overdueDsarCount: 1, // 1 overdue SLA
    unresolvedBreachesCount: 0,
  });

  assert.equal(result.breakdown.candidateRightsAndDpo.score, 10);
  assert.equal(result.breakdown.candidateRightsAndDpo.status, "WARN");
  assert(result.remediationActions.some((a) => a.includes("exceeded the statutory 30-day SLA")));
});

test("classifyBreachSeverity: categorizes high-volume and exfiltrated incidents properly", () => {
  const critical = classifyBreachSeverity({
    affectedCandidatesCount: 150,
    dataCategories: ["resume_raw_bytes", "email"],
    isExfiltrationConfirmed: true,
  });
  assert.equal(critical.severity, "critical");
  assert.equal(critical.requiresDpbiNotification, true);
  assert.equal(critical.notificationDeadlineHours, 72);

  const minor = classifyBreachSeverity({
    affectedCandidatesCount: 0,
    dataCategories: ["user_agent"],
    isExfiltrationConfirmed: false,
  });
  assert.equal(minor.severity, "low");
  assert.equal(minor.requiresDpbiNotification, false);
});

test("generateDpbiBreachReport: formats all required statutory DPBI fields", () => {
  const report = generateDpbiBreachReport({
    incidentId: "inc-12345678",
    orgName: "Acme Corp",
    detectedAtIso: "2026-11-13T10:00:00Z",
    affectedCount: 42,
    dataCategories: ["resume_raw_bytes", "phone"],
    rootCause: "Compromised recruiter session token",
    containmentActions: "Revoked session, rotated JWT secret, isolated IP range.",
    dpoContact: {
      name: "Rohit Sharma",
      email: "dpo@acme.com",
      phone: "+91-9876543210",
    },
  });

  assert(report.toLowerCase().includes("data protection board of india"));
  assert(report.includes("Acme Corp"));
  assert(report.includes("42"));
  assert(report.includes("Rohit Sharma"));
  assert(report.includes("Section 8(6)"));
});

test("validateProvenance: flags unverified scrape and permits direct portals", () => {
  const direct = validateProvenance("direct_portal");
  assert.equal(direct.isCompliant, true);
  assert.equal(direct.requiresOutreachConsent, false);

  const scrape = validateProvenance("unverified_scrape");
  assert.equal(scrape.isCompliant, false);
  assert.equal(scrape.requiresOutreachConsent, true);
  assert(scrape.riskNotice?.includes("WARNING: Unverified scraped data"));
});

test("getRule4NoticeSpec: contains required Rule 4 notice elements", () => {
  const spec = getRule4NoticeSpec("Vetta Talent");
  assert.equal(spec.fiduciaryName, "Vetta Talent");
  assert.equal(spec.purposes.length, 3);
  assert(spec.withdrawalRight.includes("right to withdraw"));
  assert(spec.grievanceContact.includes("Grievance Officer"));
});
