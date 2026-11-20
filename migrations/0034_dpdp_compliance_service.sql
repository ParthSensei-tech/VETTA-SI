-- Migration 0034: DPDP Act (2023) & DPDP Rules (2026/2027) Compliance Service
-- Enforces: DPA agreements, Data Principal rights (DSAR), breach reporting (DPBI), DPO credentials, and provenance tagging.

-- 1. Organization DPA Agreements (Data Processing Addendum under Rule 4 / Substantive Duties)
create table if not exists dpdp_dpa_agreements (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  user_id text not null,
  version text not null default '2026.11',
  terms_hash text not null,
  ip_address text,
  signer_name text not null,
  signer_title text,
  agreed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists dpdp_dpa_org_idx on dpdp_dpa_agreements (org_id, agreed_at desc);

-- 2. Data Principal Rights (DSAR) Requests & Grievance Redressal
create table if not exists dpdp_candidate_requests (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  candidate_id text references candidates (id) on delete set null,
  application_id text references applications (id) on delete set null,
  request_type text not null, -- 'access_summary' | 'correction' | 'erasure' | 'grievance' | 'nomination'
  subject_email text not null,
  subject_name text,
  details text not null default '',
  nominee_name text,
  nominee_contact text,
  status text not null default 'pending', -- 'pending' | 'in_progress' | 'resolved' | 'rejected'
  sla_deadline timestamptz not null default (now() + interval '30 days'),
  resolution_notes text,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dpdp_requests_org_idx on dpdp_candidate_requests (org_id, status);
create index if not exists dpdp_requests_email_idx on dpdp_candidate_requests (subject_email);

-- 3. Personal Data Breach Incidents & DPBI 72h Notification Log
create table if not exists dpdp_breach_incidents (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  title text not null,
  severity text not null default 'medium', -- 'critical' | 'high' | 'medium' | 'low'
  affected_candidates_count integer not null default 0,
  data_categories text not null default '[]', -- JSON array of categories
  root_cause text not null,
  containment_status text not null default 'investigating', -- 'investigating' | 'contained' | 'resolved'
  containment_actions text not null default '',
  dpbi_notified boolean not null default false,
  dpbi_notified_at timestamptz,
  dpbi_reference_number text,
  candidates_notified boolean not null default false,
  candidates_notified_at timestamptz,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dpdp_breach_org_idx on dpdp_breach_incidents (org_id, detected_at desc);

-- 4. Organization Grievance Redressal / Data Protection Officer (DPO) Credentials
create table if not exists dpdp_grievance_officers (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade unique,
  officer_name text not null,
  officer_email text not null,
  officer_phone text not null,
  physical_address text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists dpdp_dpo_org_idx on dpdp_grievance_officers (org_id);

-- 5. Alter candidates & applications with Sourcing Provenance & Notice Language
alter table candidates add column if not exists provenance_type text not null default 'direct_portal';
alter table candidates add column if not exists consent_language text not null default 'en';
alter table candidates add column if not exists provenance_details text not null default '';

alter table applications add column if not exists provenance_type text not null default 'direct_portal';
