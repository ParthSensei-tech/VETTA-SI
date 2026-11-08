/**
 * Who may see a verdict, proved against a real database.
 *
 * The ladder and the queue are tested where they live; what is only testable
 * here is the read side's two promises, because they are the two a browser can
 * poke at:
 *
 *  1. a slate read returns this user's rows and nothing else, whichever role id
 *     is handed to it — including one belonging to somebody else;
 *  2. a drawer read reaches the ledger through the application it was opened
 *     for, joined on the caller's own `user_id`, so an id from outside this
 *     workspace resolves to nothing and a cached column that has been mangled
 *     cannot redirect the read to another tenant's evidence.
 *
 * Both go through the read functions the wire calls, because the scoping lives
 * in the SQL and a test that reimplements the SQL proves nothing about it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import { readLedger } from "./ledger.server.ts";
import { enqueueVerification, processVerificationSlice } from "./queue.server.ts";
import { reportForUser, slateVerdictsFor } from "./report.server.ts";

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
const uid = () => `vr-${Date.now().toString(36)}-${(seq += 1)}`;

/** A whole workspace: org, role, one candidate and one ranked application. */
async function workspace(resumeText: string = HONEST) {
  const sql = await getSql();
  const userId = uid();
  const org = await ensureUserOrg(userId, "Vetta Read Test Co");
  const roleId = uid();
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleId}, ${userId}, 'Nimbus', 'growth', 'Senior Backend Engineer', 'Bengaluru',
            'open', ${org.orgId})`;
  const candidateId = uid();
  await sql`
    insert into candidates (id, user_id, full_name, email, resume_text, org_id)
    values (${candidateId}, ${userId}, 'Priya Ramesh', 'priya@nimbus.example', ${resumeText},
            ${org.orgId})`;
  const applicationId = uid();
  await sql`
    insert into applications (id, user_id, role_id, candidate_id, pipeline_status, rank_score,
                              rank_json, org_id)
    values (${applicationId}, ${userId}, ${roleId}, ${candidateId}, 'ranked', 42, '{"score":42}',
            ${org.orgId})`;
  return { userId, orgId: org.orgId, roleId, candidateId, applicationId };
}

/** The handoff the ingest queue performs, then the slice that finishes it. */
async function verified(w: Awaited<ReturnType<typeof workspace>>) {
  await enqueueVerification({
    userId: w.userId,
    applicationId: w.applicationId,
    candidateId: w.candidateId,
    roleId: w.roleId,
    orgId: w.orgId,
  });
  await processVerificationSlice({ userId: w.userId });
  return w;
}

/**
 * The report the application's own chain produced.
 *
 * Found through `verification_reports.application_id` rather than out of the
 * cached summary, because a test that used the pointer under test to locate the
 * ledger would be assuming the thing it is meant to check.
 */
const reportIdFor = async (applicationId: string): Promise<string> => {
  const sql = await getSql();
  const [row] = await sql<{ id: string }>`
    select id from verification_reports
    where application_id = ${applicationId} and status = 'completed'
    order by created_at desc
    limit 1`;
  assert.ok(row, `expected a completed report for ${applicationId}`);
  return row.id;
};

test("a slate read returns the owner's verdicts and nobody else's", async () => {
  const mine = await verified(await workspace());
  const theirs = await verified(await workspace());

  const verdicts = await slateVerdictsFor(mine.userId, mine.roleId);
  assert.deepEqual(
    verdicts.map((v) => v.applicationId),
    [mine.applicationId],
    "one row, and it is mine",
  );
  assert.notEqual(verdicts[0].headline, "none", "the queue wrote a headline that can be shown");
  assert.ok(verdicts[0].counts.claims > 0, "and a denominator worth rendering");

  // Same role id, different user: a role is not a capability, a user is.
  assert.deepEqual(await slateVerdictsFor(theirs.userId, mine.roleId), []);
  assert.deepEqual(await slateVerdictsFor(mine.userId, "role-that-does-not-exist"), []);
});

test("an application the queue has not reached has no chip and no drawer", async () => {
  const waiting = await workspace();
  const judged = await verified(await workspace());

  assert.deepEqual(await slateVerdictsFor(waiting.userId, waiting.roleId), []);
  const view = await reportForUser(waiting.userId, waiting.applicationId);
  assert.equal(view.verdict, null, "nothing is cached, so nothing is claimed about this person");
  assert.equal(view.job, null, "and no queue state either, because there is no job");

  // The counter-case, so the assertions above are about an unread row rather
  // than about a helper that never runs.
  assert.equal((await slateVerdictsFor(judged.userId, judged.roleId)).length, 1);
});

test("a drawer read returns the ledger the queue wrote, claim for claim", async () => {
  const w = await verified(await workspace());
  const [verdict] = await slateVerdictsFor(w.userId, w.roleId);
  const view = await reportForUser(w.userId, w.applicationId);

  assert.equal(view.verdict?.headline, verdict.headline, "the drawer and the chip cannot disagree");
  assert.equal(view.job?.status, "completed");
  assert.equal(view.costPaise, 0, "a free-tier run must not report a cost it did not incur");

  const stored = await readLedger(await reportIdFor(w.applicationId));
  assert.ok(stored.length > 0, "the fixture has claims worth reading back");
  assert.equal(view.claims.length, stored.length, "every stored claim is in the view");
  assert.deepEqual(
    view.claims.map((c) => `${c.claimId}|${c.verdict}|${c.restsOn}`).sort(),
    stored.map((c) => `${c.claimId}|${c.verdict}|${c.restsOn}`).sort(),
    "with its verdict and the check it rests on unchanged",
  );
  for (const claim of view.claims) {
    assert.ok(
      claim.quote.length > 0,
      `${claim.claimId}: the drawer shows the document's own words`,
    );
    assert.ok(claim.outcomes.length > 0, `${claim.claimId}: and what was run against those words`);
  }
  assert.equal(view.counts.claims, stored.length, "every claim is counted");
  assert.ok(
    view.coverage.claims <= stored.length,
    "and only checkable kinds are in the denominator",
  );
});

test("a drawer read of an application I do not own says nothing", async () => {
  const mine = await verified(await workspace());
  const stranger = await workspace();

  const view = await reportForUser(stranger.userId, mine.applicationId);
  assert.equal(view.verdict, null);
  assert.equal(view.job, null, "not even the queue's state for somebody else's document");
  assert.deepEqual(view.claims, []);
  assert.equal(view.coverage.claims, 0);
  assert.equal(view.costPaise, 0);

  // A made-up application id is the same answer, so the two cannot be told
  // apart from outside this workspace.
  const unknown = await reportForUser(mine.userId, uid());
  assert.deepEqual([unknown.verdict, unknown.job, unknown.claims], [null, null, []]);
});

test("a mangled cached summary cannot reach another tenant's ledger", async () => {
  const mine = await verified(await workspace());
  const theirs = await verified(await workspace());
  const before = await reportForUser(mine.userId, mine.applicationId);
  assert.ok(before.claims.length > 0, "my own ledger is open before the row is touched");

  const sql = await getSql();
  await sql`
    update applications set verification_summary_json = ${"not json at all, and not from the ledger"}
    where id = ${mine.applicationId}`;

  const view = await reportForUser(mine.userId, mine.applicationId);
  assert.ok(view.claims.length > 0, "the drawer still reads my application's own report");
  assert.deepEqual(
    view.claims.map((c) => c.claimId),
    before.claims.map((c) => c.claimId),
    "claim for claim — the summary is a rendering cache, never the key into the ledger",
  );
  const theirsClaims = (await reportForUser(theirs.userId, theirs.applicationId)).claims;
  for (const claim of view.claims) {
    assert.ok(
      !theirsClaims.some((t) => t.claimId === claim.claimId),
      "and none of them are somebody else's",
    );
  }
});

test("the drawer reads the newest completed report for the application", async () => {
  const w = await verified(await workspace());
  const before = await reportForUser(w.userId, w.applicationId);
  assert.ok(before.claims.length > 0);

  // A second, later generation for the same application — empty, as a re-run of
  // a document whose claims were all dropped as ungrounded would leave it.
  const sql = await getSql();
  const emptyReport = uid();
  await sql`
    insert into verification_reports (id, org_id, user_id, candidate_id, application_id, role_id,
                                      engine_version, claims_set_hash, status, completed_at)
    values (${emptyReport}, ${w.orgId}, ${w.userId}, ${w.candidateId}, ${w.applicationId},
            ${w.roleId}, 'vetta-verify-test', ${`hash-${emptyReport}`}, 'completed', now())`;
  await sql`
    update verification_reports set created_at = now() + interval '1 second' where id = ${emptyReport}`;

  const after = await reportForUser(w.userId, w.applicationId);
  assert.deepEqual(after.claims, [], "the newest generation wins, whatever the cache says");
  assert.equal(after.engineVersion, "vetta-verify-test");
});

test("a failed report is never the one the drawer opens", async () => {
  const w = await verified(await workspace());
  const sql = await getSql();
  const broken = uid();
  await sql`
    insert into verification_reports (id, org_id, user_id, candidate_id, application_id, role_id,
                                      engine_version, claims_set_hash, status, error, created_at)
    values (${broken}, ${w.orgId}, ${w.userId}, ${w.candidateId}, ${w.applicationId}, ${w.roleId},
            'vetta-verify-test', ${`hash-${broken}`}, 'failed', 'the ladder threw',
            now() + interval '1 second')`;

  const view = await reportForUser(w.userId, w.applicationId);
  assert.ok(view.claims.length > 0, "the completed generation is still what opens");
  assert.equal(view.engineVersion, "vetta-verify-1", "and not the failed one that came after it");
});

test("a skipped job leaves the drawer able to say why there is no report", async () => {
  const w = await verified(await workspace("Priya Ramesh"));
  const view = await reportForUser(w.userId, w.applicationId);

  assert.equal(view.verdict, null, "nothing was cached, so nothing is claimed");
  assert.equal(view.job?.status, "skipped", "but the queue did look, and is on record");
  assert.deepEqual(view.claims, []);
  assert.equal(view.coverage.claims, 0, "and the drawer does not render an empty 100% bar");
});
