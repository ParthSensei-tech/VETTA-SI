-- Enterprise Collaboration: Multi-recruiter org roles, assignments, shared pool, duplicate merge, notes, tasks and optimistic locking.

-- 1. Organization member enhancements
alter table organization_members add column if not exists status text not null default 'active';
alter table organization_members add column if not exists title text not null default '';
alter table organization_members add column if not exists invited_email text not null default '';
alter table organization_members add column if not exists invited_by text;
alter table organization_members add column if not exists joined_at timestamptz default now();
alter table organization_members add column if not exists updated_at timestamptz not null default now();

-- 2. Concurrency Control (Optimistic versioning) & merge references
alter table roles add column if not exists version integer not null default 1;
alter table candidates add column if not exists version integer not null default 1;
alter table candidates add column if not exists status text not null default 'active';
alter table candidates add column if not exists merged_into_id text;
alter table applications add column if not exists version integer not null default 1;

-- 3. Role assignments (Lead recruiter, secondary recruiters, hiring managers, interview panel)
create table if not exists role_assignments (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  role_id text not null references roles (id) on delete cascade,
  user_id text not null,
  assignment_type text not null default 'recruiter',
  assigned_by text not null,
  created_at timestamptz not null default now(),
  unique (role_id, user_id, assignment_type)
);
create index if not exists role_assign_org_user_idx on role_assignments (org_id, user_id);
create index if not exists role_assign_role_idx on role_assignments (role_id);

-- 4. Application assignments (Candidate owner recruiter, assigned reviewer, interviewer)
create table if not exists application_assignments (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  application_id text not null references applications (id) on delete cascade,
  user_id text not null,
  assignment_type text not null default 'reviewer',
  assigned_by text not null,
  created_at timestamptz not null default now(),
  unique (application_id, user_id, assignment_type)
);
create index if not exists app_assign_org_user_idx on application_assignments (org_id, user_id);
create index if not exists app_assign_app_idx on application_assignments (application_id);

-- 5. Multi-recruiter team notes with visibility & mentions
create table if not exists candidate_notes (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  candidate_id text not null references candidates (id) on delete cascade,
  application_id text references applications (id) on delete set null,
  author_id text not null,
  author_name text not null default '',
  author_role text not null default '',
  content text not null,
  visibility text not null default 'team',
  pinned boolean not null default false,
  mentions_json text not null default '[]',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists candidate_notes_cand_idx on candidate_notes (candidate_id, created_at desc);
create index if not exists candidate_notes_app_idx on candidate_notes (application_id);
create index if not exists candidate_notes_org_idx on candidate_notes (org_id);

-- 6. Actionable tasks & reminders
create table if not exists recruiting_tasks (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  title text not null,
  description text not null default '',
  candidate_id text references candidates (id) on delete cascade,
  application_id text references applications (id) on delete set null,
  role_id text references roles (id) on delete set null,
  assignee_id text not null,
  creator_id text not null,
  priority text not null default 'medium',
  status text not null default 'pending',
  due_date timestamptz,
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_org_assignee_idx on recruiting_tasks (org_id, assignee_id, status);
create index if not exists tasks_cand_idx on recruiting_tasks (candidate_id);
create index if not exists tasks_role_idx on recruiting_tasks (role_id);

-- 7. Candidate deduplication & merge history
create table if not exists candidate_merges (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  canonical_candidate_id text not null references candidates (id) on delete cascade,
  merged_candidate_id text not null,
  merged_by text not null,
  reason text not null default 'manual_duplicate_merge',
  confidence double precision not null default 1.0,
  details_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists candidate_merges_canonical_idx on candidate_merges (canonical_candidate_id);
create index if not exists candidate_merges_org_idx on candidate_merges (org_id);
