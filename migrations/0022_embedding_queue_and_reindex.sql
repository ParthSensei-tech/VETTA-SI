-- Migration 0022: Ingestion-time embedding queue, multi-model support, and reindexing configs

-- 1. Alter candidate_embeddings to support multi-model co-existence and org scoping
alter table candidate_embeddings add column if not exists org_id text;

alter table candidate_embeddings drop constraint if exists candidate_embeddings_pkey;
alter table candidate_embeddings add primary key (candidate_id, model);

create index if not exists candidate_embeddings_org_model_idx on candidate_embeddings (org_id, model);
create index if not exists candidate_embeddings_model_cand_idx on candidate_embeddings (model, candidate_id);

-- Backfill org_id from candidates
update candidate_embeddings e
set org_id = c.org_id
from candidates c
where e.candidate_id = c.id and e.org_id is null;

-- 2. Embedding Jobs table for ingestion-time and backfill queueing
create table if not exists embedding_jobs (
  id text primary key,
  org_id text,
  candidate_id text not null references candidates (id) on delete cascade,
  model text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  error text not null default '',
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint embedding_jobs_candidate_model_uniq unique (candidate_id, model)
);

create index if not exists embedding_jobs_status_prio_idx on embedding_jobs (status, priority desc, created_at asc);
create index if not exists embedding_jobs_org_status_idx on embedding_jobs (org_id, status);

-- 3. Embedding Index Configs table (tracks active model, target model, reindexing status per org)
create table if not exists embedding_index_configs (
  org_id text primary key,
  active_model text not null,
  target_model text,
  reindex_status text not null default 'idle',
  reindex_started_at timestamptz,
  reindex_completed_at timestamptz,
  auto_switch boolean not null default true,
  updated_at timestamptz not null default now()
);
