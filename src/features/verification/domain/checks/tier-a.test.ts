/**
 * The Tier A checks and the ladder that runs them.
 *
 * Each check is tested in both directions: the case that makes it worth having,
 * and the ordinary case that must not fire. The second half is the one the
 * feature lives or dies by — a check that fires on an honest document is worse
 * than a check that never fires, because the honest document is the common one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  GAP_UNACCOUNTED_MONTHS,
  TENURE_SLACK_FRACTION,
  TENURE_SLACK_MONTHS,
  checkEducationTimeline,
  checkEmailDomainEmployer,
  checkEndInFuture,
  checkMetricHasNoSource,
  checkOverlappingCurrent,
  checkRangeReversed,
  checkStartInFuture,
  checkTenureArithmetic,
  type CheckContext,
} from "./tier-a.ts";
import {
  CHECK_REGISTRY,
  DEFINITIVE_CHECK_IDS,
  VERIFICATION_ENGINE_VERSION,
  checkById,
  checksForKind,
  runLadder,
} from "./registry.ts";
import { adjudicate, isAccusingVerdict, OBSERVATIONS } from "../adjudicate.ts";
import { CLAIM_KINDS, type ClaimDetail, type ClaimKind, type ExtractedClaim } from "../claims.ts";

const NOW = "2026-11";

const mk = (kind: ClaimKind, detail: ClaimDetail, quote = "x"): ExtractedClaim => ({
  kind,
  statement: kind,
  quote,
  detail,
});

const ctx = (
  claim: ExtractedClaim,
  siblings: ExtractedClaim[] = [],
  now: string = NOW,
): CheckContext => ({ claim, siblings, now });

const period = (startMonth: string, endMonth: string, extra: ClaimDetail = {}): ExtractedClaim =>
  mk("employment_period", { startMonth, endMonth, monthPrecision: "month", ...extra });

test("engine metadata and the derived definitive set agree", () => {
  assert.match(VERIFICATION_ENGINE_VERSION, /^vetta-verify-\d+$/);
  assert.deepEqual([...DEFINITIVE_CHECK_IDS].sort(), [
    "credential.issuer_lookup",
    "dates.dated_in_future",
    "dates.range_reversed",
    "document.orphaned_text",
    "education.cgpa_document_mismatch",
    "registry.employer_incorporation",
  ]);
  for (const check of CHECK_REGISTRY) {
    if (check.definitiveWhenMismatch) assert.ok(DEFINITIVE_CHECK_IDS.has(check.id));
  }
});

test("no two checks share an id and every kind resolves to at least one row", () => {
  const ids = CHECK_REGISTRY.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(ids));
  for (const kind of CLAIM_KINDS) {
    assert.ok(checksForKind(kind).length > 0, `${kind} would be checked by nothing`);
  }
  // The inverse, which is the one that rots: a check registered for a kind the
  // extractor can no longer emit is a row that never runs and nobody notices.
  for (const check of CHECK_REGISTRY) {
    for (const kind of check.kinds) {
      assert.ok((CLAIM_KINDS as readonly string[]).includes(kind), `${check.id} claims ${kind}`);
    }
  }
  assert.equal(checkById("does.not.exist"), undefined);
});

test("a kind with no free check is a paid arm waiting, not a hole", () => {
  // `credential` is the one claim class nothing can settle from the document
  // alone, so its ladder is a `skipped` row that names the issuer lookup. Assert
  // the reason is registered rather than asserting the shape of the report.
  const credential = checksForKind("credential");
  assert.equal(
    credential.filter((c) => c.run).length,
    0,
    "nothing inline can resolve a credential id",
  );
  assert.ok(
    credential.some((c) => c.id === "credential.issuer_lookup" && c.definitiveWhenMismatch),
    "the issuer lookup is the arm that would settle it, and it is allowed to accuse",
  );
});

/* ------------------------------------------------------------------ dates */

test("work that has not started yet is impossible, and this month is not", () => {
  const future = checkStartInFuture(ctx(period("2028-01", "present")));
  assert.equal(future.observation, "impossible");
  assert.equal(future.checkId, "dates.dated_in_future");
  assert.match(future.note ?? "", /14 months after/);

  for (const start of ["2026-11", "2026-12"]) {
    assert.equal(checkStartInFuture(ctx(period(start, "present"))).observation, "supported", start);
  }
  assert.equal(checkStartInFuture(ctx(period("2026-10", "present"))).observation, "supported");
  assert.equal(
    checkStartInFuture(ctx(mk("employment_period", { endMonth: "present" }))).observation,
    "silent",
  );
  assert.equal(
    checkStartInFuture(ctx(mk("education", { endMonth: "2028-12" }))).observation,
    "silent",
  );
  // The cap that matters: this check is the one allowed to accuse.
  assert.equal(checkById(future.checkId)?.definitiveWhenMismatch, true);
});

test("a range reaching into the future is surfaced and never an accusation", () => {
  const graduating = checkEndInFuture(
    ctx(mk("education", { endMonth: "2027-12", monthPrecision: "year" })),
  );
  assert.equal(graduating.observation, "inconsistent");
  assert.equal(
    checkById(graduating.checkId)?.definitiveWhenMismatch,
    false,
    "a fresher is not a fraudster",
  );
  assert.match(graduating.note ?? "", /expected|notice period|typo/);

  const opened = period("2019-03", "present");
  assert.equal(
    checkEndInFuture(ctx(opened)).observation,
    "supported",
    "present is today, not the future",
  );
  assert.equal(checkEndInFuture(ctx(period("2019-03", "2024-06"))).observation, "supported");
  assert.equal(
    checkEndInFuture(ctx(mk("employment_period", { startMonth: "2019-03" }))).observation,
    "silent",
  );
  assert.equal(
    checkEndInFuture(ctx(mk("identity", { domain: "nimbus.example" }))).observation,
    "silent",
  );
});

test("a reversed range is arithmetic, and a same-year one is rounding", () => {
  const reversed = checkRangeReversed(ctx(period("2021-08", "2019-03")));
  assert.equal(reversed.observation, "impossible");
  assert.match(reversed.note ?? "", /29 months negative/);
  assert.equal(checkById(reversed.checkId)?.definitiveWhenMismatch, true);

  assert.equal(checkRangeReversed(ctx(period("2019-01", "2019-12"))).observation, "supported");
  assert.equal(checkRangeReversed(ctx(period("2019-03", "2019-03"))).observation, "supported");
  assert.equal(checkRangeReversed(ctx(period("2019-03", "present"))).observation, "silent");
  assert.equal(checkRangeReversed(ctx(period("2019-03", "whenever"))).observation, "silent");
  assert.equal(
    checkRangeReversed(ctx(mk("education", { startMonth: "2021-08", endMonth: "2019-03" })))
      .observation,
    "silent",
  );
});

/* ------------------------------------------------------------- tenure */

test("the tenure slack is what the check is calibrated to", () => {
  assert.equal(TENURE_SLACK_MONTHS, 12);
  assert.ok(TENURE_SLACK_FRACTION > 0 && TENURE_SLACK_FRACTION < 1);
  assert.equal(GAP_UNACCOUNTED_MONTHS, 3);
});

test("a stated total is tested against the document's own dates", () => {
  const history = [period("2016-06", "2019-02"), period("2019-03", "present")];
  const inflated = checkTenureArithmetic(ctx(mk("tenure", { years: 15 }, "15 years"), history));
  assert.equal(inflated.observation, "inconsistent");
  assert.match(inflated.note ?? "", /Claims 15 years; the dates in the same document span/);
  assert.equal(checkById(inflated.checkId)?.definitiveWhenMismatch, false);

  assert.equal(
    checkTenureArithmetic(ctx(mk("tenure", { years: 7 }, "7 years"), history)).observation,
    "supported",
  );
  // Rounding up is not a lie: the span already covers the claim plus a month.
  const nine = checkTenureArithmetic(ctx(mk("tenure", { years: 11 }, "11 years"), history));
  assert.equal(nine.observation, "supported", JSON.stringify(nine.detail));
});

test("a history with a hole in it bounds nothing and says so", () => {
  const gapped = [period("2010-01", "2012-01"), period("2024-06", "present")];
  const out = checkTenureArithmetic(ctx(mk("tenure", { years: 14 }, "14 years"), gapped));
  assert.equal(out.observation, "silent");
  assert.match(out.note ?? "", /gap/i);
  assert.equal((out.detail as Record<string, unknown>).largestGapMonths, 149);

  const stale = [period("2010-01", "2014-01")];
  const staleOut = checkTenureArithmetic(ctx(mk("tenure", { years: 14 }, "14 years"), stale));
  assert.equal(staleOut.observation, "silent", "work after 2014 cannot be excluded");
  assert.match(staleOut.note ?? "", /cannot be excluded/);

  assert.equal(checkTenureArithmetic(ctx(mk("tenure", { years: 10 }), [])).observation, "silent");
  assert.equal(
    checkTenureArithmetic(ctx(mk("tenure", {}), [period("2019-03", "present")])).observation,
    "silent",
  );
  assert.equal(checkTenureArithmetic(ctx(period("2019-03", "present"), [])).observation, "silent");
});

test("a year-only date is read at its most generous to the candidate", () => {
  // The extractor widens a bare "2019" start to 2019-01, which is the *earliest*
  // month it could mean and therefore the longest history the candidate can
  // claim. The check then only fires against a total that survives that reading.
  const loose = [
    mk("employment_period", { startMonth: "2019-01", endMonth: "present", monthPrecision: "year" }),
  ];
  const out = checkTenureArithmetic(ctx(mk("tenure", { years: 12 }, "12 years"), loose));
  assert.equal((out.detail as Record<string, unknown>).ownHistoryFrom, "2019-01");
  assert.equal((out.detail as Record<string, unknown>).ownHistoryTo, NOW);
  assert.equal((out.detail as Record<string, unknown>).ownHistoryYears, 7.8);
  assert.equal(out.observation, "inconsistent");

  // The same claim against a history that reaches back far enough is supported.
  const long = [
    mk("employment_period", { startMonth: "2014-01", endMonth: "present", monthPrecision: "year" }),
  ];
  assert.equal(
    checkTenureArithmetic(ctx(mk("tenure", { years: 12 }, "12 years"), long)).observation,
    "supported",
  );
});

/* -------------------------------------------------------- cross-claim */

test("two stints claimed as current are noticed, not convicted", () => {
  const a = period("2020-05", "present", { employer: "Cube Analytics" });
  const b = period("2021-08", "present", { employer: "Delta Retail" });
  const out = checkOverlappingCurrent(ctx(a, [b]));
  assert.equal(out.observation, "inconsistent");
  assert.equal(checkById(out.checkId)?.definitiveWhenMismatch, false);

  assert.equal(checkOverlappingCurrent(ctx(a, [])).observation, "silent");
  const closed = period("2018-01", "2020-04");
  assert.equal(
    checkOverlappingCurrent(ctx(closed, [a])).observation,
    "silent",
    "only current stints can clash",
  );
});

test("a degree is ordered against work, and never against nothing", () => {
  const degree = mk("education", { endMonth: "2016-12" });
  assert.equal(
    checkEducationTimeline(ctx(degree, [period("2010-01", "present")])).observation,
    "supported",
  );
  assert.equal(
    checkEducationTimeline(ctx(degree, [period("2020-01", "present")])).observation,
    "inconsistent",
  );
  assert.equal(checkEducationTimeline(ctx(degree, [])).observation, "silent");
  assert.equal(
    checkEducationTimeline(ctx(mk("education", {}), [period("2010-01", "present")])).observation,
    "silent",
  );
  assert.equal(checkEducationTimeline(ctx(period("2010-01", "present"), [])).observation, "silent");
  // Studying after working is the normal case in this market.
  const mba = mk("education", { endMonth: "2022-12" });
  assert.equal(
    checkEducationTimeline(ctx(mba, [period("2010-01", "present")])).observation,
    "supported",
  );
});

test("an email domain that matches an employer is support, one that does not is a question", () => {
  const identity = mk("identity", { domain: "nimbus.example", employer: "nimbus" });
  const history = [period("2019-03", "present", { employer: "Nimbus Technologies" })];
  const match = checkEmailDomainEmployer(ctx(identity, history));
  assert.equal(match.observation, "supported");
  assert.match(match.note ?? "", /matches an employer/);

  const clash = checkEmailDomainEmployer(
    ctx(identity, [period("2019-03", "present", { employer: "Zeta Labs" })]),
  );
  assert.equal(clash.observation, "inconsistent");
  assert.equal(checkById(clash.checkId)?.definitiveWhenMismatch, false);

  assert.equal(checkEmailDomainEmployer(ctx(identity, [])).observation, "silent");
  // An employment claim's own employer field must not be counted as the email's match.
  const unrelated = [mk("tenure", { years: 5 })];
  assert.equal(checkEmailDomainEmployer(ctx(identity, unrelated)).observation, "silent");
});

test("a scale claim is recorded as un-sourceable rather than as a finding", () => {
  const metric = mk("metric", { quantity: "scaled to 40M users" }, "scaled to 40M users");
  const out = checkMetricHasNoSource(ctx(metric));
  assert.equal(out.observation, "silent", "no source is not evidence either way");
  assert.match(out.note ?? "", /no authoritative source/);
  assert.equal(checkMetricHasNoSource(ctx(period("2019-03", "present"))).observation, "silent");
});

/* -------------------------------------------------------------- ladder */

test("an arm that cannot run is a row saying so, never a blank", () => {
  // Two of the ladder's four skip gates are reachable in this engine — every
  // forensic arm is registered without an implementation, so `not enabled` is
  // what a candidate's report says today, and it says it per arm rather than
  // omitting the arm. The bytes and dependency gates below it take over as V4
  // and V6 land, which is why they are asserted on the registry, not here.
  const claim = period("2019-03", "present", { employer: "Nimbus Technologies" });
  const outcomes = runLadder({
    claim,
    siblings: [],
    now: NOW,
    hasRawBytes: false,
    availableDependencies: new Set<string>(),
  });
  const byId = new Map(outcomes.map((o) => [o.checkId, o]));

  for (const check of checksForKind(claim.kind)) {
    const row = byId.get(check.id);
    assert.ok(row, `${check.id} produced no row`);
    if (check.run) continue;
    assert.equal(row.observation, "skipped", check.id);
    assert.match(row.note ?? "", /Not enabled in engine/, check.id);
  }
  assert.ok(byId.get("document.orphaned_text"));
  assert.ok(byId.get("registry.employer_incorporation"));
});

test("an entitlement outside the plan is a row, not a blank", () => {
  const outcomes = runLadder({
    claim: period("2019-03", "2024-06"),
    siblings: [],
    now: NOW,
    hasRawBytes: false,
    availableDependencies: new Set(),
    allowedCheckIds: new Set(["dates.range_reversed"]),
  });
  assert.equal(outcomes.length, checksForKind("employment_period").length);
  const allowed = outcomes.find((o) => o.checkId === "dates.range_reversed");
  assert.equal(allowed?.observation, "supported");
  assert.match(
    outcomes.find((o) => o.checkId === "dates.dated_in_future")?.note ?? "",
    /Outside this workspace's verification plan/,
  );
});

test("the registry owns the check id, not the check", () => {
  // The Tier A helpers return `checkId: ""` on their silent and skipped paths —
  // every row is attributed by the runner, from the registry entry it actually
  // called. So a mislabelled check cannot move evidence into another row, and
  // `claim_evidence.check_id` can always be joined back to a real definition.
  for (const kind of CLAIM_KINDS) {
    const outcomes = runLadder({
      claim: mk(kind, {}),
      siblings: [],
      now: NOW,
      hasRawBytes: false,
      availableDependencies: new Set(),
    });
    assert.deepEqual(
      outcomes.map((o) => o.checkId),
      checksForKind(kind).map((c) => c.id),
    );
  }
});

test("a check that cannot read its input says nothing rather than accusing", () => {
  // Every parse path has to fail toward `silent`, because a parse failure looks
  // exactly like a discrepancy to a check that reports one whenever its
  // arithmetic returns null.
  const brokenNow = { ...ctx(period("2019-03", "present")), now: "not-a-month" };
  assert.equal(checkStartInFuture(brokenNow).observation, "silent");
  assert.equal(checkEndInFuture(brokenNow).observation, "silent");
  assert.equal(
    checkTenureArithmetic({ ...brokenNow, claim: mk("tenure", { years: 9 }) }).observation,
    "silent",
  );

  const outcomes = runLadder({
    claim: mk("tenure", { years: 9 }),
    siblings: [period("2019-03", "present")],
    now: "not-a-month",
    hasRawBytes: false,
    availableDependencies: new Set(),
  });
  const a = adjudicate(outcomes, CHECK_REGISTRY);
  assert.equal(a.verdict, "unverifiable");
  assert.ok(!isAccusingVerdict(a.verdict));
  assert.ok(
    outcomes.every((o) => !["inconsistent", "impossible"].includes(o.observation)),
    "a broken input must not look like evidence about a person",
  );
});

test("the ladder's Tier A rows are free and need nothing", () => {
  const tierA = CHECK_REGISTRY.filter((c) => c.run);
  for (const check of tierA) {
    assert.equal(check.costPaise, 0, `${check.id} is a paid arm with an implementation`);
    assert.equal(check.externalDependency, "");
    assert.equal(check.includedInFreeTier, true);
    assert.equal(check.requiresRawBytes, false, `${check.id} needs bytes but runs inline`);
  }
  for (const check of CHECK_REGISTRY.filter((c) => !c.run)) {
    assert.equal(
      check.includedInFreeTier,
      false,
      `${check.id} is not built and must not look free`,
    );
  }
});

test("a fabricated document is flagged by the ladder end to end", () => {
  const claim = period("2021-08", "2019-03", { employer: "Ironclad Systems" });
  const outcomes = runLadder({
    claim,
    siblings: [],
    now: NOW,
    hasRawBytes: false,
    availableDependencies: new Set(),
  });
  const a = adjudicate(outcomes, CHECK_REGISTRY);
  assert.equal(a.verdict, "impossible");
  assert.equal(a.restsOn, "dates.range_reversed");
  assert.equal(a.definitive, true);
  assert.ok(DEFINITIVE_CHECK_IDS.has(a.restsOn));
});

test("an honest document is never accused by the ladder", () => {
  const history = [
    period("2016-06", "2019-02", { employer: "Zeta Labs" }),
    period("2019-03", "present", { employer: "Nimbus Technologies" }),
  ];
  const tenure = mk("tenure", { years: 7 }, "7 years of experience");
  for (const claim of [...history, tenure]) {
    const a = adjudicate(
      runLadder({
        claim,
        siblings: history.filter((h) => h !== claim),
        now: NOW,
        hasRawBytes: false,
        availableDependencies: new Set(),
      }),
      CHECK_REGISTRY,
    );
    assert.ok(
      a.verdict === "verified" || a.verdict === "unverifiable",
      `${claim.kind} came back ${a.verdict}: ${a.note}`,
    );
    assert.ok(!isAccusingVerdict(a.verdict), `${claim.kind} was accused`);
  }
});

test("every observation the checks can emit is one the adjudicator knows", () => {
  const known = new Set<string>(OBSERVATIONS);
  const claims: ExtractedClaim[] = [
    period("2028-01", "present"),
    period("2021-08", "2019-03"),
    mk("education", { endMonth: "2027-12" }),
    mk("credential", { credential: "AWS", credentialId: "AWS-1" }),
    mk("identity", { domain: "nimbus.example" }),
    mk("metric", { quantity: "40M" }),
    mk("tenure", { years: 30 }),
  ];
  for (const claim of claims) {
    for (const o of runLadder({
      claim,
      siblings: claims.filter((c) => c !== claim),
      now: NOW,
      hasRawBytes: true,
      availableDependencies: new Set(["dns", "registry", "issuer", "slate"]),
    })) {
      assert.ok(known.has(o.observation), o.observation);
      assert.ok(o.checkId.length > 0, "an outcome must name the check that produced it");
      // An accusing row has to say what it saw and where, because that sentence
      // is the only thing a recruiter can act on and the only record a candidate
      // could ever be shown to rebut.
      if (o.observation === "inconsistent" || o.observation === "impossible") {
        assert.ok(o.note && o.note.length > 10, `${o.checkId} accused without explaining`);
        assert.ok(o.detail, `${o.checkId} accused without the numbers behind it`);
      }
    }
  }
});
