-- Migration 0021: Strict tenant isolation for screens, approvals, audit events and legacy tables

alter table screens add column if not exists org_id text;
create index if not exists screens_org_idx on screens (org_id);

alter table approvals add column if not exists org_id text;
create index if not exists approvals_org_idx on approvals (org_id);

alter table audit_events add column if not exists org_id text;
create index if not exists audit_events_org_idx on audit_events (org_id);

-- Backfill org_id from linked applications and roles
update screens s
set org_id = (select a.org_id from applications a where a.id = s.application_id)
where s.org_id is null;

update approvals ap
set org_id = (select a.org_id from applications a where a.id = ap.application_id)
where ap.org_id is null;

update audit_events ae
set org_id = (select m.org_id from organization_members m where m.user_id = ae.user_id limit 1)
where ae.org_id is null;

update ingest_batches b
set org_id = (select r.org_id from roles r where r.id = b.role_id)
where b.org_id is null;

update ingest_jobs j
set org_id = (select b.org_id from ingest_batches b where b.id = j.batch_id)
where j.org_id is null;
