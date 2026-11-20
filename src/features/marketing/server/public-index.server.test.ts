import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import { computeMedian } from "../../analytics/domain/funnel-analytics.ts";
import { eraseSubject } from "../../people/server/privacy.server.ts";
import { INDEX_FLOOR } from "../domain/vetta-index.ts";
import type { PublicIndex } from "../domain/vetta-index.ts";
import { buildIndexSnapshot, clearIndexCache, readPublicIndex } from "./public-index.server.ts";

/**
 * The Index is the number we tell the market to repeat, so this file runs the
 * real read against the real schema and checks three things: that a short
 * cohort produces no number at all, that a long enough cohort produces the same
 * median a founder would get from the raw export, and that nothing a human
 * typed about a named person can reach the payload.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function published(index: PublicIndex): Extract<PublicIndex, { state: "published" }> {
  assert.equal(index.state, "published", `expected a published Index, got ${index.state}`);
  return index as Extract<PublicIndex, { state: "published" }>;
}

async function resetIndexData(): Promise<void> {
  const sql = await getSql();
  // Children first: candidates cascade their applications, which cascade their
  // stage events, so one delete takes the whole pipeline with it.
  await sql`delete from vetta_index_snapshots`;
  await sql`delete from erasure_receipts`;
  await sql`delete from consent_records`;
  await sql`delete from candidates`;
  await sql`delete from roles`;
  await sql`delete from organizations`;
  clearIndexCache();
}

async function seedWorkspace(label: string): Promise<{ orgId: string; userId: string }> {
  const sql = await getSql();
  const orgId = `org_${randomUUID().slice(0, 8)}`;
  const userId = `usr_${randomUUID().slice(0, 8)}`;
  const slug = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${orgId}`;
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, ${label}, ${slug}, ${userId}, 180)`;
  return { orgId, userId };
}

async function seedRole(orgId: string, userId: string): Promise<string> {
  const sql = await getSql();
  const roleId = `role_${randomUUID().slice(0, 8)}`;
  await sql`
    insert into roles (id, user_id, org_id, company_name, company_stage, title, location,
                       work_mode, employment_type, compensation_band, stack, must_haves,
                       nice_to_haves, jd_text, status)
    values (${roleId}, ${userId}, ${orgId}, 'Kestrel Robotics', 'series_a',
      'Senior Backend Engineer', 'Bengaluru', 'hybrid', 'full_time', '₹32–45L', '[]', '[]',
      '[]', 'Own the ledger.', 'open')`;
  return roleId;
}

async function seedApplication(opts: {
  orgId: string;
  userId: string;
  roleId: string;
  appliedDaysAgo: number;
}): Promise<{ candidateId: string; applicationId: string }> {
  const sql = await getSql();
  const candidateId = `cand_${randomUUID().slice(0, 8)}`;
  const applicationId = `app_${randomUUID().slice(0, 8)}`;
  const at = daysAgo(opts.appliedDaysAgo);
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, location,
                            current_title, current_company, years_experience, resume_text)
    values (${candidateId}, ${opts.userId}, ${opts.orgId}, 'Rahul Verma',
      ${`${candidateId}@candidate.test}`}, '+919876500000', 'Koramangala, Bengaluru',
      'Senior Backend Engineer', 'Zettabyte Systems', 6, 'A resume we must never publish.')`;
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status,
                              created_at, updated_at, consent_granted)
    values (${applicationId}, ${opts.userId}, ${opts.orgId}, ${opts.roleId}, ${candidateId},
      'ranked', ${at}::timestamptz, ${at}::timestamptz, true)`;
  return { candidateId, applicationId };
}

async function seedEvent(opts: {
  applicationId: string;
  candidateId: string;
  roleId: string;
  orgId: string;
  fromStage: string;
  toStage: string;
  daysAgo: number;
  reason?: string;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into pipeline_stage_events (
      id, org_id, application_id, candidate_id, role_id, from_stage, to_stage,
      actor_user_id, reason, metadata_json, created_at
    ) values (
      ${`evt_${randomUUID().slice(0, 8)}`}, ${opts.orgId}, ${opts.applicationId},
      ${opts.candidateId}, ${opts.roleId}, ${opts.fromStage}, ${opts.toStage}, '',
      ${opts.reason ?? ""}, '{}', ${daysAgo(opts.daysAgo)}::timestamptz
    )`;
}

type Cohort = {
  durations: number[];
  applications: { applicationId: string; candidateId: string; roleId: string; orgId: string }[];
  exitStages: string[];
};

/**
 * The smallest publishable cohort by default — five companies, twenty-five
 * roles, fifty applications — with all but ten of them shortlisted and ten cut.
 * The spread is deliberately uneven so a median computed here is not
 * accidentally equal to a mean or to one of the endpoints. `orgs` goes above
 * the floor when a test needs room to lose a person and stay publishable.
 */
async function seedPublishableCohort(
  opts: { orgs?: number; appliedDaysAgo?: number } = {},
): Promise<Cohort> {
  const orgs = opts.orgs ?? INDEX_FLOOR.orgs;
  const rolesPerOrg = INDEX_FLOOR.orgs;
  const appsPerRole = 2;
  const exitCount = 10;
  const appliedDaysAgo = opts.appliedDaysAgo ?? 20;
  const total = orgs * rolesPerOrg * appsPerRole;
  const cohort: Cohort = { durations: [], applications: [], exitStages: [] };

  for (let org = 0; org < orgs; org += 1) {
    const { orgId, userId } = await seedWorkspace(`Cohort Company ${org}`);
    for (let role = 0; role < rolesPerOrg; role += 1) {
      const roleId = await seedRole(orgId, userId);
      for (let app = 0; app < appsPerRole; app += 1) {
        const index = org * rolesPerOrg * appsPerRole + role * appsPerRole + app;
        const seeded = await seedApplication({ orgId, userId, roleId, appliedDaysAgo });
        cohort.applications.push({ ...seeded, roleId, orgId });

        if (index < total - exitCount) {
          const shortlistAfter = (index % 20) + 1;
          cohort.durations.push(shortlistAfter);
          await seedEvent({
            ...seeded,
            roleId,
            orgId,
            fromStage: "ranked",
            toStage: "shortlisted",
            daysAgo: appliedDaysAgo - shortlistAfter,
          });
        } else {
          const fromStage = index < total - 3 ? "ranked" : "screening";
          cohort.exitStages.push(fromStage);
          await seedEvent({
            ...seeded,
            roleId,
            orgId,
            fromStage,
            toStage: "rejected",
            daysAgo: appliedDaysAgo - 3,
            reason: `Rahul Verma (98765 43210) left — Zettabyte Systems counter-offer, told him to call ${`${seeded.candidateId}@candidate.test`}`,
          });
        }
      }
    }
  }
  return cohort;
}

test("below the floor there is no Index, and the reason is written down with the counts", async () => {
  await resetIndexData();
  // Two companies, fifty applications: enough for a story, not enough for a statistic.
  for (let org = 0; org < 2; org += 1) {
    const { orgId, userId } = await seedWorkspace(`Small Company ${org}`);
    for (let i = 0; i < 25; i += 1) {
      const roleId = await seedRole(orgId, userId);
      const seeded = await seedApplication({ orgId, userId, roleId, appliedDaysAgo: 10 });
      await seedEvent({
        ...seeded,
        roleId,
        orgId,
        fromStage: "ranked",
        toStage: "shortlisted",
        daysAgo: 4,
      });
    }
  }

  const index = await readPublicIndex();
  assert.equal(index.state, "not_published");
  if (index.state !== "not_published") return;
  assert.match(index.message, /5 companies/);
  assert.match(index.message, /25 open roles/);
  assert.match(index.message, /50 applications/);
  assert.ok(index.lastCheckedAt, "the page can say when it last looked");
  assert.deepEqual(index.floor, INDEX_FLOOR);

  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select published, withheld_reason, metrics_json, org_count, application_count
    from vetta_index_snapshots order by built_at desc limit 1`;
  const cut = rows[0]!;
  assert.equal(cut.published, false);
  assert.match(String(cut.withheld_reason), /2 of 5 companies have live pipelines/);
  assert.equal(Number(cut.org_count), 2);
  assert.equal(Number(cut.application_count), 50);
  // Not a small median. A withheld cut carries no medians at all.
  const metrics = JSON.parse(String(cut.metrics_json));
  assert.equal(metrics.timeToShortlist.medianDays, 0);
  assert.equal(metrics.timeToShortlist.sampleCount, 0);
  assert.deepEqual(metrics.pipelineExits, []);
});

test("the moment the cohort clears every floor, the published median is the one the raw durations give", async () => {
  await resetIndexData();
  const cohort = await seedPublishableCohort();

  const index = published(await readPublicIndex());
  assert.equal(index.cohorts.orgs, INDEX_FLOOR.orgs);
  assert.equal(index.cohorts.roles, INDEX_FLOOR.roles);
  assert.equal(index.cohorts.applications, INDEX_FLOOR.applications);
  assert.equal(index.windowDays, 90);

  // The contract with a founder who asks for the export: our headline is their
  // arithmetic, run through the same function the workspace dashboards use.
  assert.equal(index.metrics.timeToShortlist.medianDays, computeMedian(cohort.durations));
  assert.equal(index.metrics.timeToShortlist.sampleCount, cohort.durations.length);
  assert.ok(index.metrics.timeToShortlist.q1Days <= index.metrics.timeToShortlist.medianDays);
  assert.ok(index.metrics.timeToShortlist.q3Days >= index.metrics.timeToShortlist.medianDays);

  // Ten exits, seven from the ranked pile: shares, not a list of people.
  assert.deepEqual(
    index.metrics.pipelineExits.map((exit) => [exit.label, exit.count, exit.share]),
    [
      ["Ranked, before the shortlist", 7, 70],
      ["In the written screen", 3, 30],
    ],
  );
});

test("no sentence a human typed about a named person can reach the published payload", async () => {
  await resetIndexData();
  await seedPublishableCohort();

  const wire = JSON.stringify(await readPublicIndex());
  const lower = wire.toLowerCase();
  for (const token of [
    "rahul",
    "verma",
    "zettabyte",
    "98765",
    "counter-offer",
    "candidate.test",
    "cand_",
    "app_",
    "role_",
    "org_",
    "koramangala",
    "reason",
  ]) {
    assert.ok(!lower.includes(token), `the Index published "${token}"`);
  }
  // And every published label is one we wrote ourselves.
  const index = published(JSON.parse(wire));
  const labels = new Set([
    "Still unread — applied, never ranked",
    "Ranked, before the shortlist",
    "Shortlisted, then cut",
    "In the written screen",
    "Reviewed and ready, then cut",
    "Approved for the client, then cut",
    "At the offer, then cut",
    "Put on hold, then cut",
    "Another point in the pipeline",
  ]);
  for (const exit of index.metrics.pipelineExits) {
    assert.ok(labels.has(exit.label), `an unpublished label reached the page: ${exit.label}`);
  }
});

test("an application outside the ninety-day window is not evidence", async () => {
  await resetIndexData();
  // A quarter of hiring ago, so the rolling window cannot see any of it.
  await seedPublishableCohort({ appliedDaysAgo: 120 });
  const stale = await readPublicIndex();
  assert.equal(stale.state, "not_published");

  const sql = await getSql();
  const rows = await sql<{ count: unknown }>`
    select count(*)::text as count from vetta_index_snapshots where application_count > 0`;
  assert.equal(Number(rows[0]?.count), 0, "the old cohort was not counted anywhere");

  // Fresh fifty on top of the old ones: the published denominator is the window, not the table.
  const cohort = await seedPublishableCohort({ appliedDaysAgo: 25 });
  const index = published(await buildIndexSnapshot());
  assert.equal(index.cohorts.applications, INDEX_FLOOR.applications);
  assert.equal(index.metrics.timeToShortlist.sampleCount, cohort.durations.length);
});

test("erasing a subject rebuilds the published figure without their application", async () => {
  await resetIndexData();
  // A cohort with one person of slack in it, so the deletion is measured rather
  // than simply watched as the number falls out of print.
  const cohort = await seedPublishableCohort({ orgs: 6 });
  const before = published(await readPublicIndex());
  assert.equal(before.cohorts.applications, 60);

  const target = cohort.applications[0]!;
  const result = await eraseSubject({
    orgId: target.orgId,
    subjectId: target.candidateId,
    reason: "request",
  });
  assert.equal(result.erased, true, "the erasure ran on a real subject");

  // No manual rebuild call in this assertion: privacy.server.ts owes the Index
  // the same recalculation it owes the teaser cache.
  const after = published(await readPublicIndex());
  assert.equal(after.cohorts.applications, 59);
  assert.equal(
    after.metrics.timeToShortlist.sampleCount,
    cohort.durations.length - 1,
    "the erased application left the median's denominator too",
  );

  const sql = await getSql();
  const cuts = await sql<{ count: unknown }>`
    select count(*)::text as count from vetta_index_snapshots where published = true`;
  assert.equal(Number(cuts[0]?.count), 2, "both cuts are on the record, one per date");
});

test("a cohort that falls back below the floor takes the published number out of print", async () => {
  await resetIndexData();
  const cohort = await seedPublishableCohort();
  assert.equal(published(await readPublicIndex()).cohorts.applications, 50);

  await eraseSubject({
    orgId: cohort.applications[0]!.orgId,
    subjectId: cohort.applications[0]!.candidateId,
    reason: "request",
  });

  const after = await readPublicIndex();
  assert.equal(after.state, "not_published");
  if (after.state !== "not_published") return;
  assert.match(after.message, /50 applications/);
  assert.ok(!("metrics" in after), "an out-of-print Index carries no number at all");
});

test("a published figure older than its shelf life is not quoted again", async () => {
  await resetIndexData();
  const sql = await getSql();
  await sql`
    insert into vetta_index_snapshots (
      id, window_start, window_end, window_days, org_count, role_count, application_count,
      metrics_json, published, withheld_reason, built_at
    ) values (
      'snap_old', ${daysAgo(135)}::timestamptz, ${daysAgo(45)}::timestamptz, 90,
      9, 40, 300,
      '{"timeToShortlist":{"medianDays":7.5,"q1Days":3,"q3Days":14,"sampleCount":180},"pipelineExits":[]}',
      true, '', ${daysAgo(45)}::timestamptz
    )`;
  clearIndexCache();

  const index = await readPublicIndex();
  assert.equal(index.state, "not_published");
  if (index.state !== "not_published") return;
  assert.ok(index.lastCheckedAt, "it admits the last figure expired rather than hiding the date");
});

test("reading the page does not cut a new snapshot on every request", async () => {
  await resetIndexData();
  await seedPublishableCohort();

  await buildIndexSnapshot();
  const sql = await getSql();
  const before = await sql<{ count: unknown }>`select count(*)::text as count from vetta_index_snapshots`;

  const first = published(await readPublicIndex());
  const second = published(await readPublicIndex());
  assert.equal(second.metrics.timeToShortlist.medianDays, first.metrics.timeToShortlist.medianDays);
  assert.equal(second.id, first.id, "the same snapshot is the same number for every reader");

  const after = await sql<{ count: unknown }>`select count(*)::text as count from vetta_index_snapshots`;
  assert.equal(
    Number(after[0]?.count),
    Number(before[0]?.count),
    "a week-old cut is not recut by traffic",
  );
});
