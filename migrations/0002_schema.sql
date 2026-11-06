-- Vetta recruiting workspace. All rows are scoped to user_id (TEXT).

create table if not exists roles (
  id text primary key,
  user_id text not null,
  company_name text not null,
  company_stage text not null,
  title text not null,
  location text not null default '',
  work_mode text not null default 'hybrid',
  employment_type text not null default 'full_time',
  compensation_band text not null default '',
  stack text not null default '[]',
  must_haves text not null default '[]',
  nice_to_haves text not null default '[]',
  jd_text text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists roles_user_id_idx on roles (user_id);
create index if not exists roles_user_status_idx on roles (user_id, status);

create table if not exists candidates (
  id text primary key,
  user_id text not null,
  full_name text not null,
  email text not null default '',
  phone text not null default '',
  location text not null default '',
  linkedin_url text not null default '',
  current_title text not null default '',
  current_company text not null default '',
  years_experience double precision,
  resume_text text not null,
  parsed_json text not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists candidates_user_id_idx on candidates (user_id);

create table if not exists applications (
  id text primary key,
  user_id text not null,
  role_id text not null references roles (id) on delete cascade,
  candidate_id text not null references candidates (id) on delete cascade,
  pipeline_status text not null default 'ingested',
  rank_score integer,
  rank_json text not null default '{}',
  recruiter_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, candidate_id)
);
create index if not exists applications_user_role_idx on applications (user_id, role_id);
create index if not exists applications_user_status_idx on applications (user_id, pipeline_status);

create table if not exists screens (
  id text primary key,
  user_id text not null,
  application_id text not null references applications (id) on delete cascade,
  questions_json text not null default '[]',
  answers_json text not null default '[]',
  evaluation_json text not null default '{}',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists screens_user_app_idx on screens (user_id, application_id);

create table if not exists approvals (
  id text primary key,
  user_id text not null,
  application_id text not null references applications (id) on delete cascade,
  role_id text not null,
  artifact_type text not null,
  title text not null,
  payload_json text not null,
  status text not null default 'pending',
  reviewer_note text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approvals_user_status_idx on approvals (user_id, status);
create index if not exists approvals_user_app_idx on approvals (user_id, application_id);

create table if not exists audit_events (
  id text primary key,
  user_id text not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  meta_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_events_user_idx on audit_events (user_id, created_at desc);
