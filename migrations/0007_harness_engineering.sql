-- Harness engineering: prompt versions, frozen eval cases, traces, shadow, gate.

alter table rank_feedback
  add column if not exists predicted_level text not null default '';
alter table rank_feedback
  add column if not exists verdict text not null default 'agree';
alter table rank_feedback
  add column if not exists added_to_eval boolean not null default false;

alter table eval_runs
  add column if not exists prompt_version_id text;
alter table eval_runs
  add column if not exists prompt_hash text not null default '';
alter table eval_runs
  add column if not exists agreement_pct integer;
alter table eval_runs
  add column if not exists adjacent_pct integer;
alter table eval_runs
  add column if not exists false_shortlist_rate integer;
alter table eval_runs
  add column if not exists false_reject_rate integer;
alter table eval_runs
  add column if not exists gate_passed boolean;
alter table eval_runs
  add column if not exists gate_reason text not null default '';
alter table eval_runs
  add column if not exists compared_to_run_id text;
alter table eval_runs
  add column if not exists status text not null default 'completed';
alter table eval_runs
  add column if not exists kind text not null default 'production';

create table if not exists prompt_versions (
  id text primary key,
  user_id text not null,
  name text not null,
  body text not null,
  hash text not null,
  status text not null default 'candidate',
  created_at timestamptz not null default now()
);
create index if not exists prompt_versions_user_idx on prompt_versions (user_id, created_at desc);

create table if not exists harness_settings (
  user_id text primary key,
  shadow_enabled boolean not null default true,
  min_agreement_pct integer not null default 75,
  max_false_shortlist_pct integer not null default 15,
  production_prompt_id text,
  candidate_prompt_id text,
  updated_at timestamptz not null default now()
);

create table if not exists eval_cases (
  id text primary key,
  user_id text not null,
  slug text not null,
  title text not null,
  company_name text not null,
  company_stage text not null default 'seed',
  role_title text not null,
  location text not null default 'Bengaluru',
  work_mode text not null default 'hybrid',
  compensation_band text not null default '',
  stack_json text not null default '[]',
  must_haves_json text not null default '[]',
  nice_to_haves_json text not null default '[]',
  jd_text text not null,
  resume_text text not null,
  human_label text not null,
  expect_shortlist boolean not null default false,
  notes text not null default '',
  source text not null default 'gold',
  application_id text,
  frozen boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists eval_cases_user_slug_idx on eval_cases (user_id, slug);
create index if not exists eval_cases_user_idx on eval_cases (user_id, created_at desc);

create table if not exists eval_run_cases (
  id text primary key,
  user_id text not null,
  run_id text not null references eval_runs (id) on delete cascade,
  case_id text not null references eval_cases (id) on delete cascade,
  predicted_level text not null,
  predicted_score integer not null default 0,
  agree boolean not null default false,
  false_shortlist boolean not null default false,
  false_reject boolean not null default false,
  latency_ms integer,
  engine text not null default 'local',
  fallback boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists eval_run_cases_run_idx on eval_run_cases (run_id);

create table if not exists rank_traces (
  id text primary key,
  user_id text not null,
  application_id text,
  eval_case_id text,
  eval_run_id text,
  pair_id text,
  mode text not null default 'production',
  engine text not null default 'local',
  model text not null default 'evidence',
  prompt_hash text not null default '',
  prompt_version_id text,
  jd_hash text not null default '',
  resume_hash text not null default '',
  score integer,
  level text not null default '',
  fallback boolean not null default false,
  latency_ms integer,
  input_json text not null default '{}',
  output_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists rank_traces_user_idx on rank_traces (user_id, created_at desc);
create index if not exists rank_traces_app_idx on rank_traces (user_id, application_id);

create table if not exists shadow_comparisons (
  id text primary key,
  user_id text not null,
  application_id text,
  production_trace_id text,
  shadow_trace_id text,
  production_level text not null default '',
  shadow_level text not null default '',
  production_score integer,
  shadow_score integer,
  disagreed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists shadow_comparisons_user_idx on shadow_comparisons (user_id, created_at desc);
