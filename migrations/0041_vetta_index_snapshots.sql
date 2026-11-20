-- Migration 0041: Vetta Index snapshots.
--
-- The Index is the one number we ask the market to repeat, so it cannot be a
-- figure that drifts between a founder's tweet and the page they link to. Every
-- publish is a stored row: the window it covers, how many companies and roles
-- and applications produced it, the metrics themselves, and the date it was cut.
--
-- Withheld builds are stored too, with the reason. "We looked on the 8th and
-- there were only two companies in the window" is the honest public answer, and
-- a trail that records only the successes is the kind of record that makes a
-- published number untrustworthy.
--
-- metrics_json holds medians, quartiles and shares derived from the pipeline
-- audit trail — never a row about a person, and never the free text a recruiter
-- typed. A snapshot is derived data, so a DPDP erasure rebuilds it rather than
-- waiting for next week (see public-index.server.ts and privacy.server.ts).

create table if not exists vetta_index_snapshots (
  id text primary key,
  window_start timestamptz not null,
  window_end timestamptz not null,
  window_days integer not null,
  org_count integer not null,
  role_count integer not null,
  application_count integer not null,
  metrics_json text not null default '{}',
  published boolean not null default false,
  withheld_reason text not null default '',
  built_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists vetta_index_snapshots_built_at_idx
  on vetta_index_snapshots (built_at desc);
