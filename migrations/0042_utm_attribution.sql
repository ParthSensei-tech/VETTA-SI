-- Migration 0042: Universal UTM Tracking & Campaign Attribution
-- Adds attribution telemetry to marketing leads, candidate applications, and touchpoint audit.

-- 1. Add UTM columns to demo_requests
alter table demo_requests add column if not exists utm_source text not null default '';
alter table demo_requests add column if not exists utm_medium text not null default '';
alter table demo_requests add column if not exists utm_campaign text not null default '';
alter table demo_requests add column if not exists utm_term text not null default '';
alter table demo_requests add column if not exists utm_content text not null default '';
alter table demo_requests add column if not exists initial_referrer text not null default '';

-- 2. Add UTM columns to teaser_leads
alter table teaser_leads add column if not exists utm_source text not null default '';
alter table teaser_leads add column if not exists utm_medium text not null default '';
alter table teaser_leads add column if not exists utm_campaign text not null default '';
alter table teaser_leads add column if not exists utm_term text not null default '';
alter table teaser_leads add column if not exists utm_content text not null default '';
alter table teaser_leads add column if not exists initial_referrer text not null default '';

-- 3. Add UTM columns to applications (candidate sourcing channel)
alter table applications add column if not exists utm_source text not null default '';
alter table applications add column if not exists utm_medium text not null default '';
alter table applications add column if not exists utm_campaign text not null default '';
alter table applications add column if not exists utm_term text not null default '';
alter table applications add column if not exists utm_content text not null default '';
alter table applications add column if not exists initial_referrer text not null default '';

-- 4. Attribution Touchpoints Audit Table (Multi-Touch Campaign History)
create table if not exists attribution_touchpoints (
  id text primary key,
  session_id text not null,
  touch_type text not null, -- 'landing' | 'lead' | 'apply' | 'signup' | 'upgrade'
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  utm_term text not null default '',
  utm_content text not null default '',
  landing_path text not null default '',
  referrer text not null default '',
  metadata_json text not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists attribution_touchpoints_session_idx on attribution_touchpoints (session_id);
create index if not exists attribution_touchpoints_campaign_idx on attribution_touchpoints (utm_campaign, utm_source);
create index if not exists attribution_touchpoints_created_idx on attribution_touchpoints (created_at desc);
