-- Public demo requests from the landing page. Unowned marketing leads.

create table if not exists demo_requests (
  id text primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);