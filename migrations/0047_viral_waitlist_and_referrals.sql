-- Migration 0047: viral waitlist and referrals
-- Implements Robinhood-style queue prioritization for the December 10 launch.

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
  claimed_slug text,
  is_activated boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists launch_waitlist_position_idx on launch_waitlist (waitlist_position asc);
create index if not exists launch_waitlist_ref_code_idx on launch_waitlist (referral_code);
create index if not exists launch_waitlist_referred_by_idx on launch_waitlist (referred_by_code);
