-- Purpose limits, erasure receipts, and a log of what left the machine.
-- No sample people. Receipts keep a hash, not a name.

alter table consent_records add column if not exists notice_version text not null default '2026-10';

alter table organizations
  add column if not exists employer_covers_client_share boolean not null default true;
alter table organizations
  add column if not exists employer_covers_model_training boolean not null default false;

create table if not exists erasure_receipts (
  id text primary key,
  org_id text not null,
  subject_ref text not null,
  reason text not null,
  stores_json text not null default '{}',
  provider_forget_json text not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists erasure_receipts_org_idx on erasure_receipts (org_id, created_at desc);

create table if not exists provider_disclosures (
  id text primary key,
  org_id text not null,
  subject_id text not null,
  application_id text,
  purpose text not null,
  provider text not null,
  prompt_sha256 text not null,
  no_store boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists provider_disclosures_subject_idx
  on provider_disclosures (org_id, subject_id);
