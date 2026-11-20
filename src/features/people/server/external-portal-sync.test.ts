import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import {
  getRoleExternalPortalConfig,
  updateRoleExternalPortalConfig,
  processExternalPortalIngestion,
  getRolePortalSyncLogs,
} from "./external-portal-sync.server.ts";
import { loadHitlCheckpoints } from "./autonomous-portal.server.ts";

test("External Portal Sync: Initializes dormant config and updates toggle with authorization", async () => {
  const sql = await getSql();
  const orgId = `org_${randomUUID().slice(0, 8)}`;
  const userId = `usr_${randomUUID().slice(0, 8)}`;
  const roleId = `role_${randomUUID().slice(0, 8)}`;

  // Create organization and role
  const slug = `org-slug-${randomUUID().slice(0, 8)}`;
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, 'Test Acme Corp', ${slug}, ${userId}, 30)
  `;

  await sql`
    insert into roles (
      id, user_id, org_id, company_name, company_stage, title, location,
      work_mode, employment_type, stack, must_haves, jd_text, created_at, updated_at
    ) values (
      ${roleId}, ${userId}, ${orgId}, 'Acme Corp', 'Series B',
      'Principal Distributed Engineer', 'Bengaluru', 'hybrid', 'full_time',
      '["Go", "Kubernetes", "Kafka", "PostgreSQL"]',
      '["5+ years distributed systems", "High-throughput Kafka"]',
      'Looking for a Principal Distributed Engineer experienced in Go and Kafka.',
      now(), now()
    )
  `;

  // 1. Initial config should be disabled/dormant with unique webhook token
  const initial = await getRoleExternalPortalConfig({ roleId, orgId });
  assert.equal(initial.roleId, roleId);
  assert.equal(initial.isEnabled, false);
  assert.ok(initial.webhookToken.startsWith("wh_tok_"));

  // 2. Reject enabling with an invalid / insecure URL
  await assert.rejects(
    async () => {
      await updateRoleExternalPortalConfig({
        roleId,
        orgId,
        userId,
        isEnabled: true,
        portalJobUrl: "http://insecure-site.com/careers/123", // Insecure HTTP
      });
    },
    /Invalid Career Portal URL: Insecure protocol/,
  );

  // 3. Reject enabling with loopback SSRF URL
  await assert.rejects(
    async () => {
      await updateRoleExternalPortalConfig({
        roleId,
        orgId,
        userId,
        isEnabled: true,
        portalJobUrl: "https://127.0.0.1:8080/careers/123", // Loopback
      });
    },
    /SSRF defense/,
  );

  // 4. Successfully enable with valid HTTPS official company career portal URL
  const updated = await updateRoleExternalPortalConfig({
    roleId,
    orgId,
    userId,
    isEnabled: true,
    portalJobUrl: "https://careers.acmecorp.com/openings/principal-engineer",
    syncMode: "webhook_push",
  });

  assert.equal(updated.isEnabled, true);
  assert.equal(updated.portalJobUrl, "https://careers.acmecorp.com/openings/principal-engineer");
  assert.equal(updated.authorizedByUserId, userId);
  assert.ok(updated.authorizedAt != null);

  // 5. Ingest candidate directly from company career portal
  const ingestion = await processExternalPortalIngestion({
    roleId,
    orgId,
    syncType: "webhook",
    payload: {
      fullName: "Ananya Deshmukh",
      email: "ananya.deshmukh@example.com",
      phone: "+91 9988776655",
      location: "Bengaluru",
      resumeText: `
        Ananya Deshmukh
        Staff Distributed Systems Engineer | Bengaluru
        Email: ananya.deshmukh@example.com | Phone: +91 9988776655

        Experience:
        Fintech Infrastructure (2019 - Present)
        - Designed and deployed event-driven payment ledger in Go and PostgreSQL handling 40k events/sec.
        - Deployed microservices onto multi-cluster Kubernetes on AWS with Kafka streaming pipelines.
      `,
    },
  });

  assert.equal(ingestion.ok, true);
  assert.equal(ingestion.candidateName, "Ananya Deshmukh");
  assert.ok(ingestion.score >= 70, `Score ${ingestion.score} should reflect strong Go and Kafka match`);
  assert.equal(ingestion.shortlisted, true, "Should automatically shortlist high-scoring candidate");

  // 6. Verify application attribution in database
  const [appRow] = await sql`
    select * from applications where id = ${ingestion.applicationId} limit 1
  `;
  assert.ok(appRow);
  assert.equal(appRow.source, "official_career_portal");

  // 7. Verify candidate is routed to Human-in-the-Loop review queue
  const checkpoints = await loadHitlCheckpoints({ orgId, roleId });
  assert.ok(checkpoints.length >= 1, "Must create HITL checkpoint for recruiter review");
  assert.equal(checkpoints[0].candidateName, "Ananya Deshmukh");
  assert.equal(checkpoints[0].checkpointType, "shortlist_interview");
});
