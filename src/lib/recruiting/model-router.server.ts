/**
 * Server-side half of the model router: reads what the system actually spent and how the arms
 * actually performed, then hands `decideRoute()` the inputs it refuses to fetch itself.
 *
 * Keeping the I/O here leaves `model-router.ts` pure and replayable — a route can be recomputed
 * from its inputs, which is the only way to answer "why did this resume get ranked by that model".
 */

import { getSql } from "../../platform/db.ts";
import { USD_TO_INR_RATE } from "../../platform/observability/cost.ts";
import type { ModelTaskType } from "../../platform/observability/types.ts";
import { MODEL_ARMS, armModel, type CallContext, type ModelCandidate } from "./model-registry.ts";
import {
  decideRoute,
  type ArmHistory,
  type GatePass,
  type RouteDecision,
  type RouteInput,
} from "./model-router.ts";

/** Cost and latency of a served call are only meaningful over a recent window. */
const HISTORY_WINDOW_DAYS = 7;
const HISTORY_ROW_LIMIT = 500;

/** A gate that old is no evidence for today's prompts; the router goes back to the priors. */
const GATE_VALID_DAYS = 30;

function centsToInr(cents: number): number {
  return (cents / 100) * USD_TO_INR_RATE;
}

/** Map a `model_cost_logs` (provider, model) pair back onto a registry arm id. */
export function armIdFor(provider: string, model: string): string {
  const p = String(provider || "")
    .toLowerCase()
    .trim();
  const m = String(model || "")
    .toLowerCase()
    .trim();
  const exact = MODEL_ARMS.find((a) => a.provider === p && armModel(a).toLowerCase() === m);
  if (exact) return exact.id;
  const declared = MODEL_ARMS.find((a) => a.provider === p && a.declaredModel.toLowerCase() === m);
  if (declared) return declared.id;
  // Any arm the provider was overridden to (GROQ_MODEL and friends) still gets its own history,
  // so a surprising model is measured rather than silently matched to a declared arm.
  return `${p}:${m}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Per-arm performance for one task, read from the cost ledger.
 * `orgId` scopes it to one tenant's traffic; null aggregates across the deployment.
 */
export async function routerHistory(
  task: ModelTaskType,
  orgId?: string | null,
): Promise<ArmHistory[]> {
  const sql = await getSql();
  // meta_json carries the timeout bookkeeping (`router.timedOut`), and it is a text column, so the
  // JSON operator needs a ::jsonb cast — the same one `routerStatus` had to add.
  const rows = await sql<{
    provider: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_cents: number;
    duration_ms: number;
    success: boolean;
    timed_out: boolean | null;
  }>`
    select provider, model, prompt_tokens, completion_tokens, cost_cents, duration_ms, success,
      (nullif(meta_json, '')::jsonb -> 'router' ->> 'timedOut')::boolean as timed_out
    from model_cost_logs
    where task_type = ${task}
      and (${orgId ?? null}::text is null or org_id = ${orgId ?? null})
      and created_at >= now() - (${HISTORY_WINDOW_DAYS} * interval '1 day')
    order by created_at desc
    limit ${HISTORY_ROW_LIMIT}`;

  const byArm = new Map<string, typeof rows>();
  for (const r of rows) {
    const id = armIdFor(r.provider, r.model);
    const bucket = byArm.get(id);
    if (bucket) bucket.push(r);
    else byArm.set(id, [r]);
  }

  const out: ArmHistory[] = [];
  for (const [armId, list] of byArm) {
    const served = list.filter((r) => r.success);
    // Cost and latency describe what a *served* call felt like; failures only speak to reliability.
    const costedServed = served.filter((r) => r.cost_cents > 0);
    // We killed these, they did not fail. They must not count against reliability — but their
    // elapsed time is the only evidence of how slow the arm really is, so it is kept for that.
    const killed = list.filter((r) => !r.success && r.timed_out);
    const judged = list.filter((r) => !r.timed_out);
    out.push({
      armId,
      task,
      samples: list.length,
      avgPromptTokens: mean(served.map((r) => Number(r.prompt_tokens ?? 0))),
      avgCompletionTokens: mean(served.map((r) => Number(r.completion_tokens ?? 0))),
      avgCostCents: costedServed.length ? mean(costedServed.map((r) => Number(r.cost_cents))) : 0,
      p50DurationMs: median(served.map((r) => Number(r.duration_ms ?? 0))),
      successRate: judged.length ? judged.filter((r) => r.success).length / judged.length : 1,
      abortedSamples: killed.length,
      abortedElapsedMaxMs: killed.length
        ? Math.max(...killed.map((r) => Number(r.duration_ms ?? 0)))
        : 0,
    });
  }
  return out;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Harness verdicts the router may still trust, as `{ task, engine }` pairs.
 *
 * The engine is part of the verdict, not a detail of it: a pass recorded while the deterministic
 * local arm was measured says nothing about whether a 3B model agrees with the human labels, so
 * unlocking the whole task from any row would let the weakest arm serve `rank` on the strength of
 * the strongest arm's result. The harness records `engine`, i.e. the provider, so arms that share a
 * provider share its verdict — narrower than before, and as fine-grained as the eval data goes.
 */
export async function passedGates(): Promise<GatePass[]> {
  const sql = await getSql();
  const rows = await sql<{ task_type: string; engine: string }>`
    select distinct on (task_type, engine) task_type, engine
    from router_model_gates
    where passed
      and created_at >= now() - (${GATE_VALID_DAYS} * interval '1 day')
    order by task_type, engine, created_at desc`;
  const known: Set<string> = new Set(MODEL_ARMS.flatMap((a) => a.tasks ?? []));
  return rows
    .filter((r) => known.has(r.task_type))
    .map((r) => ({ task: r.task_type as ModelTaskType, engine: r.engine }));
}

/** Rupees this org has already spent today — the input to the daily budget cap. */
export async function orgSpendTodayInr(orgId?: string | null): Promise<number> {
  if (!orgId) return 0;
  const sql = await getSql();
  const rows = await sql<{ spent_cents: number | null }>`
    select sum(cost_cents)::float as spent_cents
    from model_cost_logs
    where org_id = ${orgId}
      and success
      and created_at >= date_trunc('day', now())`;
  return centsToInr(Number(rows[0]?.spent_cents ?? 0));
}

/** `ROUTER_DAILY_BUDGET_INR`; 0 (or unset) means no cap. */
export function routerDailyBudgetInr(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number.parseFloat(env.ROUTER_DAILY_BUDGET_INR ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

const HOST_PROBE_MS = 60_000;
const hostProbe = globalThis as typeof globalThis & {
  __vettaOllamaUp__?: { at: number; up: boolean };
};

/**
 * History and gates are beliefs about the deployment, not facts about this call: a 200-application
 * burst asks the same two questions 200 times inside a second, and PGLite serialises every read
 * behind one connection, so during bulk work an uncached read costs roughly `parallelism ×` its
 * measured time. One second is shorter than the interval over which either belief moves.
 *
 * The spend read is deliberately NOT cached — it is the one input a single call can move, and the
 * daily budget cap is worth the round-trip. `routerStatus` (the desk) reads through too, so what a
 * recruiter sees is never a second stale on purpose.
 */
const BELIEF_TTL_MS = 1_000;
const beliefCache = new Map<string, { at: number; value: readonly unknown[] }>();

async function belief<T extends readonly unknown[]>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = beliefCache.get(key);
  if (hit && Date.now() - hit.at < BELIEF_TTL_MS) return hit.value as T;
  const value = await load();
  beliefCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Forget the cached beliefs. A caller that has just *written* history — the live-arms benchmark,
 * which measures an arm and then wants to see the clock that measurement produces — must not route
 * on the pre-measurement window.
 */
export function clearRouterBeliefs() {
  beliefCache.clear();
}

/**
 * Ollama is keyless but needs a listening server, and `decideRoute` is synchronous, so the arm
 * probe reads this cached verdict. A cold cache reads as down, which only ever costs a free arm
 * one turn — `planRoute` refreshes the probe before deciding.
 */
function ollamaHostCached(): boolean {
  const cached = hostProbe.__vettaOllamaUp__;
  return Boolean(cached && Date.now() - cached.at < HOST_PROBE_MS && cached.up);
}

/**
 * Whether a local Ollama server answers. Exported for the live-arms benchmark, which has to know
 * before it spends a minute on a keyless arm that is not actually running.
 */
export async function ollamaHostUp(): Promise<boolean> {
  const cached = hostProbe.__vettaOllamaUp__;
  if (cached && Date.now() - cached.at < HOST_PROBE_MS) return cached.up;
  const base =
    process.env.OLLAMA_HOST?.trim() ||
    process.env.OLLAMA_BASE_URL?.trim() ||
    "http://127.0.0.1:11434";
  let up = false;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(1_200),
    });
    up = res.ok;
  } catch {
    up = false;
  }
  hostProbe.__vettaOllamaUp__ = { at: Date.now(), up };
  return up;
}

export type PlanRouteArgs = {
  task: ModelTaskType;
  promptText: string;
  requestedMaxTokens: number;
  orgId?: string | null;
  /** Only for an explicit, user-initiated max-quality call. */
  allowOwnerQuota?: boolean;
  /** Skip the ledger reads (burst warm-up, tests). */
  cold?: boolean;
  /** Whose patience the call is buying; decides the ceiling on one attempt. */
  context?: CallContext;
  /** Total tolerance for an answer. When set, arms that cannot fit it are excluded. */
  deadlineMs?: number;
  /** Floor on one attempt; defaults to the 14 s the whole system used to be pinned to. */
  minAttemptTimeoutMs?: number;
};

/**
 * Everything the router needs that is not in the request: real history, the harness gate, the
 * org's remaining budget, live circuit state and whether the local host is up.
 */
export async function planRoute(args: PlanRouteArgs): Promise<RouteDecision> {
  const { providerCircuitOpen } = await import("./providers.server.ts");
  const budget = routerDailyBudgetInr();

  // Refresh the host verdict first (cached a minute), because `decideRoute` can only read it sync.
  if (!args.cold) await ollamaHostUp();

  const [history, gates, spent] = await Promise.all([
    args.cold
      ? Promise.resolve([] as ArmHistory[])
      : belief(`history:${args.task}:${args.orgId ?? "global"}`, () =>
          routerHistory(args.task, args.orgId),
        ),
    args.cold ? Promise.resolve([] as GatePass[]) : belief("gates", passedGates),
    budget > 0 ? orgSpendTodayInr(args.orgId) : Promise.resolve(0),
  ]).catch(() => [[], [], 0] as [ArmHistory[], GatePass[], number]);

  const input: RouteInput = {
    task: args.task,
    promptText: args.promptText,
    requestedMaxTokens: args.requestedMaxTokens,
    isProviderOpen: (provider) => !providerCircuitOpen(provider),
    isHostAvailable: (arm: ModelCandidate) => arm.provider !== "ollama" || ollamaHostCached(),
    history,
    gates,
    dailyBudgetInr: budget,
    spendTodayInr: spent,
    allowOwnerQuota: args.allowOwnerQuota,
    context: args.context,
    deadlineMs: args.deadlineMs,
    minAttemptTimeoutMs: args.minAttemptTimeoutMs,
  };
  return decideRoute(input);
}

/**
 * What the desk shows under "Model routing": the budget, the harness gates and — per arm — whether
 * it could be chosen right now and what it actually did today. Read-only; no route is decided here.
 */
export type RouterStatus = {
  budgetInr: number;
  spendTodayInr: number;
  /** null when `ROUTER_DAILY_BUDGET_INR` is unset, i.e. no cap. */
  remainingInr: number | null;
  /** Which engine has a passing harness verdict for which task — the gate is per arm, not per task. */
  gates: GatePass[];
  ollamaUp: boolean;
  callsToday: number;
  degradedToday: number;
  arms: Array<{
    armId: string;
    provider: string;
    model: string;
    kind: string;
    free: boolean;
    eligible: boolean;
    whyNot: string | null;
    callsToday: number;
    costTodayInr: number;
    avgLatencyMs: number;
  }>;
};

export async function routerStatus(orgId?: string | null): Promise<RouterStatus> {
  const sql = await getSql();
  const { providerCircuitOpen } = await import("./providers.server.ts");
  const [gates, spent] = await Promise.all([
    passedGates().catch(() => [] as GatePass[]),
    orgSpendTodayInr(orgId).catch(() => 0),
  ]);
  const budget = routerDailyBudgetInr();

  // meta_json is a text column, so the JSON operators need the ::jsonb cast; without it
  // Postgres rejects the query with "operator does not exist: text -> unknown".
  const rows = await sql<{
    provider: string;
    model: string;
    calls: number;
    cents: number;
    avg_ms: number | null;
    degraded: number;
  }>`
    select provider, model,
      count(*)::int as calls,
      coalesce(sum(cost_cents), 0)::float as cents,
      avg(duration_ms)::float as avg_ms,
      count(*) filter (where meta_json::jsonb -> 'router' ->> 'degraded' = 'true')::int as degraded
    from model_cost_logs
    where success
      and created_at >= date_trunc('day', now())
      and (${orgId ?? null}::text is null or org_id = ${orgId ?? null})
    group by provider, model`;

  const byArm = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const id = armIdFor(r.provider, r.model);
    const prev = byArm.get(id);
    if (!prev || r.calls > prev.calls) byArm.set(id, r);
  }

  const ollamaUp = await ollamaHostUp();
  const arms = MODEL_ARMS.map((arm) => {
    const missingKey = arm.envKeys.filter((k) => !process.env[k]?.trim());
    const open = providerCircuitOpen(arm.provider);
    const hostDown = arm.requiresHost && !ollamaUp;
    const stat = byArm.get(arm.id);
    return {
      armId: arm.id,
      provider: arm.provider,
      model: armModel(arm),
      kind: arm.kind,
      free: arm.isFree,
      eligible: missingKey.length === 0 && !open && !hostDown,
      whyNot:
        missingKey.length > 0
          ? `${missingKey.join(", ")} not set`
          : open
            ? "circuit open"
            : hostDown
              ? "Ollama host unreachable"
              : null,
      callsToday: stat?.calls ?? 0,
      costTodayInr: stat ? centsToInr(stat.cents) : 0,
      avgLatencyMs: Math.round(stat?.avg_ms ?? 0),
    };
  });

  return {
    budgetInr: budget,
    spendTodayInr: spent,
    remainingInr: budget > 0 ? Math.max(0, budget - spent) : null,
    gates,
    ollamaUp,
    callsToday: arms.reduce((n, a) => n + a.callsToday, 0),
    degradedToday: rows.reduce((n, r) => n + r.degraded, 0),
    arms,
  };
}
/**
 * Remember a harness verdict so the router can trust a cheap arm on a critical task.
 * Written by `runEval`; read by `passedGates`.
 */
export async function recordRouterGates(args: {
  task: ModelTaskType;
  engines: string[];
  evalRunId?: string | null;
  passed: boolean;
  reason?: string;
  agreementPct?: number | null;
  falseShortlistRate?: number | null;
}): Promise<void> {
  const sql = await getSql();
  const engines = Array.from(new Set(args.engines.filter(Boolean)));
  if (engines.length === 0) return;
  for (const engine of engines) {
    await sql`
      insert into router_model_gates (
        id, task_type, engine, eval_run_id, agreement_pct, false_shortlist_rate, passed, reason
      ) values (
        ${crypto.randomUUID()}, ${args.task}, ${engine}, ${args.evalRunId ?? null},
        ${args.agreementPct ?? null}, ${args.falseShortlistRate ?? null}, ${args.passed}, ${args.reason ?? ""}
      )`;
  }
}
