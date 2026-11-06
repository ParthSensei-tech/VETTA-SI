-- Observability: errors, latency, per-task model cost, queue age, failed jobs, access logs and alerting

create table if not exists access_logs (
  id text primary key,
  user_id text,
  method text not null,
  path text not null,
  status_code integer not null,
  duration_ms integer not null,
  ip text not null default '',
  user_agent text not null default '',
  error_message text not null default '',
  meta_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists access_logs_created_idx on access_logs (created_at desc);
create index if not exists access_logs_status_idx on access_logs (status_code, created_at desc);
create index if not exists access_logs_path_idx on access_logs (path, created_at desc);

create table if not exists model_cost_logs (
  id text primary key,
  user_id text,
  task_type text not null, -- 'rank', 'screen_generate', 'follow_up', 'evaluate', 'client_card', 'test'
  provider text not null,  -- 'groq', 'gemini', 'openai', 'ollama', 'xai', 'local'
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_cents numeric(10, 4) not null default 0.0000,
  duration_ms integer not null default 0,
  success boolean not null default true,
  error text not null default '',
  application_id text,
  role_id text,
  meta_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists model_cost_logs_created_idx on model_cost_logs (created_at desc);
create index if not exists model_cost_logs_task_idx on model_cost_logs (task_type, created_at desc);
create index if not exists model_cost_logs_provider_idx on model_cost_logs (provider, created_at desc);

create table if not exists queue_metrics (
  id text primary key,
  job_id text not null,
  batch_id text not null,
  user_id text not null,
  queue_age_ms integer not null,
  duration_ms integer not null,
  status text not null, -- 'completed', 'failed', 'requeued'
  attempts integer not null default 1,
  error text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists queue_metrics_created_idx on queue_metrics (created_at desc);
create index if not exists queue_metrics_status_idx on queue_metrics (status, created_at desc);
create index if not exists queue_metrics_batch_idx on queue_metrics (batch_id, status);

create table if not exists system_alerts (
  id text primary key,
  rule_id text not null, -- 'error_rate_high', 'queue_lag_high', 'failed_jobs_spike', 'latency_p95_high', 'cost_spike'
  severity text not null default 'warning', -- 'info', 'warning', 'critical'
  title text not null,
  message text not null,
  current_value numeric(10, 2) not null default 0,
  threshold_value numeric(10, 2) not null default 0,
  status text not null default 'firing', -- 'firing', 'acknowledged', 'resolved'
  details_json text not null default '{}',
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists system_alerts_status_idx on system_alerts (status, created_at desc);
create index if not exists system_alerts_rule_idx on system_alerts (rule_id, status);

create table if not exists alert_rules (
  id text primary key,
  rule_name text not null,
  description text not null default '',
  enabled boolean not null default true,
  threshold numeric(10, 2) not null,
  window_minutes integer not null default 15,
  severity text not null default 'warning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
