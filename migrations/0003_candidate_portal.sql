-- Tag applications that arrived from the public candidate portal.
alter table applications
  add column if not exists source text not null default 'ingest';
