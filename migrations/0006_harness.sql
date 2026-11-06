-- Rank traces, human labels, and eval runs. All rows scoped to user_id.

alter table applications
  add column if not exists rank_engine text not null default 'local';
alter table applications
  add column if not exists rank_latency_ms integer;
alter table applications
  add column if not exists rank_fallback boolean not null default true;
alter table applications
  add column if not exists rank_at timestamptz;

create table if not exists rank_feedback (
  id text primary key,
  user_id text not null,
  application_id text not null references applications (id) on delete cascade,
  human_label text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists rank_feedback_user_idx on rank_feedback (user_id, created_at desc);
create unique index if not exists rank_feedback_app_idx on rank_feedback (user_id, application_id);

create table if not exists eval_runs (
  id text primary key,
  user_id text not null,
  engine text not null default 'local',
  labeled_count integer not null default 0,
  agree_count integer not null default 0,
  false_shortlist integer not null default 0,
  false_reject integer not null default 0,
  p50_latency_ms integer,
  p95_latency_ms integer,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists eval_runs_user_idx on eval_runs (user_id, created_at desc);
