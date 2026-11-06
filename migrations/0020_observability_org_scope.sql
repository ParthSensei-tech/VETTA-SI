-- Migration 0020: Observability organization scope and tenant isolation

alter table system_alerts add column if not exists org_id text;
create index if not exists system_alerts_org_idx on system_alerts (org_id, status);

alter table ingest_jobs add column if not exists org_id text;
create index if not exists ingest_jobs_org_idx on ingest_jobs (org_id, status);

alter table ingest_batches add column if not exists org_id text;
create index if not exists ingest_batches_org_idx on ingest_batches (org_id);
