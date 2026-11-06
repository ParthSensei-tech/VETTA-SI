/**
 * Per-task model registry.
 *
 * The ladder in `providers.server.ts` asks "which provider answered first". This registry is
 * the other half of the router: it declares every arm the system is allowed to use for a given
 * task, with the priors a choice needs — price source, key requirement, context window, how
 * reliably it emits valid JSON, expected speed and raw quality.
 *
 * Prices are deliberately NOT duplicated here. `modelPriceFor()` in `../../platform/observability/cost.ts`
 * is the single source, so a routing decision and the `model_cost_logs` row it later writes
 * cannot disagree.
 *
 * Shape mirrors `SUPPORTED_EMBEDDING_MODELS` / `getModelInfo` in `embed-text.server.ts`.
 */

import type { ModelTaskType } from "../../platform/observability/types.ts";

export type ArmProvider = "groq" | "gemini" | "openai" | "ollama" | "xai" | "local" | "xenova";

/** `paid` bills per token, `free_tier` bills nothing until a quota is exhausted,
 *  `keyless_local` runs in this process with no credential at all. */
export type ArmKind = "paid" | "free_tier" | "keyless_local";

export type ModelCandidate = {
  /** Stable routing key, also what the desk shows: "groq:openai/gpt-oss-20b". */
  id: string;
  /** Matches the `provider` column of `model_cost_logs` so history joins on it. */
  provider: ArmProvider;
  /** What is actually sent, after any `<PROVIDER>_MODEL` override is applied. */
  declaredModel: string;
  /**
   * Only the provider's *default* arm carries this. Sharing one env var across several arms
   * would collapse them all onto the same model and make the choice meaningless.
   */
  modelEnvVar?: "GROQ_MODEL" | "GEMINI_MODEL" | "OPENAI_MODEL" | "OLLAMA_MODEL" | "XAI_MODEL";
  kind: ArmKind;
  /** True when a served call costs nothing. */
  isFree: boolean;
  /** Any one of these env vars must be set, or the arm is not eligible. Empty = keyless. */
  envKeys: string[];
  /** Keyless but still needs a listening server (Ollama on 11434). */
  requiresHost: boolean;
  contextWindowTokens: number;
  /** Prior probability it returns parseable JSON for a JSON-only prompt. */
  jsonReliability: number;
  /** Prior wall-clock ms for a task-sized call, cold provider. */
  speedClassMs: number;
  /**
   * Token-aware latency priors, tokens/second. `speedClassMs` answers "what does a task-sized
   * call feel like"; these answer "can this arm emit *this many* tokens inside *this many*
   * seconds", which is the question a deadline has to ask. Undefined means "trust speedClassMs".
   * A CPU-only Ollama arm is where the two diverge by two orders of magnitude.
   */
  decodeTokensPerSec?: number;
  prefillTokensPerSec?: number;
  /** Everything not explained by tokens: connection, queueing, first token, parsing. */
  callOverheadMs?: number;
  /** Capability prior, used to pick the strongest arm when nothing is gated. */
  qualityPrior: number;
  /** xAI in this environment spends the app owner's real quota — never route it in bulk. */
  spendsOwnerQuota?: boolean;
  /** Arms restricted to certain tasks (an embedding model cannot write a client card). */
  tasks?: ModelTaskType[];
};

export type TaskRisk = "critical" | "low_stakes";

export type TaskProfile = {
  task: ModelTaskType;
  /** `critical` decides a candidate's fate and may only go cheap once gated by the harness. */
  risk: TaskRisk;
  /** Hard clip applied to the prompt before the call, so cost is predictable. */
  inputClipChars: number;
  /** The maxTokens actually sent — replaces the per-callsite magic numbers. */
  outputCeiling: number;
  /** What one served call should cost, in cents; a router warning light, not a hard fail. */
  targetCostCents: number;
  /** What one served call should take, in ms. The router scores cost and latency against these
   *  absolute targets, so a 0.01c saving never looks as decisive as a 10x speed difference. */
  targetLatencyMs: number;
  minJsonReliability: number;
  /**
   * The shortest answer that still parses into something usable. A deadline that leaves less
   * room than this rejects the arm instead of asking for a truncated answer — a rank cut off
   * mid-JSON is worth nothing however fast it arrived.
   */
  minViableOutputTokens: number;
};

/**
 * Who is waiting for this call. Tolerance is a property of the call site, never of the model, so
 * it is supplied here rather than inferred from which arm was chosen.
 *
 * - `interactive`: one candidate, a recruiter watching a spinner.
 * - `bulk`: a server function that loops over many ranks inside a single request.
 * - `background`: detached work nobody is watching, where ₹0 can be worth minutes.
 */
export type CallContext = "interactive" | "bulk" | "background";

/**
 * The old 14 s, reinterpreted: a *floor* on any single attempt (never a ceiling that applies to
 * every arm) and the default when a caller passes no context at all.
 */
export const DEFAULT_MIN_ATTEMPT_TIMEOUT_MS = 14_000;

const HARD_MAX_MS: Record<CallContext, number> = {
  interactive: 16_000,
  bulk: 60_000,
  background: 300_000,
};

const HARD_MAX_ENV: Record<CallContext, string> = {
  interactive: "ROUTER_MAX_TIMEOUT_INTERACTIVE_MS",
  bulk: "ROUTER_MAX_TIMEOUT_BULK_MS",
  background: "ROUTER_MAX_TIMEOUT_BACKGROUND_MS",
};

/** The most any single attempt may be given, by context. Env-tunable, floor-guarded. */
export function contextHardMaxMs(
  context: CallContext = "interactive",
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): number {
  const raw = env[HARD_MAX_ENV[context]]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  const configured = Number.isFinite(parsed) && parsed > 0 ? parsed : HARD_MAX_MS[context];
  // Never let a tuning mistake drop an attempt below the historical constant.
  return Math.max(DEFAULT_MIN_ATTEMPT_TIMEOUT_MS, Math.round(configured));
}

/**
 * Token-aware wall-clock prior for one arm: prefill the prompt, decode the answer, add the
 * non-token overhead. Compared with `speedClassMs` — which describes a *task-sized* call and
 * therefore cannot see that a 1500-token answer on a laptop CPU takes minutes — and never
 * allowed below it, so this can raise a pessimistic estimate but never a lucky one.
 */
export function armLatencyPriorMs(
  arm: ModelCandidate,
  promptTokens: number,
  outputTokens: number,
): number {
  const prefillMs =
    arm.prefillTokensPerSec && arm.prefillTokensPerSec > 0
      ? (Math.max(0, promptTokens) / arm.prefillTokensPerSec) * 1_000
      : 0;
  const decodeMs =
    arm.decodeTokensPerSec && arm.decodeTokensPerSec > 0
      ? (Math.max(0, outputTokens) / arm.decodeTokensPerSec) * 1_000
      : 0;
  // Arms with no throughput priors (in-process code, embedding models) are their own floor.
  if (prefillMs === 0 && decodeMs === 0) return arm.speedClassMs;
  return Math.max(arm.speedClassMs, Math.round(prefillMs + decodeMs + (arm.callOverheadMs ?? 0)));
}

/**
 * How many output tokens this arm can still emit inside `budgetMs`, having spent the prompt.
 * Negative when prefill and overhead alone blow the budget — the arm cannot start, let alone
 * finish, and no answer length will rescue it.
 */
export function armFeasibleOutputTokens(
  arm: ModelCandidate,
  promptTokens: number,
  budgetMs: number,
): number {
  if (!arm.decodeTokensPerSec || arm.decodeTokensPerSec <= 0) return Number.POSITIVE_INFINITY;
  const prefillMs =
    arm.prefillTokensPerSec && arm.prefillTokensPerSec > 0
      ? (Math.max(0, promptTokens) / arm.prefillTokensPerSec) * 1_000
      : 0;
  const forDecode = budgetMs - prefillMs - (arm.callOverheadMs ?? 0);
  if (forDecode <= 0) return -1;
  return Math.floor((forDecode / 1_000) * arm.decodeTokensPerSec);
}

const CLOUD_TEXT_TASKS: ModelTaskType[] = [
  "rank",
  "screen_generate",
  "follow_up",
  "evaluate",
  "client_card",
  "rubric_draft",
  "test",
];

/**
 * Declaration order is the router's last tie-break, so cheaper-but-capable arms are listed
 * before expensive ones inside each class.
 */
export const MODEL_ARMS: ModelCandidate[] = [
  // ---- keyless local: always eligible, always ₹0 -----------------------------------------
  {
    id: "local:evidence",
    provider: "local",
    declaredModel: "evidence",
    kind: "keyless_local",
    isFree: true,
    envKeys: [],
    requiresHost: false,
    contextWindowTokens: 32_000,
    // Deterministic code, so it cannot emit malformed JSON.
    jsonReliability: 1,
    speedClassMs: 5,
    qualityPrior: 0.62,
    tasks: ["rank", "screen_generate", "follow_up", "evaluate", "client_card"],
  },
  {
    id: "ollama:llama3.2:3b",
    provider: "ollama",
    declaredModel: "llama3.2:3b",
    kind: "keyless_local",
    isFree: true,
    envKeys: [],
    requiresHost: true,
    contextWindowTokens: 128_000,
    jsonReliability: 0.6,
    speedClassMs: 2_500,
    // Measured-ish CPU-only figures for a 4-core i5 with no discrete GPU, i.e. the laptop case.
    decodeTokensPerSec: 18,
    prefillTokensPerSec: 300,
    callOverheadMs: 150,
    qualityPrior: 0.55,
    tasks: CLOUD_TEXT_TASKS,
  },
  {
    id: "ollama:qwen2.5:14b",
    provider: "ollama",
    declaredModel: "qwen2.5:14b",
    modelEnvVar: "OLLAMA_MODEL",
    kind: "keyless_local",
    isFree: true,
    envKeys: [],
    requiresHost: true,
    contextWindowTokens: 32_768,
    jsonReliability: 0.8,
    speedClassMs: 9_000,
    // A 14B model on laptop CPU decodes at a few tokens/second. `speedClassMs` flatters it: the
    // real cost is proportional to the output, so a 1500-token answer takes minutes, not 9 s.
    decodeTokensPerSec: 4,
    prefillTokensPerSec: 60,
    callOverheadMs: 250,
    qualityPrior: 0.78,
    tasks: CLOUD_TEXT_TASKS,
  },
  {
    id: "xenova:multilingual-e5-small",
    provider: "xenova",
    declaredModel: "Xenova/multilingual-e5-small",
    kind: "keyless_local",
    isFree: true,
    envKeys: [],
    requiresHost: false,
    // The model's real sequence limit, not a guess.
    contextWindowTokens: 512,
    jsonReliability: 1,
    speedClassMs: 20,
    qualityPrior: 0.7,
    tasks: ["domain_embed"],
  },

  // ---- cloud free tiers: ₹0 until the provider quota runs out ------------------------------
  {
    id: "groq:llama-3.1-8b-instant",
    provider: "groq",
    declaredModel: "llama-3.1-8b-instant",
    kind: "free_tier",
    isFree: false,
    envKeys: ["GROQ_API_KEY"],
    requiresHost: false,
    contextWindowTokens: 131_072,
    jsonReliability: 0.85,
    speedClassMs: 600,
    decodeTokensPerSec: 300,
    prefillTokensPerSec: 2_000,
    callOverheadMs: 250,
    qualityPrior: 0.7,
    tasks: CLOUD_TEXT_TASKS,
  },
  {
    id: "gemini:gemini-2.5-flash-lite",
    provider: "gemini",
    declaredModel: "gemini-2.5-flash-lite",
    kind: "free_tier",
    isFree: false,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    requiresHost: false,
    contextWindowTokens: 1_048_576,
    jsonReliability: 0.85,
    speedClassMs: 500,
    decodeTokensPerSec: 250,
    prefillTokensPerSec: 3_000,
    callOverheadMs: 300,
    qualityPrior: 0.72,
    tasks: CLOUD_TEXT_TASKS,
  },

  // ---- paid cloud --------------------------------------------------------------------------
  {
    id: "groq:openai/gpt-oss-20b",
    provider: "groq",
    declaredModel: "openai/gpt-oss-20b",
    modelEnvVar: "GROQ_MODEL",
    kind: "paid",
    isFree: false,
    envKeys: ["GROQ_API_KEY"],
    requiresHost: false,
    contextWindowTokens: 131_072,
    jsonReliability: 0.9,
    speedClassMs: 900,
    decodeTokensPerSec: 200,
    prefillTokensPerSec: 1_500,
    callOverheadMs: 250,
    qualityPrior: 0.82,
    tasks: CLOUD_TEXT_TASKS,
  },
  {
    id: "openai:gpt-4o-mini",
    provider: "openai",
    declaredModel: "gpt-4o-mini",
    modelEnvVar: "OPENAI_MODEL",
    kind: "paid",
    isFree: false,
    envKeys: ["OPENAI_API_KEY"],
    requiresHost: false,
    contextWindowTokens: 128_000,
    jsonReliability: 0.93,
    speedClassMs: 1_100,
    decodeTokensPerSec: 120,
    prefillTokensPerSec: 1_500,
    callOverheadMs: 400,
    qualityPrior: 0.84,
    tasks: CLOUD_TEXT_TASKS,
  },
  {
    id: "gemini:gemini-2.5-flash",
    provider: "gemini",
    declaredModel: "gemini-2.5-flash",
    modelEnvVar: "GEMINI_MODEL",
    kind: "paid",
    isFree: false,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    requiresHost: false,
    contextWindowTokens: 1_048_576,
    jsonReliability: 0.9,
    speedClassMs: 650,
    decodeTokensPerSec: 220,
    prefillTokensPerSec: 3_000,
    callOverheadMs: 350,
    qualityPrior: 0.8,
    tasks: CLOUD_TEXT_TASKS,
  },
  {
    id: "groq:llama-3.3-70b-versatile",
    provider: "groq",
    declaredModel: "llama-3.3-70b-versatile",
    kind: "paid",
    isFree: false,
    envKeys: ["GROQ_API_KEY"],
    requiresHost: false,
    contextWindowTokens: 131_072,
    jsonReliability: 0.9,
    speedClassMs: 1_200,
    decodeTokensPerSec: 180,
    prefillTokensPerSec: 1_200,
    callOverheadMs: 300,
    qualityPrior: 0.88,
    tasks: CLOUD_TEXT_TASKS,
  },
  {
    id: "xai:grok-4.5",
    provider: "xai",
    declaredModel: "grok-4.5",
    modelEnvVar: "XAI_MODEL",
    kind: "paid",
    isFree: false,
    envKeys: ["XAI_API_KEY"],
    requiresHost: false,
    contextWindowTokens: 131_072,
    jsonReliability: 0.9,
    speedClassMs: 1_500,
    decodeTokensPerSec: 100,
    prefillTokensPerSec: 800,
    callOverheadMs: 500,
    qualityPrior: 0.92,
    spendsOwnerQuota: true,
    tasks: CLOUD_TEXT_TASKS,
  },
];

/**
 * Output ceilings are sized to what each prompt asks for, not to the model's limit:
 * rank returns evidence + requirement verdicts, screen returns exactly 6 questions with one
 * follow-up each, follow_up is capped at ~40 words by its own prompt.
 */
export const TASK_PROFILES: Record<ModelTaskType, TaskProfile> = {
  rank: {
    task: "rank",
    risk: "critical",
    inputClipChars: 16_000,
    outputCeiling: 1_500,
    targetCostCents: 0.05,
    // A burst ranks hundreds of resumes, so per-call latency is multiplied by the queue.
    targetLatencyMs: 1_500,
    minJsonReliability: 0.85,
    minViableOutputTokens: 200,
  },
  evaluate: {
    task: "evaluate",
    risk: "critical",
    inputClipChars: 12_000,
    outputCeiling: 900,
    targetCostCents: 0.02,
    targetLatencyMs: 1_500,
    // No gold set exists for screen verdicts, so only the most reliable arms may take this.
    minJsonReliability: 0.9,
    minViableOutputTokens: 120,
  },
  screen_generate: {
    task: "screen_generate",
    risk: "low_stakes",
    inputClipChars: 3_000,
    outputCeiling: 1_400,
    targetCostCents: 0.04,
    targetLatencyMs: 2_500,
    minJsonReliability: 0.6,
    minViableOutputTokens: 200,
  },
  follow_up: {
    task: "follow_up",
    risk: "low_stakes",
    inputClipChars: 1_800,
    outputCeiling: 220,
    targetCostCents: 0.005,
    targetLatencyMs: 1_200,
    minJsonReliability: 0.6,
    minViableOutputTokens: 40,
  },
  client_card: {
    task: "client_card",
    risk: "low_stakes",
    inputClipChars: 6_000,
    outputCeiling: 1_000,
    targetCostCents: 0.02,
    targetLatencyMs: 2_000,
    minJsonReliability: 0.6,
    minViableOutputTokens: 120,
  },
  rubric_draft: {
    task: "rubric_draft",
    risk: "low_stakes",
    inputClipChars: 6_000,
    outputCeiling: 1_200,
    targetCostCents: 0.02,
    // One-off, recruiter-initiated and worth waiting for.
    targetLatencyMs: 3_000,
    // A rubric is not a draft of prose, it is the definition of every later score. Below 0.8 a
    // laptop-CPU 3B used to win this outright on cost, and `local:evidence` cannot take the task
    // because it does not declare it — so the bar has to come from the arms that can parse.
    // Refusing the weak arm costs nothing: `draftRubricFromRoleFields` is the deterministic
    // fallback, which is a usable scaffold rather than a hallucinated weighting scheme.
    minJsonReliability: 0.8,
    minViableOutputTokens: 150,
  },
  domain_embed: {
    task: "domain_embed",
    risk: "low_stakes",
    // Must stay inside the embedding arm's 512-token window (~395 tokens here), or the router
    // disqualifies its only capable arm and embeddings silently stop.
    inputClipChars: 1_500,
    outputCeiling: 0,
    targetCostCents: 0,
    // In-process ONNX: tens of milliseconds, or it is not worth doing inline.
    targetLatencyMs: 200,
    minJsonReliability: 1,
    minViableOutputTokens: 0,
  },
  test: {
    task: "test",
    risk: "low_stakes",
    inputClipChars: 4_000,
    outputCeiling: 400,
    targetCostCents: 0.01,
    targetLatencyMs: 2_000,
    minJsonReliability: 0.5,
    minViableOutputTokens: 60,
  },
};

export function getArm(id: string): ModelCandidate | undefined {
  return MODEL_ARMS.find((a) => a.id === id);
}

export function getTaskProfile(task: ModelTaskType): TaskProfile {
  return TASK_PROFILES[task];
}

/** Resolve the model name an arm will actually send, honouring `<PROVIDER>_MODEL`. */
export function armModel(
  arm: ModelCandidate,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string {
  const override = arm.modelEnvVar ? env[arm.modelEnvVar]?.trim() : "";
  return override || arm.declaredModel;
}

/** True when the arm's credential is present in this environment. */
export function armHasKey(
  arm: ModelCandidate,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (arm.envKeys.length === 0) return true;
  return arm.envKeys.some((key) => Boolean(env[key]?.trim()));
}
