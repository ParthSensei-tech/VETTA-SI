-- Versioned match rubrics: LLM-drafted criteria, hard constraints, lock-on-stamp.

create table if not exists rubric_versions (
  id text primary key,
  org_id text not null,
  role_id text not null,
  version integer not null,
  status text not null default 'draft',
  -- draft | active | locked | superseded
  criteria_json text not null default '[]',
  hard_constraints_json text not null default '{}',
  source text not null default 'llm',
  created_by text not null default '',
  parent_version_id text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (role_id, version)
);
create index if not exists rubric_versions_role_idx on rubric_versions (role_id, status);
create index if not exists rubric_versions_org_idx on rubric_versions (org_id);

alter table applications add column if not exists rubric_version_id text;
create index if not exists applications_rubric_version_idx on applications (rubric_version_id);

-- DPDP consent flag on portal applications (explicit UI).
alter table applications add column if not exists consent_granted boolean not null default false;
alter table applications add column if not exists consent_at timestamptz;
