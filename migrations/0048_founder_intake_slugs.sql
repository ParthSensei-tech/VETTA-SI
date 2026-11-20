-- Migration 0048: personal founder intake slugs and WhatsApp router
-- Lets founders attach `vetta.ai/f/:slug` to LinkedIn/Twitter hiring posts.

create table if not exists founder_intake_slugs (
  id text primary key,
  org_id text not null,
  user_id text,
  slug text not null unique,
  founder_name text not null default '',
  company_name text not null default '',
  whatsapp_number text not null default '',
  active_role_ids jsonb not null default '[]'::jsonb,
  welcome_message text,
  total_candidates_ingested integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists founder_intake_slugs_slug_idx on founder_intake_slugs (slug);
create index if not exists founder_intake_slugs_org_idx on founder_intake_slugs (org_id);
