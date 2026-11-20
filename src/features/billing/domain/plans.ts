/**
 * What each plan is, and what it entitles, in arithmetic.
 *
 * Same doctrine as `verification/domain/quota.ts`: the commercial decisions live
 * here as pure numbers so a file with IO cannot make them quietly. Prices are in
 * paise (integer rupees × 100) because Razorpay quotes in paise and a rupee that
 * survives two float round-trips is a rupee nobody can reconcile.
 *
 * The invariant that matters: an absent plan row is the free tier with its
 * allowance intact — never an exhausted one. Running out of an allowance stops
 * the *new work*, and never hides the work already done: a workspace that hits
 * its cap still sees every role, application and verdict it already has.
 */

export type ProductPlan = "free" | "starter" | "growth" | "portfolio";

export type PlanTier = {
  plan: ProductPlan;
  /** The program name the pricing page sells — identity, not feature. */
  displayName: string;
  /** Paise per month. Portfolio is quoted, never priced in code. */
  pricePaiseMonthly: number | null;
  seats: number;
  /** null = the tier does not cap open roles. */
  activeRolesMax: number | null;
  /** null = the tier does not cap monthly screens. */
  screeningQuotaMonthly: number | null;
};

export const PLAN_TIERS: Record<ProductPlan, PlanTier> = {
  free: {
    plan: "free",
    displayName: "Free",
    pricePaiseMonthly: 0,
    seats: 1,
    activeRolesMax: 1,
    screeningQuotaMonthly: 30,
  },
  starter: {
    plan: "starter",
    displayName: "Vetta Engine",
    pricePaiseMonthly: 699_900,
    seats: 3,
    activeRolesMax: 3,
    screeningQuotaMonthly: 300,
  },
  growth: {
    plan: "growth",
    displayName: "Vetta Ops",
    pricePaiseMonthly: 1_699_900,
    seats: 10,
    activeRolesMax: null,
    screeningQuotaMonthly: null,
  },
  portfolio: {
    plan: "portfolio",
    displayName: "Vetta Portfolio",
    pricePaiseMonthly: null,
    seats: 50,
    activeRolesMax: null,
    screeningQuotaMonthly: null,
  },
};

/** Plans whose paid terms entitle the verification ladder's paid arms. */
export function planBuysVerificationLadder(plan: ProductPlan): boolean {
  return plan !== "free";
}

export type ProductQuotaState = {
  plan: ProductPlan;
  /** Roles currently `open` in this workspace — read by the server, not guessed. */
  rolesOpen: number;
  /** Screening uses already charged in the current billing period. */
  screeningsUsed: number;
};

/** The state a workspace with no row in org_plans is in — free, allowance intact. */
export function defaultProductQuotaState(): ProductQuotaState {
  return { plan: "free", rolesOpen: 0, screeningsUsed: 0 };
}

function whole(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export type ProductEntitlement = {
  tier: PlanTier;
  canCreateRole: boolean;
  /** null = uncapped. Never a fake big number. */
  screeningsLeft: number | null;
  /** Whether the next AI screen may be generated and charged. */
  canScreen: boolean;
  /** In product words, never empty — the sentence the UI shows when a gate bites. */
  reason: string;
};

export function productEntitlementFor(state: ProductQuotaState): ProductEntitlement {
  const tier = PLAN_TIERS[state.plan] ?? PLAN_TIERS.free;
  const rolesOpen = whole(state.rolesOpen);
  const screeningsUsed = whole(state.screeningsUsed);

  const canCreateRole = tier.activeRolesMax === null || rolesOpen < tier.activeRolesMax;
  const screeningsLeft =
    tier.screeningQuotaMonthly === null ? null : Math.max(0, tier.screeningQuotaMonthly - screeningsUsed);
  const canScreen = screeningsLeft === null || screeningsLeft > 0;

  let reason: string;
  if (canCreateRole && canScreen) {
    reason =
      screeningsLeft === null
        ? `${tier.displayName} — open roles and screens are uncapped.`
        : `${tier.displayName} — ${screeningsLeft} of ${tier.screeningQuotaMonthly} screens left this month.`;
  } else if (!canScreen) {
    reason = `This month's ${tier.screeningQuotaMonthly} screens are used up. New screens start again on the 1st, or move to a plan that does not cap them — everything already screened keeps its verdicts.`;
  } else {
    reason = `${tier.displayName} allows ${tier.activeRolesMax} open role${tier.activeRolesMax === 1 ? "" : "s"} at a time. Close one or move to a plan that does not cap them.`;
  }

  return { tier, canCreateRole, screeningsLeft, canScreen, reason };
}

/**
 * Thrown by a gated wire when the plan, not the product, is the limit.
 *
 * The message is the product sentence above — a recruiter who hits a gate must
 * be able to read why and what would lift it, in the same breath.
 */
export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

/**
 * One charged screen, as a string.
 *
 * The key names the application and the billing period, not the request: a
 * retried job, a double-clicked button and a re-generated screen inside the
 * same month are all the same use, and a genuinely new screening round next
 * month is a new key. Recomputable from the inputs, like every other meter
 * key in this repo — a charge that cannot be recomputed cannot be explained.
 */
export function idempotencyKeyForScreening(args: {
  orgId: string;
  applicationId: string;
  periodStartIso: string;
}): string {
  return [args.orgId, args.applicationId, args.periodStartIso].join(":");
}
