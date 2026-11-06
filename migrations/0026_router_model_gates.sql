-- Migration 0026: the harness gate the model router reads before trading quality for cost
--
-- A `critical` task (rank, evaluate) may only be served by a cheaper arm once the eval harness
-- has measured that the arm agrees with human labels. The harness already computes that verdict
-- per run; this table remembers it so routing decisions do not have to re-run the eval every time.

create table if not exists router_model_gates (
  id text primary key,
  task_type text not null,           -- 'rank', 'evaluate', ...
  engine text not null,              -- provider/arm the run actually used: 'groq', 'local', ...
  eval_run_id text,
  agreement_pct numeric(6, 2),
  false_shortlist_rate numeric(6, 2),
  passed boolean not null default false,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists router_model_gates_task_idx on router_model_gates (task_type, passed, created_at desc);
create index if not exists router_model_gates_run_idx on router_model_gates (eval_run_id);
