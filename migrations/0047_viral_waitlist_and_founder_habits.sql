-- Migration 0047: Viral waitlist, referral line-jumping, founder intake slugs, and daily briefings.
--
-- Supports the Robinhood-style viral pre-boarding waitlist for December 10,
-- personal founder WhatsApp intake slugs (vetta.ai/f/:slug), and the
-- 9:00 AM WhatsApp executive talent pulse briefing.

create table if not exists launch_waitlist (
  id text primary key,
  email text not null unique,
  founder_name text not null default '',
  company_name text not null default '',
  role_title text not null default '',
  waitlist_position integer not null,
  referral_code text not null unique,
  referred_by_code text,
  referral_count integer not null default 0,
  bonus_calling_credits integer not null default 10,
  is_activated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launch_waitlist_position_idx on launch_waitlist (waitlist_position asc);
create index if not exists launch_waitlist_referral_code_idx on launch_waitlist (referral_code);
create index if not exists launch_waitlist_referred_by_idx on launch_waitlist (referred_by_code);

-- Personal founder intake slugs for LinkedIn hiring posts and WhatsApp referrals (vetta.ai/f/:slug)
create table if not exists founder_intake_slugs (
  id text primary key,
  org_id text not null,
  user_id text,
  slug text not null unique,
  founder_name text not null default '',
  company_name text not null default '',
  whatsapp_number text not null default '',
  active_role_ids text[] not null default '{}',
  total_candidates_ingested integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists founder_intake_slugs_slug_idx on founder_intake_slugs (slug);
create index if not exists founder_intake_slugs_org_id_idx on founder_intake_slugs (org_id);

-- Daily 09:00 AM executive talent briefing cache
create table if not exists founder_daily_briefings (
  id text primary key,
  org_id text not null,
  brief_date date not null default current_date,
  hazard_summary_json jsonb not null default '[]'::jsonb,
  interviews_json jsonb not null default '[]'::jsonb,
  overnight_candidates_json jsonb not null default '[]'::jsonb,
  whatsapp_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint founder_daily_briefings_org_date_unique unique (org_id, brief_date)
);

create index if not exists founder_daily_briefings_org_date_idx on founder_daily_briefings (org_id, brief_date desc);
