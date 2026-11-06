/**
 * Router selection tests — pure, no DB and no network.
 *
 * Each test names the property the user's design depends on: the cheapest capable arm wins,
 * a critical task cannot go cheap before its harness gate passes, real cost history beats the
 * declared priors, and a blown budget degrades to a free arm instead of throwing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { decideRoute, routeTelemetry, type ArmHistory } from "./model-router.ts";
import { MODEL_ARMS, armLatencyPriorMs, type ModelCandidate } from "./model-registry.ts";

const arm = (over: Partial<ModelCandidate> & { id: string; provider: ModelCandidate["provider"] }): ModelCandidate => ({
  declaredModel: over.provider,
  kind: "paid",
  isFree: false,
  envKeys: [],
  requiresHost: false,
  contextWindowTokens: 131_072,
  jsonReliability: 0.9,
  speedClassMs: 1000,
  qualityPrior: 0.8,
  ...over,
});

const ALL_KEYS = {
  GROQ_API_KEY: "k",
  GEMINI_API_KEY: "k",
  OPENAI_API_KEY: "k",
  XAI_API_KEY: "k",
};

/** A rank-sized prompt: ~1.6k tokens after the registry's 3.8 chars/token estimate. */
const RANK_PROMPT = "r".repeat(6000);

const chosenId = (task: string, over: Record<string, unknown> = {}) =>
  decideRoute({
    task: task as never,
    promptText: RANK_PROMPT,
    requestedMaxTokens: 4000,
    env: ALL_KEYS,
    ...over,
  }).chosen?.id;

// --------------------------------------------------------------------------------------------
// 1. Cheapest-capable-wins
// --------------------------------------------------------------------------------------------

test("router: a low-stakes task goes to the free keyless arm, not a paid one", () => {
  const d = decideRoute({
    task: "follow_up",
    promptText: "candidate answered: 5 years at fintech",
    requestedMaxTokens: 800,
    env: ALL_KEYS,
  });
  assert.equal(d.chosen?.id, "local:evidence");
  assert.equal(d.estimatedCostCents, 0);
  assert.ok(d.reasons.some((r) => r.includes("free")));
  // An embedding model genuinely cannot write a follow-up question.
  assert.ok(d.rejected.some((r) => r.armId === "xenova:multilingual-e5-small" && r.reason === "task_not_declared"));
});

test("router: token shape comes from the task profile, never from the caller", () => {
  const d = decideRoute({
    task: "follow_up",
    promptText: "x".repeat(100_000),
    requestedMaxTokens: 99_999,
    env: ALL_KEYS,
  });
  // follow_up profile: outputCeiling 220, inputClipChars 1800.
  assert.equal(d.maxTokens, 220, "the profile caps, it never raises");
  assert.equal(d.expectedPromptTokens, Math.ceil(1800 / 3.8), "cost is estimated on the clipped prompt");
});

// --------------------------------------------------------------------------------------------
// 2. Risk gate
// --------------------------------------------------------------------------------------------

test("router: an ungated critical task keeps its quality floor", () => {
  const d = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
  });
  assert.notEqual(d.chosen?.id, "local:evidence");
  assert.ok(d.rejected.some((r) => r.armId === "local:evidence" && r.reason === "risk_gate"));
  assert.equal(d.degraded, true);
  assert.match(d.degradeReason ?? "", /risk gate/);
});

test("router: a harness gate that passed unlocks the arm it was measured on", () => {
  const d = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    gates: [{ task: "rank", engine: "local" }],
  });
  assert.equal(d.chosen?.id, "local:evidence");
  assert.ok(d.reasons.some((r) => r.includes("gate passed")));
});

test("router: a gate pass for one engine does not speak for another", () => {
  // The defect this replaces: `rank` is critical, a verdict was stored per *task*, and a pass
  // recorded while the deterministic local arm was measured used to unlock every cheap model for
  // the call that decides a candidate's fate. A Groq verdict says nothing about a 3B on CPU.
  const d = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    gates: [{ task: "rank", engine: "groq" }],
  });
  assert.ok(
    d.rejected.some((r) => r.armId === "local:evidence" && r.reason === "risk_gate"),
    "local:evidence has no verdict of its own, so the quality floor still holds it",
  );
  assert.notEqual(d.chosen?.id, "local:evidence");
});

test("router: a rubric is not drafted by an arm that cannot be trusted to parse one", () => {
  // The rubric defines every later score, and `local:evidence` cannot take this task at all — so
  // the floor has to come from JSON reliability. At 0.6 the free 3B CPU arm used to win outright,
  // which is the worst possible place to discover that a model cannot hold a schema.
  const d = decideRoute({
    task: "rubric_draft",
    promptText: "Draft a rubric for a Series B staff backend role. " + "j".repeat(3_000),
    requestedMaxTokens: 1_800,
    env: {},
    isHostAvailable: () => true,
  });
  assert.ok(
    d.rejected.some((r) => r.armId === "ollama:llama3.2:3b" && r.reason === "json_reliability"),
    "the 0.6-reliability arm must be refused, not scored down",
  );
  assert.notEqual(d.chosen?.id, "ollama:llama3.2:3b");
});

// --------------------------------------------------------------------------------------------
// 3. Eligibility
// --------------------------------------------------------------------------------------------

test("router: no credential means no cloud arm is even offered", () => {
  const d = decideRoute({
    task: "follow_up",
    promptText: "answer",
    requestedMaxTokens: 300,
    env: {},
  });
  const cloud = d.ranked.filter((r) => ["groq", "gemini", "openai", "xai"].includes(r.armId.split(":")[0]));
  assert.deepEqual(cloud, [], "only keyless arms may compete");
  assert.ok(d.chosen?.id.startsWith("local:") || d.chosen?.id.startsWith("ollama:"));
});

test("router: an open circuit removes that provider from the choice", () => {
  const withGroq = chosenId("rank", { requestedMaxTokens: 1500 });
  const withoutGroq = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    isProviderOpen: (provider) => provider !== "groq",
  });
  assert.ok(withoutGroq.rejected.some((r) => r.armId === "groq:openai/gpt-oss-20b" && r.reason === "circuit_open"));
  assert.equal(withoutGroq.chosen?.id, "openai:gpt-4o-mini");
  assert.notEqual(withoutGroq.chosen?.id, withGroq, "the breaker actually changes the route");
});

test("router: an arm too small for the clipped prompt is disqualified, not scored down", () => {
  const tiny = arm({
    id: "tiny:model",
    provider: "openai",
    kind: "free_tier",
    isFree: true,
    contextWindowTokens: 512,
    tasks: ["rank"],
  });
  const d = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    arms: [tiny, ...MODEL_ARMS],
  });
  assert.ok(d.rejected.some((r) => r.armId === "tiny:model" && r.reason === "context_too_small"));
  assert.ok(d.chosen && d.chosen.id !== "tiny:model");
});

test("registry: the embedding arm's window fits the domain_embed profile", () => {
  // A profile clipped past its only capable arm's context turns embeddings off with no error,
  // so the pairing is asserted rather than trusted.
  const d = decideRoute({
    task: "domain_embed",
    promptText: "e".repeat(20_000),
    requestedMaxTokens: 0,
    env: ALL_KEYS,
  });
  assert.equal(d.chosen?.id, "xenova:multilingual-e5-small");
});

test("router: the arm that bills the owner's quota is skipped unless this call opts in", () => {
  const off = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
  });
  assert.ok(off.rejected.some((r) => r.armId === "xai:grok-4.5" && r.reason === "owner_quota"));
  assert.ok(!off.ranked.some((r) => r.armId === "xai:grok-4.5"));

  const on = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    allowOwnerQuota: true,
  });
  assert.ok(on.ranked.some((r) => r.armId === "xai:grok-4.5"), "opt-in makes it compete");
  // Even when eligible it is the dearest and slowest arm, so cost + speed still rule.
  assert.notEqual(on.chosen?.id, "xai:grok-4.5");
});

// --------------------------------------------------------------------------------------------
// 4. History beats priors
// --------------------------------------------------------------------------------------------

test("router: real cost history overrides the declared priors", () => {
  const base = {
    task: "rank" as const,
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    // Groq is tripped, so the choice is between the priors of these two.
    isProviderOpen: (provider: string) => provider !== "groq",
  };
  const priors = decideRoute(base);
  assert.equal(priors.chosen?.id, "openai:gpt-4o-mini", "on priors, mini is cheaper");

  const flashHistory: ArmHistory = {
    armId: "gemini:gemini-2.5-flash",
    task: "rank",
    samples: 50,
    avgPromptTokens: 1600,
    avgCompletionTokens: 1500,
    // Measured: flash is much dearer and faster than its prior claims.
    avgCostCents: 0.05,
    p50DurationMs: 300,
    successRate: 1,
  };
  const withHistory = decideRoute({ ...base, history: [flashHistory] });
  assert.equal(withHistory.chosen?.id, "gemini:gemini-2.5-flash");
});

test("router: an arm that keeps failing is routed around", () => {
  const d = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    history: [
      {
        armId: "groq:openai/gpt-oss-20b",
        task: "rank",
        samples: 60,
        avgPromptTokens: 1600,
        avgCompletionTokens: 1500,
        avgCostCents: 0.2,
        p50DurationMs: 900,
        successRate: 0.4,
      },
    ],
  });
  assert.notEqual(d.chosen?.id, "groq:openai/gpt-oss-20b");
  assert.ok(d.chosen, "a different arm still serves the task");
});

// --------------------------------------------------------------------------------------------
// 5. Budget
// --------------------------------------------------------------------------------------------

test("router: a blown daily budget degrades a low-stakes task to a free arm", () => {
  const d = decideRoute({
    task: "follow_up",
    promptText: "answer",
    requestedMaxTokens: 300,
    env: ALL_KEYS,
    dailyBudgetInr: 200,
    spendTodayInr: 240,
  });
  assert.equal(d.chosen?.isFree, true);
  assert.equal(d.estimatedCostCents, 0);
  assert.equal(d.degraded, true);
  assert.match(d.degradeReason ?? "", /budget/);
});

test("router: a critical task with no budget left declines instead of dropping quality silently", () => {
  const d = decideRoute({
    task: "rank",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1500,
    env: ALL_KEYS,
    dailyBudgetInr: 1,
    spendTodayInr: 50,
  });
  assert.equal(d.chosen, null, "the caller must fall back and label provenance");
  assert.match(d.degradeReason ?? "", /budget/);
});

// --------------------------------------------------------------------------------------------
// 6. Determinism
// --------------------------------------------------------------------------------------------

test("router: the same inputs always produce the same route", () => {
  const inputs = {
    task: "evaluate" as const,
    promptText: RANK_PROMPT,
    requestedMaxTokens: 900,
    env: ALL_KEYS,
  };
  const first = decideRoute(inputs);
  for (let i = 0; i < 20; i += 1) {
    assert.deepEqual(decideRoute(inputs), first);
  }
});

test("router: ranked is score-ordered and the winner is never the dearest eligible arm", () => {
  for (const task of ["rank", "evaluate", "screen_generate", "follow_up", "client_card", "rubric_draft"] as const) {
    const d = decideRoute({
      task,
      promptText: RANK_PROMPT,
      requestedMaxTokens: 1500,
      env: ALL_KEYS,
      allowOwnerQuota: true,
      gates: (["rank", "evaluate"] as const).flatMap((task) =>
        Array.from(new Set(MODEL_ARMS.map((a) => a.provider))).map((engine) => ({ task, engine })),
      ),
    });
    const scores = d.ranked.map((r) => r.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => a - b), `${task}: ranked must be ascending`);
    assert.equal(d.ranked[0]?.armId, d.chosen?.id, `${task}: the top row is what gets called`);
    const dearest = Math.max(...d.ranked.map((r) => r.costCents));
    if (d.ranked.length > 1 && dearest > 0) {
      assert.ok(
        d.estimatedCostCents < dearest,
        `${task}: paid the most expensive eligible arm while a cheaper one could do the job`,
      );
    }
  }
});

test("router: cost and speed each move the choice on their own", () => {
  // Two arms that can both do the job, differing in exactly one dimension at a time, so a
  // passing route proves the score really minimises money and time rather than priors by luck.
  const freeArm = (speedClassMs: number) =>
    arm({ id: "ollama:cheap", provider: "ollama", kind: "keyless_local", isFree: true, requiresHost: true, speedClassMs });
  const paidArm = arm({
    id: "groq:paid",
    provider: "groq",
    declaredModel: "llama-3.1-8b-instant",
    envKeys: ["GROQ_API_KEY"],
    speedClassMs: 1_000,
  });
  const base = {
    task: "client_card" as const,
    promptText: "x".repeat(3000),
    requestedMaxTokens: 1000,
    env: ALL_KEYS,
  };

  const moneyOnly = decideRoute({ ...base, arms: [freeArm(1_000), paidArm] });
  assert.equal(moneyOnly.chosen?.id, "ollama:cheap", "same speed: the ₹0 arm wins");

  const speedOnly = decideRoute({ ...base, arms: [freeArm(20_000), paidArm] });
  assert.equal(speedOnly.chosen?.id, "groq:paid", "20x slower costs more time than it saves");
});

test("router: an arm that fails in reality loses even when it is free and fast", () => {
  const free = arm({ id: "ollama:cheap", provider: "ollama", kind: "keyless_local", isFree: true, speedClassMs: 600 });
  const paid = arm({
    id: "groq:paid",
    provider: "groq",
    declaredModel: "llama-3.1-8b-instant",
    envKeys: ["GROQ_API_KEY"],
    speedClassMs: 700,
  });
  const d = decideRoute({
    task: "client_card",
    promptText: "x".repeat(3000),
    requestedMaxTokens: 1000,
    env: ALL_KEYS,
    arms: [free, paid],
    history: [
      {
        armId: "ollama:cheap",
        task: "client_card",
        samples: 40,
        avgPromptTokens: 800,
        avgCompletionTokens: 1000,
        avgCostCents: 0,
        p50DurationMs: 600,
        successRate: 0.1,
      },
    ],
  });
  assert.equal(d.chosen?.id, "groq:paid", "a 90% failure rate is routed around");
});

// --------------------------------------------------------------------------------------------
// 6. The caller's clock — timeout derived from the arm, rejection derived from the deadline
// --------------------------------------------------------------------------------------------

/** A 14B model on a 4-core i5 with no GPU: 4 tok/s decode is the laptop case, not a pessimism. */
const cpuArm = arm({
  id: "ollama:cpu14b",
  provider: "ollama",
  kind: "keyless_local",
  isFree: true,
  speedClassMs: 9_000,
  decodeTokensPerSec: 4,
  prefillTokensPerSec: 2_000,
  callOverheadMs: 250,
});

/** A hosted arm: fast enough that the token maths never binds, so the floor is what shows. */
const hostedArm = arm({
  id: "groq:hosted",
  provider: "groq",
  declaredModel: "llama-3.1-8b-instant",
  envKeys: ["GROQ_API_KEY"],
  speedClassMs: 600,
});

const CLOCK_ARMS = [cpuArm, hostedArm];

/** screen_generate: 3000-char clip -> ~790 prompt tokens, 1400 output ceiling, 200 min viable. */
const clockRoute = (over: Record<string, unknown>) =>
  decideRoute({
    task: "screen_generate",
    promptText: RANK_PROMPT,
    requestedMaxTokens: 1_400,
    env: ALL_KEYS,
    arms: CLOCK_ARMS,
    ...over,
  });

test("clock: a fast hosted arm gets the historical 14 s as a floor, not its own median", () => {
  const d = clockRoute({
    deadlineMs: 16_000,
    context: "interactive",
    history: [
      {
        armId: "groq:hosted",
        task: "screen_generate",
        samples: 40,
        avgPromptTokens: 790,
        avgCompletionTokens: 1_400,
        avgCostCents: 0.1,
        p50DurationMs: 300,
        successRate: 1,
      } satisfies ArmHistory,
    ],
  });
  // p50 x 1.4 would be 420 ms — a timeout equal to a median fails half of all calls by definition.
  assert.equal(d.chosen?.id, "groq:hosted");
  assert.equal(d.timeoutMs, 14_000, "the floor, not the median");
  assert.equal(d.minAttemptTimeoutMs, 14_000);
});

test("clock: an interactive deadline routes around the laptop CPU instead of forgiving it", () => {
  const d = clockRoute({ deadlineMs: 16_000, context: "interactive" });
  assert.ok(
    d.rejected.some((r) => r.armId === "ollama:cpu14b" && r.reason === "deadline"),
    "excluded with a reason that says it was the clock",
  );
  assert.equal(d.chosen?.id, "groq:hosted");
  assert.ok(!d.ranked.some((r) => r.armId === "ollama:cpu14b"), "a skipped arm never competes");
  assert.ok(
    d.reasons.some((r) => r.includes("deadline 16000ms (interactive)")),
    "the desk is told the budget that did the excluding",
  );
});

test("clock: the same arm becomes eligible when nobody is watching", () => {
  const d = clockRoute({ deadlineMs: 300_000, context: "background" });
  assert.ok(!d.rejected.some((r) => r.reason === "deadline"), "a long deadline fits a slow arm");
  assert.ok(d.ranked.some((r) => r.armId === "ollama:cpu14b"));
  assert.ok(d.timeoutMs >= 14_000 && d.timeoutMs <= 300_000, "bounded by the caller's context");
});

test("clock: a bulk deadline trims the answer before it rejects the arm", () => {
  const d = clockRoute({ deadlineMs: 17_000, context: "bulk" });
  const cpu = d.armBudgets.find((b) => b.armId === "ollama:cpu14b");
  assert.ok(cpu, "the arithmetic behind the exclusion is surfaced");
  assert.ok(cpu!.outputTokensFit > 0 && cpu!.outputTokensFit < 1_400, "the clock shrank the work");
  assert.ok(
    cpu!.outputTokensFit < 200,
    "so little fits that the answer would not parse — that, not slowness, is what rejects it",
  );
  assert.equal(cpu!.tooSlow, true);
  assert.ok(d.rejected.some((r) => r.armId === "ollama:cpu14b" && r.reason === "deadline"));
});

test("clock: a background deadline keeps the slow arm and trims, rather than excluding, its answer", () => {
  const d = clockRoute({ deadlineMs: 300_000, context: "background", arms: [cpuArm] });
  assert.equal(d.chosen?.id, "ollama:cpu14b");
  assert.ok(d.suggestedMaxTokens < d.maxTokens, "1500 tokens cannot decode in 300 s at 4 tok/s");
  assert.ok(d.suggestedMaxTokens > 200, "but enough still fits to be worth calling");
  assert.ok(d.reasons.some((r) => r.includes("clock trimmed")));
  assert.equal(d.timeoutMs, 300_000, "the trimmed estimate still exceeds the context cap");
});

test("clock: a caller tighter than the floor gets its own number, not 14 s", () => {
  const d = clockRoute({ deadlineMs: 5_000, context: "interactive", arms: [hostedArm] });
  assert.equal(d.chosen?.id, "groq:hosted");
  assert.equal(d.timeoutMs, 5_000, "the caller's tolerance outranks the historical floor");
  assert.equal(d.deadlineMs, 5_000);
});

test("clock: a caller that states no deadline keeps the candidate set it always had", () => {
  const d = clockRoute({});
  assert.deepEqual(d.rejected, [], "no arm is excluded on the clock silently");
  assert.equal(d.armBudgets.length, 0, "and none is judged against an invented budget");
  assert.ok(d.timeoutMs >= 14_000 && d.timeoutMs <= 16_000, "the interactive default still bounds it");
});

test("clock: the ledger records the budget that was actually allowed", () => {
  const d = clockRoute({ deadlineMs: 45_000, context: "bulk" });
  const t = routeTelemetry(d, 2, { timedOut: true });
  assert.equal(t.context, "bulk");
  assert.equal(t.deadlineMs, 45_000);
  assert.equal(t.timeoutMs, d.timeoutMs);
  assert.equal(t.timedOut, true, "so a killed attempt is readable as ours, not the arm's");
});

// --------------------------------------------------------------------------------------------
// 7. Censored history — a timeout must not write evidence that rewrites the next timeout
// --------------------------------------------------------------------------------------------

test("history: an arm whose calls keep getting killed is estimated by its aborts, not its luck", () => {
  const cold = arm({ id: "ollama:never", provider: "ollama", kind: "keyless_local", isFree: true, speedClassMs: 9_000 });
  const killed = arm({ ...cold, id: "ollama:killed" });
  const killedHistory: ArmHistory = {
    armId: "ollama:killed",
    task: "screen_generate",
    samples: 8,
    avgPromptTokens: 790,
    avgCompletionTokens: 1_400,
    avgCostCents: 0,
    // Every served call was aborted: nothing completed, so the median is meaningless.
    p50DurationMs: 0,
    successRate: 1,
    abortedSamples: 8,
    abortedElapsedMaxMs: 120_000,
  };
  const d = clockRoute({ arms: [cold, killed], history: [killedHistory] });
  const coldMs = d.ranked.find((r) => r.armId === "ollama:never")?.expectedMs;
  const killedMs = d.ranked.find((r) => r.armId === "ollama:killed")?.expectedMs;
  assert.equal(coldMs, 9_000, "no samples: the declared class stands");
  assert.ok(killedMs !== undefined && killedMs > 60_000, "8 of 13 weight on an aborted 120 s");
  assert.equal(d.chosen?.id, "ollama:never", "the arm we keep killing loses on the clock alone");
  assert.ok(
    d.timeoutMs <= 16_000 && d.timeoutMs >= 14_000,
    "the chosen fast arm is unaffected by the other one's aborts",
  );
});

test("history: an arm's own aborts raise its attempt budget to the context cap", () => {
  const d = clockRoute({
    arms: [hostedArm],
    history: [
      {
        armId: "groq:hosted",
        task: "screen_generate",
        samples: 8,
        avgPromptTokens: 790,
        avgCompletionTokens: 1_400,
        avgCostCents: 0.1,
        p50DurationMs: 0,
        successRate: 1,
        abortedSamples: 8,
        abortedElapsedMaxMs: 120_000,
      },
    ],
  });
  assert.equal(d.timeoutMs, 16_000, "censored evidence, capped by what an interactive caller allows");
});

test("registry: the CPU prior sees the answer size the speed class cannot", () => {
  const fourteenB = MODEL_ARMS.find((a) => a.id === "ollama:qwen2.5:14b");
  assert.ok(fourteenB, "the laptop arm is in the registry");
  const priorMs = armLatencyPriorMs(fourteenB!, 1_600, 1_500);
  assert.ok(priorMs > 60_000, `${priorMs}ms — minutes, not the 9 s its class claims`);
  assert.ok(priorMs > fourteenB!.speedClassMs);
  // An arm with no declared throughput keeps its declared class: no prior is invented from nothing.
  assert.equal(armLatencyPriorMs(hostedArm, 1_600, 1_500), hostedArm.speedClassMs);
});
