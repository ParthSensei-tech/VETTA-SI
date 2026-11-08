/**
 * The read side's one judgement: when may a chip speak?
 *
 * `verification_status` and `verification_summary_json` are written by the queue
 * and read by a recruiter's screen, and nothing forces the two to be the same
 * age. An engine bump, a hand-edited row, a migration that backfilled one column
 * and not the other — each leaves a cached verdict that is neither obviously
 * wrong nor obviously right. These tests pin the answer for every one of those
 * shapes, because the failure mode of a hiring tool that reads a stale verdict
 * as fresh is a claim about a person that cannot be defended afterwards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_COUNTS,
  HEADLINES,
  parseSummaryJson,
  reportView,
  slateVerdict,
  type ReportLedger,
} from "./report.ts";

const summary = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    headline: "flagged",
    counts: { verified: 1, contradicted: 1, unverifiable: 0, impossible: 0, claims: 2 },
    coverage: 0.5,
    engineVersion: "vetta-verify-1",
    ...over,
  });

test("a summary that still matches the domain reads back in full", () => {
  assert.deepEqual(slateVerdict("app-1", "flagged", summary()), {
    applicationId: "app-1",
    headline: "flagged",
    coverage: 0.5,
    counts: { verified: 1, contradicted: 1, unverifiable: 0, impossible: 0, claims: 2 },
    engineVersion: "vetta-verify-1",
  });
});

test("the four words the ladder can emit are the four the reader knows", () => {
  for (const headline of HEADLINES) {
    assert.ok(slateVerdict("app-1", headline, summary({ headline })), `${headline} is readable`);
  }
  // Not a superset: a word the reader invented but the ladder never says would
  // render a chip for a verdict that does not exist.
  assert.deepEqual([...HEADLINES], ["clean", "flagged", "partial", "none"]);
});

test("a cached row that cannot be re-validated shows nothing", () => {
  const cases: [string, string, string | null | undefined][] = [
    ["the default before any run", "", "{}"],
    ["nothing at all", "", null],
    ["a word in neither place", "suspicious", summary({ headline: "" })],
    ["a status the ledger never writes", "reviewed", "not json at all"],
    ["a headline from an engine we no longer run", "scored", summary({ headline: "scored" })],
    [
      "a future word in the summary and an empty status",
      "none-but-legacy",
      summary({ headline: "scored" }),
    ],
  ];
  for (const [why, status, json] of cases) {
    assert.equal(slateVerdict("app-1", status, json), null, why);
  }
});

test("a broken summary does not silence a word the status column knows", () => {
  // The summary is a rendering cache; `verification_status` is the ledger's own
  // label, written from `headlineVerdict()` in the same statement. A row whose
  // JSON was mangled but whose label is intact still shows the label — and the
  // drawer reads the real ledger by application, so it can substantiate it.
  for (const json of ["not json at all", "[1,2,3]", "42", "null", null, undefined, ""]) {
    const verdict = slateVerdict("app-1", "flagged", json);
    assert.equal(verdict?.headline, "flagged", `${String(json)}: the word survives`);
    assert.equal(verdict?.coverage, 0, "and nothing is asserted about coverage");
    assert.deepEqual(verdict?.counts, EMPTY_COUNTS, "or about which claims it covers");
  }
});

test("the status column carries the word when the summary forgot it", () => {
  // `verification_status` is written in the same statement as the summary, from
  // the same `headlineVerdict()` call, so trusting it alone is not a guess — and
  // a summary written by an older engine still has a defensible headline.
  assert.equal(slateVerdict("app-1", "partial", "{}")?.headline, "partial");
  assert.equal(slateVerdict("app-1", "clean", summary({ headline: undefined }))?.headline, "clean");
  assert.equal(slateVerdict("app-1", "", summary({ headline: "" })), null, "and never invents one");
});

test("half a summary degrades to a known default, never to a guess", () => {
  const verdict = slateVerdict(
    "app-1",
    "clean",
    JSON.stringify({ headline: "clean", coverage: "0.5", counts: [1, 2], engineVersion: 7 }),
  );
  assert.equal(verdict?.coverage, 0, "a stringified ratio is not a percentage");
  assert.equal(verdict?.engineVersion, "", "and a numeric version is not a version");
  // An array is truthy and object-typed, so the counts still spread — but every
  // field the drawer reads falls back, and the chip cannot report a number of
  // claims that was never stored.
  assert.equal(verdict?.counts.claims, 0);
  assert.equal(verdict?.counts.verified, 0);
});

test("parseSummaryJson never throws, whatever the column holds", () => {
  for (const json of [null, undefined, "", "{", '"a string"', "42", "true", "[1,2]", "null"]) {
    assert.doesNotThrow(() => parseSummaryJson(json));
  }
  assert.deepEqual(parseSummaryJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseSummaryJson("42"), {}, "a scalar is not a record");
  assert.deepEqual(parseSummaryJson("[1,2]"), {}, "and neither is a list");
});

const ledger = (over: Partial<ReportLedger> = {}): ReportLedger => ({
  claims: [],
  coverage: { ratio: 1, checked: 2, claims: 2 },
  counts: { verified: 2, contradicted: 0, unverifiable: 0, impossible: 0, claims: 2 },
  costPaise: 0,
  engineVersion: "vetta-verify-1",
  ...over,
});

test("the drawer prefers the ledger and falls back to the cache", () => {
  const verdict = slateVerdict("app-1", "flagged", summary({ headline: "partial" }));
  const job = { status: "completed", error: "", attempts: 1 };

  const withLedger = reportView(verdict, job, ledger());
  assert.equal(withLedger.coverage.ratio, 1, "the ledger's own denominator wins");
  assert.equal(withLedger.counts.verified, 2);
  assert.equal(withLedger.engineVersion, "vetta-verify-1");

  // A purged or never-finished report keeps the headline the recruiter already
  // saw, and shows no claims — because there is nothing left to show them from.
  const cacheOnly = reportView(verdict, null, null);
  assert.deepEqual(cacheOnly.claims, []);
  assert.equal(cacheOnly.coverage.ratio, 0.5, "the cached coverage, not a recomputed one");
  assert.equal(cacheOnly.coverage.checked, 0, "and no claim can be claimed as checked");
  assert.equal(cacheOnly.coverage.claims, 2);
  assert.equal(cacheOnly.costPaise, 0, "a cached row cannot resurrect a cost either");
  assert.equal(cacheOnly.engineVersion, "vetta-verify-1");

  const nothing = reportView(null, null, null);
  assert.equal(nothing.verdict, null);
  assert.deepEqual(nothing.counts, EMPTY_COUNTS);
  assert.deepEqual(nothing.coverage, { ratio: 0, checked: 0, claims: 0 });
});

test("an empty ledger is not the same as no ledger", () => {
  // A completed report with no claims is a real finding — the document simply
  // had nothing checkable — while a missing report is our reach. Only the first
  // may show a zero-filled coverage bar, and it comes from the ledger.
  const view = reportView(
    slateVerdict("app-1", "none", summary({ headline: "none" })),
    null,
    ledger({
      coverage: { ratio: 0, checked: 0, claims: 0 },
      counts: EMPTY_COUNTS,
    }),
  );
  assert.deepEqual(view.coverage, { ratio: 0, checked: 0, claims: 0 });
  assert.equal(view.counts.claims, 0);
});
