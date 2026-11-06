-- Migration 0017: Rank provenance, rubric hashing, and stale score invalidation

-- Track rubric hash in rubric_versions
alter table rubric_versions add column if not exists rubric_hash text not null default '';

-- Add provenance and rubric version tracking to rank_cache
alter table rank_cache add column if not exists model text not null default '';
alter table rank_cache add column if not exists provider text not null default '';
alter table rank_cache add column if not exists rubric_version_id text;
alter table rank_cache add column if not exists rubric_version integer;
alter table rank_cache add column if not exists rubric_hash text not null default '';

-- Add provenance and stale flags to applications
alter table applications add column if not exists model text not null default '';
alter table applications add column if not exists provider text not null default '';
alter table applications add column if not exists rubric_version integer;
alter table applications add column if not exists rubric_hash text not null default '';
alter table applications add column if not exists is_stale boolean not null default false;
alter table applications add column if not exists stale_reason text not null default '';

create index if not exists applications_stale_idx on applications (role_id, is_stale);
create index if not exists rank_cache_rubric_idx on rank_cache (rubric_version_id, rubric_hash);
