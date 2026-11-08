/**
 * The verification queue against a real database.
 *
 * The pure ladder and the ledger are tested where they live. What only a running
 * queue can prove is the set of promises the handoff makes:
 *
 *  1. the pipeline may mention an application five times and get one job, then
 *     re-run that job when asked again — because a queue that grows while nobody
 *     watches is a queue that eventually runs out of money;
 *  2. a tick belongs to the caller who asked for it, and claims only the free
 *     ladder, so "verification is in the pipeline" cannot also mean "anybody with
 *     a curl can spend the owner's quota — or anyone else's";
 *  3. a job whose document is gone is `skipped`, and a job that throws is retried
 *     with a bounded budget — the two failure shapes that decide whether a 200-
 *     resume slate converges or churns;
 *  4. one tenant's slice never writes another tenant's verdict;
 *  5. the whole handoff cannot move a ranking input, and cannot fail a rank.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import { CHECK_REGISTRY } from "../domain/checks/registry.ts";
import {
  checkIdsForPlan,
  enqueueVerification,
  PLAN_TIER_FREE,
  PLAN_TIER_PAID,
  processVerificationSlice,
} from "./queue.server.ts";

const HONEST = `PRIYA RAMESH
Senior Backend Engineer | Bengaluru, Karnataka
priya@nimbus.example | +91 98450 12345

PROFILE
Backend engineer with 7 years of experience building high-throughput services for fintech.
Scaled a payments platform to 40M monthly requests across three regions.

EMPLOYMENT
Nimbus Technologies, Bengaluru — Senior Backend Engineer
Mar 2019 - Present
- Owned the reconciliation pipeline processing 2.3 million records a day.

Zeta Labs, Pune — Backend Developer
Jun 2016 - Feb 2019

EDUCATION
B.E. in Computer Science, NIT Trichy - 2016

CERTIFICATIONS
- AWS Certified Solutions Architect - Associate
Credential ID: AWS-11223344`;

let seq = 0;
const uid = () => `vq-${Date.now().toString(36)}-${(seq += 1)}`;

/** The chain the ingest queue leaves behind: org, role, candidate, application. */
async function fixture(resumeText: string = HONEST) {
  const sql = await getSql();
  const userId = uid();
  const org = await ensureUserOrg(userId, "Vetta Queue Test Co");
  const roleId = uid();
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleId}, ${userId}, 'Nimbus', 'growth', 'Senior Backend Engineer', 'Bengaluru', 'open', ${org.orgId})`;
  const candidateId = uid();
  await sql`
    insert into candidates (id, user_id, full_name, email, resume_text, org_id)
    values (${candidateId}, ${userId}, 'Priya Ramesh', 'priya@nimbus.example', ${resumeText}, ${org.orgId})`;
  const applicationId = uid();
  await sql`
    insert into applications (id, user_id, role_id, candidate_id, pipeline_status, rank_score,
                              rank_json, recruiter_notes, org_id)
    values (${applicationId}, ${userId}, ${roleId}, ${candidateId}, 'ranked', 42, '{"score":42}',
            'shortlisted', ${org.orgId})`;
  return { sql, userId, orgId: org.orgId, roleId, candidateId, applicationId };
}

const handoff = (f: Awaited<ReturnType<typeof fixture>>, planTier?: string) =>
  enqueueVerification({
    userId: f.userId,
    applicationId: f.applicationId,
    candidateId: f.candidateId,
    roleId: f.roleId,
    orgId: f.orgId,
    ...(planTier ? { planTier } : {}),
  });

const jobRows = async (applicationId: string) => {
  const sql = await getSql();
  return sql<Record<string, unknown>>`
    select id, status, plan_tier, report_id, error, attempts, run_after
    from verification_jobs where application_id = ${applicationId}
    order by created_at`;
};

const reportIdFor = async (applicationId: string): Promise<string> => {
  const [job] = await jobRows(applicationId);
  assert.ok(job && job.report_id, `expected a finished job for ${applicationId}`);
  return String(job.report_id);
};

/**
 * The per-check observations a stored report actually recorded.
 *
 * Read out of `detail_json.outcomes` rather than from `claim_evidence.status`,
 * because a verdict is about a claim and an observation is about a check: the
 * row's status is the four-word verdict, and the only place a capped or missing
 * arm still exists is the outcome list the ladder was built from.
 */
const outcomesFor = async (reportId: string) => {
  const sql = await getSql();
  const rows = await sql<{ detail_json: string }>`
    select detail_json from claim_evidence where report_id = ${reportId}`;
  return rows.flatMap((row) => {
    const detail = JSON.parse(String(row.detail_json)) as {
      outcomes?: { checkId: string; observation: string; note: string }[];
    };
    return detail.outcomes ?? [];
  });
};

/** Every column the rank path owns, so a before/after diff cannot miss one. */
async function rankInputs(applicationId: string) {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select pipeline_status, rank_score, rank_json, rubric_score, rubric_json, rubric_version,
           rubric_version_id, rubric_hash, resume_hash, role_hash, rank_engine, model, provider,
           is_stale, stale_reason, recruiter_notes, source, org_id, candidate_id, role_id, user_id
    from applications where id = ${applicationId} limit 1`;
  return rows[0];
}

test("the plan decides entitlement, and an unknown plan gets the free ladder", () => {
  const free = checkIdsForPlan(PLAN_TIER_FREE);
  const paid = checkIdsForPlan(PLAN_TIER_PAID);

  assert.deepEqual(
    [...free].sort(),
    CHECK_REGISTRY.filter((c) => c.includedInFreeTier)
      .map((c) => c.id)
      .sort(),
  );
  assert.ok(
    free.has("dates.range_reversed"),
    "the free tier must include the accused-by-arithmetic arm",
  );
  assert.ok(!free.has("credential.issuer_lookup"), "the ₹300 issuer lookup is not a free check");
  assert.equal(paid.size, CHECK_REGISTRY.length, "a paid plan reaches every registered arm");
  // Fail closed: a plan string this file does not know is not a route to money.
  assert.deepEqual([...checkIdsForPlan("enterprise-annual")].sort(), [...free].sort());
});

test("five handoffs for one application are one queued job", async () => {
  const f = await fixture();
  const first = await handoff(f);
  assert.equal(first.queued, true);

  const again = await Promise.all([handoff(f), handoff(f), handoff(f), handoff(f)]);
  for (const result of again) {
    assert.equal(result.jobId, first.jobId, "the same application re-uses its job row");
    assert.equal(result.queued, false, "a job already queued is not queued twice");
    assert.equal(result.status, "queued");
  }
  assert.equal((await jobRows(f.applicationId)).length, 1);
});

test("a finished job is re-queued with its retry budget, not duplicated", async () => {
  const f = await fixture();
  const first = await handoff(f);
  const slice = await processVerificationSlice({ userId: f.userId });
  assert.equal(slice.completed, 1);

  const sql = await getSql();
  // A run that took all three tries on the way to completing must not start its
  // next life already out of retries.
  await sql`update verification_jobs set attempts = 3, error = 'stale' where id = ${first.jobId}`;

  const requeued = await handoff(f);
  assert.equal(requeued.queued, true, "a completed job asked about again is re-queued");
  assert.equal(requeued.jobId, first.jobId);
  const rows = await jobRows(f.applicationId);
  assert.equal(rows.length, 1, "refreshing a verdict does not add a second job");
  assert.equal(rows[0].status, "queued");
  assert.equal(Number(rows[0].attempts), 0);
  assert.equal(rows[0].error, "");
});

test("the queue turns a ranked application into a ledger and a chip", async () => {
  const f = await fixture();
  await handoff(f);
  const slice = await processVerificationSlice({ userId: f.userId });
  assert.deepEqual(
    { processed: slice.processed, completed: slice.completed, failed: slice.failed },
    { processed: 1, completed: 1, failed: 0 },
  );

  const [job] = await jobRows(f.applicationId);
  assert.equal(job.status, "completed");
  assert.ok(job.report_id, "the finished job names the report it wrote");

  const sql = await getSql();
  const reports = await sql<{ status: string; counts_json: string }>`
    select status, counts_json from verification_reports where id = ${String(job.report_id)} limit 1`;
  assert.equal(reports[0]?.status, "completed");
  const counts = JSON.parse(String(reports[0]?.counts_json ?? "{}")) as { claims?: number };
  assert.ok(Number(counts.claims ?? 0) >= 6, `expected a real claim set, got ${counts.claims}`);

  const apps = await sql<{ verification_status: string; verification_summary_json: string }>`
    select verification_status, verification_summary_json from applications where id = ${f.applicationId}`;
  assert.ok(
    ["clean", "flagged", "partial"].includes(apps[0].verification_status),
    `unexpected chip label ${apps[0].verification_status}`,
  );
  assert.ok(JSON.parse(apps[0].verification_summary_json).coverage !== undefined);
});

test("verification through the pipeline still cannot move a ranking input", async () => {
  const f = await fixture();
  const before = await rankInputs(f.applicationId);
  await handoff(f);
  await processVerificationSlice({ userId: f.userId });

  assert.deepEqual(await rankInputs(f.applicationId), before);

  // And the verdict it did write is the one the ladder means: an honest
  // document is never accused, whatever route reached it.
  const sql = await getSql();
  const accusing = await sql<{ n: number | string }>`
    select count(*) as n from claim_evidence e
    join candidate_claims c on c.id = e.claim_id
    where c.report_id = (select report_id from verification_jobs where application_id = ${f.applicationId})
      and e.status in ('contradicted', 'impossible')`;
  assert.equal(Number(accusing[0].n), 0);
});

test("a tick spends nothing, and records which arms its plan capped", async () => {
  const f = await fixture();
  await handoff(f);
  await processVerificationSlice({ userId: f.userId });
  const reportId = await reportIdFor(f.applicationId);

  const sql = await getSql();
  const cost = await sql<{ total: number | string }>`
    select coalesce(sum(cost_paise), 0) as total from claim_evidence where report_id = ${reportId}`;
  assert.equal(Number(cost[0].total), 0, "the free ladder is made of zero-cost checks only");

  const cached = await sql<{ n: number | string }>`
    select count(*) as n from verification_checks_cache`;
  assert.equal(Number(cached[0].n), 0, "an uncalled external arm must not answer from a cache");

  const seen = await outcomesFor(reportId);
  const capped = seen.filter(
    (o) => o.observation === "skipped" && /verification plan/i.test(o.note),
  );
  const cappedIds = new Set(capped.map((o) => o.checkId));
  const armsACurlMustNotReach = [
    "registry.employer_incorporation",
    "credential.issuer_lookup",
    "identity.dns_mx",
    "template.slate_duplicate",
  ];
  for (const id of armsACurlMustNotReach) {
    assert.ok(cappedIds.has(id), `the paid arm ${id} must show up as capped, not missing`);
  }
  for (const check of CHECK_REGISTRY) {
    if (check.includedInFreeTier) {
      assert.ok(
        !cappedIds.has(check.id),
        `a free check cannot be capped by the plan that grants it: ${check.id}`,
      );
    }
  }
  assert.ok(
    seen.some((o) => !["skipped", "error"].includes(o.observation)),
    "and the ladder it did run must have actually said something",
  );
});

test("a paid job waits for a paid slice, then discloses what it still could not run", async () => {
  const f = await fixture();
  await handoff(f, PLAN_TIER_PAID);

  const freeSlice = await processVerificationSlice({ userId: f.userId });
  assert.equal(freeSlice.processed, 0, "the free slice must not claim a paid job");
  const [still] = await jobRows(f.applicationId);
  assert.equal(still.status, "queued");

  const paid = await processVerificationSlice({ userId: f.userId, planTier: PLAN_TIER_PAID });
  assert.equal(paid.completed, 1);

  const reportId = await reportIdFor(f.applicationId);
  const seen = await outcomesFor(reportId);
  assert.ok(
    !seen.some((o) => /verification plan/i.test(o.note)),
    "the paid plan is not capped by entitlement, so the cap note must be gone",
  );
  const issuer = seen.filter((o) => o.checkId === "credential.issuer_lookup");
  assert.ok(issuer.length > 0, "a credential claim must show the issuer arm it could not run");
  assert.ok(
    issuer.every((o) => o.observation === "skipped" && o.note.length > 10),
    "not built yet is disclosed as a reason, never left as a blank",
  );

  const sql = await getSql();
  const cost = await sql<{ total: number | string }>`
    select coalesce(sum(cost_paise), 0) as total from claim_evidence where report_id = ${reportId}`;
  assert.equal(Number(cost[0].total), 0, "an arm that never called out still bills nothing");
});

test("a document that is no longer there is skipped, not retried forever", async () => {
  const f = await fixture();
  await handoff(f);
  const sql = await getSql();
  await sql`update candidates set resume_text = '' where id = ${f.candidateId}`;

  const slice = await processVerificationSlice({ userId: f.userId });
  assert.deepEqual({ c: slice.completed, f: slice.failed, s: slice.skipped }, { c: 0, f: 0, s: 1 });
  const [job] = await jobRows(f.applicationId);
  assert.equal(job.status, "skipped");
  assert.match(String(job.error), /no readable resume text/i);

  const reports = await sql<{ n: number | string }>`
    select count(*) as n from verification_reports where application_id = ${f.applicationId}`;
  assert.equal(Number(reports[0].n), 0, "a skipped job leaves no half-written report behind");
});

test("one tenant's slice does not write another tenant's verdict", async () => {
  const a = await fixture();
  const b = await fixture();
  await handoff(a);
  await handoff(b);

  const slice = await processVerificationSlice({ userId: a.userId });
  assert.equal(slice.completed, 1, "only the scoped user's job ran");
  assert.equal((await jobRows(a.applicationId))[0].status, "completed");
  assert.equal((await jobRows(b.applicationId))[0].status, "queued");

  // A forged job row that claims somebody else's application reads nothing at
  // all: the document lookup is scoped by `user_id` on both sides of the join,
  // so a queue row is not a way to reach a candidate the caller does not own.
  const forged = await fixture();
  const sql = await getSql();
  const foreign = uid();
  await sql`
    insert into verification_jobs (id, org_id, user_id, application_id, candidate_id, role_id, status, plan_tier)
    values (${foreign}, ${a.orgId}, ${a.userId}, ${forged.applicationId}, ${forged.candidateId},
            ${forged.roleId}, 'queued', ${PLAN_TIER_FREE})`;
  await processVerificationSlice({ userId: a.userId });
  const [row] = await sql<{ status: string; error: string }>`
    select status, error from verification_jobs where id = ${foreign}`;
  assert.equal(row.status, "skipped");
  assert.match(row.error, /no readable resume text/i);

  const reports = await sql<{ n: number | string }>`
    select count(*) as n from verification_reports where application_id = ${forged.applicationId}`;
  assert.equal(Number(reports[0].n), 0, "no ledger is opened for a tenant that did not ask");
});

test("a run that throws is retried with backoff, and the budget is finite", async () => {
  const f = await fixture();
  const sql = await getSql();
  const jobId = uid();
  // An org that does not exist: the insert into `verification_reports` fails on
  // its foreign key, which is the queue meeting a real bug rather than a mock.
  await sql`
    insert into verification_jobs (id, org_id, user_id, application_id, candidate_id, role_id, status, plan_tier)
    values (${jobId}, 'org-that-does-not-exist', ${f.userId}, ${f.applicationId}, ${f.candidateId},
            ${f.roleId}, 'queued', ${PLAN_TIER_FREE})`;

  const first = await processVerificationSlice({ userId: f.userId });
  assert.equal(first.processed, 1);
  const [requeued] = await sql<{ status: string; error: string; attempts: number }>`
    select status, error, attempts from verification_jobs where id = ${jobId}`;
  assert.equal(requeued.status, "queued", "a thrown run is work to do again");
  assert.equal(requeued.attempts, 1);
  assert.ok(requeued.error.length > 0, "and it says what went wrong");

  await sql`update verification_jobs set attempts = 3 where id = ${jobId}`;
  await sql`update verification_jobs set run_after = now() - interval '1 minute' where id = ${jobId}`;
  await processVerificationSlice({ userId: f.userId });
  const [last] = await sql<{
    status: string;
  }>`select status from verification_jobs where id = ${jobId}`;
  assert.equal(last.status, "failed", "the retry budget is three, not forever");
});

test("a job stuck mid-run is reclaimed by the watchdog", async () => {
  const f = await fixture();
  const { jobId } = await handoff(f);
  const sql = await getSql();
  // A worker that was killed between the claim and the write leaves the row
  // owned by a process that no longer exists.
  await sql`
    update verification_jobs
    set status = 'running', updated_at = now() - interval '10 minutes'
    where id = ${jobId}`;

  const slice = await processVerificationSlice({ userId: f.userId });
  assert.equal(slice.completed, 1, "the watchdog re-queues a stuck row before claiming");
  assert.equal((await jobRows(f.applicationId))[0].status, "completed");
});

test("the ingest handoff cannot fail a rank", () => {
  const source = readFileSync(
    new URL("../../pipeline/server/queue.server.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const saved = await persistRanked(job);");
  assert.ok(start > -1, "the rank path's success branch is where the handoff lives");
  const after = source.slice(start, source.indexOf("update ingest_jobs", start));

  assert.match(after, /try\s*\{/, "the handoff is inside its own try");
  assert.match(after, /console\.error\("\[vetta-verification\]"/, "and its failure is logged");
  assert.match(after, /bindDocumentToApplication/, "the document store is handed the same job");
  assert.match(after, /console\.error\("\[vetta-documents\]"/, "in its own try, on its own");
  assert.ok(
    !/update ingest_jobs[\s\S]*?status = 'failed'/.test(after),
    "nothing between the rank and the queue row may mark the ingest job failed",
  );
});

/**
 * The route that lets anything outside the app ask for a verdict.
 *
 * `processVerificationSlice({ userId })` is proved scoped four tests above; what
 * a unit test of the queue cannot see is the one line in the HTTP layer that
 * either passes it the verified caller or passes it nothing. The second is a
 * public endpoint that runs every tenant's ladder, and the first is the reason
 * this file exists.
 */
test("a tick belongs to whoever asked for it", () => {
  const source = readFileSync(
    new URL("../../../routes/api/queue/tick.ts", import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");
  assert.match(source, /requireUserId/, "the caller is authenticated, not assumed");
  assert.ok(/const userId = await requireUserId/.test(source), "before either queue is touched");
  assert.ok(
    source.indexOf("const userId = await requireUserId") <
      source.indexOf("await processQueueSlice"),
    "and not after a slice has already run",
  );
  assert.match(source, /processQueueSlice\(\{ userId/, "the ingest half is scoped");
  assert.match(source, /processVerificationSlice\(\{ userId/, "and so is the ladder");
  assert.ok(
    !/processVerificationSlice\(\{\s*maxJobs/.test(source),
    "no call in this file runs the unscoped slice",
  );
  assert.match(source, /assertSameSiteRequest/, "a cross-site page cannot drive it");
});
