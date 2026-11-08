-- Migration 0028: one verification job per application per plan.
--
-- The ingest queue hands work to the verification queue the moment it ranks an
-- application, and a handoff that is not idempotent is a queue that grows while
-- nobody watches: a retried ingest job, a second tick, or the same resume
-- uploaded twice would each add another row for the same application, each of
-- which re-runs the ladder and re-opens the paid arms. With this index the
-- handoff is a single upsert, so "verify this application" is a statement about
-- the application, not about how many times the pipeline happened to mention it.
--
-- The pair is complete rather than partial on purpose: `plan_tier` is part of the
-- key because a workspace that later buys the paid ladder must get one re-grade
-- per paid arm too, and a free row and a paid row for the same application are
-- two different pieces of work with two different budgets.
--
-- Re-queues only ever touch finished rows (the upsert's WHERE clause), so a
-- second handoff can never interrupt a job already in flight.
create unique index if not exists verification_jobs_app_tier_idx
  on verification_jobs (application_id, plan_tier);
