/**
 * The product-plan entitlement algebra.
 *
 * Pinned before anything reads it out of a database: an absent plan row must be
 * the free tier with its allowance intact, a cap must bite on the use *after*
 * the limit and never on the work already done, unlimited must be null and not
 * a large number, and a retried screen inside one billing month must be one
 * key — the difference between a meter and a bill somebody disputes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PLAN_TIERS,
  defaultProductQuotaState,
  idempotencyKeyForScreening,
  planBuysVerificationLadder,
  productEntitlementFor,
} from "./plans.ts";

describe("plan tiers", () => {
  test("the free tier caps at one open role and thirty screens", () => {
    const free = PLAN_TIERS.free;
    assert.equal(free.activeRolesMax, 1);
    assert.equal(free.screeningQuotaMonthly, 30);
    assert.equal(free.pricePaiseMonthly, 0);
  });

  test("prices are paise integers, rupee-exact", () => {
    assert.equal(PLAN_TIERS.starter.pricePaiseMonthly, 699_900);
    assert.equal(PLAN_TIERS.growth.pricePaiseMonthly, 1_699_900);
    for (const tier of Object.values(PLAN_TIERS)) {
      if (tier.pricePaiseMonthly !== null) {
        assert.equal(Number.isInteger(tier.pricePaiseMonthly), true);
      }
    }
  });

  test("uncapped tiers say null, not a magic number", () => {
    assert.equal(PLAN_TIERS.growth.activeRolesMax, null);
    assert.equal(PLAN_TIERS.growth.screeningQuotaMonthly, null);
    assert.equal(PLAN_TIERS.portfolio.screeningQuotaMonthly, null);
  });

  test("only the free plan leaves the verification ladder un-bought", () => {
    assert.equal(planBuysVerificationLadder("free"), false);
    assert.equal(planBuysVerificationLadder("starter"), true);
    assert.equal(planBuysVerificationLadder("growth"), true);
    assert.equal(planBuysVerificationLadder("portfolio"), true);
  });
});

describe("productEntitlementFor", () => {
  test("an absent row is free with the whole allowance left", () => {
    const e = productEntitlementFor(defaultProductQuotaState());
    assert.equal(e.tier.plan, "free");
    assert.equal(e.canCreateRole, true);
    assert.equal(e.screeningsLeft, 30);
    assert.equal(e.canScreen, true);
    assert.notEqual(e.reason, "");
  });

  test("the role cap bites on the open role at the limit, not below it", () => {
    assert.equal(productEntitlementFor({ plan: "free", rolesOpen: 0, screeningsUsed: 0 }).canCreateRole, true);
    assert.equal(productEntitlementFor({ plan: "starter", rolesOpen: 2, screeningsUsed: 0 }).canCreateRole, true);
    assert.equal(productEntitlementFor({ plan: "starter", rolesOpen: 3, screeningsUsed: 0 }).canCreateRole, false);
    assert.equal(productEntitlementFor({ plan: "growth", rolesOpen: 400, screeningsUsed: 0 }).canCreateRole, true);
  });

  test("the screen allowance counts down and then holds at zero", () => {
    assert.equal(productEntitlementFor({ plan: "free", rolesOpen: 1, screeningsUsed: 29 }).screeningsLeft, 1);
    const spent = productEntitlementFor({ plan: "free", rolesOpen: 1, screeningsUsed: 30 });
    assert.equal(spent.screeningsLeft, 0);
    assert.equal(spent.canScreen, false);
    // Overcounted uses (a meter read after a race) must not go negative.
    assert.equal(productEntitlementFor({ plan: "free", rolesOpen: 1, screeningsUsed: 99 }).screeningsLeft, 0);
    assert.equal(productEntitlementFor({ plan: "growth", rolesOpen: 1, screeningsUsed: 9_999 }).screeningsLeft, null);
    assert.equal(productEntitlementFor({ plan: "growth", rolesOpen: 1, screeningsUsed: 9_999 }).canScreen, true);
  });

  test("a gate that bites says what lifts it", () => {
    const screened = productEntitlementFor({ plan: "free", rolesOpen: 1, screeningsUsed: 30 });
    assert.match(screened.reason, /screens are used up/);
    const roled = productEntitlementFor({ plan: "starter", rolesOpen: 3, screeningsUsed: 10 });
    assert.match(roled.reason, /Close one/);
  });

  test("nonsense numbers cannot invent entitlement", () => {
    const junk = productEntitlementFor({
      plan: "starter" as keyof typeof PLAN_TIERS,
      rolesOpen: -5,
      screeningsUsed: Number.NaN,
    });
    assert.equal(junk.tier.plan, "starter");
    assert.equal(junk.screeningsLeft, 300);
    const unknownPlan = productEntitlementFor({
      ...defaultProductQuotaState(),
      plan: "not-a-plan" as never,
    });
    assert.equal(unknownPlan.tier.plan, "free");
  });
});

describe("screening idempotency", () => {
  test("the same application in the same period is the same key", () => {
    const base = { orgId: "o1", applicationId: "a1", periodStartIso: "2026-11-01T00:00:00.000Z" };
    assert.equal(idempotencyKeyForScreening(base), idempotencyKeyForScreening({ ...base }));
  });

  test("a new billing month is a new use", () => {
    const base = { orgId: "o1", applicationId: "a1" };
    assert.notEqual(
      idempotencyKeyForScreening({ ...base, periodStartIso: "2026-11-01T00:00:00.000Z" }),
      idempotencyKeyForScreening({ ...base, periodStartIso: "2026-12-01T00:00:00.000Z" }),
    );
  });

  test("different applications never collide", () => {
    const base = { orgId: "o1", periodStartIso: "2026-11-01T00:00:00.000Z" };
    assert.notEqual(
      idempotencyKeyForScreening({ ...base, applicationId: "a1" }),
      idempotencyKeyForScreening({ ...base, applicationId: "a2" }),
    );
  });
});
