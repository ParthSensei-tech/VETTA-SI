-- Migration 0033: Offer Guard - Offer-to-Joining Pre-Boarding & Renege Prevention Engine
-- Tracks accepted offers through 60-90 day Indian notice periods, records multi-signal micro-telemetry,
-- powers the Dynamic Bayesian Survival State-Space Model, and logs prescriptive interventions.

-- 1. Pre-Boarding Offer Tracking
create table if not exists preboarding_offers (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  role_id text not null references roles (id) on delete cascade,
  candidate_id text not null references candidates (id) on delete cascade,
  application_id text not null references applications (id) on delete cascade,
  
  -- Notice period timeline
  offer_accepted_date timestamptz not null default now(),
  target_joining_date timestamptz not null,
  total_notice_days integer not null default 60,
  
  -- Financial context
  offered_ctc double precision not null default 0,
  current_ctc double precision not null default 0,
  placement_fee double precision not null default 0,
  currency text not null default 'INR',
  
  -- Current state & hazard score
  intent_state text not null default 'committed', -- 'committed' | 'wavering' | 'counteroffered' | 'imminent_renege' | 'joined' | 'reneged'
  hazard_score double precision not null default 15.0, -- 0.0 to 100.0
  risk_tier text not null default 'low', -- 'low' | 'moderate' | 'high' | 'critical'
  
  -- Verification & Milestones
  resignation_submitted boolean not null default false,
  resignation_submitted_date timestamptz,
  resignation_accepted boolean not null default false,
  resignation_proof_document_id text,
  bgv_documents_submitted boolean not null default false,
  preboarding_portal_visits integer not null default 0,
  last_response_latency_hours double precision not null default 4.0,
  swag_dispatched boolean not null default false,
  buddy_assigned_name text not null default '',
  buddy_assigned_email text not null default '',
  
  -- Runner-up standby
  silver_medalist_application_id text references applications (id) on delete set null,
  silver_medalist_warmed boolean not null default false,
  
  -- Resolution status
  resolution text not null default 'active', -- 'active' | 'joined' | 'reneged' | 'rescinded'
  resolved_at timestamptz,
  
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id)
);

create index if not exists preboarding_offers_org_idx on preboarding_offers (org_id);
create index if not exists preboarding_offers_role_idx on preboarding_offers (role_id);
create index if not exists preboarding_offers_candidate_idx on preboarding_offers (candidate_id);
create index if not exists preboarding_offers_intent_idx on preboarding_offers (org_id, intent_state);
create index if not exists preboarding_offers_risk_idx on preboarding_offers (org_id, risk_tier);
create index if not exists preboarding_offers_joining_idx on preboarding_offers (target_joining_date);

-- 2. Observable Micro-Telemetry Signals
create table if not exists preboarding_signals (
  id text primary key,
  offer_id text not null references preboarding_offers (id) on delete cascade,
  signal_type text not null, -- 'response_latency' | 'resignation_milestone' | 'document_velocity' | 'portal_dwell' | 'recruiter_sentiment' | 'counteroffer_hint'
  signal_value double precision not null default 0,
  signal_payload jsonb not null default '{}'::jsonb,
  notes text not null default '',
  detected_at timestamptz not null default now()
);

create index if not exists preboarding_signals_offer_idx on preboarding_signals (offer_id, detected_at);
create index if not exists preboarding_signals_type_idx on preboarding_signals (signal_type);

-- 3. Prescriptive Intervention Audit Log
create table if not exists preboarding_interventions (
  id text primary key,
  offer_id text not null references preboarding_offers (id) on delete cascade,
  playbook_key text not null, -- 'resignation_escalation' | 'counteroffer_defense' | 'peer_buddy_coffee' | 'executive_sync' | 'silver_medalist_warm'
  status text not null default 'recommended', -- 'recommended' | 'in_progress' | 'completed' | 'dismissed'
  recommended_by text not null default 'system_hazard_engine',
  actor_user_id text not null default '',
  action_summary text not null default '',
  outcome_notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists preboarding_interventions_offer_idx on preboarding_interventions (offer_id, status);

-- 4. Interactive Tutorial & Contextual Bubble Guide Progress
create table if not exists preboarding_tutorial_progress (
  id text primary key,
  org_id text not null references organizations (id) on delete cascade,
  user_id text not null default '',
  step_key text not null,
  dismissed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, step_key)
);

create index if not exists preboarding_tutorial_org_user_idx on preboarding_tutorial_progress (org_id, user_id);
