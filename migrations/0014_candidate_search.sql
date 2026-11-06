-- Candidate retrieval: Postgres full-text first, embeddings stored beside the row.
-- No lexicon and no example resumes. Vectors are written when the model runs.

alter table candidates add column if not exists search_tsv tsvector;
alter table candidates add column if not exists notice_period_days integer;
alter table candidates add column if not exists expected_ctc_lakh double precision;

create index if not exists candidates_search_tsv_idx on candidates using gin (search_tsv);
create index if not exists candidates_user_location_idx on candidates (user_id, location);

create table if not exists candidate_embeddings (
  candidate_id text primary key references candidates (id) on delete cascade,
  model text not null,
  dim integer not null,
  vector_json text not null,
  updated_at timestamptz not null default now()
);
