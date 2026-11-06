-- Enterprise Funnel Analytics: Stage events, cycle times, placements, retention, repeat mandates, and gross margin ledger.

-- 1. Pipeline Stage Event Audit Trail
create table if not exists pipeline_stage_events (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  application_id text not null references applications (id) on delete cascade,
  candidate_id text not null references candidates (id) on delete cascade,
  role_id text not null references roles (id) on delete cascade,
  from_stage text not null default '',
  to_stage text not null,
  actor_user_id text not null default '',
  reason text not null default '',
  metadata_json text not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists stage_events_org_app_idx on pipeline_stage_events (org_id, application_id);
create index if not exists stage_events_org_stage_idx on pipeline_stage_events (org_id, to_stage, created_at);
create index if not exists stage_events_role_stage_idx on pipeline_stage_events (role_id, to_stage);
create index if not exists stage_events_created_idx on pipeline_stage_events (created_at);

-- 2. Client Mandate Tracking on Roles
alter table roles add column if not exists client_id text not null default '';
alter table roles add column if not exists mandate_number integer not null default 1;
alter table roles add column if not exists is_repeat_mandate boolean not null default false;
alter table roles add column if not exists target_hire_count integer not null default 1;
alter table roles add column if not exists placement_fee_percentage double precision not null default 15.0;
alter table roles add column if not exists billing_currency text not null default 'INR';

-- 3. Placement Financials & Commercial Ledger
create table if not exists placement_financials (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  role_id text not null references roles (id) on delete cascade,
  candidate_id text not null references candidates (id) on delete cascade,
  application_id text not null references applications (id) on delete cascade,
  offered_ctc double precision not null default 0,
  fee_percentage double precision not null default 15.0,
  gross_placement_fee double precision not null default 0,
  direct_sourcing_cost double precision not null default 0,
  recruiter_commission double precision not null default 0,
  gross_margin_amount double precision not null default 0,
  gross_margin_percentage double precision not null default 0,
  currency text not null default 'INR',
  offer_date timestamptz,
  offer_accepted_date timestamptz,
  joining_date timestamptz,
  joining_status text not null default 'pending',
  retention_status text not null default 'pending',
  retention_days integer not null default 0,
  clawback_amount double precision not null default 0,
  invoice_status text not null default 'draft',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id)
);

create index if not exists placements_org_role_idx on placement_financials (org_id, role_id);
create index if not exists placements_org_joining_idx on placement_financials (org_id, joining_status);
create index if not exists placements_org_retention_idx on placement_financials (org_id, retention_status);
create index if not exists placements_org_currency_idx on placement_financials (org_id, currency);
