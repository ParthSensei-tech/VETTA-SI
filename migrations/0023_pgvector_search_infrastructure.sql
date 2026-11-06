-- Migration 0023: pgvector + PostgreSQL Dedicated Search Infrastructure

-- 1. Conditionally enable vector extension if supported in current Postgres engine
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector C-extension not available in current host environment, using standard vector storage and indexing: %', SQLERRM;
END $$;

-- 2. Add pgvector-compatible string formatting to candidate_embeddings
alter table candidate_embeddings add column if not exists embedding_str text;

-- 3. Dedicated Job / Requirement Embeddings Table
create table if not exists job_embeddings (
  role_id text not null references roles (id) on delete cascade,
  org_id text,
  model text not null,
  dim integer not null,
  vector_json text not null,
  embedding_str text not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (role_id, model)
);

create index if not exists job_embeddings_org_model_idx on job_embeddings (org_id, model);

-- 4. Search Infrastructure Metadata & Health
create table if not exists search_infrastructure_metadata (
  id text primary key,
  engine_type text not null default 'pgvector+hybrid',
  active_model text not null default 'Xenova/multilingual-e5-small',
  vector_dim integer not null default 384,
  distance_metric text not null default 'cosine',
  hnsw_m integer not null default 16,
  hnsw_ef_construction integer not null default 64,
  native_pgvector_enabled boolean not null default false,
  status text not null default 'healthy',
  updated_at timestamptz not null default now()
);

-- 5. Search Outcome Tracking & Feedback Loop (Shortlist -> Interview -> Hire)
create table if not exists search_outcome_feedback (
  id text primary key,
  org_id text not null,
  query text not null,
  role_id text references roles (id) on delete set null,
  candidate_id text not null references candidates (id) on delete cascade,
  retrieval_mode text not null,
  rrf_rank integer,
  cross_encoder_score double precision,
  outcome_stage text not null,
  feedback_notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists search_outcome_org_role_idx on search_outcome_feedback (org_id, role_id);
create index if not exists search_outcome_cand_stage_idx on search_outcome_feedback (candidate_id, outcome_stage);
