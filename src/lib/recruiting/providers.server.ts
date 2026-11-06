/**
 * Free/cloud provider ladder for *deepen* only (not bulk batch).
 * Order: Groq → Gemini → OpenAI → Ollama → xAI → fail (caller falls back to local).
 * Retries with backoff on 429 / 503. Circuit opens briefly after hard failures.
 */

export type LadderProvider = "groq" | "gemini" | "openai" | "ollama" | "xai";

export type ProviderCallResult =
  | {
      ok: true;
      text: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      model?: string;
    };

export type LadderResult =
  | {
      ok: true;
      text: string;
      provider: LadderProvider;
      model: string;
      promptTokens: number;
      completionTokens: number;
      attempts: number;
      durationMs: number;
    }
  | {
      ok: false;
      error: string;
      attempts: number;
      lastProvider?: LadderProvider;
      durationMs: number;
    };

type Circuit = { openUntil: number; fails: number };

const g = globalThis as typeof globalThis & {
  __vettaCircuits__?: Map<string, Circuit>;
};

function circuits(): Map<string, Circuit> {
  g.__vettaCircuits__ ??= new Map();
  return g.__vettaCircuits__;
}

function isOpen(name: string): boolean {
  const c = circuits().get(name);
  if (!c) return false;
  if (Date.now() >= c.openUntil) {
    circuits().delete(name);
    return false;
  }
  return true;
}

/** Whether a provider is currently tripped. The router asks before it offers an arm. */
export function providerCircuitOpen(name: string): boolean {
  return isOpen(name);
}

function recordFail(name: string, hard: boolean) {
  const prev = circuits().get(name) ?? { openUntil: 0, fails: 0 };
  const fails = prev.fails + 1;
  // Open circuit longer after repeated or hard (403/auth) failures.
  const ms = hard ? 15 * 60_000 : Math.min(120_000, 5_000 * fails);
  circuits().set(name, { openUntil: Date.now() + ms, fails });
}

function recordOk(name: string) {
  circuits().delete(name);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const localQueues = globalThis as typeof globalThis & {
  __vettaLocalInflight__?: Map<string, Promise<void>>;
};

function localInflight(): Map<string, Promise<void>> {
  localQueues.__vettaLocalInflight__ ??= new Map();
  return localQueues.__vettaLocalInflight__;
}

/**
 * One inference at a time per local host.
 *
 * A CPU-only Ollama box cannot run two models in parallel usefully: each concurrent request slows
 * every other one by roughly the same factor, so the second queued call is what makes the first
 * one miss its deadline. Cloud arms have their own quotas and are left alone.
 */
async function withLocalSingleFlight<T>(provider: string, run: () => Promise<T>): Promise<T> {
  if (provider !== "ollama" && provider !== "xenova") return run();
  const key = provider;
  const queue = localInflight();
  const waitForTurn = queue.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const chain = waitForTurn.then(() => mine).catch(() => {});
  queue.set(key, chain);
  await waitForTurn.catch(() => {});
  try {
    return await run();
  } finally {
    release();
    // Drop the tail only when nobody queued behind us, so the map does not grow with traffic.
    if (queue.get(key) === chain) queue.delete(key);
  }
}

function ollamaBaseUrl(): string {
  const raw =
    process.env.OLLAMA_HOST?.trim() ||
    process.env.OLLAMA_BASE_URL?.trim() ||
    "http://127.0.0.1:11434";
  return raw.replace(/\/$/, "");
}

function ollamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || "qwen2.5:14b";
}

export function availableLadderProviders(): LadderProvider[] {
  const out: LadderProvider[] = [];
  if (process.env.GROQ_API_KEY?.trim()) out.push("groq");
  if (process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()) out.push("gemini");
  if (process.env.OPENAI_API_KEY?.trim()) out.push("openai");
  if (process.env.OLLAMA_HOST?.trim() || process.env.OLLAMA_BASE_URL?.trim()) out.push("ollama");
  if (process.env.XAI_API_KEY?.trim()) out.push("xai");
  // Probe Ollama even without forced host (best-effort later).
  if (!out.includes("ollama")) out.push("ollama");
  return out;
}

async function callGroq(args: {
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  /** The router's chosen arm; falls back to `GROQ_MODEL` when absent. */
  model?: string;
}): Promise<ProviderCallResult> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return { ok: false, error: "GROQ_API_KEY missing", retryable: false };
  const model = args.model?.trim() || process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: args.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
    signal: args.signal,
  });
  if (res.status === 429 || res.status === 503) {
    return { ok: false, error: `Groq ${res.status}`, retryable: true, model };
  }
  if (!res.ok) {
    return { ok: false, error: `Groq ${res.status}`, retryable: res.status >= 500, model };
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) return { ok: false, error: "Empty Groq response", retryable: true, model };
  const promptTokens =
    body.usage?.prompt_tokens ?? Math.ceil((args.system.length + args.user.length) / 4);
  const completionTokens = body.usage?.completion_tokens ?? Math.ceil(text.length / 4);
  return { ok: true, text, model, promptTokens, completionTokens };
}

async function callGemini(args: {
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  model?: string;
}): Promise<ProviderCallResult> {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!key) return { ok: false, error: "GEMINI_API_KEY missing", retryable: false };
  const model = args.model?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: args.system }] },
      contents: [{ role: "user", parts: [{ text: args.user }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: args.maxTokens,
        responseMimeType: "application/json",
      },
    }),
    signal: args.signal,
  });
  if (res.status === 429 || res.status === 503) {
    return { ok: false, error: `Gemini ${res.status}`, retryable: true, model };
  }
  if (!res.ok) {
    return { ok: false, error: `Gemini ${res.status}`, retryable: res.status >= 500, model };
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text =
    body.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      ?.trim() ?? "";
  if (!text) return { ok: false, error: "Empty Gemini response", retryable: true, model };
  const promptTokens =
    body.usageMetadata?.promptTokenCount ?? Math.ceil((args.system.length + args.user.length) / 4);
  const completionTokens = body.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
  return { ok: true, text, model, promptTokens, completionTokens };
}

async function callOpenAI(args: {
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  model?: string;
}): Promise<ProviderCallResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, error: "OPENAI_API_KEY missing", retryable: false };
  const model = args.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: args.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
    signal: args.signal,
  });
  if (res.status === 429 || res.status === 503) {
    return { ok: false, error: `OpenAI ${res.status}`, retryable: true, model };
  }
  if (!res.ok) {
    return { ok: false, error: `OpenAI ${res.status}`, retryable: res.status >= 500, model };
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) return { ok: false, error: "Empty OpenAI response", retryable: true, model };
  const promptTokens =
    body.usage?.prompt_tokens ?? Math.ceil((args.system.length + args.user.length) / 4);
  const completionTokens = body.usage?.completion_tokens ?? Math.ceil(text.length / 4);
  return { ok: true, text, model, promptTokens, completionTokens };
}

/** Reasoning models prepend their chain-of-thought to the answer; the JSON parser never sees it. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callOllama(args: {
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  model?: string;
}): Promise<ProviderCallResult> {
  const model = args.model?.trim() || ollamaModel();
  try {
    const res = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.2, num_predict: args.maxTokens },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
      signal: args.signal,
    });
    if (res.status === 429 || res.status === 503) {
      return { ok: false, error: `Ollama ${res.status}`, retryable: true, model };
    }
    if (!res.ok) return { ok: false, error: `Ollama ${res.status}`, retryable: true, model };
    const body = (await res.json()) as {
      message?: { content?: string };
      error?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (body.error) return { ok: false, error: body.error, retryable: true, model };
    const text = stripThink(body.message?.content ?? "");
    if (!text) return { ok: false, error: "Empty Ollama response", retryable: true, model };
    const promptTokens =
      body.prompt_eval_count ?? Math.ceil((args.system.length + args.user.length) / 4);
    const completionTokens = body.eval_count ?? Math.ceil(text.length / 4);
    return { ok: true, text, model, promptTokens, completionTokens };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Ollama unreachable",
      retryable: true,
      model,
    };
  }
}

async function callXai(args: {
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  model?: string;
}): Promise<ProviderCallResult> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return { ok: false, error: "XAI_API_KEY missing", retryable: false };
  const model = args.model?.trim() || process.env.XAI_MODEL?.trim() || "grok-4.5";
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: args.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
    signal: args.signal,
  });
  if (res.status === 429 || res.status === 503) {
    return { ok: false, error: `xAI ${res.status}`, retryable: true, model };
  }
  if (res.status === 403) {
    return { ok: false, error: `xAI ${res.status}`, retryable: false, model };
  }
  if (!res.ok) {
    return { ok: false, error: `xAI ${res.status}`, retryable: res.status >= 500, model };
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = stripThink(body.choices?.[0]?.message?.content ?? "");
  if (!text) return { ok: false, error: "Empty xAI response", retryable: true, model };
  const promptTokens =
    body.usage?.prompt_tokens ?? Math.ceil((args.system.length + args.user.length) / 4);
  const completionTokens = body.usage?.completion_tokens ?? Math.ceil(text.length / 4);
  return { ok: true, text, model, promptTokens, completionTokens };
}

async function callProvider(
  provider: LadderProvider,
  args: { system: string; user: string; maxTokens: number; signal: AbortSignal; model?: string },
): Promise<ProviderCallResult> {
  switch (provider) {
    case "groq":
      return callGroq(args);
    case "gemini":
      return callGemini(args);
    case "openai":
      return callOpenAI(args);
    case "ollama":
      return callOllama(args);
    case "xai":
      return callXai(args);
  }
}

/**
 * Try providers in order with per-provider retries. Used only for deepen (mode=full).
 */
export async function completeWithLadder(args: {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs?: number;
  maxAttemptsPerProvider?: number;
}): Promise<LadderResult> {
  const started = Date.now();
  const timeoutMs = args.timeoutMs ?? 14_000;
  const maxAttempts = args.maxAttemptsPerProvider ?? 2;
  const order = availableLadderProviders().filter((p) => {
    if (p === "groq" && !process.env.GROQ_API_KEY?.trim()) return false;
    if (
      p === "gemini" &&
      !(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim())
    )
      return false;
    if (p === "openai" && !process.env.OPENAI_API_KEY?.trim()) return false;
    if (p === "xai" && !process.env.XAI_API_KEY?.trim()) return false;
    return true;
  });

  let attempts = 0;
  let lastProvider: LadderProvider | undefined;
  let lastError = "No providers configured";

  for (const provider of order) {
    if (isOpen(provider)) continue;
    lastProvider = provider;
    for (let a = 0; a < maxAttempts; a++) {
      attempts += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const result = await callProvider(provider, {
          system: args.system,
          user: args.user,
          maxTokens: args.maxTokens,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (result.ok) {
          recordOk(provider);
          return {
            ok: true,
            text: result.text,
            provider,
            model: result.model,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            attempts,
            durationMs: Date.now() - started,
          };
        }
        lastError = result.error;
        if (!result.retryable) {
          recordFail(provider, true);
          break;
        }
        await sleep(400 * (a + 1) + Math.floor(Math.random() * 200));
      } catch (e) {
        clearTimeout(timer);
        lastError = e instanceof Error ? e.message : "Provider error";
        await sleep(300 * (a + 1));
      }
    }
    recordFail(provider, false);
  }

  return { ok: false, error: lastError, attempts, lastProvider, durationMs: Date.now() - started };
}

/**
 * Result of a routed call. `routedLocal: true` is not a failure: it says the cheapest arm that
 * can do this task is the caller's own in-process engine, so it should run that path and label
 * provenance as a routing choice rather than a fallback.
 */
export type RoutedResult =
  | {
      ok: true;
      text: string;
      provider: LadderProvider | "local";
      model: string;
      promptTokens: number;
      completionTokens: number;
      attempts: number;
      durationMs: number;
      routedLocal: boolean;
      route: import("./model-router.ts").RouteDecision;
    }
  | {
      ok: false;
      error: string;
      attempts: number;
      lastProvider?: LadderProvider;
      /** True when we killed the last attempt on the clock, rather than the arm failing. */
      timedOut?: boolean;
      durationMs: number;
      route: import("./model-router.ts").RouteDecision;
    };

/**
 * Call the arm the router chose for this task, instead of the first provider that answers.
 *
 * Same shape of outcome as `completeWithLadder`, so callers swap over directly, plus the decision
 * itself so the ledger can record why. `completeWithLadder` stays for the benchmark's A/B.
 */
export async function completeWithRouter(args: {
  task: import("../observability/types.ts").ModelTaskType;
  system: string;
  user: string;
  maxTokens: number;
  /**
   * Legacy per-attempt override. The router now derives the attempt budget from the arm it chose;
   * this only applies when the decision has no figure (a caller that predates the deadline work).
   */
  timeoutMs?: number;
  maxAttemptsPerProvider?: number;
  orgId?: string | null;
  /** Only for an explicit user-initiated max-quality call. */
  allowOwnerQuota?: boolean;
  /** Whose patience this is: `interactive`, `bulk` or `background`. */
  context?: import("./model-registry.ts").CallContext;
  /** Total tolerance for an answer. Arms that cannot fit it are never offered the task. */
  deadlineMs?: number;
  /** Floor on one attempt; the historical 14 s, now a floor rather than the rule. */
  minAttemptTimeoutMs?: number;
}): Promise<RoutedResult> {
  const started = Date.now();
  const { planRoute } = await import("./model-router.server.ts");
  const { armModel } = await import("./model-registry.ts");
  const route = await planRoute({
    task: args.task,
    promptText: `${args.system}\n${args.user}`,
    requestedMaxTokens: args.maxTokens,
    orgId: args.orgId,
    allowOwnerQuota: args.allowOwnerQuota,
    context: args.context,
    deadlineMs: args.deadlineMs,
    minAttemptTimeoutMs: args.minAttemptTimeoutMs,
  });

  const arm = route.chosen;
  if (!arm) {
    return {
      ok: false,
      error: route.degradeReason ?? `no model arm eligible for ${args.task}`,
      attempts: 0,
      durationMs: Date.now() - started,
      route,
    };
  }

  if (arm.provider === "local" || arm.provider === "xenova") {
    return {
      ok: true,
      text: "",
      provider: "local",
      model: armModel(arm),
      promptTokens: route.expectedPromptTokens,
      completionTokens: 0,
      attempts: 0,
      durationMs: Date.now() - started,
      routedLocal: true,
      route,
    };
  }

  // The attempt budget comes from the decision, not from a number this call site guessed: a Groq
  // arm and a laptop-CPU Ollama arm cannot share one timeout and stay honest about either.
  const deadlineAt = started + Math.max(1, route.deadlineMs);
  const attemptBudgetMs = () => {
    const base = route.timeoutMs > 0 ? route.timeoutMs : (args.timeoutMs ?? 14_000);
    const remaining = deadlineAt - Date.now();
    return Math.max(1_000, Math.min(base, remaining));
  };
  // A second arm behind a 14 s deadline is not a retry plan, it is a 28 s request. Once less than
  // a second of the caller's clock is left, the honest answer is "this arm did not answer".
  const clockLeftMs = () => deadlineAt - Date.now();
  const maxAttempts = args.maxAttemptsPerProvider ?? 2;
  const { getArm } = await import("./model-registry.ts");

  // The router ranked these; a transient failure on the top arm should not waste the task, so the
  // runner-on is tried too. Only two, because every extra arm is another round of waiting.
  const queue = [
    arm,
    ...route.ranked
      .slice(1)
      .map((r) => getArm(r.armId))
      .filter(Boolean),
  ]
    .slice(0, 2)
    .filter((a) => a && a.provider !== "local" && a.provider !== "xenova");

  let attempts = 0;
  let lastError = "no model arm answered";
  let lastProvider: LadderProvider | undefined;
  let timedOut = false;

  for (const candidate of queue) {
    if (!candidate) continue;
    const provider = candidate.provider as LadderProvider;
    if (providerCircuitOpen(provider)) continue;
    const model = armModel(candidate);
    lastProvider = provider;
    lastError = `${provider} did not answer`;

    for (let a = 0; a < maxAttempts; a++) {
      if (clockLeftMs() < 1_000) {
        lastError = `${provider} not tried again: the caller's ${route.deadlineMs}ms deadline is spent`;
        break;
      }
      const timeoutMs = attemptBudgetMs();
      attempts += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const result = await withLocalSingleFlight(provider, () =>
          callProvider(provider, {
            system: args.system,
            user: args.user,
            // The profile's ceiling, then whatever the clock says fits — this is where the token
            // budget is enforced, and why a slow arm is asked for a shorter answer, not a longer wait.
            maxTokens: Math.min(route.maxTokens, route.suggestedMaxTokens),
            signal: ctrl.signal,
            model,
          }),
        );
        clearTimeout(timer);
        if (result.ok) {
          recordOk(provider);
          return {
            ok: true,
            text: result.text,
            provider,
            model: result.model,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            attempts,
            durationMs: Date.now() - started,
            routedLocal: false,
            // The desk should show the arm that actually answered, not just the one it asked for.
            route: { ...route, chosen: candidate, model: result.model },
          };
        }
        lastError = result.error;
        if (!result.retryable) {
          recordFail(provider, true);
          break;
        }
        await sleep(400 * (a + 1) + Math.floor(Math.random() * 200));
      } catch (e) {
        clearTimeout(timer);
        // Our clock expiring is not the provider misbehaving. Record which it was, so the arm's
        // reliability history is not written by the timeout we chose for it.
        if (ctrl.signal.aborted) {
          timedOut = true;
          lastError = `${provider} exceeded its ${timeoutMs}ms attempt budget`;
          break;
        }
        lastError = e instanceof Error ? e.message : `${provider} request failed`;
        await sleep(300 * (a + 1));
      }
    }
    recordFail(provider, false);
  }

  return {
    ok: false,
    error: lastError,
    attempts,
    lastProvider,
    timedOut,
    durationMs: Date.now() - started,
    route,
  };
}
