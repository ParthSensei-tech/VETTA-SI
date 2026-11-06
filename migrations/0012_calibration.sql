-- Learned shortlist calibration (per org) and retrieved HR language (EN + HI).
-- No probabilities or glossary definitions are stored in this file.

create table if not exists calibration_models (
  org_id text primary key,
  samples integer not null default 0,
  positives integer not null default 0,
  brier_ema double precision not null default 0.25,
  weights_json text not null,
  updated_at timestamptz not null default now()
);

create table if not exists hr_lexicon (
  id text primary key,
  lang text not null,
  text text not null,
  source text not null,
  embed_json text not null default '[]',
  fetched_at timestamptz not null default now()
);

create index if not exists hr_lexicon_lang_idx on hr_lexicon (lang);
