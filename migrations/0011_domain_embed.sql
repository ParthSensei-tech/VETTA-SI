-- Universal domain embedding (neural encoder) + live India market snapshots.
-- Weights and metrics are written at runtime. No market numbers live in this file.

create table if not exists domain_embed_models (
  id text primary key,
  version integer not null default 1,
  steps integer not null default 0,
  docs integer not null default 0,
  recon_loss double precision not null default 1,
  rank_steps integer not null default 0,
  weights_json text not null,
  updated_at timestamptz not null default now()
);

create table if not exists domain_embed_seen (
  doc_hash text primary key,
  seen_at timestamptz not null default now()
);

create table if not exists domain_embed_adapters (
  org_id text primary key,
  steps integer not null default 0,
  bias_json text not null,
  updated_at timestamptz not null default now()
);

create table if not exists market_snapshots (
  id text primary key,
  fetched_at timestamptz not null default now(),
  sources_json text not null default '[]',
  metrics_json text not null default '[]',
  document_text text not null default '',
  embed_json text not null default '[]'
);

create index if not exists market_snapshots_fetched_idx on market_snapshots (fetched_at desc);
