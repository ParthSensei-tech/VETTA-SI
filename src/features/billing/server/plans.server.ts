/**
 * The product plan and its screening meter, as written.
 *
 * Mirrors `verification/server/quota.server.ts` deliberately, because the same
 * three rules apply at this meter too: the entitlement and the insert are one
 * statement, an absent plan row is the free tier with its allowance, and a row
 * is written only for work the product actually did. The billing period is the
 * calendar month the plan row carries — `period_start` is a column so an
 * agreement that bills on the 7th is a row, not a code change.
 *
 * One thing this file adds that the verification meter does not have: it is the
 * only sanctioned bridge between the product plan and the verification plan.
 * `setProductPlan` writes both, in one call, so the two ledgers cannot disagree
 * about whether this workspace bought the paid ladder. Nothing else in the
 * product flips `org_verification_plans` except the existing settings wire.
 */
import { getSql } from "../../../platform/db.ts";
import {
  PLAN_TIERS,
  defaultProductQuotaState,
  idempotencyKeyForScreening,
  planBuysVerificationLadder,
  productEntitlementFor,
  type ProductEntitlement,
  type ProductPlan,
  type ProductQuotaState,
} from "../domain/plans.ts";

function newId(): string {
  return crypto.randomUUID();
}

const PLANS = new Set<string>(Object.keys(PLAN_TIERS));

function asPlan(value: unknown): ProductPlan {
  return typeof value === "string" && PLANS.has(value) ? (value as ProductPlan) : "free";
}

type PlanRow = {
  plan: string;
  seats: number | string;
  active_roles_max: number | string;
  screening_quota_monthly: number | string;
  period_start: Date | string;
};

async function planRowForOrg(orgId: string): Promise<PlanRow | null> {
  if (!orgId) return null;
  const sql = await getSql();
  const [row] = await sql<PlanRow>`
    select plan, seats, active_roles_max, screening_quota_monthly, period_start
    from org_plans where org_id = ${orgId} limit 1`;
  return row ?? null;
}

function periodStartIso(row: PlanRow | null): string {
  if (!row) return startOfThisMonthIso();
  const raw = row.period_start instanceof Date ? row.period_start : new Date(String(row.period_start));
  return Number.isFinite(raw.getTime()) ? raw.toISOString() : startOfThisMonthIso();
}

function startOfThisMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();
}

/**
 * What the meter says, with the absent row read as the free plan.
 *
 * `rolesOpen` and `screeningsUsed` are counted, never trusted from a caller —
 * the same reason the verification summary counts charges instead of reading a
 * column somebody could edit.
 */
export async function productQuotaStateForOrg(orgId: string): Promise<ProductQuotaState> {
  if (!orgId) return defaultProductQuotaState();
  const sql = await getSql();
  const row = await planRowForOrg(orgId);
  const [open] = await sql<{ n: number | string }>`
    select count(*)::int as n from roles where org_id = ${orgId} and status = 'open'`;
  const [used] = await sql<{ n: number | string }>`
    select count(*)::int as n from screening_uses
    where org_id = ${orgId} and created_at >= ${periodStartIso(row)}::timestamptz`;
  return {
    plan: asPlan(row?.plan),
    rolesOpen: Number(open?.n ?? 0),
    screeningsUsed: Number(used?.n ?? 0),
  };
}

export async function entitlementForProductOrg(
  orgId: string,
): Promise<{ state: ProductQuotaState; entitlement: ProductEntitlement }> {
  const state = await productQuotaStateForOrg(orgId);
  return { state, entitlement: productEntitlementFor(state) };
}

export type ScreeningChargeResult = {
  charged: boolean;
  kind: "free" | "paid" | "none";
  useId: string;
  reason: string;
};

/**
 * Record that this screen cost this workspace a use.
 *
 * The quota and the insert are one statement (the `where` is the allowance),
 * and the unlimited tiers are the `-1` in the table, tested in SQL and nowhere
 * else — so a cap that exists in the domain but not in the charge path cannot
 * survive a slate.
 */
export async function chargeScreeningUse(opts: {
  orgId: string;
  userId: string;
  roleId: string;
  applicationId: string;
}): Promise<ScreeningChargeResult> {
  const nothing = "No workspace to charge: this screen belongs to no tenant.";
  if (!opts.orgId || !opts.applicationId) {
    return { charged: false, kind: "none", useId: "", reason: nothing };
  }
  const sql = await getSql();
  const row = await planRowForOrg(opts.orgId);
  const periodStart = periodStartIso(row);
  const key = idempotencyKeyForScreening({
    orgId: opts.orgId,
    applicationId: opts.applicationId,
    periodStartIso: periodStart,
  });
  const id = newId();
  const inserted = await sql<{ id: string; kind: string }>`
    with setting as (
      select coalesce(max(plan), 'free') as plan,
             coalesce(max(screening_quota_monthly), ${PLAN_TIERS.free.screeningQuotaMonthly}) as quota
      from org_plans where org_id = ${opts.orgId}
    ),
    meter as (
      select count(*)::int as spent
      from screening_uses
      where org_id = ${opts.orgId} and created_at >= ${periodStart}::timestamptz
    )
    insert into screening_uses (
      id, org_id, user_id, role_id, application_id, idempotency_key, kind
    )
    select
      ${id}, ${opts.orgId}, ${opts.userId}, ${opts.roleId}, ${opts.applicationId}, ${key},
      case when setting.quota < 0 then 'paid'
           when setting.plan = 'free' then 'free'
           else 'paid' end
    from setting cross join meter
    where setting.quota < 0 or meter.spent < setting.quota
    on conflict (idempotency_key) do nothing
    returning id, kind`;

  const result = inserted[0];
  if (result) {
    return {
      charged: true,
      kind: result.kind === "paid" ? "paid" : "free",
      useId: result.id,
      reason: "",
    };
  }

  const existing = await sql<{ id: string }>`
    select id from screening_uses where idempotency_key = ${key} limit 1`;
  if (existing[0]) {
    return {
      charged: false,
      kind: "none",
      useId: existing[0].id,
      reason: "Already charged: this screen was recorded earlier this month.",
    };
  }
  const { entitlement } = await entitlementForProductOrg(opts.orgId);
  return { charged: false, kind: "none", useId: "", reason: entitlement.reason };
}

/**
 * Put a workspace on a plan — the only sanctioned writer of both ledgers.
 *
 * The tier's terms are denormalised into the row at write time (an auditor can
 * read what was sold without importing the code), and the verification plan is
 * bridged in the same call: a bought plan switches the paid arms on, going back
 * to free switches them off through the *existing* verification writer, never a
 * second one.
 */
export async function setProductPlan(opts: {
  orgId: string;
  userId: string;
  plan: ProductPlan;
}): Promise<ProductQuotaState> {
  const tier = PLAN_TIERS[opts.plan] ?? PLAN_TIERS.free;
  const sql = await getSql();
  await sql`
    insert into org_plans (
      org_id, user_id, plan, seats, active_roles_max, screening_quota_monthly,
      period_start, status, updated_at
    )
    values (
      ${opts.orgId}, ${opts.userId}, ${tier.plan}, ${tier.seats},
      ${tier.activeRolesMax ?? -1}, ${tier.screeningQuotaMonthly ?? -1},
      date_trunc('month', now()), 'active', now()
    )
    on conflict (org_id) do update set
      plan = excluded.plan,
      seats = excluded.seats,
      active_roles_max = excluded.active_roles_max,
      screening_quota_monthly = excluded.screening_quota_monthly,
      period_start = date_trunc('month', now()),
      status = 'active',
      user_id = excluded.user_id,
      updated_at = now()`;

  const { setVerificationPlan } = await import("../../verification/server/quota.server.ts");
  await setVerificationPlan({
    orgId: opts.orgId,
    userId: opts.userId,
    plan: planBuysVerificationLadder(tier.plan) ? "paid" : "free",
  });

  return productQuotaStateForOrg(opts.orgId);
}

export type ProductPlanSummary = {
  orgId: string;
  state: ProductQuotaState;
  entitlement: ProductEntitlement;
  periodStartIso: string;
};

/** What the workspace can be told: its plan, its caps, and what it has spent. */
export async function productPlanSummary(orgId: string): Promise<ProductPlanSummary> {
  const row = await planRowForOrg(orgId);
  const state = await productQuotaStateForOrg(orgId);
  return {
    orgId,
    state,
    entitlement: productEntitlementFor(state),
    periodStartIso: periodStartIso(row),
  };
}
