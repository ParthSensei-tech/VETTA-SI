/**
 * The ledger against a real database.
 *
 * The pure half of this feature is tested where it lives — `adjudicate.ts` and
 * `claims.ts` need no I/O. What only a database can prove is the four things the
 * write side promises:
 *
 *  1. the accusation cap holds at the *write boundary*, so a caller that skipped
 *     `adjudicate()` still cannot put `contradicted` in a row;
 *  2. a cache hit is the same report, not a second implementation of the truth;
 *  3. a half-written report is never served as if it were finished;
 *  4. verification cannot move a single ranking input — which is the invariant
 *     the whole feature is built around, and the only one of its four rules that
 *     a `select` on `applications` can actually falsify.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import { extractClaims, normalizeText } from "../domain/claims.ts";
import { isAccusingVerdict, type Verdict } from "../domain/adjudicate.ts";
import { DEFINITIVE_CHECK_IDS } from "../domain/checks/registry.ts";
import { fixtureById } from "../domain/fixtures.ts";
import { analyzeDocument } from "../domain/forensics.ts";
import {
  ensureReport,
  insertEvidence,
  loadReport,
  readLedger,
  runVerification,
  VERDICTLESS_CHECK_ID,
} from "./ledger.server.ts";

const NOW = "2026-11";

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

/** The same career, with one range typed backwards. */
const FABRICATED = HONEST.replace("Jun 2016 - Feb 2019", "Aug 2019 - Feb 2017");

let seq = 0;
const uid = () => `vlt-${Date.now().toString(36)}-${(seq += 1)}`;

/** The store's own identity for a file, so the test salts the key the same way. */
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * A user, an org, a role, a candidate and the application between them.
 *
 * The chain is real because the FKs are real; a fixture that inserted into
 * `claim_evidence` without a `verification_reports` row would be testing nothing.
 */
async function fixture(resumeText: string) {
  const sql = await getSql();
  const userId = uid();
  const org = await ensureUserOrg(userId, "Vetta Verification Test Co");
  const roleId = uid();
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleId}, ${userId}, 'Nimbus', 'growth', 'Senior Backend Engineer', 'Bengaluru', 'open', ${org.orgId})`;
  const candidateId = uid();
  await sql`
    insert into candidates (id, user_id, full_name, email, resume_text)
    values (${candidateId}, ${userId}, 'Priya Ramesh', 'priya@nimbus.example', ${resumeText})`;
  const applicationId = uid();
  await sql`
    insert into applications (id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json, recruiter_notes, org_id)
    values (${applicationId}, ${userId}, ${roleId}, ${candidateId}, 'ranked', 42, '{"score":42}', 'shortlisted', ${org.orgId})`;
  return { sql, userId, orgId: org.orgId, roleId, candidateId, applicationId, resumeText };
}

const runFor = (f: Awaited<ReturnType<typeof fixture>>, over = {}) =>
  runVerification({
    orgId: f.orgId,
    userId: f.userId,
    candidateId: f.candidateId,
    applicationId: f.applicationId,
    roleId: f.roleId,
    resumeText: f.resumeText,
    referenceMonth: NOW,
    ...over,
  });

const verdicts = (claims: { verdict: Verdict }[]) => claims.map((c) => c.verdict);

test("an honest document produces a ledger that accuses nobody", async () => {
  const f = await fixture(HONEST);
  const run = await runFor(f);

  assert.equal(run.fromCache, false);
  assert.ok(run.claims.length >= 6, `expected a populated claim set, got ${run.claims.length}`);
  assert.ok(
    !verdicts(run.claims).some(isAccusingVerdict),
    JSON.stringify(run.claims.map((c) => [c.kind, c.verdict, c.note])),
  );
  assert.equal(
    run.headline,
    "partial",
    "checked and unsupported-in-place is not the same as clean",
  );
  assert.equal(run.costPaise, 0, "Tier A is free and the run must say so");

  // Every stored claim is still the document's own bytes, after the round trip
  // through JSON — this is the gate that keeps a hallucination out of the ledger.
  const text = normalizeText(f.resumeText);
  for (const claim of run.claims) {
    assert.ok(normalizeText(claim.quote).length > 0, claim.statement);
    assert.ok(text.includes(normalizeText(claim.quote)), `“${claim.quote}” is not in the document`);
  }

  const stored = await f.sql<{ quote: string }>`
    select quote from candidate_claims where report_id = ${run.reportId}`;
  assert.equal(stored.length, run.claims.length);
});

test("the same claim set verifies once; the cache hit is not a second answer", async () => {
  const f = await fixture(HONEST);
  const first = await runFor(f);
  const second = await runFor(f);

  assert.equal(second.reportId, first.reportId);
  assert.equal(second.fromCache, true);
  assert.deepEqual(
    second.claims.map((c) => [c.kind, c.quote, c.verdict, c.restsOn]),
    first.claims.map((c) => [c.kind, c.quote, c.verdict, c.restsOn]),
  );
  assert.deepEqual(second.counts, first.counts);
  assert.deepEqual(second.coverage, first.coverage);
  assert.equal(second.headline, first.headline);

  const reports = await f.sql<{ n: string }>`
    select count(*)::text as n from verification_reports where org_id = ${f.orgId} and candidate_id = ${f.candidateId}`;
  assert.equal(reports[0].n, "1");
  const claims = await f.sql<{ n: string }>`
    select count(*)::text as n from candidate_claims where report_id = ${first.reportId}`;
  assert.equal(claims[0].n, String(first.claims.length), "a re-run must not duplicate claims");

  // And the drawer reads the same rows the run wrote.
  const ledger = await readLedger(first.reportId);
  assert.deepEqual(
    ledger.map((c) => c.verdict),
    first.claims.map((c) => c.verdict),
  );
});

test("different claims are a different report, not an amendment", async () => {
  const f = await fixture(HONEST);
  const first = await runFor(f);
  const changed = {
    ...f,
    resumeText: HONEST.replace("7 years of experience", "11 years of experience"),
  };
  const second = await runFor(changed);

  assert.notEqual(second.reportId, first.reportId);
  assert.equal(second.fromCache, false);
  const stillThere = await f.sql<{ status: string }>`
    select status from verification_reports where id = ${first.reportId}`;
  assert.equal(stillThere[0].status, "completed");
});

/**
 * The file is part of the claim set, because for these arms it is the evidence.
 *
 * `resume-classic` and `resume-edited` are built to have the same visible prose —
 * that is what an incremental update *is* — so the claims hash is identical and
 * the only thing that can tell the two runs apart is the digest of what the byte
 * arms were handed. Without it the second candidate is served the first one's
 * verdict, which is not staleness but a report about a document nobody read.
 */
test("the same sentences over two different files are two reports", async () => {
  const f = await fixture(HONEST);
  const classic = fixtureById("resume-classic");
  const edited = fixtureById("resume-edited");
  const over = (file: typeof classic) => ({
    hasRawBytes: true,
    documents: [
      analyzeDocument({ bytes: file.build(), filename: file.filename, docClass: "resume" as const }),
    ],
    documentFingerprint: sha256Hex(file.build()),
  });

  const first = await runFor(f, over(classic));
  const second = await runFor(f, over(edited));
  assert.equal(first.fromCache, false);
  assert.notEqual(second.reportId, first.reportId, "the forged file cannot inherit the clean run");
  assert.equal(second.fromCache, false);

  // Each file still hits its own report, so the salt is a key and not a rerun.
  const again = await runFor(f, over(classic));
  assert.equal(again.reportId, first.reportId);
  assert.equal(again.fromCache, true);

  const reports = await f.sql<{ n: string }>`
    select count(*)::text as n from verification_reports
    where org_id = ${f.orgId} and candidate_id = ${f.candidateId}`;
  assert.equal(reports[0].n, "2");
});

test("a half-written report is never served as a finished one", async () => {
  const f = await fixture(HONEST);
  const { reportId, isNew } = await ensureReport({
    orgId: f.orgId,
    userId: f.userId,
    candidateId: f.candidateId,
    applicationId: f.applicationId,
    roleId: f.roleId,
    claims: extractClaims(f.resumeText),
  });
  assert.equal(isNew, true);
  assert.equal(await loadReport(reportId), null, "status 'running' must not look like a verdict");

  const run = await runFor(f);
  assert.equal(run.reportId, reportId, "the in-flight report is the cache hit");
  assert.notEqual(await loadReport(reportId), null);
});

test("a reversed range is accused, by name, with a definitive check behind it", async () => {
  const f = await fixture(FABRICATED);
  const run = await runFor(f);

  const accused = run.claims.filter((c) => isAccusingVerdict(c.verdict));
  assert.ok(accused.length > 0, "the fabricated document walked away clean");
  for (const claim of accused) {
    assert.ok(DEFINITIVE_CHECK_IDS.has(claim.restsOn), `${claim.restsOn} may not accuse`);
    assert.ok(claim.definitive);
    assert.ok(claim.note.length > 10, "an accusation with no sentence behind it");
    const row = await f.sql<{ check_id: string; definitive: boolean }>`
      select check_id, definitive from claim_evidence where claim_id = ${claim.claimId} and status = ${claim.verdict}`;
    assert.equal(row[0].check_id, claim.restsOn);
    assert.equal(row[0].definitive, true);
  }
  assert.equal(run.headline, "flagged");

  // The verdict is re-readable later, from the ledger rather than from memory.
  const history = await f.sql<{ status: string; engine_version: string; check_id: string }>`
    select status, engine_version, check_id from verification_verdict_history
    where report_id = ${run.reportId} and status = 'impossible'`;
  assert.ok(history.length > 0);
  assert.ok(history.every((h) => DEFINITIVE_CHECK_IDS.has(h.check_id)));
});

test("the write boundary refuses an accusation the check is not entitled to make", async () => {
  const f = await fixture(HONEST);
  const run = await runFor(f);
  const claim = run.claims.find((c) => c.kind === "employment_period");
  assert.ok(claim);

  // Two ways to get here: a check registered as non-definitive, and one nobody
  // registered at all. Both are refused, and neither is a silent downgrade — the
  // caller has to be told it tried to write something it may not write.
  await assert.rejects(
    () =>
      insertEvidence({
        claimId: claim.claimId,
        reportId: run.reportId,
        orgId: f.orgId,
        checkId: "experience.tenure_arithmetic",
        status: "contradicted",
        note: "should never be stored",
        detail: {},
      }),
    /may not write "contradicted"/,
  );
  await assert.rejects(
    () =>
      insertEvidence({
        claimId: claim.claimId,
        reportId: run.reportId,
        orgId: f.orgId,
        checkId: "some.future.check",
        status: "impossible",
        note: "unregistered",
        detail: {},
      }),
    /may not write "impossible"/,
  );

  const id = await insertEvidence({
    claimId: claim.claimId,
    reportId: run.reportId,
    orgId: f.orgId,
    checkId: "dates.range_reversed",
    status: "contradicted",
    note: "dates run backwards",
    detail: { startMonth: "2021-08", endMonth: "2019-03" },
  });
  const row = await f.sql<{ definitive: boolean; tier: number }>`
    select definitive, tier from claim_evidence where id = ${id}`;
  assert.equal(
    row[0].definitive,
    true,
    "definitive is read from the registry, not from the caller",
  );
  assert.equal(row[0].tier, 0);

  // `(claim_id, check_id)` is unique: the same check running twice must not
  // produce two verdicts for the same question.
  const again = await insertEvidence({
    claimId: claim.claimId,
    reportId: run.reportId,
    orgId: f.orgId,
    checkId: "dates.range_reversed",
    status: "contradicted",
    note: "same question, second run",
    detail: {},
  });
  const rows = await f.sql<{ n: string }>`
    select count(*)::text as n from claim_evidence
    where claim_id = ${claim.claimId} and check_id = 'dates.range_reversed'`;
  assert.equal(rows[0].n, "1");
  assert.notEqual(again, id, "the refused insert still returns the id it would have used");
});

test("an arm that could not run is recorded as a blind spot, not as a pass", async () => {
  const f = await fixture(HONEST);
  const run = await runFor(f);
  const credential = run.claims.find((c) => c.kind === "credential");
  assert.ok(credential, "the credential id should have been extracted");

  assert.equal(credential.verdict, "unverifiable");
  assert.equal(credential.definitive, false);
  assert.ok(
    credential.outcomes.every((o) => o.observation === "skipped" || o.observation === "silent"),
    JSON.stringify(credential.outcomes),
  );
  assert.match(credential.note, /Not enabled|issuer|reference/i);
  assert.equal(credential.restsOn, VERDICTLESS_CHECK_ID);

  // Coverage counts this claim in the denominator and not in the numerator,
  // which is the difference between "70% checked" and a green tick.
  assert.ok(run.coverage.claims > 0);
  assert.ok(run.coverage.checked < run.coverage.claims, JSON.stringify(run.coverage));
  assert.equal(run.coverage.ratio, run.coverage.checked / run.coverage.claims);
  assert.equal(run.coverage.ratio > 0 && run.coverage.ratio < 1, true);
});

test("verification cannot move a ranking input", async () => {
  const f = await fixture(FABRICATED);
  const before = await f.sql<Record<string, string>>`
    select pipeline_status, rank_score::text, rank_json, recruiter_notes, updated_at::text
    from applications where id = ${f.applicationId}`;

  const run = await runFor(f);

  const after = await f.sql<Record<string, string>>`
    select pipeline_status, rank_score::text, rank_json, recruiter_notes, updated_at::text
    from applications where id = ${f.applicationId}`;
  assert.deepEqual(
    { ...after[0], updated_at: before[0].updated_at },
    before[0],
    "only the two verification columns may change",
  );

  const summary = await f.sql<{ verification_status: string; verification_summary_json: string }>`
    select verification_status, verification_summary_json from applications where id = ${f.applicationId}`;
  assert.equal(summary[0].verification_status, run.headline);
  const parsed = JSON.parse(summary[0].verification_summary_json) as Record<string, unknown>;
  assert.deepEqual(parsed.counts, run.counts);
  assert.equal(parsed.engineVersion, run.engineVersion);

  // A document with nothing to complain about writes the same two columns and
  // still leaves the rank alone.
  const clean = await fixture(HONEST);
  const cleanRun = await runFor(clean);
  const cleanRow = await clean.sql<Record<string, string>>`
    select rank_score::text, pipeline_status from applications where id = ${clean.applicationId}`;
  assert.equal(cleanRow[0].rank_score, "42");
  assert.equal(cleanRow[0].pipeline_status, "ranked");
  assert.equal(cleanRun.headline, "partial");
});
