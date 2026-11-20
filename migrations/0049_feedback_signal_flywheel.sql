-- Migration 0049: Feedback Signal Flywheel (Competitive Moat — Data Engine)
-- Every approve / reject on the triage card trains the taste engine.
-- A competitor copying our UI starts with zero of this data. We compound daily.

-- 1. Per-decision feedback signals (the atomic unit of taste learning)
create table if not exists feedback_signals (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  candidate_id text not null,
  role_id text not null,
  session_id text not null default '',               -- triage session / batch id for grouping
  action text not null,                              -- 'pass' | 'unlock' | 'shortlist' | 'reject_post_unlock'
  reason_code text not null default 'unspecified',   -- 'notice_too_long' | 'ctc_gap' | 'comm_quality' | 'tech_weak' | 'culture_fit' | 'strong_hire' | 'other'
  reason_note text not null default '',              -- free-text note (optional, founder types it)
  match_score_at_decision integer not null default 0,-- snapshot of AI match score when decision was made (0-100)
  decision_latency_ms integer not null default 0,    -- how long founder took to decide (certainty signal)
  audio_played boolean not null default false,       -- did they listen before deciding?
  hinglish_flags text not null default '[]',         -- JSON: which Hinglish signals were on the card
  outcome_joined boolean,                            -- null until known; true if candidate eventually joined
  outcome_checked_at timestamptz,                    -- when we checked the join outcome (30/60-day follow-up)
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_signals_org on feedback_signals(org_id, created_at desc);
create index if not exists idx_feedback_signals_candidate on feedback_signals(candidate_id);
create index if not exists idx_feedback_signals_role on feedback_signals(role_id);
create index if not exists idx_feedback_signals_action on feedback_signals(action, created_at desc);

-- 2. Taste engine calibration snapshots (computed weekly from feedback_signals)
-- Stores the aggregated preference vector per org after each retraining run.
create table if not exists taste_calibration_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  snapshot_at timestamptz not null default now(),
  signals_used integer not null default 0,           -- how many feedback_signals were used in this run
  positive_weight_json text not null default '{}',   -- JSON: { "top5_github": 0.82, "product_pace": 0.74, ... }
  negative_weight_json text not null default '{}',   -- JSON: { "it_service_firm": -0.91, "academic_only": -0.68, ... }
  predicted_accuracy real not null default 0,        -- cross-validation accuracy of this snapshot (0-1)
  culture_pace_bias text not null default 'high_velocity',
  created_at timestamptz not null default now()
);

create index if not exists idx_taste_snapshots_org on taste_calibration_snapshots(org_id, snapshot_at desc);

-- 3. Talent recycling consent (candidates rejected at one Vetta company surface to others — with consent)
-- This is the network effect moat: a trust graph incumbents cannot replicate.
create table if not exists talent_recycling_consents (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null unique,
  consented boolean not null default false,
  consented_at timestamptz,
  consent_channel text not null default 'whatsapp', -- 'whatsapp' | 'email' | 'portal'
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  recycled_to_orgs text not null default '[]',       -- JSON array of org_ids candidate was surfaced to
  created_at timestamptz not null default now()
);

create index if not exists idx_talent_recycling_candidate on talent_recycling_consents(candidate_id);
