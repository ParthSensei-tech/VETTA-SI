import test from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureUserOrg } from "./org.server.ts";
import { hasPermission } from "./rbac.ts";
import {
  assertOrgPermission,
  addOrgMember,
  isAuthorizedOperator,
  assertAuthorizedOperator,
} from "./rbac.server.ts";
import {
  getObservabilitySummary,
  retryFailedJobs,
  acknowledgeAlert,
  resolveAlert,
} from "../observability/observability.server.ts";

function uid(): string {
  return crypto.randomUUID();
}

test("RBAC defines observability:view and observability:manage strictly for owner and admin", () => {
  // Owner permissions
  assert.equal(hasPermission("owner", "observability:view"), true);
  assert.equal(hasPermission("owner", "observability:manage"), true);

  // Admin permissions
  assert.equal(hasPermission("admin", "observability:view"), true);
  assert.equal(hasPermission("admin", "observability:manage"), true);

  // Recruiter and non-admin roles must NOT have observability permissions
  assert.equal(hasPermission("lead_recruiter", "observability:view"), false);
  assert.equal(hasPermission("lead_recruiter", "observability:manage"), false);
  assert.equal(hasPermission("recruiter", "observability:view"), false);
  assert.equal(hasPermission("recruiter", "observability:manage"), false);
  assert.equal(hasPermission("hiring_manager", "observability:view"), false);
  assert.equal(hasPermission("hiring_manager", "observability:manage"), false);
  assert.equal(hasPermission("interviewer", "observability:view"), false);
  assert.equal(hasPermission("interviewer", "observability:manage"), false);
  assert.equal(hasPermission("sourcer", "observability:view"), false);
  assert.equal(hasPermission("sourcer", "observability:manage"), false);
});

test("assertOrgPermission blocks recruiters and allows owner/admin for observability operations", async () => {
  const ownerId = `user-obs-owner-${uid()}`;
  const adminId = `user-obs-admin-${uid()}`;
  const recruiterId = `user-obs-recruiter-${uid()}`;
  const externalUserId = `user-obs-external-${uid()}`;

  const org = await ensureUserOrg(ownerId, "Reliance Jio Telecommunications");

  // Add admin and recruiter to the org
  await addOrgMember({
    orgId: org.orgId,
    userId: adminId,
    role: "admin",
    actorUserId: ownerId,
    title: "System Administrator",
  });

  await addOrgMember({
    orgId: org.orgId,
    userId: recruiterId,
    role: "recruiter",
    actorUserId: ownerId,
    title: "Talent Recruiter",
  });

  // 1. Owner checks
  const ownerMember = await assertOrgPermission(ownerId, org.orgId, "observability:view");
  assert.equal(ownerMember.role, "owner");
  await assertOrgPermission(ownerId, org.orgId, "observability:manage");

  // 2. Admin checks
  const adminMember = await assertOrgPermission(adminId, org.orgId, "observability:view");
  assert.equal(adminMember.role, "admin");
  await assertOrgPermission(adminId, org.orgId, "observability:manage");

  // 3. Recruiter checks (must fail)
  await assert.rejects(
    async () => {
      await assertOrgPermission(recruiterId, org.orgId, "observability:view");
    },
    {
      message: /Forbidden: Role 'recruiter' lacks 'observability:view' permission/,
    },
  );

  await assert.rejects(
    async () => {
      await assertOrgPermission(recruiterId, org.orgId, "observability:manage");
    },
    {
      message: /Forbidden: Role 'recruiter' lacks 'observability:manage' permission/,
    },
  );

  // 4. External non-member check (must fail with Unauthorized)
  await assert.rejects(
    async () => {
      await assertOrgPermission(externalUserId, org.orgId, "observability:view");
    },
    {
      message: /Unauthorized: User .* is not a member of organization/,
    },
  );
});

test("isAuthorizedOperator recognizes built-in identities, env configs, and system org members", async () => {
  // Built-in identities
  assert.equal(await isAuthorizedOperator("system"), true);
  assert.equal(await isAuthorizedOperator("operator"), true);
  assert.equal(await isAuthorizedOperator("system_admin"), true);

  // Environment variable operator
  process.env.OPERATOR_USER_IDS = "platform-sec-op,ops-lead-42";
  assert.equal(await isAuthorizedOperator("platform-sec-op"), true);
  assert.equal(await isAuthorizedOperator("ops-lead-42"), true);

  // Platform admin env
  process.env.PLATFORM_ADMIN_USER_ID = "root-admin-user";
  assert.equal(await isAuthorizedOperator("root-admin-user"), true);

  // Ordinary user should not be operator
  const normalUserId = `normal-user-${uid()}`;
  assert.equal(await isAuthorizedOperator(normalUserId), false);

  await assert.rejects(
    async () => {
      await assertAuthorizedOperator(normalUserId);
    },
    {
      message: /Forbidden: User '.*' is not an authorized system operator/,
    },
  );

  // User who is owner of a system organization (slug starts with 'system')
  const sysAdminId = `sysadmin-${uid()}`;
  const sql = await getSql();
  const sysOrgId = uid();
  await sql`
    insert into organizations (id, name, slug, created_by)
    values (${sysOrgId}, 'System Infrastructure Operations', ${`system-ops-${uid().slice(0, 8)}`}, ${sysAdminId})`;
  await sql`
    insert into organization_members (id, org_id, user_id, role, status)
    values (${uid()}, ${sysOrgId}, ${sysAdminId}, 'owner', 'active')`;

  assert.equal(await isAuthorizedOperator(sysAdminId), true);
  await assert.doesNotReject(async () => {
    await assertAuthorizedOperator(sysAdminId);
  });
});

test("retryFailedJobs blocks un-scoped execution and strictly confines retries to tenant organization", async () => {
  const sql = await getSql();

  // 1. Un-scoped execution without orgId or operator must throw error
  await assert.rejects(
    async () => {
      await retryFailedJobs();
    },
    {
      message: /Organization scope or operator authorization is required to retry failed jobs/,
    },
  );

  // 2. Setup two distinct organizations: Tenant A and Tenant B
  const userA = `user-a-${uid()}`;
  const userB = `user-b-${uid()}`;
  const orgA = await ensureUserOrg(userA, "Reliance Digital Services");
  const orgB = await ensureUserOrg(userB, "Jio Financial Services");

  const roleA = uid();
  const roleB = uid();
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleA}, ${userA}, 'Reliance', 'growth', 'Lead Architect', 'Mumbai', 'open', ${orgA.orgId})`;
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleB}, ${userB}, 'Jio', 'growth', 'Data Engineer', 'Navi Mumbai', 'open', ${orgB.orgId})`;

  const batchA = uid();
  const batchB = uid();
  await sql`
    insert into ingest_batches (id, user_id, role_id, org_id, source_name, status)
    values (${batchA}, ${userA}, ${roleA}, ${orgA.orgId}, 'batch-a.zip', 'failed')`;
  await sql`
    insert into ingest_batches (id, user_id, role_id, org_id, source_name, status)
    values (${batchB}, ${userB}, ${roleB}, ${orgB.orgId}, 'batch-b.zip', 'failed')`;

  const jobA1 = uid();
  const jobA2 = uid();
  const jobB1 = uid();
  const jobB2 = uid();

  await sql`
    insert into ingest_jobs (id, user_id, batch_id, role_id, org_id, filename, status, error)
    values
      (${jobA1}, ${userA}, ${batchA}, ${roleA}, ${orgA.orgId}, 'resume-a1.pdf', 'failed', 'Parser timeout'),
      (${jobA2}, ${userA}, ${batchA}, ${roleA}, ${orgA.orgId}, 'resume-a2.pdf', 'failed', 'Rate limited'),
      (${jobB1}, ${userB}, ${batchB}, ${roleB}, ${orgB.orgId}, 'resume-b1.pdf', 'failed', 'Invalid format'),
      (${jobB2}, ${userB}, ${batchB}, ${roleB}, ${orgB.orgId}, 'resume-b2.pdf', 'failed', 'Network fault')`;

  // 3. Cross-tenant attempt: Tenant A tries to retry Tenant B's specific job
  const crossRetryCount = await retryFailedJobs({
    jobId: jobB1,
    orgId: orgA.orgId,
  });
  assert.equal(crossRetryCount, 0, "Tenant A cannot retry Tenant B's job");

  const checkB1 = await sql<{ status: string }>`select status from ingest_jobs where id = ${jobB1}`;
  assert.equal(checkB1[0]?.status, "failed", "Tenant B's job remains failed");

  // 4. Cross-tenant attempt: Tenant A tries to retry Tenant B's batch
  const crossBatchRetry = await retryFailedJobs({
    batchId: batchB,
    orgId: orgA.orgId,
  });
  assert.equal(crossBatchRetry, 0, "Tenant A cannot retry Tenant B's batch");

  // 5. Tenant A retries all its own failed jobs (no jobId or batchId provided)
  const retriedA = await retryFailedJobs({ orgId: orgA.orgId });
  assert.equal(retriedA, 2, "Tenant A successfully retried only its 2 failed jobs");

  // Verify Tenant A's jobs are queued
  const statusA1 = await sql<{
    status: string;
  }>`select status from ingest_jobs where id = ${jobA1}`;
  const statusA2 = await sql<{
    status: string;
  }>`select status from ingest_jobs where id = ${jobA2}`;
  assert.equal(statusA1[0]?.status, "queued");
  assert.equal(statusA2[0]?.status, "queued");

  // Verify Tenant B's jobs are STILL failed (ZERO cross-tenant bleed)
  const statusB1 = await sql<{
    status: string;
  }>`select status from ingest_jobs where id = ${jobB1}`;
  const statusB2 = await sql<{
    status: string;
  }>`select status from ingest_jobs where id = ${jobB2}`;
  assert.equal(statusB1[0]?.status, "failed");
  assert.equal(statusB2[0]?.status, "failed");

  // 6. Authorized operator can perform global retry across tenants
  const operatorRetried = await retryFailedJobs({ isOperator: true });
  assert.ok(operatorRetried >= 2, "Operator retried all remaining failed jobs across tenants");

  const finalB1 = await sql<{ status: string }>`select status from ingest_jobs where id = ${jobB1}`;
  assert.equal(finalB1[0]?.status, "queued");
});

test("getObservabilitySummary isolates failed jobs and telemetry by organization", async () => {
  const sql = await getSql();

  const userX = `user-x-${uid()}`;
  const userY = `user-y-${uid()}`;
  const orgX = await ensureUserOrg(userX, "Jio Telecom Network Engineering");
  const orgY = await ensureUserOrg(userY, "Reliance Retail Supply Chain");

  const roleX = uid();
  const roleY = uid();
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleX}, ${userX}, 'Jio', 'growth', 'Network Engineer', 'Mumbai', 'open', ${orgX.orgId})`;
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleY}, ${userY}, 'Reliance', 'growth', 'Supply Chain Lead', 'Bangalore', 'open', ${orgY.orgId})`;

  const batchX = uid();
  const batchY = uid();
  await sql`
    insert into ingest_batches (id, user_id, role_id, org_id, source_name, status)
    values (${batchX}, ${userX}, ${roleX}, ${orgX.orgId}, 'telecom.zip', 'failed')`;
  await sql`
    insert into ingest_batches (id, user_id, role_id, org_id, source_name, status)
    values (${batchY}, ${userY}, ${roleY}, ${orgY.orgId}, 'retail.zip', 'failed')`;

  const jobX = uid();
  const jobY = uid();
  await sql`
    insert into ingest_jobs (id, user_id, batch_id, role_id, org_id, filename, status, error)
    values
      (${jobX}, ${userX}, ${batchX}, ${roleX}, ${orgX.orgId}, 'telecom-candidate.pdf', 'failed', 'Syntax error'),
      (${jobY}, ${userY}, ${batchY}, ${roleY}, ${orgY.orgId}, 'retail-candidate.pdf', 'failed', 'Timeout')`;

  // Fetch summary for Org X
  const summaryX = await getObservabilitySummary({ orgId: orgX.orgId });
  const failedJobIdsX = summaryX.failedJobs.map((j) => j.id);

  assert.ok(failedJobIdsX.includes(jobX), "Summary for Org X must include Org X's failed job");
  assert.ok(!failedJobIdsX.includes(jobY), "Summary for Org X must NOT include Org Y's failed job");

  // Fetch summary for Org Y
  const summaryY = await getObservabilitySummary({ orgId: orgY.orgId });
  const failedJobIdsY = summaryY.failedJobs.map((j) => j.id);

  assert.ok(failedJobIdsY.includes(jobY), "Summary for Org Y must include Org Y's failed job");
  assert.ok(!failedJobIdsY.includes(jobX), "Summary for Org Y must NOT include Org X's failed job");

  // Clean up
  await retryFailedJobs({ orgId: orgX.orgId });
  await retryFailedJobs({ orgId: orgY.orgId });
});
