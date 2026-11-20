-- Migration 0040: teaser leads.
--
-- The reciprocity wedge gives a founder a real, masked shortlist before asking
-- for anything, and the only thing we ask for is the address to send the rest
-- to. So this table is a lead inbox, not a candidate table: it holds details of
-- the *founder who looked*, never of the people in the shortlist they viewed.
--
-- Deliberately no foreign key on role_id. The role is the context of the ask,
-- and a lead outlives the posting — a closed role still tells us which teardown
-- earned the conversation. Rows with role_id = '' come from the JD audit, where
-- nothing is live yet and the founder pasted their own description.

create table if not exists teaser_leads (
  id text primary key,
  role_id text not null default '',
  email text not null,
  name text not null default '',
  company text not null default '',
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  constraint teaser_leads_role_email_unique unique (role_id, email)
);

create index if not exists teaser_leads_created_at_idx on teaser_leads (created_at desc);
