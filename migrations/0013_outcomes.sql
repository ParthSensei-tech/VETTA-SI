-- Outcome model: interview, offer, join, 90-day stay.
-- Weights and events are written at runtime. No base rates in this file.

create table if not exists outcome_events (
  id text primary key,
  org_id text not null,
  user_id text not null,
  application_id text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists outcome_events_app_idx on outcome_events (application_id, created_at desc);
create index if not exists outcome_events_org_idx on outcome_events (org_id, kind);

create table if not exists outcome_models (
  id text primary key,
  head text not null,
  org_id text not null,
  samples integer not null default 0,
  positives integer not null default 0,
  brier_ema double precision not null default 0.25,
  weights_json text not null,
  updated_at timestamptz not null default now(),
  unique (head, org_id)
);
