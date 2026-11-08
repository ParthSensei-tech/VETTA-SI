/**
 * The accusation rule, tested as a property rather than as examples.
 *
 * These tests are the reason the feature can be described as defensible: they
 * hold for *any* set of observations, so a check added later that tries to
 * accuse without being registered as definitive meets the same wall the first
 * seven did. The single most important assertion here is the one that looks
 * trivial — an output of `contradicted` or `impossible` always names a check in
 * the definitive set, and never rests on anything else.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  adjudicate,
  countVerdicts,
  coverageRatio,
  definitiveCheckIds,
  headlineVerdict,
  isAccusingVerdict,
  isFinding,
  mayRecordVerdict,
  type CheckOutcome,
  type CheckTier,
  type Observation,
  type Verdict,
} from "./adjudicate.ts";

const REGISTRY: CheckTier[] = [
  {
    id: "arith.reversed",
    label: "Dates run backwards",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: true,
    kinds: ["employment_period"],
  },
  {
    id: "arith.future_start",
    label: "Started in the future",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: true,
    kinds: ["employment_period"],
  },
  {
    id: "soft.overlap",
    label: "Two current employers",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ["employment_period"],
  },
  {
    id: "paid.registry",
    label: "Incorporation date",
    tier: 2,
    costPaise: 50_000,
    requiresRawBytes: false,
    externalDependency: "registry",
    definitiveWhenMismatch: true,
    kinds: ["employment_period"],
  },
];

const outcome = (checkId: string, observation: Observation, note = ""): CheckOutcome => ({
  checkId,
  observation,
  note,
});

test("only a definitive check can leave a verdict that accuses", () => {
  const a = adjudicate([outcome("arith.reversed", "impossible", "runs backwards")], REGISTRY);
  assert.equal(a.verdict, "impossible");
  assert.equal(a.definitive, true);
  assert.equal(a.restsOn, "arith.reversed");
  assert.equal(a.cappedFrom, "");
});

test("a non-definitive mismatch is capped to unverifiable, and the cap is recorded", () => {
  for (const wanted of ["inconsistent", "impossible"] as const) {
    const a = adjudicate([outcome("soft.overlap", wanted, "two current")], REGISTRY);
    assert.equal(a.verdict, "unverifiable", `${wanted} must not accuse`);
    assert.equal(a.cappedFrom, wanted === "inconsistent" ? "contradicted" : "impossible");
    assert.equal(a.definitive, false);
    assert.match(a.note, /two current/, "the suppressed reason must survive");
  }
});

test("an unregistered check id can warn but cannot accuse", () => {
  const a = adjudicate([outcome("some.future.check", "impossible", "new arm")], REGISTRY);
  assert.equal(a.verdict, "unverifiable");
  assert.equal(a.cappedFrom, "impossible");
  assert.equal(a.definitive, false);
});

test("a definitive impossible outranks a cheaper supported", () => {
  const a = adjudicate(
    [
      outcome("soft.overlap", "supported", "looks fine"),
      outcome("arith.reversed", "impossible", "2021 to 2019"),
      outcome("paid.registry", "supported", "company exists"),
    ],
    REGISTRY,
  );
  assert.equal(a.verdict, "impossible");
  assert.equal(a.restsOn, "arith.reversed");
});

test("supported never launders an accusation, definitive or capped", () => {
  const cases: CheckOutcome[][] = [
    [outcome("soft.overlap", "inconsistent", "noted"), outcome("arith.future_start", "supported")],
    [outcome("arith.reversed", "impossible", "noted"), outcome("paid.registry", "supported")],
    [outcome("arith.future_start", "supported"), outcome("soft.overlap", "inconsistent", "noted")],
  ];
  for (const outcomes of cases) {
    const a = adjudicate(outcomes, REGISTRY);
    assert.notEqual(a.verdict, "verified", JSON.stringify(outcomes));
    assert.ok(isAccusingVerdict(a.verdict) || a.verdict === "unverifiable");
  }
});

test("order of observations does not change the verdict", () => {
  const base: CheckOutcome[] = [
    outcome("arith.reversed", "impossible", "backwards"),
    outcome("soft.overlap", "inconsistent", "overlap"),
    outcome("paid.registry", "supported", "exists"),
  ];
  const forward = adjudicate(base, REGISTRY);
  const backward = adjudicate([...base].reverse(), REGISTRY);
  assert.equal(forward.verdict, backward.verdict);
  assert.equal(forward.definitive, backward.definitive);
  assert.deepEqual(
    [...forward.contributingCheckIds].sort(),
    [...backward.contributingCheckIds].sort(),
  );
});

test("adjudication is pure and deterministic", () => {
  const input = [outcome("paid.registry", "inconsistent", "incorporated 2021")];
  assert.deepEqual(adjudicate(input, REGISTRY), adjudicate(input, REGISTRY));
});

test("silence is not agreement", () => {
  for (const observation of ["silent", "skipped", "error"] as const) {
    const a = adjudicate([outcome("arith.reversed", observation, "nothing to compare")], REGISTRY);
    assert.equal(a.verdict, "unverifiable", `${observation} must not read as verified`);
    assert.equal(a.attempted, false, `${observation} is not coverage`);
  }
  assert.equal(adjudicate([], REGISTRY).verdict, "unverifiable");
  assert.equal(adjudicate([], REGISTRY).attempted, false);
  assert.match(adjudicate([], REGISTRY).note, /No check could run/);
});

test("isFinding is the one definition coverage and verdicts share", () => {
  assert.deepEqual(
    (
      ["supported", "inconsistent", "impossible", "silent", "skipped", "error"] as Observation[]
    ).filter(isFinding),
    ["supported", "inconsistent", "impossible"],
  );
});

test("cost accumulates from the outcome, else from the registry", () => {
  const a = adjudicate(
    [outcome("paid.registry", "supported"), outcome("soft.overlap", "supported")],
    REGISTRY,
  );
  assert.equal(a.costPaise, 50_000);
  const billed = adjudicate(
    [{ checkId: "paid.registry", observation: "supported", costPaise: 1234 }],
    REGISTRY,
  );
  assert.equal(billed.costPaise, 1234);
});

test("an arm that never ran is not on the bill", () => {
  // This number is what V5's quota spends and what the invoice shows; a slate
  // that skipped every paid arm must read ₹0, not ₹50,000 a claim.
  const skipped = adjudicate(
    [outcome("paid.registry", "skipped", "Waiting on registry")],
    REGISTRY,
  );
  assert.equal(skipped.costPaise, 0);
  assert.equal(skipped.verdict, "unverifiable");
  assert.equal(skipped.attempted, false);
  // An arm that threw *after* being bought is charged what it declared: the
  // provider usually billed the call regardless of how it ended.
  const errored = adjudicate([outcome("paid.registry", "error", "timeout")], REGISTRY);
  assert.equal(errored.costPaise, 50_000);
  assert.equal(errored.attempted, false);
});

test("definitiveCheckIds is derived from the flags, not from a list", () => {
  const ids = definitiveCheckIds(REGISTRY);
  assert.deepEqual([...ids].sort(), ["arith.future_start", "arith.reversed", "paid.registry"]);
  const flipped: CheckTier[] = REGISTRY.map((c) => ({ ...c, definitiveWhenMismatch: false }));
  assert.equal(definitiveCheckIds(flipped).size, 0);
});

test("mayRecordVerdict lets benign words through and gates the accusing ones", () => {
  const definitive = definitiveCheckIds(REGISTRY);
  const benign: Verdict[] = ["verified", "unverifiable"];
  for (const v of benign) {
    assert.equal(mayRecordVerdict("soft.overlap", v, definitive), true);
    assert.equal(mayRecordVerdict("not.registered.at.all", v, definitive), true);
  }
  for (const v of ["contradicted", "impossible"] as Verdict[]) {
    assert.equal(mayRecordVerdict("arith.reversed", v, definitive), true);
    assert.equal(mayRecordVerdict("soft.overlap", v, definitive), false);
    assert.equal(mayRecordVerdict("not.registered.at.all", v, definitive), false);
    assert.equal(mayRecordVerdict("ledger.no_applicable_check", v, definitive), false);
  }
});

test("every path that ends in an accusing verdict names a definitive check", () => {
  const observations: Observation[] = [
    "supported",
    "inconsistent",
    "impossible",
    "silent",
    "skipped",
    "error",
  ];
  const ids = REGISTRY.map((c) => c.id).concat(["unknown.check"]);
  const definitive = definitiveCheckIds(REGISTRY);
  // Exhaustive over pairs rather than sampled: this is the property the whole
  // feature rests on, and 7 x 6 x 42 is cheap enough to run on every commit.
  for (const first of ids) {
    for (const second of ids) {
      for (const o1 of observations) {
        for (const o2 of observations) {
          const a = adjudicate([outcome(first, o1, "x"), outcome(second, o2, "y")], REGISTRY);
          if (isAccusingVerdict(a.verdict)) {
            assert.ok(definitive.has(a.restsOn), `${a.verdict} rested on ${a.restsOn}`);
            assert.equal(a.definitive, true);
          }
          // And the cap never escalates: whatever else happened, a claim whose
          // verdict is `unverifiable` is never reported as `verified`.
          if (a.cappedFrom) assert.notEqual(a.verdict, "verified");
        }
      }
    }
  }
});

test("coverage stays inside [0,1] and clamps a nonsense numerator", () => {
  assert.equal(coverageRatio({ claims: 0, checked: 0 }).ratio, 0);
  assert.equal(coverageRatio({ claims: 4, checked: 4 }).ratio, 1);
  assert.equal(coverageRatio({ claims: 4, checked: 9 }).ratio, 1);
  assert.equal(coverageRatio({ claims: 4, checked: -2 }).ratio, 0);
  assert.equal(coverageRatio({ claims: -1, checked: 3 }).claims, 0);
});

test("counts add up to the claims they were given", () => {
  const counts = countVerdicts([
    "verified",
    "verified",
    "unverifiable",
    "contradicted",
    "impossible",
  ]);
  assert.deepEqual(counts, {
    verified: 2,
    contradicted: 1,
    unverifiable: 1,
    impossible: 1,
    claims: 5,
  });
  assert.equal(
    Object.entries(counts)
      .filter(([k]) => k !== "claims")
      .reduce((n, [, v]) => n + v, 0),
    counts.claims,
  );
});

test("a slate is clean only when every claim was verified", () => {
  assert.equal(headlineVerdict(countVerdicts([])), "none");
  assert.equal(headlineVerdict(countVerdicts(["verified", "verified"])), "clean");
  assert.equal(headlineVerdict(countVerdicts(["verified", "unverifiable"])), "partial");
  assert.equal(headlineVerdict(countVerdicts(["verified", "contradicted"])), "flagged");
  assert.equal(headlineVerdict(countVerdicts(["verified", "impossible"])), "flagged");
  // The absence of evidence is never evidence of honesty.
  assert.notEqual(headlineVerdict(countVerdicts(["unverifiable"])), "clean");
});
