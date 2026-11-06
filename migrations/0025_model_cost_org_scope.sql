-- Migration 0025: organization scope for the model cost ledger (needed by the per-task model router)
-- The router prices and caps spend per org, so cost rows must be attributable to one.

alter table model_cost_logs add column if not exists org_id text;
create index if not exists model_cost_logs_org_idx on model_cost_logs (org_id, created_at desc);
create index if not exists model_cost_logs_org_task_idx on model_cost_logs (org_id, task_type, created_at desc);
