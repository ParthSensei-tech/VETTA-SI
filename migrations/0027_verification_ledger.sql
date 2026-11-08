-- Migration 0027: the claim-verification ledger.
--
-- What this database is FOR, in one line: for every checkable claim a candidate
-- made, say whether it is verified, contradicted, unverifiable or impossible —
-- and keep the evidence that said so. Nothing here is read by the ranker, the
-- hard gates or the strict filter; `scripts/check-verification.mjs` fails the
-- build if a rank-path file ever selects from one of these tables.
--
-- Three rules the shape of these tables carries, not just the prose:
--  1. `claim_evidence.definitive` is copied from the check registry at write time
--     and is the only thing that lets a row say `contradicted` / `impossible`.
--     A check that is not definitive is capped at `unverifiable` by a throw in
--     `insertEvidence()`, so an opinion can never reach the UI as a finding.
--  2. `verification_verdict_history` is append-only: no UPDATE and no DELETE
--     statement anywhere in the repo touches it, which is what makes a past
--     decision re-litigable after the fact.
--  3. `verification_reports` is unique on the claims-set hash, so a report is
--     also the cache — a re-run after a partial failure costs nothing, and a
--     re-grade of unchanged claims cannot silently produce a second verdict.

-- One generation of verification over one candidate's claim set.
create table if not exists verification_reports (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  user_id text not null,
  candidate_id text not null,
  application_id text,
  role_id text,
  -- Bumped whenever extraction or a check's logic changes; part of the cache key
  -- so an old verdict can never be served for new rules.
  engine_version text not null,
  -- Hash of the normalised claim set. Same claims + same engine => same report.
  claims_set_hash text not null,
  status text not null default 'queued', -- 'queued' | 'running' | 'completed' | 'failed'
  coverage_ratio numeric(5, 4) not null default 0, -- checked claims / checkable claims
  counts_json text not null default '{}',          -- {verified,contradicted,unverifiable,impossible,claims}
  cost_paise integer not null default 0,           -- measured COGS, from model_cost_logs pricing
  error text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, candidate_id, engine_version, claims_set_hash)
);
create index if not exists verification_reports_org_idx on verification_reports (org_id, created_at desc);
create index if not exists verification_reports_app_idx on verification_reports (application_id);

-- One claim, extracted from the document, with the exact bytes it came from.
-- `quote` is a verbatim substring of the text it was found in: an ungrounded
-- claim is dropped during extraction and never gets a row here, so a
-- hallucinated sentence cannot accuse anybody of anything.
create table if not exists candidate_claims (
  id text primary key,
  report_id text not null references verification_reports (id) on delete cascade,
  org_id text not null,
  claim_kind text not null, -- 'tenure' | 'employment_period' | 'education' | 'credential' | 'metric' | 'identity'
  statement text not null,  -- the claim, in our words
  quote text not null,      -- the document's words, verbatim
  detail_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists candidate_claims_report_idx on candidate_claims (report_id);
create index if not exists candidate_claims_org_idx on candidate_claims (org_id);
create unique index if not exists candidate_claims_report_quote_idx
  on candidate_claims (report_id, claim_kind, quote);

-- One check, run against one claim. `(claim_id, check_id)` is unique because a
-- check that ran twice must not produce two verdicts for the same question.
create table if not exists claim_evidence (
  id text primary key,
  claim_id text not null references candidate_claims (id) on delete cascade,
  report_id text not null references verification_reports (id) on delete cascade,
  org_id text not null,
  check_id text not null,
  tier integer not null default 0,
  status text not null, -- 'verified' | 'contradicted' | 'unverifiable' | 'impossible' | 'skipped' | 'errored'
  definitive boolean not null default false,
  cost_paise integer not null default 0,
  external_dependency text not null default '',
  detail_json text not null default '{}',
  note text not null default '', -- what would be needed to settle it — shown even when capped
  created_at timestamptz not null default now(),
  unique (claim_id, check_id)
);
create index if not exists claim_evidence_report_idx on claim_evidence (report_id, status);
create index if not exists claim_evidence_check_idx on claim_evidence (check_id, status);

-- Append-only. Every adjudication ever made, so a decision can be audited after
-- the rules that produced it have changed. Nothing updates or deletes these rows.
create table if not exists verification_verdict_history (
  id text primary key,
  org_id text not null,
  report_id text not null,
  candidate_id text not null,
  claim_id text not null,
  check_id text not null,
  status text not null,
  definitive boolean not null default false,
  engine_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists verification_verdict_history_claim_idx
  on verification_verdict_history (claim_id, created_at desc);
create index if not exists verification_verdict_history_org_idx
  on verification_verdict_history (org_id, created_at desc);

-- Mirrors `ingest_jobs` on purpose: same claim/retry/`run_after` shape, so the
-- paid and slow arms queue instead of blocking a 200-resume slate.
create table if not exists verification_jobs (
  id text primary key,
  org_id text,
  user_id text not null,
  application_id text not null,
  candidate_id text,
  role_id text,
  report_id text,
  status text not null default 'queued', -- 'queued' | 'running' | 'completed' | 'failed' | 'skipped'
  -- 'tier_a' runs inline for free; 'paid' is only ever claimed by the worker.
  plan_tier text not null default 'tier_a',
  error text not null default '',
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verification_jobs_queue_idx on verification_jobs (status, run_after, created_at);
create index if not exists verification_jobs_org_idx on verification_jobs (org_id, status);
create index if not exists verification_jobs_app_idx on verification_jobs (application_id);

-- Answer-once facts. Three employers across a 200-candidate slate is three DNS
-- lookups, not two hundred; `org_id = ''` is the global scope, the same
-- convention `rank_cache` uses for `user_id`.
create table if not exists verification_checks_cache (
  id text primary key,
  org_id text not null default '',
  cache_key text not null, -- e.g. 'dns:nimbus.example', 'registry:Nimbus Pvt Ltd'
  check_id text not null,
  outcome_json text not null default '{}',
  definitive boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, cache_key)
);
create index if not exists verification_checks_cache_expiry_idx on verification_checks_cache (expires_at);

-- Two columns on the existing table, and only two: the slate needs the headline
-- without a join. Neither is read by the ranker, and neither changes ordering.
alter table applications add column if not exists verification_status text not null default '';
alter table applications add column if not exists verification_summary_json text not null default '{}';
create index if not exists applications_verification_status_idx on applications (org_id, verification_status);
