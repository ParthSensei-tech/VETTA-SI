-- Migration 0038: demo leads grow up.
--
-- The teaser wedge and the pricing page will hand this table real humans, not
-- just emails. `marketing_opt_in` is stored with its timestamp because a
-- marketing email without a dated yes is exactly what the DPDP audit asks
-- about; `status` is the founder's own pipeline column — 'new' | 'contacted' |
-- 'demo_booked' | 'won' | 'lost' — set by hand in the admin view until there
-- is a reason for it to be set by anything else.

alter table demo_requests add column if not exists name text not null default '';
alter table demo_requests add column if not exists company text not null default '';
alter table demo_requests add column if not exists marketing_opt_in boolean not null default false;
alter table demo_requests add column if not exists marketing_opt_in_at timestamptz;
alter table demo_requests add column if not exists status text not null default 'new';
-- The founder triages by hand at first; a one-line note ("called, wants Q3
-- pilot") is the difference between a CRM and a list of emails.
alter table demo_requests add column if not exists note text not null default '';
