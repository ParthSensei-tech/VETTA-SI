import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import { isPipelineExit, reachedShortlist } from "../../marketing/domain/vetta-index.ts";
import { recordPipelineTrail } from "./pipeline-trail.server.ts";

/**
 * The trail is the only thing the Vetta Index measures, and until now nothing in
 * the product wrote it: recruiters moved `applications.pipeline_status` and the
 * event table stayed empty, which would have made a published benchmark a
 * fiction. These tests pin the writer to the reader's contract — same columns,
 * same stage vocabulary — and pin the one behaviour the workflow cannot do
 * without: a failed analytics insert must never fail a recruiter's click.
 */

async function reset(): Promise<void> {
  const sql = await getSql();
  await sql`delete from pipeline_stage_events`;
  await sql`delete from candidates`;
  await sql`delete from roles`;
  await sql`delete from organizations`;
}

async function seedPipeline(): Promise<{
  orgId: string;
  userId: string;
  roleId: string;
  candidateId: string;
  applicationId: string;
}> {
  const sql = await getSql();
  const orgId = `org_${randomUUID().slice(0, 8)}`;
  const userId = `usr_${randomUUID().slice(0, 8)}`;
  const slug = `trail-${orgId}`;
  const roleId = `role_${randomUUID().slice(0, 8)}`;
  const candidateId = `cand_${randomUUID().slice(0, 8)}`;
  const applicationId = `app_${randomUUID().slice(0, 8)}`;
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, 'Kestrel Robotics', ${slug}, ${userId}, 180)`;
  await sql`
    insert into roles (id, user_id, org_id, company_name, company_stage, title, location,
                       work_mode, employment_type, compensation_band, stack, must_haves,
                       nice_to_haves, jd_text, status)
    values (${roleId}, ${userId}, ${orgId}, 'Kestrel Robotics', 'series_a',
      'Senior Backend Engineer', 'Bengaluru', 'hybrid', 'full_time', '₹32–45L', '[]', '[]',
      '[]', 'Own the ledger.', 'open')`;
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, resume_text)
    values (${candidateId}, ${userId}, ${orgId}, 'Rahul Verma',
      ${`${candidateId}@candidate.test`}, 'A resume.')`;
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status)
    values (${applicationId}, ${userId}, ${orgId}, ${roleId}, ${candidateId}, 'ranked')`;
  return { orgId, userId, roleId, candidateId, applicationId };
}

async function events(): Promise<
  { from_stage: string; to_stage: string; org_id: string; actor_user_id: string }[]
> {
  const sql = await getSql();
  return sql<{ from_stage: string; to_stage: string; org_id: string; actor_user_id: string }>`
    select from_stage, to_stage, org_id, actor_user_id from pipeline_stage_events
    order by created_at asc`;
}

test("a recruiter's decision lands in the trail with the before and after stage", async () => {
  await reset();
  const p = await seedPipeline();
  await recordPipelineTrail({
    orgId: p.orgId,
    applicationId: p.applicationId,
    candidateId: p.candidateId,
    roleId: p.roleId,
    fromStage: "ranked",
    toStage: "shortlisted",
    actorUserId: p.userId,
  });

  const rows = await events();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { from: rows[0]!.from_stage, to: rows[0]!.to_stage, org: rows[0]!.org_id, actor: rows[0]!.actor_user_id },
    { from: "ranked", to: "shortlisted", org: p.orgId, actor: p.userId },
  );
  // The Index's own classifiers must accept what the writer produced, or the
  // event is a row nobody can count.
  assert.ok(reachedShortlist(rows[0]!.to_stage));
});

test("a rejection is recorded as an exit from the stage the candidate was in", async () => {
  await reset();
  const p = await seedPipeline();
  await recordPipelineTrail({
    orgId: p.orgId,
    applicationId: p.applicationId,
    candidateId: p.candidateId,
    roleId: p.roleId,
    fromStage: "shortlisted",
    toStage: "rejected",
    actorUserId: p.userId,
  });

  const rows = await events();
  assert.equal(rows.length, 1);
  assert.ok(isPipelineExit(rows[0]!.to_stage));
  assert.ok(reachedShortlist(rows[0]!.from_stage), "the exit is attributed to the list they were on");
});

test("an application the platform cannot attribute to a company writes no event", async () => {
  await reset();
  const p = await seedPipeline();
  // The workspace pre-dates org attribution. `org_id` is a foreign key, and an
  // unattributable pipeline is not evidence about companies — the same
  // fail-closed rule the Index applies when it counts its cohorts.
  await recordPipelineTrail({
    orgId: null,
    applicationId: p.applicationId,
    candidateId: p.candidateId,
    roleId: p.roleId,
    fromStage: "ranked",
    toStage: "shortlisted",
  });
  await recordPipelineTrail({
    orgId: "",
    applicationId: p.applicationId,
    candidateId: p.candidateId,
    roleId: p.roleId,
    fromStage: "ranked",
    toStage: "shortlisted",
  });
  assert.equal((await events()).length, 0);
});

test("a status saved without moving is not a decision", async () => {
  await reset();
  const p = await seedPipeline();
  await recordPipelineTrail({
    orgId: p.orgId,
    applicationId: p.applicationId,
    candidateId: p.candidateId,
    roleId: p.roleId,
    fromStage: "ranked",
    toStage: "ranked",
  });
  assert.equal((await events()).length, 0);
});

test("a broken trail write never fails the workflow that tried to record it", async () => {
  await reset();
  const p = await seedPipeline();
  // No such application: the insert hits a foreign key and fails. The recruiter
  // has already moved the candidate by this point, so the helper's contract is
  // "best effort, logged", not "throw".
  await recordPipelineTrail({
    orgId: p.orgId,
    applicationId: "app_that_does_not_exist",
    candidateId: p.candidateId,
    roleId: p.roleId,
    fromStage: "ranked",
    toStage: "shortlisted",
  });
  assert.equal((await events()).length, 0);

  // And the caller keeps working afterwards.
  await recordPipelineTrail({
    orgId: p.orgId,
    applicationId: p.applicationId,
    candidateId: p.candidateId,
    roleId: p.roleId,
    fromStage: "ranked",
    toStage: "shortlisted",
  });
  assert.equal((await events()).length, 1);
});
