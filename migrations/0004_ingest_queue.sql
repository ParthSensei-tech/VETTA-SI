-- Overnight / batch ingest queue. Rows are scoped to user_id (TEXT).

create table if not exists ingest_batches (
  id text primary key,
  user_id text not null,
  role_id text not null references roles (id) on delete cascade,
  source_name text not null default '',
  status text not null default 'queued',
  total_count integer not null default 0,
  parsed_count integer not null default 0,
  ranked_count integer not null default 0,
  failed_count integer not null default 0,
  error_summary text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ingest_batches_user_idx on ingest_batches (user_id, created_at desc);
create index if not exists ingest_batches_user_role_idx on ingest_batches (user_id, role_id);

create table if not exists ingest_jobs (
  id text primary key,
  user_id text not null,
  batch_id text not null references ingest_batches (id) on delete cascade,
  role_id text not null,
  filename text not null default '',
  resume_text text not null default '',
  status text not null default 'queued',
  application_id text,
  error text not null default '',
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ingest_jobs_queue_idx on ingest_jobs (status, run_after, created_at);
create index if not exists ingest_jobs_batch_idx on ingest_jobs (batch_id, status);
create index if not exists ingest_jobs_user_idx on ingest_jobs (user_id, status);
