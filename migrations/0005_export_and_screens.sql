-- Client shares (snapshot of a ranked slate / client cards) and conversational screens.

create table if not exists client_shares (
  id text primary key,
  user_id text not null,
  role_id text not null,
  token text not null unique,
  kind text not null default 'slate',
  title text not null default '',
  recipient_email text not null default '',
  recipient_name text not null default '',
  message text not null default '',
  payload_json text not null default '{}',
  email_status text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists client_shares_user_idx on client_shares (user_id, created_at desc);
create index if not exists client_shares_role_idx on client_shares (user_id, role_id);
create unique index if not exists client_shares_token_idx on client_shares (token);

create table if not exists screen_reminders (
  id text primary key,
  user_id text not null,
  application_id text not null,
  channel text not null,
  meta_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists screen_reminders_app_idx on screen_reminders (application_id, created_at desc);

alter table screens add column if not exists transcript_json text not null default '[]';
alter table screens add column if not exists invite_token text;
alter table screens add column if not exists opened_at timestamptz;
alter table screens add column if not exists started_at timestamptz;
alter table screens add column if not exists completed_at timestamptz;
alter table screens add column if not exists last_reminded_at timestamptz;

create unique index if not exists screens_invite_token_idx on screens (invite_token) where invite_token is not null;
