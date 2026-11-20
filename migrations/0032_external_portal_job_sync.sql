-- Migration 0032: Official Company Career Portal Direct Ingestion & Job Sync
--
-- Enables recruiters with premium plans to toggle and configure direct resume
-- ingestion from their official company career portal / job pages for specific roles.
--
-- Guarantees:
--  1. Isolated, read-only sync: Vetta never writes to or alters their website.
--  2. Explicit authorization: Records recruiter user ID and timestamp when enabled.
--  3. Audit log: Every fetch/ingest event records resumes parsed and shortlisted.

create table if not exists role_external_portal_configs (
  id text primary key,
  role_id text not null references roles(id) on delete cascade,
  org_id text not null references organizations(id) on delete cascade,
  is_enabled boolean not null default false,
  portal_job_url text not null default '',
  sync_mode text not null default 'webhook_push', -- 'webhook_push' | 'feed_pull' | 'manual_pull'
  feed_api_url text not null default '',
  feed_auth_token text not null default '',
  webhook_token text not null unique,
  auto_shortlist boolean not null default true,
  authorized_by_user_id text,
  authorized_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text not null default 'idle', -- 'idle' | 'syncing' | 'success' | 'failed'
  last_sync_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists role_external_portal_configs_role_idx on role_external_portal_configs(role_id);
create index if not exists role_external_portal_configs_org_idx on role_external_portal_configs(org_id);
create index if not exists role_external_portal_configs_token_idx on role_external_portal_configs(webhook_token);

create table if not exists portal_sync_logs (
  id text primary key,
  role_id text not null references roles(id) on delete cascade,
  org_id text not null references organizations(id) on delete cascade,
  sync_type text not null, -- 'webhook' | 'feed_pull' | 'manual'
  resumes_fetched integer not null default 0,
  resumes_parsed integer not null default 0,
  candidates_shortlisted integer not null default 0,
  status text not null, -- 'success' | 'partial' | 'failed'
  details_json text not null default '{}',
  error_message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists portal_sync_logs_role_idx on portal_sync_logs(role_id, created_at desc);
create index if not exists portal_sync_logs_org_idx on portal_sync_logs(org_id, created_at desc);
