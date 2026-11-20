-- Migration 0036: the product plan and its screening meter.
--
-- The verification meter (0030) prices candidate reports; this table prices the
-- workspace itself — how many roles may be open at once and how many AI screens
-- may be generated in a month. The commercial shape mirrors 0030 deliberately:
--
--  1. **An absent row is the free plan.** No seed, no default flip. A workspace
--     that never saw a pricing page is on the free tier with its allowance
--     intact, not on an exhausted trial.
--  2. **A screening use is charged per application, per billing month.** The
--     idempotency key names the application and the period, so a retry of a
--     screen already generated this month is the same use — the same doctrine
--     0030 states for reports: retried work is not new work.
--  3. **Unlimited is -1, not a magic large number.** A negative quota in this
--     table means the tier does not cap, and `domain/plans.ts` is the only file
--     that decides what -1 means. A UI that counted its way around a cap is the
--     failure mode this split exists to prevent.
--
-- Nothing here takes money. `plan` records which tier the workspace is on —
-- written by the checkout webhook when it exists, and by the manual upgrade path
-- until then — and the columns below it are the tier's terms, denormalised at
-- write time so an auditor can read what was sold without importing the code.

create table if not exists org_plans (
  org_id text primary key references organizations (id) on delete cascade,
  user_id text not null default '',
  -- 'free' | 'starter' | 'growth' | 'portfolio'.
  plan text not null default 'free',
  seats integer not null default 1,
  active_roles_max integer not null default 1,
  screening_quota_monthly integer not null default 30,
  -- Start of the current billing month; the meter counts uses at or after it.
  period_start timestamptz not null default date_trunc('month', now()),
  -- 'active' | 'past_due' | 'cancelled'. Nothing flips it automatically yet.
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One charged AI screen. Append-only like verification_uses: a meter that can be
-- edited is a meter nobody can audit.
create table if not exists screening_uses (
  id text primary key,
  org_id text not null,
  user_id text not null default '',
  role_id text not null default '',
  application_id text not null,
  -- `${org}:${application}:${periodStart}` — see rule 2 above.
  idempotency_key text not null,
  -- 'free' (inside the monthly allowance) | 'paid' (the plan is unlimited or bought).
  kind text not null,
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);
create index if not exists screening_uses_org_period_idx on screening_uses (org_id, created_at desc);
