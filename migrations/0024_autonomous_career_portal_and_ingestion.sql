-- Migration 0024: Autonomous Career Portal & Multi-Stage Ingestion Engine
-- Replaces legacy keyword-parsing ATS with agentic retrieval, client connection wizard,
-- dynamic missing-info intake, and strict Human-in-the-Loop (HITL) decision gates.

create table if not exists autonomous_portals (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  slug text not null unique,
  portal_name text not null,
  headline text not null default 'Join Our Team & Build the Future',
  description text not null default 'Experience our autonomous career portal powered by evidence-grounded matching with human review at every stage.',
  tier text not null default 'premium',
  hitl_policy text not null default 'strict',
  auto_shortlist_threshold integer not null default 78,
  require_human_rejection boolean not null default true,
  require_rubric_approval boolean not null default true,
  interactive_intake_enabled boolean not null default true,
  webhook_secret text not null default '',
  connected_ats text not null default 'none',
  channels_json text not null default '{"career_portal": true, "embed_widget": true, "ats_webhook": true, "direct_drop": true}',
  branding_json text not null default '{"primaryColor": "#2563EB", "accentColor": "#38BDF8", "theme": "system"}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists autonomous_portals_org_idx on autonomous_portals (org_id);
create index if not exists autonomous_portals_slug_idx on autonomous_portals (slug);

-- Strict Human-in-the-Loop (HITL) Checkpoints
create table if not exists hitl_decisions (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  role_id text not null references roles (id) on delete cascade,
  application_id text references applications (id) on delete cascade,
  portal_id text references autonomous_portals (id) on delete cascade,
  checkpoint_type text not null, -- 'rubric_approval' | 'missing_info_probe' | 'shortlist_interview' | 'candidate_rejection'
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected' | 'clarification_requested'
  candidate_name text not null default '',
  role_title text not null default '',
  ai_recommendation text not null, -- 'advance' | 'probe' | 'reject' | 'calibrate'
  ai_score integer,
  ai_fit_level text,
  ai_confidence double precision not null default 0.0,
  evidence_summary text not null default '',
  missing_requirements_json text not null default '[]',
  probe_questions_json text not null default '[]',
  candidate_responses_json text not null default '[]',
  reviewer_id text,
  reviewer_decision text,
  reviewer_notes text not null default '',
  calibration_delta_json text not null default '{}',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hitl_decisions_org_status_idx on hitl_decisions (org_id, status);
create index if not exists hitl_decisions_role_idx on hitl_decisions (role_id);
create index if not exists hitl_decisions_app_idx on hitl_decisions (application_id);

-- Dynamic Interactive Intake Sessions (for missing information probes)
create table if not exists portal_intake_sessions (
  id text primary key,
  portal_id text not null references autonomous_portals (id) on delete cascade,
  role_id text not null references roles (id) on delete cascade,
  application_id text not null references applications (id) on delete cascade,
  candidate_email text not null,
  candidate_name text not null,
  intake_token text not null unique,
  probes_json text not null default '[]',
  responses_json text not null default '[]',
  status text not null default 'pending', -- 'pending' | 'submitted' | 'reviewed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portal_intake_token_idx on portal_intake_sessions (intake_token);
create index if not exists portal_intake_app_idx on portal_intake_sessions (application_id);
