-- Migration 0043: Client Taste Calibration, Omnichannel Outreach & Voice Screening
-- Supports AI-Native Agency architecture (The YC Model for India)

-- 1. Client Taste Profiles (Persistent latent preference vector per client org)
create table if not exists client_taste_profiles (
  id text primary key,
  org_id text not null,
  company_name text not null,
  taste_vector text not null default '[]', -- JSON float array of latent preference weights
  positive_signals text not null default '[]', -- JSON array of positive tags (e.g. "product_pace", "distributed_systems")
  negative_signals text not null default '[]', -- JSON array of negative tags (e.g. "it_service_firm", "academic_only")
  samples_count integer not null default 0,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  culture_pace_bias text not null default 'high_velocity', -- high_velocity | structured_enterprise | balanced
  last_calibrated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, company_name)
);

create index if not exists idx_client_taste_profiles_org on client_taste_profiles(org_id);

-- 2. Client Feedback Events (Captures hiring manager decision on candidate share pages)
create table if not exists client_feedback_events (
  id text primary key,
  org_id text not null,
  company_name text not null,
  role_id text not null,
  candidate_id text not null,
  application_id text,
  action text not null, -- interview | reject | hire | more_info
  category text not null, -- culture_pace | tech_depth | ctc_gap | notice_too_long | service_firm_bias | communication | other
  notes text not null default '',
  reviewer_name text not null default '',
  reviewer_email text not null default '',
  calibrated boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_client_feedback_org on client_feedback_events(org_id, company_name);
create index if not exists idx_client_feedback_candidate on client_feedback_events(candidate_id);

-- 3. Outreach Conversations (Multi-channel communication thread)
create table if not exists outreach_conversations (
  id text primary key,
  org_id text not null,
  candidate_id text not null,
  candidate_name text not null,
  phone text not null,
  email text not null default '',
  current_role_id text not null,
  channel text not null default 'whatsapp', -- whatsapp | sms | email
  status text not null default 'active', -- active | opted_out | responded | screened | expired
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  opt_out_reason text,
  proof_of_work_hook text not null default '',
  company_name text not null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_outreach_conversations_org on outreach_conversations(org_id);
create index if not exists idx_outreach_conversations_candidate on outreach_conversations(candidate_id);
create index if not exists idx_outreach_conversations_phone on outreach_conversations(phone);

-- 4. Outreach Messages (Unified multi-channel timeline)
create table if not exists outreach_messages (
  id text primary key,
  conversation_id text not null references outreach_conversations(id) on delete cascade,
  direction text not null, -- outbound | inbound
  channel text not null, -- whatsapp | sms | email
  content text not null,
  action_type text, -- proof_of_work_hook | objection_reply | screening_prompt | opt_out_confirm | manual
  delivery_status text not null default 'sent', -- pending | sent | delivered | read | failed
  metadata_json text not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_outreach_messages_conv on outreach_messages(conversation_id, created_at);

-- 5. Voice Screen Sessions (Audio / Hinglish screening sessions & cheating detection)
create table if not exists voice_screen_sessions (
  id text primary key,
  org_id text not null,
  candidate_id text not null,
  role_id text not null,
  duration_seconds integer not null default 0,
  transcript_text text not null default '',
  hinglish_entities_json text not null default '{}', -- parsed notice, fixed ctc, in-hand
  tech_score integer not null default 0, -- 0-100
  communication_score integer not null default 0, -- 0-100
  proxy_risk_score integer not null default 0, -- 0-100 (high = proxy / AI teleprompter suspected)
  cheating_flags text not null default '[]', -- JSON array of detected anomaly codes
  evaluated boolean not null default false,
  verdict text not null default 'passed', -- passed | borderline | flagged | failed
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_voice_screen_sessions_org on voice_screen_sessions(org_id);
create index if not exists idx_voice_screen_sessions_candidate on voice_screen_sessions(candidate_id);
