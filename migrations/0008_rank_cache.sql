-- Durable rank/parse cache keyed by content hashes (no hardcoded demo data).

create table if not exists rank_cache (
  id text primary key,
  user_id text not null,
  resume_hash text not null,
  role_hash text not null,
  mode text not null default 'fast',
  engine text not null default 'local',
  profile_json text not null default '{}',
  rank_json text not null default '{}',
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rank_cache_key_idx
  on rank_cache (user_id, resume_hash, role_hash, mode);

create index if not exists rank_cache_user_updated_idx
  on rank_cache (user_id, updated_at desc);

-- Optional content hashes on applications for cache invalidation / telemetry.
alter table applications
  add column if not exists resume_hash text not null default '';
alter table applications
  add column if not exists role_hash text not null default '';
alter table applications
  add column if not exists rank_engine text not null default '';
