-- Migration 0030: the verification plan and its meter.
--
-- The forensic arms are the feature, and until now the only way to reach them was
-- a caller passing a plan string nobody in the product can set. This table is the
-- part that decides: a workspace gets four candidate reports with the byte arms
-- switched on, and after that the arms wait for a plan.
--
-- Three things the shape carries, not just the prose:
--
--  1. **An absent row is the free plan.** There is no seed and no default flip:
--     a workspace that never saw this feature cannot be sitting on a paid
--     entitlement, and it cannot be sitting on an exhausted trial either. The
--     allowance is therefore read as "4 left", not "0 left", which is the
--     difference between a meter and a trap.
--  2. **A use is charged for a report, not for a claim or a slate.** Per-slate
--     would mean one 200-resume drop burns the whole trial and yields one
--     summary row; per-claim would make the price of a resume depend on how
--     wordy its author was. Per-candidate-report is the unit the work actually
--     happens in, so the meter tracks COGS one-for-one.
--  3. **`idempotency_key` is unique, and it is the retry defence.** The queue
--     re-claims a job it did not finish, a tick can be asked twice, and a
--     recruiter can press the same button twice; without the key each of those
--     is a charged use for work that was already paid for. The key names the
--     engine and the report row, and the report row is already unique on the
--     claim set and the files behind it — so the same document re-read is free,
--     and a genuinely different report is a new use.
--
-- Nothing here can change a verdict. `plan` selects which checks the ladder is
-- allowed to *attempt*; `adjudicate()` never sees it, and the cap on accusing is
-- still the registry's `definitiveWhenMismatch`, enforced in `insertEvidence()`.
-- A workspace that pays buys more checks, not harsher ones.

-- One workspace's decision about the paid ladder. Absent row = free, four uses.
create table if not exists org_verification_plans (
  org_id text primary key references organizations (id) on delete cascade,
  user_id text not null default '',
  -- 'free' | 'paid'. Nothing in this repo takes money: this is the flag a
  -- workspace sets when its plan exists outside the product, and the only
  -- writer is the settings wire.
  plan text not null default 'free',
  -- The trial allowance, in candidate reports. A column rather than a constant
  -- so the number the product decided is readable by an auditor, and so an
  -- agreement that opens with ten uses is a row, not a code change.
  free_quota integer not null default 4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One charged report. There is no UPDATE or DELETE path to this table anywhere,
-- and `scripts/check-verification.mjs` fails the build if one appears: a meter
-- that can be edited is a meter nobody can audit, and "we corrected the billing
-- row" is how a disputed charge becomes an undisputed one.
create table if not exists verification_uses (
  id text primary key,
  org_id text not null,
  user_id text not null default '',
  candidate_id text not null,
  report_id text not null default '',
  -- `${org}:${candidate}:${engine}:${report}` — see rule 3 above.
  idempotency_key text not null,
  -- 'free' (inside the allowance) | 'paid' (the workspace's plan).
  kind text not null,
  -- What the report actually cost to produce, measured from the run's own
  -- evidence rows. Zero is the honest answer for the byte arms, which cost CPU
  -- and no rupees; it is not a placeholder for a price nobody looked up.
  cost_paise integer not null default 0,
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);
create index if not exists verification_uses_org_idx on verification_uses (org_id, created_at desc);
create index if not exists verification_uses_candidate_idx on verification_uses (candidate_id);
