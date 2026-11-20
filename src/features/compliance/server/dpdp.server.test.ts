import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import {
  auditOrgDpdpCompliance,
  configureGrievanceOfficer,
  createDsarRequest,
  generateDpbiFiling,
  listBreachIncidents,
  listDsarRequests,
  logBreachIncident,
  recordDpaAgreement,
  resolveDsarRequest,
} from "./dpdp.server.ts";

test("DPDP Compliance Server Service: Full lifecycle audit, DPA agreement, DPO setup, DSAR handling, and DPBI breach logging", async () => {
  const sql = await getSql();
  const orgId = `org_${randomUUID().slice(0, 8)}`;
  const userId = `usr_${randomUUID().slice(0, 8)}`;
  const slug = `slug-${randomUUID().slice(0, 8)}`;

  // 1. Create test organization
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, 'Tata Technologies', ${slug}, ${userId}, 180)`;

  // 2. Initial audit before any DPA or DPO setup
  const initialAudit = await auditOrgDpdpCompliance(orgId);
  assert.equal(initialAudit.stats.dpaSigned, false);
  assert.equal(initialAudit.stats.dpoConfigured, false);
  assert(initialAudit.audit.overallScore < 85);

  // 3. Record enterprise DPA agreement
  const dpa = await recordDpaAgreement({
    orgId,
    userId,
    signerName: "Vikram Sarabhai",
    signerTitle: "Chief Legal Officer",
    ipAddress: "14.139.128.5",
  });
  assert.equal(dpa.signerName, "Vikram Sarabhai");
  assert.equal(dpa.version, "2026.11-R4");

  // 4. Configure Grievance Redressal / Data Protection Officer
  const dpo = await configureGrievanceOfficer({
    orgId,
    officerName: "Ananya Iyer",
    officerEmail: "dpo@tatatech.com",
    officerPhone: "+91-9876543210",
    physicalAddress: "Level 8, T-Hub Phase 2, Madhapur, Hyderabad, Telangana 500081",
  });
  assert.equal(dpo.officerName, "Ananya Iyer");

  // 5. Post-DPA audit
  const auditAfterSetup = await auditOrgDpdpCompliance(orgId);
  assert.equal(auditAfterSetup.stats.dpaSigned, true);
  assert.equal(auditAfterSetup.stats.dpoConfigured, true);
  assert.equal(auditAfterSetup.audit.breakdown.dpaAndLegal.status, "PASS");
  assert.equal(auditAfterSetup.audit.breakdown.candidateRightsAndDpo.status, "PASS");

  // 6. Create a candidate and a DSAR Access Summary request
  const candId = `cand_${randomUUID().slice(0, 8)}`;
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, resume_text, provenance_type)
    values (${candId}, ${userId}, ${orgId}, 'Rahul Verma', 'rahul@example.com', '+919999988888', 'Resume text', 'direct_portal')`;

  const dsar = await createDsarRequest({
    orgId,
    candidateId: candId,
    requestType: "access_summary",
    subjectEmail: "rahul@example.com",
    subjectName: "Rahul Verma",
    details: "I request a full summary of personal data and AI ranking traces processed for my profile.",
  });
  assert.equal(dsar.status, "pending");
  assert.equal(dsar.daysRemaining, 30);

  // List DSAR requests
  const dsarList = await listDsarRequests(orgId);
  assert.equal(dsarList.length, 1);
  assert.equal(dsarList[0]?.subjectEmail, "rahul@example.com");

  // Resolve DSAR request
  await resolveDsarRequest({
    orgId,
    requestId: dsar.id,
    resolvedByUserId: userId,
    resolutionNotes: "Dispatched candidate personal data access export via secure candidate link.",
    status: "resolved",
  });
  const resolvedList = await listDsarRequests(orgId);
  assert.equal(resolvedList[0]?.status, "resolved");

  // 7. Log a Personal Data Breach Incident and generate DPBI filing
  const breach = await logBreachIncident({
    orgId,
    title: "Suspicious API bulk query anomaly",
    affectedCandidatesCount: 15,
    dataCategories: ["resume_raw_bytes", "phone"],
    rootCause: "Compromised recruiter session token accessed from unverified IP",
    containmentActions: "Revoked session, rotated session tokens, enforced MFA on recruiter account.",
    isExfiltrationConfirmed: false,
  });
  assert.equal(breach.severity, "high");

  const incidents = await listBreachIncidents(orgId);
  assert.equal(incidents.length, 1);

  const filing = await generateDpbiFiling({ orgId, incidentId: breach.id });
  assert(filing.toLowerCase().includes("data protection board of india"));
  assert(filing.includes("Tata Technologies"));
  assert(filing.includes("Ananya Iyer"));
});
