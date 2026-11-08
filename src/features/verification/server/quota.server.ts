/**
 * The plan and the meter, as written.
 *
 * `domain/quota.ts` decides what entitlement *means*; this file is the only place
 * that can read it from the database or write a charge, and the two decisions are
 * deliberately in different statements. The queue asks the meter twice: once when
 * it hands an application over (which ladder will this job ask for) and once
 * immediately before it spends (which ladder does this workspace still have).
 * The second answer is the one that runs, because the gap between them is a
 * 200-resume drop, and a trial that is checked only at the door is a trial that
 * a slate walks straight through.
 *
 * Three rules this file holds:
 *
 *  1. **The charge and the entitlement are one statement.** `chargeVerificationUse`
 *     counts the meter and inserts the row in the same query, so two jobs finishing
 *     together cannot both read "three used, one left" and both take the last one.
 *     It is not a lock — the residual window is real, and the worst it can do is
 *     give a workspace one more free report than it was sold, never one less.
 *  2. **An absent plan row is a workspace with an allowance.** `defaultQuotaState`
 *     is the only reading of "no row", so nothing that was never configured is
 *     also nothing that is free to use.
 *  3. **A row is written only for work the arms actually did.** A free-tier run
 *     charges nothing, a run that fell back because the trial ended charges
 *     nothing, and a retried run charges once — the unique key, not a convention.
 *
 * Nothing here can make a verdict friendlier or harsher: it chooses which checks
 * may be *attempted*, and `adjudicate()` cannot see it.
 */
import { getSql } from "../../../platform/db.ts";
import {
  FREE_USE_ALLOWANCE,
  defaultQuotaState,
  entitlementFor,
  idempotencyKeyFor,
  type Entitlement,
  type QuotaState,
  type VerificationPlan,
} from "../domain/quota.ts";

function newId(): string {
  return crypto.randomUUID();
}

export type QuotaSummary = {
  orgId: string;
  plan: VerificationPlan;
  freeQuota: number;
  usesSpent: number;
  usesLeft: number;
  entitled: boolean;
  charge: Entitlement["charge"];
  reason: string;
  /** Rupees the charged reports actually cost to produce, measured not quoted. */
  measuredCostPaise: number;
  /** `measuredCostPaise` per charged report, the figure the pricing page should use. */
  measuredCostPerUsePaise: number;
  lastUsedAtMs: number | null;
};

/**
 * What the meter says, with the absent row read as the free plan.
 *
 * The count is of `free` charges only, which is what makes the allowance mean
 * the same thing in the arithmetic and in the agreement: a paid workspace that
 * never needed its trial did not spend it, and a downgrade to the free plan
 * afterwards still has the four reports the product promised.
 *
 * Two reads, not one atomic snapshot: the plan is a decision a human made and the
 * count is a fact about work already done, and a charge taken between them is
 * settled by `chargeVerificationUse`, which re-derives both in its own statement.
 */
export async function quotaStateForOrg(orgId: string): Promise<QuotaState> {
  if (!orgId) return defaultQuotaState();
  const sql = await getSql();
  const [plan] = await sql<{ plan: string; free_quota: number | string }>`
    select plan, free_quota from org_verification_plans where org_id = ${orgId} limit 1`;
  const [spent] = await sql<{ n: number | string }>`
    select count(*)::int as n from verification_uses where org_id = ${orgId} and kind = 'free'`;
  if (!plan) {
    return { plan: "free", freeQuota: FREE_USE_ALLOWANCE, usesSpent: Number(spent?.n ?? 0) };
  }
  return {
    // Anything the table holds that is not the paid plan is the free plan: the
    // column is text, and a value nobody wrote must not become an entitlement.
    plan: plan.plan === "paid" ? "paid" : "free",
    freeQuota: Number(plan.free_quota),
    usesSpent: Number(spent?.n ?? 0),
  };
}

export async function entitlementForOrg(
  orgId: string,
): Promise<{ state: QuotaState; entitlement: Entitlement }> {
  const state = await quotaStateForOrg(orgId);
  return { state, entitlement: entitlementFor(state) };
}

/**
 * The settings wire: the plan a workspace has, and the allowance it was granted.
 *
 * `plan` is the only field, because nothing in this repo takes money — the flag
 * records that an agreement exists outside the product, and the meter is derived
 * from the charges, never edited. A caller that could set `usesSpent` could set
 * the trial to endless, so there is no path to it here.
 */
export async function setVerificationPlan(opts: {
  orgId: string;
  userId: string;
  plan: VerificationPlan;
  freeQuota?: number | null;
}): Promise<QuotaState> {
  const sql = await getSql();
  const state = await quotaStateForOrg(opts.orgId);
  const freeQuota =
    opts.freeQuota === undefined || opts.freeQuota === null
      ? state.freeQuota
      : Math.max(0, Math.floor(opts.freeQuota));
  await sql`
    insert into org_verification_plans (org_id, user_id, plan, free_quota, updated_at)
    values (${opts.orgId}, ${opts.userId}, ${opts.plan}, ${freeQuota}, now())
    on conflict (org_id) do update set
      plan = excluded.plan,
      free_quota = excluded.free_quota,
      user_id = excluded.user_id,
      updated_at = now()`;
  return { plan: opts.plan, freeQuota, usesSpent: state.usesSpent };
}

export type ChargeResult = {
  charged: boolean;
  kind: VerificationPlan | "none";
  useId: string;
  /** Why nothing was recorded, in the same words the drawer would use. */
  reason: string;
};

/**
 * Record that this report cost this workspace a use.
 *
 * The entitlement and the insert are the same statement on purpose (rule 1 in
 * this file's header): the `where` is the trial, and a row that does not satisfy
 * it is a report the paid ladder should not have run. Returning `kind` from the
 * insert rather than computing it first means what the caller is told is what the
 * table says.
 */
export async function chargeVerificationUse(opts: {
  orgId: string;
  userId: string;
  candidateId: string;
  reportId: string;
  engineVersion: string;
  costPaise?: number;
}): Promise<ChargeResult> {
  const reason = "No workspace to charge: this report belongs to no tenant.";
  if (!opts.orgId || !opts.candidateId || !opts.reportId) {
    return { charged: false, kind: "none", useId: "", reason };
  }
  const sql = await getSql();
  const key = idempotencyKeyFor(opts);
  const id = newId();
  const inserted = await sql<{ id: string; kind: string }>`
    with setting as (
      select coalesce(max(plan), 'free') as plan,
             coalesce(max(free_quota), ${FREE_USE_ALLOWANCE}) as free_quota
      from org_verification_plans where org_id = ${opts.orgId}
    ),
    meter as (
      select count(*)::int as spent
      from verification_uses where org_id = ${opts.orgId} and kind = 'free'
    )
    insert into verification_uses (
      id, org_id, user_id, candidate_id, report_id, idempotency_key, kind, cost_paise
    )
    select
      ${id}, ${opts.orgId}, ${opts.userId}, ${opts.candidateId}, ${opts.reportId}, ${key},
      case when setting.plan = 'paid' then 'paid' else 'free' end,
      ${opts.costPaise ?? 0}
    from setting cross join meter
    where setting.plan = 'paid' or meter.spent < setting.free_quota
    on conflict (idempotency_key) do nothing
    returning id, kind`;

  const row = inserted[0];
  if (row) {
    return {
      charged: true,
      kind: row.kind === "paid" ? "paid" : "free",
      useId: row.id,
      reason: "",
    };
  }

  // Either the key already existed — the honest retry, which cost nothing — or
  // the trial ran out between the two reads, which is the case the queue has to
  // be able to say out loud in the report it produces anyway.
  const existing = await sql<{ id: string }>`
    select id from verification_uses where idempotency_key = ${key} limit 1`;
  if (existing[0]) {
    return {
      charged: false,
      kind: "none",
      useId: existing[0].id,
      reason: "Already charged: this report was recorded by an earlier attempt.",
    };
  }
  const { entitlement } = await entitlementForOrg(opts.orgId);
  return {
    charged: false,
    kind: "none",
    useId: "",
    reason: entitlement.reason,
  };
}

/**
 * What the workspace can be told, and what its reports actually cost.
 *
 * `measuredCostPaise` is read out of the charges the runs wrote, not out of the
 * pricing document: the byte arms cost CPU and no rupees, so the honest figure
 * for most workspaces is zero, and a page that printed a quoted price instead
 * would be guessing at a number the database already knows.
 */
export async function verificationQuotaSummary(orgId: string): Promise<QuotaSummary> {
  const { state, entitlement } = await entitlementForOrg(orgId);
  const sql = await getSql();
  const [cost] = await sql<{
    charged: number | string;
    total: number | string;
    last_created_at: Date | string | null;
  }>`
    select count(*)::int as charged,
           coalesce(sum(cost_paise), 0) as total,
           max(created_at) as last_created_at
    from verification_uses where org_id = ${orgId}`;
  const charged = Number(cost?.charged ?? 0);
  const measuredCostPaise = Number(cost?.total ?? 0);
  const last =
    cost?.last_created_at instanceof Date
      ? cost.last_created_at.getTime()
      : Date.parse(String(cost?.last_created_at ?? ""));
  return {
    orgId,
    plan: state.plan,
    freeQuota: state.freeQuota,
    usesSpent: state.usesSpent,
    usesLeft: entitlement.usesLeft,
    entitled: entitlement.entitled,
    charge: entitlement.charge,
    reason: entitlement.reason,
    measuredCostPaise,
    measuredCostPerUsePaise: charged > 0 ? Math.round(measuredCostPaise / charged) : 0,
    lastUsedAtMs: Number.isFinite(last) ? last : null,
  };
}
