/**
 * Per-task model router.
 *
 * The ladder in `providers.server.ts` picks "whichever provider answered first". This module
 * picks "the arm that does this task for the fewest tokens, the least money and the least
 * time" — from a declared candidate set, using static priors plus the real history in
 * `model_cost_logs`. A cold router (no history yet) falls back to the priors alone, so it
 * still makes a defensible choice on the very first call.
 *
 * Deliberately pure: no DB, no network, no `process.env` reads at module scope. Everything
 * environmental arrives as an argument, so the scoring is unit-testable and a route decision
 * can be replayed from the inputs that produced it.
 */

import { predictCostUsd, USD_TO_INR_RATE } from "../observability/cost.ts";
import type { ModelTaskType } from "../observability/types.ts";
import {
  DEFAULT_MIN_ATTEMPT_TIMEOUT_MS,
  MODEL_ARMS,
  armFeasibleOutputTokens,
  armHasKey,
  armLatencyPriorMs,
  armModel,
  contextHardMaxMs,
  getTaskProfile,
  type CallContext,
  type ModelCandidate,
} from "./model-registry.ts";

/** One arm's realised performance for one task, aggregated from `model_cost_logs`. */
export type ArmHistory = {
  armId: string;
  task: ModelTaskType;
  samples: number;
  /** Mean prompt + completion tokens actually used. */
  avgPromptTokens: number;
  avgCompletionTokens: number;
  /** Mean served cost, in cents. */
  avgCostCents: number;
  /** Median served latency, in ms. */
  p50DurationMs: number;
  /** Served / attempted, 0..1. Open circuits rarely appear here at all. */
  successRate: number;
  /**
   * Longest elapsed time seen on an *aborted* attempt, ms. A call that was killed never reports
   * a duration, so without this a slow arm's p50 is computed only from the fraction that
   * finished — it looks fast and unreliable, and the timeout that caused it is invisible.
   */
  abortedElapsedMaxMs?: number;
  /** How many attempts were aborted rather than answered. */
  abortedSamples?: number;
};

/**
 * A harness verdict for one engine on one task — the unit the risk gate reads.
 * `engine` is the provider name as the cost ledger records it (`local`, `groq`, `ollama`, ...),
 * because that is what a rank row and an eval row both carry; arm ids are a registry detail.
 */
export type GatePass = { task: ModelTaskType; engine: string };

export type RejectReason =
  | "task_not_declared"
  | "context_too_small"
  | "no_key"
  | "host_unavailable"
  | "circuit_open"
  | "json_reliability"
  | "risk_gate"
  | "owner_quota"
  | "budget"
  | "deadline";

export type RejectedArm = { armId: string; reason: RejectReason };

/**
 * What the caller's clock says about one arm, before and after the work is trimmed to fit.
 * Surfaced so the desk can explain a slow arm's absence as arithmetic rather than as a failure.
 */
export type ArmBudget = {
  armId: string;
  /** Token-aware wall-clock estimate at the requested answer size. */
  priorMs: number;
  /** Answer tokens this arm can emit within the deadline; -1 when it cannot even start. */
  feasibleOutputTokens: number;
  /** The answer size handed to this arm: the profile ceiling, trimmed to what fits. */
  outputTokensFit: number;
  /** Estimate after trimming the answer — the number the deadline is actually judged against. */
  fitMs: number;
  /** True when the arm was excluded because the clock, not capability, ruled it out. */
  tooSlow: boolean;
};

export type RouteDecision = {
  task: ModelTaskType;
  /** The arm to call, or null when nothing is eligible (the caller must fall back). */
  chosen: ModelCandidate | null;
  /** Model name actually sent (after `<PROVIDER>_MODEL`). */
  model: string;
  /** maxTokens to send — the task profile's ceiling, clamped to what was requested. */
  maxTokens: number;
  /**
   * maxTokens trimmed further so the chosen arm can still answer inside the caller's deadline.
   * Equal to `maxTokens` when the clock is not the binding constraint.
   */
  suggestedMaxTokens: number;
  /**
   * How long one attempt at the chosen arm is allowed to take. Derived from that arm's own
   * expectation, floored at the historical 14 s so a median-based estimate never becomes a coin
   * flip, and capped by the caller's tolerance. This is the number the runner must use instead of
   * a per-callsite constant.
   */
  timeoutMs: number;
  /** The per-attempt floor applied above — the old 14 s, now a floor rather than the rule. */
  minAttemptTimeoutMs: number;
  /** The caller's total tolerance for this call, after context bounds are applied. */
  deadlineMs: number;
  /** Whose patience this is, resolved from the input (default: `interactive`). */
  context: CallContext;
  /** Every arm the clock was computed for, slowest judgement first — empty when no deadline. */
  armBudgets: ArmBudget[];
  /** Tokens the router expects this call to consume. */
  expectedPromptTokens: number;
  expectedCompletionTokens: number;
  /** Predicted served cost. */
  estimatedCostCents: number;
  estimatedCostInr: number;
  /** Every eligible arm, best score first, with its score. */
  ranked: Array<{ armId: string; score: number; costCents: number; expectedMs: number }>;
  rejected: RejectedArm[];
  /** True when the router gave up quality or the top pick to stay in budget / behind a gate. */
  degraded: boolean;
  degradeReason?: string;
  /** Human-readable one-liner for the desk and `meta_json.router.reasons`. */
  reasons: string[];
};

/** The compact, ledger-shaped form of a decision, stored at `meta_json.router`. */
export type RouteTelemetry = {
  arm: string | null;
  kind: string | null;
  model: string;
  maxTokens: number;
  /** What the runner was actually allowed to wait, and whose tolerance set it. */
  timeoutMs: number;
  deadlineMs: number;
  context: CallContext;
  estimatedCostCents: number;
  estimatedCostInr: number;
  ranked: RouteDecision["ranked"];
  rejected: RejectedArm[];
  degraded: boolean;
  degradeReason: string | null;
  reasons: string[];
  attempts: number;
  /**
   * The last attempt was killed by our own clock. Such a row is evidence about the *deadline*,
   * not about the arm, so the reliability history and the error-rate alert both set it aside —
   * otherwise the timeout we choose writes the record that decides the next timeout.
   */
  timedOut: boolean;
};

/**
 * What the desk reads to answer "why this model". Failed arms are described here rather than
 * written as extra `success = false` ledger rows, because that column feeds the dashboard error
 * rate and the `high_error_rate` alert — a rejected candidate is neither an error nor a spend.
 */
export function routeTelemetry(
  route: RouteDecision,
  attempts: number,
  observed?: { timedOut?: boolean },
): RouteTelemetry {
  return {
    arm: route.chosen?.id ?? null,
    kind: route.chosen?.kind ?? null,
    model: route.model,
    maxTokens: route.maxTokens,
    timeoutMs: route.timeoutMs,
    deadlineMs: route.deadlineMs,
    context: route.context,
    estimatedCostCents: route.estimatedCostCents,
    estimatedCostInr: Math.round(route.estimatedCostInr * 10000) / 10000,
    ranked: route.ranked,
    rejected: route.rejected,
    degraded: route.degraded,
    degradeReason: route.degradeReason ?? null,
    reasons: route.reasons,
    attempts,
    timedOut: observed?.timedOut ?? false,
  };
}

export type RouteInput = {
  task: ModelTaskType;
  /** The prompt about to be sent, so token estimates match the real call. */
  promptText: string;
  /** maxTokens the caller asked for; the profile may lower it, never raise it. */
  requestedMaxTokens: number;
  env?: Record<string, string | undefined>;
  /** Circuit breaker probe — false means "do not send to this provider right now". */
  isProviderOpen?: (provider: string) => boolean;
  /** Reachability for arms that need a local server (Ollama). */
  isHostAvailable?: (arm: ModelCandidate) => boolean;
  /** Realised performance rows, newest window. Missing rows use the registry priors. */
  history?: ArmHistory[];
  /**
   * Harness verdicts: which *engine* was measured agreeing with the human labels for which task.
   * A pass belongs to an arm, not to a task — a gate that local code passed says nothing about
   * whether a 3B model on a laptop CPU agrees with anyone.
   */
  gates?: GatePass[];
  /** Rupees already spent by this org today, from `model_cost_logs`. */
  spendTodayInr?: number;
  /** Daily cap in rupees; 0 or undefined means no cap. */
  dailyBudgetInr?: number;
  /** Let arms that bill the app owner's quota compete. Off by default — never true in a burst. */
  allowOwnerQuota?: boolean;
  /**
   * Whose patience this call is buying. Sets the ceiling on a single attempt and, with
   * `deadlineMs`, decides which arms are too slow to be offered the task at all.
   */
  context?: CallContext;
  /**
   * How long the caller is willing to wait for an answer, in total. When absent the deadline
   * filter stays off and every arm is scored as before — so existing callers are unaffected until
   * they opt in, and the ones that do get a timeout that matches the model they were routed to.
   */
  deadlineMs?: number;
  /** Floor on one attempt. Defaults to the 14 s the whole system used to be hard-coded to. */
  minAttemptTimeoutMs?: number;
  /** Restrict the candidate set (used by tests and by pinned-arm debugging). */
  arms?: ModelCandidate[];
};

// Capability is decided by *eligibility* (declared tasks, JSON reliability, the risk gate), not
// by these weights: anything still competing here can already do the job, so what separates the
// candidates is money and time. Cost leads, but a 20x latency gap must be able to outweigh a
// rounding-error saving — in a 200-resume burst, seconds multiply and fractions of a rupee don't.
const WEIGHT_COST = 0.45;
const WEIGHT_LATENCY = 0.35;
const WEIGHT_RELIABILITY = 0.2;

/** How much quality a critical task may give up when its gate has NOT passed. */
const CRITICAL_QUALITY_TOLERANCE = 0.1;

/** ~3.8 chars per token, matching `estimateTokensFromText` in the cost ledger. */
function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 3.8));
}

function historyFor(
  history: ArmHistory[],
  armId: string,
  task: ModelTaskType,
): ArmHistory | undefined {
  return history.find((h) => h.armId === armId && h.task === task && h.samples > 0);
}

/** Cost the router expects, in cents: history if known, else the profile's token shape. */
function expectedCostCents(
  arm: ModelCandidate,
  promptTokens: number,
  completionTokens: number,
  env: Record<string, string | undefined>,
): number {
  return (
    predictCostUsd({
      model: armModel(arm, env),
      provider: arm.provider,
      promptTokens,
      completionTokens,
    }) * 100
  );
}

/**
 * Saturating ratio against an absolute target: 0 at free/instant, 0.5 exactly on target, and
 * approaching 1 far over it. Scoring against the task's own target rather than the best arm in
 * the set is what keeps a ₹0.012 saving from looking as decisive as a 10x speed gap.
 */
function normAgainst(value: number, target: number): number {
  if (value <= 0) return 0;
  const t = target > 0 ? target : 1;
  return value / (value + t);
}

/**
 * How much longer than its own expectation one attempt is given. 1.4 covers the half of calls that
 * legitimately exceed a median plus one cold connection, without letting a stalled local inference
 * hold the process for minutes.
 */
const LATENCY_HEADROOM = 1.4;

/** Aborted samples needed before a killed call's elapsed time is trusted over the declared prior. */
const ABORT_SHRINKAGE = 5;

/**
 * The arm's own expectation for a call like this one.
 *
 * Realised p50 when there is history, else the declared speed class — and never below the longest
 * *aborted* attempt. That last clause is what stops a timeout from hiding itself: a call we killed
 * reports no duration, so plain p50 would score a laptop-CPU arm on the strength of its luckiest
 * handful of runs and then blame its error rate for the rest.
 */
function expectedLatencyMs(arm: ModelCandidate, h: ArmHistory | undefined): number {
  const served = h?.p50DurationMs && h.p50DurationMs > 0 ? h.p50DurationMs : arm.speedClassMs;
  const aborted = h?.abortedElapsedMaxMs ?? 0;
  if (aborted <= served) return served;
  const samples = h?.abortedSamples ?? 0;
  const w = samples / (samples + ABORT_SHRINKAGE);
  return Math.round(served + w * (aborted - served));
}

/**
 * Clamp into the attempt's window. When the caller's tolerance is below the floor the ceiling
 * wins, because a deadline the system blew through is worse than a retry that never happened.
 */
function clampAttemptTimeoutMs(value: number, floor: number, ceiling: number): number {
  return Math.max(1, Math.min(ceiling, Math.max(floor, value)));
}

/**
 * Whether this arm can physically emit `completionTokens` inside the caller's clock.
 *
 * This is deliberately NOT the number the arms are scored with. Scoring asks "what does this arm
 * feel like for a task of this shape" — measured p50, else the declared speed class — and a
 * measured figure from one arm must stay comparable with a declared figure from another. Feasibility
 * asks a physical question instead: tokens divided by this arm's tokens-per-second, plus the time
 * the prompt takes to read. A 9 s speed class and a 375 s decode both coexist in those two answers,
 * and only the second one can promise an answer inside 16 s.
 */
function armFeasibilityMs(
  arm: ModelCandidate,
  h: ArmHistory | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  // A call we killed is evidence the arm is slower than its declared class, so it raises the floor.
  return Math.max(
    armLatencyPriorMs(arm, promptTokens, completionTokens),
    h?.abortedElapsedMaxMs ?? 0,
  );
}

/**
 * Choose the best arm for one task.
 *
 * Filters run before scoring, so an ineligible arm never competes: a cheap arm that cannot
 * hold the prompt, has no key, sits behind an open circuit or cannot emit parseable JSON is
 * rejected outright rather than scored down.
 */
export function decideRoute(input: RouteInput): RouteDecision {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const profile = getTaskProfile(input.task);
  const allArms = input.arms ?? MODEL_ARMS;
  const history = input.history ?? [];
  const gates = input.gates ?? [];
  const isProviderOpen = input.isProviderOpen ?? (() => true);
  const isHostAvailable = input.isHostAvailable ?? (() => true);

  const clippedPrompt = input.promptText.slice(0, profile.inputClipChars);
  const maxTokens = Math.min(input.requestedMaxTokens, profile.outputCeiling);
  const promptTokens = estimateTokens(clippedPrompt);

  // ---- the caller's clock --------------------------------------------------------------------
  // Two different questions, deliberately kept apart: *how long will this arm take* is a property
  // of the model, and *how long may it take* is a property of who is waiting. Only the first one
  // is per-arm, which is why one constant at every call site could never have been right.
  const context = input.context ?? "interactive";
  const hardMaxMs = contextHardMaxMs(context, env);
  const minAttemptTimeoutMs = Math.max(
    1,
    input.minAttemptTimeoutMs ?? DEFAULT_MIN_ATTEMPT_TIMEOUT_MS,
  );
  const deadlineMs =
    input.deadlineMs && input.deadlineMs > 0 ? Math.min(input.deadlineMs, hardMaxMs) : hardMaxMs;
  // Arms are excluded for being too slow only once a caller states a deadline, so every existing
  // call site keeps its current candidate set until it opts in.
  const enforceDeadline = Boolean(input.deadlineMs && input.deadlineMs > 0);

  const rejected: RejectedArm[] = [];
  const eligible: ModelCandidate[] = [];
  const budgets = new Map<string, ArmBudget>();

  /** What the clock allows this arm to attempt, and whether that is still worth calling. */
  const budgetFor = (arm: ModelCandidate, h: ArmHistory | undefined): ArmBudget => {
    const priorMs = armFeasibilityMs(arm, h, promptTokens, maxTokens);
    // The trim always applies — asking an arm for more tokens than its clock can hold is never
    // right — but exclusion on the clock only does, so a caller that states no deadline keeps the
    // candidate set it has always had and simply gets a realistic answer size.
    const feasible = armFeasibleOutputTokens(arm, promptTokens, deadlineMs);
    const outputTokensFit = Math.max(
      0,
      Math.min(maxTokens, Number.isFinite(feasible) ? feasible : maxTokens),
    );
    const fitMs = armFeasibilityMs(arm, h, promptTokens, outputTokensFit);
    return {
      armId: arm.id,
      priorMs,
      feasibleOutputTokens: feasible,
      outputTokensFit,
      fitMs,
      tooSlow:
        enforceDeadline && (fitMs > deadlineMs || outputTokensFit < profile.minViableOutputTokens),
    };
  };

  for (const arm of allArms) {
    if (arm.tasks && !arm.tasks.includes(input.task)) {
      rejected.push({ armId: arm.id, reason: "task_not_declared" });
      continue;
    }
    if (promptTokens + Math.max(maxTokens, 1) > arm.contextWindowTokens) {
      rejected.push({ armId: arm.id, reason: "context_too_small" });
      continue;
    }
    if (!armHasKey(arm, env)) {
      rejected.push({ armId: arm.id, reason: "no_key" });
      continue;
    }
    if (arm.requiresHost && !isHostAvailable(arm)) {
      rejected.push({ armId: arm.id, reason: "host_unavailable" });
      continue;
    }
    if (arm.provider !== "local" && !isProviderOpen(arm.provider)) {
      rejected.push({ armId: arm.id, reason: "circuit_open" });
      continue;
    }
    // xAI bills the app owner's real quota here, so it is opt-in per call, never a bulk target.
    if (arm.spendsOwnerQuota && !input.allowOwnerQuota) {
      rejected.push({ armId: arm.id, reason: "owner_quota" });
      continue;
    }
    if (arm.jsonReliability < profile.minJsonReliability) {
      rejected.push({ armId: arm.id, reason: "json_reliability" });
      continue;
    }
    // Capacity last: an arm that *cannot* do the job should never be reported as merely slow.
    const budget = budgetFor(arm, historyFor(history, arm.id, input.task));
    if (enforceDeadline) budgets.set(arm.id, budget);
    if (budget.tooSlow) {
      rejected.push({ armId: arm.id, reason: "deadline" });
      continue;
    }
    eligible.push(arm);
  }

  const reasons: string[] = [];
  let degraded = false;
  let degradeReason: string | undefined;

  // A slow arm excluded on the clock is a routing choice, not an error: no call was made, so no
  // ledger row exists and no circuit was tripped. Say so in the decision, because nothing else will.
  if (enforceDeadline && budgets.size > 0) {
    const excluded = [...budgets.values()].filter((b) => b.tooSlow);
    if (excluded.length > 0) {
      reasons.push(
        `deadline ${deadlineMs}ms (${context}): ${excluded
          .map((b) => `${b.armId} needs ~${Math.round(b.priorMs / 1000)}s for this answer`)
          .join(", ")} skipped`,
      );
    }
  }

  // ---- risk gate ---------------------------------------------------------------------------
  // A `critical` task decides a candidate's fate. Arms near the best quality are the reference the
  // harness compares against, so they never need proving; anything below the floor competes only
  // with a verdict of its own. Scoping the verdict to the engine is the whole point: a pass
  // recorded when `local:evidence` was measured says nothing about a 3B model on a laptop CPU, and
  // treating it as a task-wide unlock let the weakest arm serve the most consequential call.
  let candidates = eligible;
  if (profile.risk === "critical" && eligible.length > 0) {
    const bestQuality = Math.max(...eligible.map((a) => a.qualityPrior));
    const floor = bestQuality - CRITICAL_QUALITY_TOLERANCE;
    const passedEngines = new Set(gates.filter((g) => g.task === input.task).map((g) => g.engine));
    const proven = (a: ModelCandidate) => a.qualityPrior >= floor || passedEngines.has(a.provider);
    const allowed = eligible.filter(proven);

    // Say what the verdict bought, separately from what the floor still refuses: both can be true
    // at once, and a desk that only showed the second would hide why a free arm is being used.
    const admitted = eligible.filter(
      (a) => a.qualityPrior < floor && passedEngines.has(a.provider),
    );
    if (admitted.length > 0) {
      reasons.push(
        `gate passed for ${input.task} via ${[...new Set(admitted.map((a) => a.provider))].join(", ")}: cost and speed may be traded for quality`,
      );
    }

    if (allowed.length > 0 && allowed.length < eligible.length) {
      const dropped = eligible.filter((a) => !allowed.includes(a));
      for (const a of dropped) rejected.push({ armId: a.id, reason: "risk_gate" });
      candidates = allowed;
      degraded = true;
      degradeReason = `risk gate: ${input.task} is critical and unproven for ${dropped.length} arm(s), quality floor ${floor}`;
      reasons.push(
        `risk gate held ${input.task} to ${allowed.length} arm(s); ${dropped.length} cheaper arm(s) need their own harness pass`,
      );
    }
  }

  // ---- budget cap --------------------------------------------------------------------------
  const cap = Math.max(0, input.dailyBudgetInr ?? 0);
  const spent = Math.max(0, input.spendTodayInr ?? 0);
  if (cap > 0) {
    const remaining = Math.max(0, cap - spent);
    const priced = candidates.map((arm) => {
      const h = historyFor(history, arm.id, input.task);
      return {
        arm,
        inr:
          expectedCostCents(
            arm,
            h?.avgPromptTokens ?? promptTokens,
            h?.avgCompletionTokens ?? maxTokens,
            env,
          ) *
          0.01 *
          USD_TO_INR_RATE,
      };
    });
    const affordable = priced.filter((p) => p.inr <= remaining || p.arm.isFree);
    if (affordable.length === 0) {
      // Free arms only. Local never bills tokens, so it is always the floor.
      const freeOnly = candidates.filter((a) => a.isFree);
      if (freeOnly.length > 0) {
        for (const p of priced)
          if (!p.arm.isFree) rejected.push({ armId: p.arm.id, reason: "budget" });
        candidates = freeOnly;
        degraded = true;
        degradeReason = `daily budget ₹${remaining.toFixed(2)} left; degraded to a free arm`;
        reasons.push(
          `budget: ₹${remaining.toFixed(2)} of ₹${cap.toFixed(2)} left, paid arms skipped`,
        );
      } else {
        candidates = [];
        degraded = true;
        degradeReason = `daily budget ₹${remaining.toFixed(2)} exhausted and no free arm is eligible`;
        reasons.push(`budget exhausted and nothing free can serve ${input.task}`);
      }
    } else {
      const skipped = priced.filter((p) => !affordable.includes(p));
      for (const p of skipped) rejected.push({ armId: p.arm.id, reason: "budget" });
      if (skipped.length > 0) {
        candidates = affordable.map((p) => p.arm);
        degraded = true;
        degradeReason = `daily budget: ${skipped.length} arm(s) priced above ₹${remaining.toFixed(2)} remaining`;
        reasons.push(
          `budget: skipped ${skipped.map((p) => p.arm.id).join(", ")} over ₹${remaining.toFixed(2)} remaining`,
        );
      }
    }
  }

  if (candidates.length === 0) {
    return {
      task: input.task,
      chosen: null,
      model: "",
      maxTokens,
      suggestedMaxTokens: maxTokens,
      // Nothing was selected, so no attempt is being budgeted; the floor keeps the shape honest
      // for any caller that reads this field before checking `chosen`.
      timeoutMs: minAttemptTimeoutMs,
      minAttemptTimeoutMs,
      deadlineMs,
      context,
      armBudgets: [...budgets.values()],
      expectedPromptTokens: promptTokens,
      expectedCompletionTokens: maxTokens,
      estimatedCostCents: 0,
      estimatedCostInr: 0,
      ranked: [],
      rejected,
      degraded: true,
      degradeReason: degradeReason ?? `no arm eligible for ${input.task}`,
      reasons: [...reasons, `no eligible arm for ${input.task}`],
    };
  }

  // ---- scoring -----------------------------------------------------------------------------
  // Cost and latency are scored against the task's own targets, not against each other, so the
  // result does not depend on which other arms happen to be eligible. History, when present,
  // replaces the priors — a provider that is really slower or dearer than advertised gets routed
  // around by its own recorded numbers.
  const rows = candidates.map((arm) => {
    const h = historyFor(history, arm.id, input.task);
    const armPromptTokens = h?.avgPromptTokens ?? promptTokens;
    const armCompletionTokens = h?.avgCompletionTokens ?? maxTokens;
    const costCents =
      h && h.avgCostCents > 0
        ? h.avgCostCents
        : expectedCostCents(arm, armPromptTokens, armCompletionTokens, env);
    // Scored on what the arm *feels* like (measured p50, else its declared class) — never on the
    // feasibility figure, which is a per-answer-size physical bound, not a ranking input.
    const expectedMs = expectedLatencyMs(arm, h);
    const successRate = h?.successRate ?? 1;
    return { arm, costCents, expectedMs, successRate, armPromptTokens, armCompletionTokens };
  });

  const scored = rows.map((r) => ({
    ...r,
    score:
      WEIGHT_COST * normAgainst(r.costCents, profile.targetCostCents) +
      WEIGHT_LATENCY * normAgainst(r.expectedMs, profile.targetLatencyMs) +
      WEIGHT_RELIABILITY * (1 - r.successRate),
  }));

  // Free beats paid, then cheaper, then declaration order — so ties never flip-flop between calls.
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-9) return a.score - b.score;
    if (a.arm.isFree !== b.arm.isFree) return a.arm.isFree ? -1 : 1;
    if (Math.abs(a.costCents - b.costCents) > 1e-9) return a.costCents - b.costCents;
    return allArms.indexOf(a.arm) - allArms.indexOf(b.arm);
  });

  const best = scored[0];
  const chosen = best.arm;

  // ---- the timeout is an output, not an input ------------------------------------------------
  // Headroom over what this arm can physically do at the answer size we are asking for, because a
  // median is exceeded by half of all calls and a cold arm's figure is a prior, not a measurement.
  // The floor is the 14 s the whole system used to be pinned to; the ceiling is the caller's clock.
  // Note this uses *feasibility*, not the scored `expectedMs`: asking a laptop CPU for 1500 tokens
  // and giving it 14 s because its speed class says 9 s is how every one of those calls died.
  const chosenBudget =
    budgets.get(chosen.id) ?? budgetFor(chosen, historyFor(history, chosen.id, input.task));
  const suggestedMaxTokens = Math.max(
    Math.min(maxTokens, chosenBudget.outputTokensFit),
    Math.min(maxTokens, profile.minViableOutputTokens),
  );
  const timeoutMs = clampAttemptTimeoutMs(
    Math.ceil(chosenBudget.fitMs * LATENCY_HEADROOM),
    minAttemptTimeoutMs,
    Math.min(deadlineMs, hardMaxMs),
  );
  if (suggestedMaxTokens < maxTokens) {
    reasons.push(
      `clock trimmed ${input.task} output ${maxTokens} -> ${suggestedMaxTokens} tokens so ${chosen.id} fits ${deadlineMs}ms`,
    );
  }

  return {
    task: input.task,
    chosen,
    model: armModel(chosen, env),
    maxTokens,
    suggestedMaxTokens,
    timeoutMs,
    minAttemptTimeoutMs,
    deadlineMs,
    context,
    armBudgets: [...budgets.values()],
    expectedPromptTokens: best.armPromptTokens,
    expectedCompletionTokens: best.armCompletionTokens,
    estimatedCostCents: best.costCents,
    estimatedCostInr: best.costCents * 0.01 * USD_TO_INR_RATE,
    ranked: scored.map((s) => ({
      armId: s.arm.id,
      score: Math.round(s.score * 10000) / 10000,
      costCents: Math.round(s.costCents * 10000) / 10000,
      expectedMs: Math.round(s.expectedMs),
    })),
    rejected,
    degraded,
    degradeReason,
    reasons: [
      ...reasons,
      `routed ${input.task} to ${chosen.id} (${chosen.kind}, ~${Math.round(best.costCents * 100) / 10000}c, ~${Math.round(best.expectedMs)}ms, ${timeoutMs}ms allowed)` +
        (chosen.isFree ? " — free" : ""),
    ],
  };
}
