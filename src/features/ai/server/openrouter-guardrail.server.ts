/**
 * OpenRouter Credit Limit Guardrail & Circuit Breaker Engine
 *
 * Enforces strict budget caps around the user's OpenRouter API key ($100 credit limit):
 * - Soft alert at $80.00 USD
 * - Hard circuit breaker shutoff at $95.00 USD (blocks further paid requests before limit is burned)
 * - Live synchronization with OpenRouter's /auth/key API
 * - Zero-cost exemption for models ending in ':free' (e.g. google/gemma-4-31b-it:free)
 */

export interface OpenRouterKeyInfo {
  label?: string;
  usage: number; // in USD
  limit: number | null; // in USD
  isFreeTier: boolean;
  rateLimit?: {
    requests: number;
    interval: string;
  };
}

export interface GuardrailDecision {
  allowed: boolean;
  reason?: string;
  isFreeModel: boolean;
  currentSpendUsd: number;
  remainingUsd: number;
  circuitTripped: boolean;
}

type CircuitState = {
  tripped: boolean;
  trippedAt?: number;
  reason?: string;
};

const g = globalThis as typeof globalThis & {
  __openRouterCircuit__?: CircuitState;
  __openRouterKeyCache__?: { info: OpenRouterKeyInfo; fetchedAt: number };
  __openRouterSpendAccumulator__?: number;
};

function getCircuitState(): CircuitState {
  g.__openRouterCircuit__ ??= { tripped: false };
  return g.__openRouterCircuit__;
}

export function isOpenRouterCircuitTripped(): boolean {
  return getCircuitState().tripped;
}

export function tripOpenRouterCircuit(reason: string): void {
  const state = getCircuitState();
  state.tripped = true;
  state.trippedAt = Date.now();
  state.reason = reason;
  console.warn(`[OpenRouter Guardrail] Circuit BREAKER TRIPPED: ${reason}`);
}

export function resetOpenRouterCircuit(): void {
  const state = getCircuitState();
  state.tripped = false;
  state.trippedAt = undefined;
  state.reason = undefined;
}

export function getOpenRouterBudgetLimits() {
  const creditLimitUsd = parseFloat(process.env.OPENROUTER_CREDIT_LIMIT_USD || "100.00");
  const hardLimitUsd = parseFloat(process.env.OPENROUTER_HARD_LIMIT_USD || "95.00");
  const warnLimitUsd = parseFloat(process.env.OPENROUTER_WARN_LIMIT_USD || "80.00");
  const maxTokensPerCall = parseInt(process.env.OPENROUTER_MAX_TOKENS_PER_CALL || "2048", 10);

  return { creditLimitUsd, hardLimitUsd, warnLimitUsd, maxTokensPerCall };
}

export function isFreeOpenRouterModel(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  return (
    normalized.endsWith(":free") ||
    normalized.includes("free") ||
    normalized === "google/gemma-4-31b-it:free"
  );
}

/**
 * Fetch live account spend and limits from OpenRouter key API:
 * GET https://openrouter.ai/api/v1/auth/key
 */
export async function fetchOpenRouterKeyInfo(apiKeyOverride?: string): Promise<OpenRouterKeyInfo | null> {
  const apiKey = apiKeyOverride || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  // Cache for 60 seconds
  const now = Date.now();
  if (g.__openRouterKeyCache__ && now - g.__openRouterKeyCache__.fetchedAt < 60_000) {
    return g.__openRouterKeyCache__.info;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://vetta.ai",
        "X-Title": "Vetta ATS Guardrail",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(`[OpenRouter Guardrail] /auth/key responded with status ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      data?: {
        label?: string;
        usage?: number;
        limit?: number | null;
        is_free_tier?: boolean;
        rate_limit?: { requests: number; interval: string };
      };
    };

    const data = json.data;
    if (!data) return null;

    const info: OpenRouterKeyInfo = {
      label: data.label,
      usage: typeof data.usage === "number" ? data.usage : 0,
      limit: typeof data.limit === "number" ? data.limit : null,
      isFreeTier: Boolean(data.is_free_tier),
      rateLimit: data.rate_limit,
    };

    g.__openRouterKeyCache__ = { info, fetchedAt: now };
    return info;
  } catch (err) {
    console.warn("[OpenRouter Guardrail] Failed to query OpenRouter auth/key:", err);
    return null;
  }
}

/**
 * Pre-flight budget evaluation before issuing any request to OpenRouter.
 */
export async function checkOpenRouterBudget(params: {
  model?: string;
  estimatedTokens?: number;
}): Promise<GuardrailDecision> {
  const { hardLimitUsd, warnLimitUsd, creditLimitUsd } = getOpenRouterBudgetLimits();
  const model = params.model || process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  const isFree = isFreeOpenRouterModel(model);

  // If circuit breaker is already open
  const circuit = getCircuitState();
  if (circuit.tripped) {
    return {
      allowed: false,
      reason: circuit.reason || "OpenRouter circuit breaker is active",
      isFreeModel: isFree,
      currentSpendUsd: g.__openRouterSpendAccumulator__ ?? 0,
      remainingUsd: 0,
      circuitTripped: true,
    };
  }

  // Attempt live key telemetry sync
  const keyInfo = await fetchOpenRouterKeyInfo();
  const currentSpend = keyInfo?.usage ?? g.__openRouterSpendAccumulator__ ?? 0;
  const remainingUsd = Math.max(0, creditLimitUsd - currentSpend);

  // Soft warning alert
  if (currentSpend >= warnLimitUsd && currentSpend < hardLimitUsd) {
    console.warn(
      `[OpenRouter Guardrail Alert] Soft budget alert reached: $${currentSpend.toFixed(2)} / $${creditLimitUsd.toFixed(2)} USD`,
    );
  }

  // Hard limit breach check
  if (currentSpend >= hardLimitUsd) {
    tripOpenRouterCircuit(
      `Hard credit limit reached: $${currentSpend.toFixed(2)} >= $${hardLimitUsd.toFixed(2)} USD (budget cap: $${creditLimitUsd.toFixed(2)})`,
    );
    return {
      allowed: false,
      reason: `OpenRouter budget limit tripped ($${currentSpend.toFixed(2)} spent of $${creditLimitUsd.toFixed(2)})`,
      isFreeModel: isFree,
      currentSpendUsd: currentSpend,
      remainingUsd,
      circuitTripped: true,
    };
  }

  // Model-level verification: Free-tier models pass unconditionally within budget
  return {
    allowed: true,
    isFreeModel: isFree,
    currentSpendUsd: currentSpend,
    remainingUsd,
    circuitTripped: false,
  };
}

/**
 * Record usage telemetry and update internal ledger.
 */
export function recordOpenRouterUsage(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  costUsd?: number;
}): void {
  const cost = params.costUsd ?? (isFreeOpenRouterModel(params.model) ? 0 : 0.0001);
  g.__openRouterSpendAccumulator__ = (g.__openRouterSpendAccumulator__ ?? 0) + cost;

  if (params.reasoningTokens && params.reasoningTokens > 0) {
    console.info(
      `[OpenRouter Usage] Model: ${params.model} | Prompt: ${params.promptTokens} | Completion: ${params.completionTokens} | Reasoning Tokens: ${params.reasoningTokens} | Spend: $${cost.toFixed(6)}`,
    );
  }
}
