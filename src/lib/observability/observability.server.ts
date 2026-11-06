import { randomUUID } from "node:crypto";
import { getSql } from "../db.ts";
import { calculateModelCost, USD_TO_INR_RATE } from "./cost.ts";
import { getRecentAccessLogs } from "./access-logger.server.ts";
import type {
  AlertRule,
  AlertSeverity,
  ModelCostLog,
  ModelTaskType,
  ObservabilitySummary,
  QueueMetric,
  SystemAlert,
} from "./types.ts";

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: "error_rate_high",
    rule_name: "High Error Rate",
    description: "Triggers when HTTP and model error rate exceeds threshold within the window.",
    enabled: true,
    threshold: 5.0, // 5%
    window_minutes: 15,
    severity: "critical",
  },
  {
    id: "queue_lag_high",
    rule_name: "Queue Lag / Stale Ingest Jobs",
    description: "Triggers when any queued job waits longer than threshold seconds.",
    enabled: true,
    threshold: 180, // 180 seconds (3 mins)
    window_minutes: 5,
    severity: "warning",
  },
  {
    id: "failed_jobs_spike",
    rule_name: "Failed Jobs Spike",
    description: "Triggers when number of failed queue jobs exceeds threshold.",
    enabled: true,
    threshold: 3, // 3 failed jobs
    window_minutes: 15,
    severity: "critical",
  },
  {
    id: "latency_p95_high",
    rule_name: "P95 Latency Degradation",
    description: "Triggers when 95th percentile latency exceeds threshold milliseconds.",
    enabled: true,
    threshold: 4000, // 4000ms
    window_minutes: 15,
    severity: "warning",
  },
  {
    id: "cost_spike",
    rule_name: "Hourly Model Cost Spike",
    description: "Triggers when model spend in the last hour exceeds threshold dollars.",
    enabled: true,
    threshold: 5.0, // $5.00
    window_minutes: 60,
    severity: "warning",
  },
];

/**
 * Records an AI model completion cost & token log entry.
 */
export async function recordModelCost(args: {
  userId?: string | null;
  taskType: ModelTaskType | string;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  promptText?: string;
  completionText?: string;
  text?: string;
  durationMs: number;
  success?: boolean;
  error?: string;
  applicationId?: string | null;
  roleId?: string | null;
  orgId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const sql = await getSql();
  const id = randomUUID();
  const cost = calculateModelCost({
    provider: args.provider,
    model: args.model,
    promptTokens: args.promptTokens,
    completionTokens: args.completionTokens,
    promptText: args.promptText,
    completionText: args.completionText,
    text: args.text,
  });

  const enrichedMeta = {
    ...(args.meta ?? {}),
    cost_inr: cost.costInr,
    cost_rupees: cost.costRupees,
    cost_usd: cost.costUsd,
    is_estimated_tokens: cost.isEstimatedTokens,
  };

  try {
    await sql`
      insert into model_cost_logs (
        id, user_id, task_type, provider, model,
        prompt_tokens, completion_tokens, total_tokens,
        cost_cents, duration_ms, success, error,
        application_id, role_id, org_id, meta_json, created_at
      ) values (
        ${id}, ${args.userId ?? null}, ${args.taskType}, ${args.provider}, ${args.model},
        ${cost.promptTokens}, ${cost.completionTokens}, ${cost.totalTokens},
        ${cost.costCents}, ${Math.max(0, Math.round(args.durationMs))}, ${args.success ?? true}, ${args.error ?? ""},
        ${args.applicationId ?? null}, ${args.roleId ?? null}, ${args.orgId ?? null}, ${JSON.stringify(enrichedMeta)}, now()
      )`;
  } catch (err) {
    console.error("[model-cost-log-error]", err);
  }

  return id;
}

/**
 * Records execution telemetry for an ingest queue job.
 */
export async function recordQueueMetric(args: {
  jobId: string;
  batchId: string;
  userId: string;
  queueAgeMs: number;
  durationMs: number;
  status: "completed" | "failed" | "requeued";
  attempts?: number;
  error?: string;
}): Promise<string> {
  const sql = await getSql();
  const id = randomUUID();
  try {
    await sql`
      insert into queue_metrics (
        id, job_id, batch_id, user_id,
        queue_age_ms, duration_ms, status, attempts, error, created_at
      ) values (
        ${id}, ${args.jobId}, ${args.batchId}, ${args.userId},
        ${Math.max(0, Math.round(args.queueAgeMs))}, ${Math.max(0, Math.round(args.durationMs))},
        ${args.status}, ${args.attempts ?? 1}, ${args.error ?? ""}, now()
      )`;
  } catch (err) {
    console.error("[queue-metric-error]", err);
  }
  return id;
}

/**
 * Dispatches an alert notification via webhook if configured.
 */
async function dispatchAlertWebhook(alert: SystemAlert) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "vetta-observability",
        timestamp: new Date().toISOString(),
        alert: {
          id: alert.id,
          rule: alert.rule_id,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          currentValue: alert.current_value,
          thresholdValue: alert.threshold_value,
          status: alert.status,
        },
      }),
    });
  } catch (err) {
    console.error("[alert-webhook-dispatch-error]", err);
  }
}

/**
 * Evaluates all system alert rules and updates firing/resolved alert state.
 */
export async function evaluateSystemAlerts(): Promise<SystemAlert[]> {
  const sql = await getSql();
  const activeAlerts: SystemAlert[] = [];

  try {
    // 1. Calculate Error Rate (access logs + model calls in last 15 min)
    const accessErrorStats = await sql<{ total: string | number; errors: string | number }>`
      select
        count(*) as total,
        count(*) filter (where status_code >= 400) as errors
      from access_logs
      where created_at >= now() - interval '15 minutes'`;

    // Calls the router killed on its own clock are evidence about the deadline we chose, not about
    // the provider. Counting them would let a laptop-CPU arm that cannot finish inside 16 s page
    // someone for a model that never actually returned an error.
    const modelErrorStats = await sql<{ total: string | number; errors: string | number }>`
      select
        count(*) as total,
        count(*) filter (where success = false) as errors
      from model_cost_logs
      where created_at >= now() - interval '15 minutes'
        and (nullif(meta_json, '')::jsonb #>> '{router,timedOut}') is distinct from 'true'`;

    const totalOps =
      (Number(accessErrorStats[0]?.total) || 0) + (Number(modelErrorStats[0]?.total) || 0);
    const totalErrors =
      (Number(accessErrorStats[0]?.errors) || 0) + (Number(modelErrorStats[0]?.errors) || 0);
    const errorRatePercent = totalOps > 0 ? (totalErrors / totalOps) * 100 : 0;

    // 2. Queue Lag (oldest pending job in queue)
    const queueLagStats = await sql<{ oldest_sec: string | number | null }>`
      select extract(epoch from (now() - min(created_at))) as oldest_sec
      from ingest_jobs
      where status = 'queued'`;
    const oldestQueueSec = Number(queueLagStats[0]?.oldest_sec) || 0;

    // 3. Failed jobs in last 15 min
    const failedJobStats = await sql<{ count: string | number }>`
      select count(*) as count
      from ingest_jobs
      where status = 'failed' and updated_at >= now() - interval '15 minutes'`;
    const failedJobCount = Number(failedJobStats[0]?.count) || 0;

    // 4. Latency p95 in last 15 min
    const latencies = await sql<{ duration_ms: number }>`
      select duration_ms from (
        select duration_ms from access_logs where created_at >= now() - interval '15 minutes'
        union all
        select duration_ms from model_cost_logs where created_at >= now() - interval '15 minutes'
      ) t order by duration_ms asc`;

    let p95Latency = 0;
    if (latencies.length > 0) {
      const idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
      p95Latency = latencies[idx]?.duration_ms ?? 0;
    }

    // 5. Cost in last 60 min (in USD)
    const costStats = await sql<{ total_cents: string | number | null }>`
      select sum(cost_cents) as total_cents
      from model_cost_logs
      where created_at >= now() - interval '60 minutes'`;
    const hourlyCostUsd = (Number(costStats[0]?.total_cents) || 0) / 100;

    // Evaluate rules
    const checks: Array<{
      ruleId: string;
      title: string;
      message: string;
      severity: AlertSeverity;
      currentValue: number;
      threshold: number;
      isTriggered: boolean;
    }> = [
      {
        ruleId: "error_rate_high",
        title: "High Error Rate Detected",
        message: `System error rate is ${errorRatePercent.toFixed(1)}% across ${totalOps} operations (threshold: 5.0%).`,
        severity: "critical",
        currentValue: Math.round(errorRatePercent * 10) / 10,
        threshold: 5.0,
        isTriggered: errorRatePercent > 5.0 && totalErrors >= 3,
      },
      {
        ruleId: "queue_lag_high",
        title: "Ingest Queue Lag / Stale Jobs",
        message: `Oldest queued job has been waiting for ${Math.round(oldestQueueSec)}s (threshold: 180s).`,
        severity: "warning",
        currentValue: Math.round(oldestQueueSec),
        threshold: 180,
        isTriggered: oldestQueueSec > 180,
      },
      {
        ruleId: "failed_jobs_spike",
        title: "Elevated Job Failure Count",
        message: `${failedJobCount} ingest jobs failed in the last 15 minutes (threshold: 3).`,
        severity: "critical",
        currentValue: failedJobCount,
        threshold: 3,
        isTriggered: failedJobCount >= 3,
      },
      {
        ruleId: "latency_p95_high",
        title: "Elevated P95 Latency",
        message: `P95 system latency reached ${p95Latency}ms in the last 15 minutes (threshold: 4000ms).`,
        severity: "warning",
        currentValue: p95Latency,
        threshold: 4000,
        isTriggered: p95Latency > 4000 && latencies.length >= 10,
      },
      {
        ruleId: "cost_spike",
        title: "Model Cost Spike Alert",
        message: `AI model spend reached $${hourlyCostUsd.toFixed(2)} in the last hour (threshold: $5.00).`,
        severity: "warning",
        currentValue: Math.round(hourlyCostUsd * 100) / 100,
        threshold: 5.0,
        isTriggered: hourlyCostUsd > 5.0,
      },
    ];

    for (const check of checks) {
      const existing = await sql<SystemAlert>`
        select * from system_alerts
        where rule_id = ${check.ruleId} and status in ('firing', 'acknowledged')
        limit 1`;

      if (check.isTriggered) {
        if (existing.length === 0) {
          const alertId = randomUUID();
          await sql`
            insert into system_alerts (
              id, rule_id, severity, title, message,
              current_value, threshold_value, status, details_json, created_at, updated_at
            ) values (
              ${alertId}, ${check.ruleId}, ${check.severity}, ${check.title}, ${check.message},
              ${check.currentValue}, ${check.threshold}, 'firing', '{}', now(), now()
            )`;
          const newAlert: SystemAlert = {
            id: alertId,
            rule_id: check.ruleId,
            severity: check.severity,
            title: check.title,
            message: check.message,
            current_value: check.currentValue,
            threshold_value: check.threshold,
            status: "firing",
            details_json: "{}",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          activeAlerts.push(newAlert);
          void dispatchAlertWebhook(newAlert);
        } else {
          // Update current value
          await sql`
            update system_alerts
            set current_value = ${check.currentValue}, message = ${check.message}, updated_at = now()
            where id = ${existing[0].id}`;
          activeAlerts.push(existing[0]);
        }
      } else if (existing.length > 0) {
        // Condition resolved
        await sql`
          update system_alerts
          set status = 'resolved', resolved_at = now(), updated_at = now()
          where id = ${existing[0].id}`;
      }
    }
  } catch (err) {
    console.error("[evaluate-alerts-error]", err);
  }

  return activeAlerts;
}

/**
 * Acknowledges an active alert. Scoped to org if orgId is provided.
 */
export async function acknowledgeAlert(
  alertId: string,
  userId: string,
  orgId?: string,
): Promise<boolean> {
  const sql = await getSql();
  try {
    if (orgId) {
      const updated = await sql`
        update system_alerts
        set status = 'acknowledged', acknowledged_by = ${userId}, acknowledged_at = now(), updated_at = now()
        where id = ${alertId} and (org_id = ${orgId} or org_id is null)
        returning id`;
      return updated.length > 0;
    }
    await sql`
      update system_alerts
      set status = 'acknowledged', acknowledged_by = ${userId}, acknowledged_at = now(), updated_at = now()
      where id = ${alertId}`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves an active alert manually. Scoped to org if orgId is provided.
 */
export async function resolveAlert(
  alertId: string,
  userId: string,
  orgId?: string,
): Promise<boolean> {
  const sql = await getSql();
  try {
    if (orgId) {
      const updated = await sql`
        update system_alerts
        set status = 'resolved', resolved_at = now(), updated_at = now(), acknowledged_by = ${userId}
        where id = ${alertId} and (org_id = ${orgId} or org_id is null)
        returning id`;
      return updated.length > 0;
    }
    await sql`
      update system_alerts
      set status = 'resolved', resolved_at = now(), updated_at = now(), acknowledged_by = ${userId}
      where id = ${alertId}`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Retries failed ingest queue jobs.
 * Enforces organization scope to prevent cross-tenant operational abuse.
 */
export async function retryFailedJobs(opts?: {
  batchId?: string;
  jobId?: string;
  orgId?: string;
  isOperator?: boolean;
}): Promise<number> {
  const sql = await getSql();

  // Guard against un-scoped execution: must provide either an orgId or isOperator: true
  if (!opts?.orgId && !opts?.isOperator) {
    throw new Error(
      "Organization scope or operator authorization is required to retry failed jobs",
    );
  }

  try {
    if (opts?.isOperator && !opts?.orgId) {
      // Global operator retry
      if (opts.jobId) {
        const updated = await sql`
          update ingest_jobs
          set status = 'queued', attempts = 0, error = '', run_after = now(), updated_at = now()
          where id = ${opts.jobId} and status = 'failed'
          returning id`;
        return updated.length;
      }
      if (opts.batchId) {
        const updated = await sql`
          update ingest_jobs
          set status = 'queued', attempts = 0, error = '', run_after = now(), updated_at = now()
          where batch_id = ${opts.batchId} and status = 'failed'
          returning id`;
        const { refreshBatchStats } = await import("../recruiting/queue.server.ts");
        await refreshBatchStats(opts.batchId);
        return updated.length;
      }
      const updated = await sql`
        update ingest_jobs
        set status = 'queued', attempts = 0, error = '', run_after = now(), updated_at = now()
        where status = 'failed'
        returning id`;
      return updated.length;
    }

    // Tenant-scoped retry (requires matching org_id or role_id or user_id within tenant)
    const orgId = opts.orgId!;
    if (opts.jobId) {
      const updated = await sql`
        update ingest_jobs
        set status = 'queued', attempts = 0, error = '', run_after = now(), updated_at = now()
        where id = ${opts.jobId}
          and status = 'failed'
          and (
            org_id = ${orgId}
            or role_id in (select id from roles where org_id = ${orgId})
            or user_id in (select user_id from organization_members where org_id = ${orgId})
          )
        returning id`;
      return updated.length;
    }

    if (opts.batchId) {
      const updated = await sql`
        update ingest_jobs
        set status = 'queued', attempts = 0, error = '', run_after = now(), updated_at = now()
        where batch_id = ${opts.batchId}
          and status = 'failed'
          and (
            org_id = ${orgId}
            or role_id in (select id from roles where org_id = ${orgId})
            or user_id in (select user_id from organization_members where org_id = ${orgId})
          )
        returning id`;
      if (updated.length > 0) {
        const { refreshBatchStats } = await import("../recruiting/queue.server.ts");
        await refreshBatchStats(opts.batchId);
      }
      return updated.length;
    }

    // Retry all failed jobs belonging exclusively to this organization
    const updated = await sql`
      update ingest_jobs
      set status = 'queued', attempts = 0, error = '', run_after = now(), updated_at = now()
      where status = 'failed'
        and (
          org_id = ${orgId}
          or role_id in (select id from roles where org_id = ${orgId})
          or user_id in (select user_id from organization_members where org_id = ${orgId})
        )
      returning id`;
    return updated.length;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Organization scope or operator authorization is required")
    ) {
      throw err;
    }
    console.error("[retry-failed-jobs-error]", err);
    return 0;
  }
}

/**
 * Generates the full observability summary for the dashboard.
 * Scoped to organization when orgId is provided.
 */
export async function getObservabilitySummary(opts?: {
  orgId?: string;
  isOperator?: boolean;
}): Promise<ObservabilitySummary> {
  const sql = await getSql();

  // Evaluate alerts in background
  await evaluateSystemAlerts();

  // 1. Latency calculations (P50, P95, P99, avg)
  let p50Ms = 0;
  let p95Ms = 0;
  let p99Ms = 0;
  let avgMs = 0;
  let sampleCount = 0;
  try {
    const latencies = opts?.orgId
      ? await sql<{ duration_ms: number }>`
          select duration_ms from (
            select duration_ms from access_logs
            where created_at >= now() - interval '24 hours'
              and user_id in (select user_id from organization_members where org_id = ${opts.orgId})
            union all
            select duration_ms from model_cost_logs
            where created_at >= now() - interval '24 hours'
              and (role_id in (select id from roles where org_id = ${opts.orgId})
                   or user_id in (select user_id from organization_members where org_id = ${opts.orgId}))
            union all
            select duration_ms from queue_metrics
            where created_at >= now() - interval '24 hours'
              and user_id in (select user_id from organization_members where org_id = ${opts.orgId})
          ) t order by duration_ms asc`
      : await sql<{ duration_ms: number }>`
          select duration_ms from (
            select duration_ms from access_logs where created_at >= now() - interval '24 hours'
            union all
            select duration_ms from model_cost_logs where created_at >= now() - interval '24 hours'
            union all
            select duration_ms from queue_metrics where created_at >= now() - interval '24 hours'
          ) t order by duration_ms asc`;

    sampleCount = latencies.length;
    if (sampleCount > 0) {
      let sum = 0;
      for (const row of latencies) sum += row.duration_ms;
      avgMs = Math.round(sum / sampleCount);
      p50Ms = latencies[Math.floor(sampleCount * 0.5)]?.duration_ms ?? 0;
      p95Ms = latencies[Math.floor(sampleCount * 0.95)]?.duration_ms ?? 0;
      p99Ms = latencies[Math.floor(sampleCount * 0.99)]?.duration_ms ?? 0;
    }
  } catch {
    /* fallback defaults */
  }

  // 2. Errors (count, rate, recent list)
  let errorTotal = 0;
  let errorRatePercent = 0;
  const recentErrors: ObservabilitySummary["errors"]["recent"] = [];
  try {
    const accessErrors = opts?.orgId
      ? await sql<{
          id: string;
          path: string;
          error_message: string;
          status_code: number;
          created_at: string;
        }>`
          select id, path, error_message, status_code, created_at
          from access_logs
          where status_code >= 400
            and user_id in (select user_id from organization_members where org_id = ${opts.orgId})
          order by created_at desc
          limit 10`
      : await sql<{
          id: string;
          path: string;
          error_message: string;
          status_code: number;
          created_at: string;
        }>`
          select id, path, error_message, status_code, created_at
          from access_logs
          where status_code >= 400
          order by created_at desc
          limit 10`;

    for (const row of accessErrors) {
      recentErrors.push({
        id: row.id,
        source: `HTTP ${row.status_code} ${row.path}`,
        message: row.error_message || `HTTP ${row.status_code} error`,
        timestamp: row.created_at,
        status: row.status_code,
      });
    }

    const failedModelCalls = opts?.orgId
      ? await sql<{
          id: string;
          task_type: string;
          provider: string;
          error: string;
          created_at: string;
        }>`
          select id, task_type, provider, error, created_at
          from model_cost_logs
          where success = false
            and (role_id in (select id from roles where org_id = ${opts.orgId})
                 or user_id in (select user_id from organization_members where org_id = ${opts.orgId}))
          order by created_at desc
          limit 10`
      : await sql<{
          id: string;
          task_type: string;
          provider: string;
          error: string;
          created_at: string;
        }>`
          select id, task_type, provider, error, created_at
          from model_cost_logs
          where success = false
          order by created_at desc
          limit 10`;

    for (const row of failedModelCalls) {
      recentErrors.push({
        id: row.id,
        source: `Model (${row.provider} / ${row.task_type})`,
        message: row.error || "Model completion failure",
        timestamp: row.created_at,
      });
    }

    errorTotal = recentErrors.length;
    errorRatePercent = sampleCount > 0 ? Math.round((errorTotal / sampleCount) * 1000) / 10 : 0;
  } catch {
    /* fallback defaults */
  }

  // 3. Model cost breakdown
  let totalCostCents = 0;
  let totalTokens = 0;
  let totalCalls = 0;
  let savingsUsd = 0;
  const byTask: ObservabilitySummary["modelCosts"]["byTask"] = {};
  const byProvider: ObservabilitySummary["modelCosts"]["byProvider"] = {};

  try {
    const costRows = opts?.orgId
      ? await sql<ModelCostLog>`
          select * from model_cost_logs
          where created_at >= now() - interval '30 days'
            and (role_id in (select id from roles where org_id = ${opts.orgId})
                 or user_id in (select user_id from organization_members where org_id = ${opts.orgId}))
          order by created_at desc
          limit 500`
      : await sql<ModelCostLog>`
          select * from model_cost_logs
          where created_at >= now() - interval '30 days'
          order by created_at desc
          limit 500`;

    for (const row of costRows) {
      totalCalls += 1;
      const cents = Number(row.cost_cents) || 0;
      const tokens = (Number(row.prompt_tokens) || 0) + (Number(row.completion_tokens) || 0);
      totalCostCents += cents;
      totalTokens += tokens;

      // Group by task
      byTask[row.task_type] ??= { costCents: 0, costUsd: 0, costInr: 0, tokens: 0, count: 0 };
      byTask[row.task_type].costCents += cents;
      byTask[row.task_type].costUsd =
        Math.round((byTask[row.task_type].costCents / 100) * 1000) / 1000;
      byTask[row.task_type].costInr =
        Math.round(byTask[row.task_type].costUsd * USD_TO_INR_RATE * 100) / 100;
      byTask[row.task_type].tokens += tokens;
      byTask[row.task_type].count += 1;

      // Group by provider
      byProvider[row.provider] ??= { costCents: 0, costUsd: 0, costInr: 0, tokens: 0, count: 0 };
      byProvider[row.provider].costCents += cents;
      byProvider[row.provider].costUsd =
        Math.round((byProvider[row.provider].costCents / 100) * 1000) / 1000;
      byProvider[row.provider].costInr =
        Math.round(byProvider[row.provider].costUsd * USD_TO_INR_RATE * 100) / 100;
      byProvider[row.provider].tokens += tokens;
      byProvider[row.provider].count += 1;

      // Calculate benchmark savings (if local/ollama was used vs gpt-4o rates)
      if (row.provider === "local" || row.provider === "ollama") {
        // ~ $2.50 prompt, $10.00 comp / 1M tokens => avg $5/1M = $0.0005/1k
        savingsUsd += (tokens / 1_000_000) * 5.0;
      }
    }
  } catch {
    /* fallback defaults */
  }

  // 4. Queue health & failed jobs
  let pendingCount = 0;
  let processingCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let oldestAgeMs = 0;
  let avgAgeMs = 0;
  let failureRatePercent = 0;
  const failedJobs: ObservabilitySummary["failedJobs"] = [];

  try {
    const queueStats = opts?.orgId
      ? await sql<{
          status: string;
          cnt: string | number;
          oldest_created: string | null;
          avg_wait_ms: string | number | null;
        }>`
          select
            status,
            count(*) as cnt,
            min(created_at) as oldest_created,
            avg(extract(epoch from (now() - created_at)) * 1000) as avg_wait_ms
          from ingest_jobs
          where (org_id = ${opts.orgId}
                 or role_id in (select id from roles where org_id = ${opts.orgId})
                 or user_id in (select user_id from organization_members where org_id = ${opts.orgId}))
          group by status`
      : await sql<{
          status: string;
          cnt: string | number;
          oldest_created: string | null;
          avg_wait_ms: string | number | null;
        }>`
          select
            status,
            count(*) as cnt,
            min(created_at) as oldest_created,
            avg(extract(epoch from (now() - created_at)) * 1000) as avg_wait_ms
          from ingest_jobs
          group by status`;

    for (const stat of queueStats) {
      const cnt = Number(stat.cnt) || 0;
      if (stat.status === "queued") {
        pendingCount = cnt;
        if (stat.oldest_created) {
          oldestAgeMs = Math.max(0, Date.now() - new Date(stat.oldest_created).getTime());
        }
        avgAgeMs = Math.max(0, Math.round(Number(stat.avg_wait_ms) || 0));
      } else if (stat.status === "ranking") {
        processingCount = cnt;
      } else if (stat.status === "completed") {
        completedCount = cnt;
      } else if (stat.status === "failed") {
        failedCount = cnt;
      }
    }

    const totalJobs = pendingCount + processingCount + completedCount + failedCount;
    failureRatePercent = totalJobs > 0 ? Math.round((failedCount / totalJobs) * 1000) / 10 : 0;

    const failedRows = opts?.orgId
      ? await sql<{
          id: string;
          batch_id: string;
          filename: string;
          error: string;
          attempts: number;
          created_at: string;
          updated_at: string;
        }>`
          select id, batch_id, filename, error, attempts, created_at, updated_at
          from ingest_jobs
          where status = 'failed'
            and (org_id = ${opts.orgId}
                 or role_id in (select id from roles where org_id = ${opts.orgId})
                 or user_id in (select user_id from organization_members where org_id = ${opts.orgId}))
          order by updated_at desc
          limit 25`
      : await sql<{
          id: string;
          batch_id: string;
          filename: string;
          error: string;
          attempts: number;
          created_at: string;
          updated_at: string;
        }>`
          select id, batch_id, filename, error, attempts, created_at, updated_at
          from ingest_jobs
          where status = 'failed'
          order by updated_at desc
          limit 25`;

    failedJobs.push(...failedRows);
  } catch {
    /* fallback defaults */
  }

  // 5. Access logs
  const accessLogs = await getRecentAccessLogs(30, false, opts?.orgId);

  // 6. Alerts
  let alerts: SystemAlert[] = [];
  try {
    alerts = opts?.orgId
      ? await sql<SystemAlert>`
          select * from system_alerts
          where status in ('firing', 'acknowledged')
            and (org_id = ${opts.orgId} or org_id is null)
          order by created_at desc
          limit 20`
      : await sql<SystemAlert>`
          select * from system_alerts
          where status in ('firing', 'acknowledged')
          order by created_at desc
          limit 20`;
  } catch {
    /* fallback defaults */
  }

  return {
    errors: {
      total: errorTotal,
      ratePercent: errorRatePercent,
      windowMinutes: 15,
      recent: recentErrors,
    },
    latency: {
      p50Ms,
      p95Ms,
      p99Ms,
      avgMs,
      sampleCount,
    },
    modelCosts: {
      totalCostCents: Math.round(totalCostCents * 100) / 100,
      totalCostUsd: Math.round((totalCostCents / 100) * 100) / 100,
      totalCostInr: Math.round((totalCostCents / 100) * USD_TO_INR_RATE * 100) / 100,
      totalTokens,
      totalCalls,
      byTask,
      byProvider,
      savingsUsd: Math.round(savingsUsd * 100) / 100,
      savingsInr: Math.round(savingsUsd * USD_TO_INR_RATE * 100) / 100,
    },
    queueHealth: {
      pendingCount,
      processingCount,
      completedCount,
      failedCount,
      oldestAgeMs,
      avgAgeMs,
      failureRatePercent,
    },
    failedJobs,
    accessLogs,
    alerts,
    alertRules: DEFAULT_ALERT_RULES,
  };
}
