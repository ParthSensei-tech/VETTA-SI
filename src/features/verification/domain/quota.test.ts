/**
 * The entitlement algebra.
 *
 * These tests are about one failure mode: a workspace that should still get an
 * answer being left with nothing, and a workspace that should not get the
 * expensive arms getting them anyway. Both are decided by arithmetic over three
 * numbers, so the arithmetic is worth pinning before anything reads it out of a
 * database — and the second half of the file is the retry defence, which is the
 * difference between a meter and a bill somebody disputes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  FREE_USE_ALLOWANCE,
  PLAN_TIER_FREE,
  PLAN_TIER_PAID,
  defaultQuotaState,
  entitlementFor,
  preflightSpend,
  idempotencyKeyFor,
  type QuotaState,
} from "./quota.ts";

const free = (usesSpent: number, freeQuota = FREE_USE_ALLOWANCE): QuotaState => ({
  plan: "free",
  freeQuota,
  usesSpent,
});

describe("the four free reports", () => {
  test("a workspace nobody has ever written a row for has an allowance, not a zero", () => {
    const e = entitlementFor(defaultQuotaState());
    assert.equal(e.planTier, PLAN_TIER_PAID);
    assert.equal(e.charge, "free");
    assert.equal(e.usesLeft, FREE_USE_ALLOWANCE);
    // The sentence a recruiter reads has to contain the number, or the meter is
    // decorative.
    assert.match(e.reason, /4 of 4 free checks left/);
  });

  test("the trial spends down one report at a time and stops mid-slate", () => {
    for (let spent = 0; spent < FREE_USE_ALLOWANCE; spent += 1) {
      const e = entitlementFor(free(spent));
      assert.equal(e.entitled, true, `${spent} spent still has use ${spent + 1}`);
      assert.equal(e.usesLeft, FREE_USE_ALLOWANCE - spent);
    }
    const spent = entitlementFor(free(FREE_USE_ALLOWANCE));
    assert.equal(spent.entitled, false);
    assert.equal(spent.planTier, PLAN_TIER_FREE);
    assert.equal(spent.charge, "none");
    assert.equal(spent.usesLeft, 0);
  });

  test("running out of a trial stops the arms, never the report", () => {
    // The load-bearing asymmetry: exhausted means `tier_a`, which is a complete
    // verdict over the free checks — it does not mean "come back with a card".
    const exhausted = entitlementFor(free(FREE_USE_ALLOWANCE + 7));
    assert.equal(exhausted.planTier, PLAN_TIER_FREE);
    assert.ok(/switched off/.test(exhausted.reason));
    assert.ok(/report below is still complete/.test(exhausted.reason));
  });

  test("an allowance of zero is a workspace with no trial, not a broken one", () => {
    const e = entitlementFor(free(0, 0));
    assert.equal(e.entitled, false);
    assert.equal(e.planTier, PLAN_TIER_FREE);
  });
});

describe("a workspace with a plan", () => {
  test("the plan is what was agreed and the allowance is what was granted", () => {
    // Paid with uses still unspent: entitled and charged as `paid`, and the
    // unused allowance is reported rather than hidden, because it is a fact
    // about the agreement.
    const e = entitlementFor({ plan: "paid", freeQuota: 4, usesSpent: 1 });
    assert.equal(e.planTier, PLAN_TIER_PAID);
    assert.equal(e.charge, "paid");
    assert.equal(e.usesLeft, 3);
    assert.equal(e.entitled, true);
  });

  test("a paid plan does not expire because the meter grew", () => {
    assert.equal(entitlementFor({ plan: "paid", freeQuota: 4, usesSpent: 900 }).entitled, true);
  });
});

describe("a meter that arrived from somewhere else", () => {
  test("nonsense cannot invent entitlement", () => {
    for (const bad of [-4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const e = entitlementFor({ plan: "free", freeQuota: bad, usesSpent: 0 });
      assert.equal(e.entitled, false, `freeQuota ${bad}`);
      assert.equal(e.planTier, PLAN_TIER_FREE, `freeQuota ${bad}`);
    }
    // A negative spend is not a credit balance.
    const credited = entitlementFor({ plan: "free", freeQuota: 4, usesSpent: -3 });
    assert.equal(credited.usesLeft, 4);
  });

  test("an unrecognised plan string reads as the free plan, not as a paid one", () => {
    const e = entitlementFor({ plan: "enterprise_premium" as "paid", freeQuota: 4, usesSpent: 4 });
    assert.equal(e.planTier, PLAN_TIER_FREE);
  });
});

describe("the idempotency key", () => {
  const base = {
    orgId: "org-1",
    candidateId: "can-1",
    engineVersion: "vetta-verify-2",
    reportId: "report-1",
  };

  test("the same work asked for twice is the same key", () => {
    assert.equal(idempotencyKeyFor(base), idempotencyKeyFor({ ...base }));
    assert.doesNotMatch(idempotencyKeyFor(base), /undefined|null|\s/);
  });

  test("anything that changes what the arms would see changes the key", () => {
    const keys = new Set([
      idempotencyKeyFor(base),
      idempotencyKeyFor({ ...base, orgId: "org-2" }),
      idempotencyKeyFor({ ...base, candidateId: "can-2" }),
      idempotencyKeyFor({ ...base, engineVersion: "vetta-verify-3" }),
      // A different report row is a different claim set or a different file under
      // the same prose — either way, the byte arms looked at something else.
      idempotencyKeyFor({ ...base, reportId: "report-2" }),
    ]);
    assert.equal(keys.size, 5, JSON.stringify([...keys]));
  });

  test("ids containing the separator cannot collide with a different pair", () => {
    const a = idempotencyKeyFor({ ...base, orgId: "org:can-1", candidateId: "" });
    const b = idempotencyKeyFor({ ...base, orgId: "org", candidateId: "can-1" });
    assert.notEqual(a, b);
  });
});

describe("asking before a slate spends", () => {
  test("a trial smaller than the slate is disclosed, not discovered", () => {
    const p = preflightSpend(free(3), { reports: 200 });
    assert.equal(p.willRunPaid, 1, "one use was left");
    assert.equal(p.willFallBack, 199);
    assert.equal(p.needsConsent, false, "nothing here costs the workspace money");
    assert.match(p.reason, /1 report with the full ladder, 199 with the free one/);
  });

  test("a per-report plan without a number is a question, not a decision", () => {
    const p = preflightSpend({ plan: "paid", freeQuota: 4, usesSpent: 9 }, { reports: 200 });
    assert.equal(p.needsConsent, true);
    assert.equal(p.willRunPaid, 0, "200 reports is not a number nobody agreed to");
    assert.equal(p.willFallBack, 200, "and all 200 still get their free checks");
  });

  test("the caller's cap is honoured, and cannot be outspent by a big slate", () => {
    const paid = preflightSpend({ plan: "paid", freeQuota: 0, usesSpent: 0 }, { reports: 200, maxUses: 20 });
    assert.equal(paid.willRunPaid, 20);
    assert.equal(paid.willFallBack, 180);

    const trial = preflightSpend(free(0), { reports: 200, maxUses: 20 });
    assert.equal(trial.willRunPaid, 4, "the allowance binds before the cap does");

    const tiny = preflightSpend(free(0), { reports: 2, maxUses: 20 });
    assert.equal(tiny.willRunPaid, 2, "a cap larger than the slate is not a licence to invent reports");
  });

  test("an exhausted workspace is told nothing is charged, in words", () => {
    const p = preflightSpend(free(4), { reports: 50 });
    assert.equal(p.willRunPaid, 0);
    assert.equal(p.needsConsent, false);
    assert.match(p.reason, /^Nothing is charged:/);
  });

  test("a zero-report slate spends nothing and asks for nothing", () => {
    const p = preflightSpend({ plan: "paid", freeQuota: 0, usesSpent: 0 }, { reports: 0 });
    assert.deepEqual(
      { paid: p.willRunPaid, back: p.willFallBack, consent: p.needsConsent },
      { paid: 0, back: 0, consent: false },
    );
  });
});
