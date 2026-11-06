-- Enterprise: organizations, match rubrics, rank labels (LTR), DPDP consent/retention, share expiry.

create table if not exists organizations (
  id text primary key,
  name text not null,
  slug text not null unique,
  created_by text not null,
  retention_days integer not null default 365,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_members (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  user_id text not null,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_members_user_idx on organization_members (user_id);
create index if not exists org_members_org_idx on organization_members (org_id);

-- Formal weighted match rubric per org (and optional per-role override).
create table if not exists match_rubrics (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  role_id text,
  name text not null default 'default',
  weights_json text not null default '{}',
  source text not null default 'system',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists match_rubrics_org_idx on match_rubrics (org_id);
create unique index if not exists match_rubrics_org_default_idx
  on match_rubrics (org_id) where role_id is null;

-- Recruiter labels → learning signal for per-org ranking (not demo harness).
create table if not exists rank_labels (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  user_id text not null,
  role_id text not null,
  application_id text not null,
  label text not null,
  note text not null default '',
  dimension_scores_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists rank_labels_org_idx on rank_labels (org_id, created_at desc);
create index if not exists rank_labels_app_idx on rank_labels (application_id);

-- DPDP: consent for processing candidate personal data.
create table if not exists consent_records (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  purpose text not null,
  lawful_basis text not null default 'consent',
  granted boolean not null default true,
  source text not null default 'portal',
  meta_json text not null default '{}',
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists consent_subject_idx on consent_records (org_id, subject_type, subject_id);

-- Share links: expiry + revoke.
alter table client_shares add column if not exists expires_at timestamptz;
alter table client_shares add column if not exists revoked_at timestamptz;
alter table client_shares add column if not exists org_id text;

-- Scope recruiting entities to org (nullable until backfilled by app ensureOrg).
alter table roles add column if not exists org_id text;
alter table candidates add column if not exists org_id text;
alter table applications add column if not exists org_id text;
alter table applications add column if not exists rubric_score integer;
alter table applications add column if not exists rubric_json text not null default '{}';

create index if not exists roles_org_idx on roles (org_id);
create index if not exists candidates_org_idx on candidates (org_id);
create index if not exists applications_org_idx on applications (org_id);
