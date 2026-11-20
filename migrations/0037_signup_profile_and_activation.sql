-- Migration 0037: the signup profile and the activation trail.
--
-- The funnel the pricing page feeds needs two things the schema did not have:
-- a place to record who actually signed up (company size and the founder's own
-- role decide which plan conversation to have), and an append-only trail of the
-- activation moments the financial model is built on. The events are the honest
-- version of "how is the funnel doing" — counted from writes the product made,
-- never typed into a dashboard.

alter table organizations add column if not exists company_size text not null default '';
alter table organizations add column if not exists founder_role text not null default '';

-- 'signup_profile' | 'first_role_created' | 'first_shortlist_viewed'.
-- Append-only, like every other meter in this repo.
create table if not exists activation_events (
  id text primary key,
  org_id text not null,
  user_id text not null default '',
  kind text not null,
  role_id text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists activation_events_org_kind_idx on activation_events (org_id, kind, created_at desc);
