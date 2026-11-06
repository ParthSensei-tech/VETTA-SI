export type ModelPricing = {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
};

// Pricing table (USD per 1M tokens) - rates based on standard 2026 provider pricing
export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { promptUsdPerMillion: 2.5, completionUsdPerMillion: 10.0 },
  "gpt-4o-mini": { promptUsdPerMillion: 0.15, completionUsdPerMillion: 0.6 },
  "gpt-4-turbo": { promptUsdPerMillion: 10.0, completionUsdPerMillion: 30.0 },
  "gpt-3.5-turbo": { promptUsdPerMillion: 0.5, completionUsdPerMillion: 1.5 },

  // Groq
  "llama-3.3-70b-versatile": { promptUsdPerMillion: 0.59, completionUsdPerMillion: 0.79 },
  "llama-3.1-8b-instant": { promptUsdPerMillion: 0.05, completionUsdPerMillion: 0.08 },
  "openai/gpt-oss-20b": { promptUsdPerMillion: 0.1, completionUsdPerMillion: 0.2 },

  // Google Gemini
  // gemini-2.5-flash is what providers.server.ts actually sends (GEMINI_MODEL default).
  "gemini-2.5-flash": { promptUsdPerMillion: 0.3, completionUsdPerMillion: 2.5 },
  "gemini-2.5-flash-lite": { promptUsdPerMillion: 0.1, completionUsdPerMillion: 0.4 },
  "gemini-2.0-flash": { promptUsdPerMillion: 0.1, completionUsdPerMillion: 0.4 },
  "gemini-1.5-flash": { promptUsdPerMillion: 0.075, completionUsdPerMillion: 0.3 },
  "gemini-1.5-pro": { promptUsdPerMillion: 1.25, completionUsdPerMillion: 5.0 },

  // xAI
  "grok-4.5": { promptUsdPerMillion: 2.0, completionUsdPerMillion: 10.0 },
  "grok-2": { promptUsdPerMillion: 2.0, completionUsdPerMillion: 10.0 },
  "grok-beta": { promptUsdPerMillion: 5.0, completionUsdPerMillion: 15.0 },

  // Ollama (Self-hosted local)
  "qwen3.6:27b": { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
  "qwen2.5:14b": { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
  "llama3.2": { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },

  // Local rule-based engine
  evidence: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
  local: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
};

// Default pricing for unknown models per provider
export const DEFAULT_PROVIDER_PRICING: Record<string, ModelPricing> = {
  openai: { promptUsdPerMillion: 2.5, completionUsdPerMillion: 10.0 },
  groq: { promptUsdPerMillion: 0.2, completionUsdPerMillion: 0.4 },
  gemini: { promptUsdPerMillion: 0.1, completionUsdPerMillion: 0.4 },
  xai: { promptUsdPerMillion: 2.0, completionUsdPerMillion: 10.0 },
  ollama: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
  local: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
};

/**
 * Baseline price comparison model (e.g. what would this have cost on gpt-4o?)
 */
export const BASELINE_BENCHMARK_PRICING: ModelPricing = {
  promptUsdPerMillion: 2.5,
  completionUsdPerMillion: 10.0,
};

/**
 * Standard USD to INR (Indian Rupee) exchange rate for multi-currency cost tracking.
 * Can be overridden via USD_TO_INR environment variable.
 */
export const USD_TO_INR_RATE =
  typeof process !== "undefined" && process.env?.USD_TO_INR
    ? Number.parseFloat(process.env.USD_TO_INR) || 86.5
    : 86.5;

/**
 * The single price lookup used by both `calculateModelCost` and the model router, so a
 * routing decision and the row it later writes into `model_cost_logs` can never disagree
 * about what a model costs.
 */
export function modelPriceFor(model: string, provider: string): ModelPricing {
  const normModel = String(model || "")
    .toLowerCase()
    .trim();
  const normProvider = String(provider || "")
    .toLowerCase()
    .trim();
  return (
    MODEL_PRICING_TABLE[normModel] ??
    DEFAULT_PROVIDER_PRICING[normProvider] ?? { promptUsdPerMillion: 0, completionUsdPerMillion: 0 }
  );
}

/** Predicted cost of one call at a declared token shape, in USD. */
export function predictCostUsd(args: {
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const price = modelPriceFor(args.model, args.provider);
  return (
    (Math.max(0, args.promptTokens) / 1_000_000) * price.promptUsdPerMillion +
    (Math.max(0, args.completionTokens) / 1_000_000) * price.completionUsdPerMillion
  );
}

/**
 * Estimate token count from text using standard whitespace and punctuation heuristic (~3.8-4 chars/token).
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3.8));
}

/**
 * Calculates model execution cost in USD, Cents, and Rupees (INR) with token estimation fallbacks.
 */
export function calculateModelCost(args: {
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  // Token estimation fallback texts
  promptText?: string;
  completionText?: string;
  text?: string;
}): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  costCents: number;
  costInr: number;
  costRupees: number;
  baselineUsd: number;
  baselineInr: number;
  savingsUsd: number;
  savingsInr: number;
  isEstimatedTokens: boolean;
} {
  const pricing = modelPriceFor(args.model, args.provider);

  let isEstimatedTokens = false;

  // Resolve prompt tokens with fallback to text estimation
  let promptTokens = Math.max(0, args.promptTokens ?? 0);
  if (promptTokens === 0) {
    const rawPrompt = args.promptText || args.text;
    if (rawPrompt) {
      promptTokens = estimateTokensFromText(rawPrompt);
      isEstimatedTokens = true;
    }
  }

  // Resolve completion tokens with fallback to text estimation
  let completionTokens = Math.max(0, args.completionTokens ?? 0);
  if (completionTokens === 0 && args.completionText) {
    completionTokens = estimateTokensFromText(args.completionText);
    isEstimatedTokens = true;
  }

  const totalTokens = promptTokens + completionTokens;

  const promptCost = (promptTokens / 1_000_000) * pricing.promptUsdPerMillion;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionUsdPerMillion;
  const costUsd = promptCost + completionCost;
  const costCents = Math.round(costUsd * 100 * 10000) / 10000; // 4 decimals of cents
  const costInr = Math.round(costUsd * USD_TO_INR_RATE * 10000) / 10000;

  // Benchmark baseline cost (gpt-4o rates)
  const baselinePrompt =
    (promptTokens / 1_000_000) * BASELINE_BENCHMARK_PRICING.promptUsdPerMillion;
  const baselineComp =
    (completionTokens / 1_000_000) * BASELINE_BENCHMARK_PRICING.completionUsdPerMillion;
  const baselineUsd = baselinePrompt + baselineComp;
  const baselineInr = Math.round(baselineUsd * USD_TO_INR_RATE * 10000) / 10000;

  const savingsUsd = Math.max(0, baselineUsd - costUsd);
  const savingsInr = Math.round(savingsUsd * USD_TO_INR_RATE * 10000) / 10000;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    costCents,
    costInr,
    costRupees: costInr,
    baselineUsd: Math.round(baselineUsd * 1_000_000) / 1_000_000,
    baselineInr,
    savingsUsd: Math.round(savingsUsd * 1_000_000) / 1_000_000,
    savingsInr,
    isEstimatedTokens,
  };
}

export function formatCostUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.0001) return `<$0.0001`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatCostCents(cents: number): string {
  if (cents <= 0) return "0.00¢";
  if (cents < 0.01) return `${cents.toFixed(4)}¢`;
  return `${cents.toFixed(2)}¢`;
}

/**
 * Formats a cost in Indian Rupees (₹).
 */
export function formatCostInr(inr: number): string {
  if (inr <= 0) return "₹0.00";
  if (inr < 0.001) return `<₹0.001`;
  if (inr < 0.01) return `₹${inr.toFixed(4)}`;
  if (inr < 1.0) return `₹${inr.toFixed(3)}`;
  return `₹${inr.toFixed(2)}`;
}

/**
 * Alias for formatCostInr.
 */
export const formatCostRupees = formatCostInr;

/**
 * Formats cost standing side by side with dollars, cents, and rupees.
 * Example formats:
 * - "parens" (default): "$0.0075 (0.75¢ • ₹0.65)"
 * - "slash": "$0.0075 / 0.75¢ / ₹0.65"
 * - "inline": "$0.0075 • 0.75¢ • ₹0.65"
 */
export function formatCostSideBySide(
  cost: number | { usd?: number; cents?: number; inr?: number },
  format: "parens" | "slash" | "inline" = "parens",
): string {
  const usd = typeof cost === "number" ? cost : (cost.usd ?? (cost.cents ? cost.cents / 100 : 0));
  const cents = typeof cost === "number" ? cost * 100 : (cost.cents ?? usd * 100);
  const inr =
    typeof cost === "number" ? cost * USD_TO_INR_RATE : (cost.inr ?? usd * USD_TO_INR_RATE);

  const usdStr = formatCostUsd(usd);
  const centsStr = formatCostCents(cents);
  const inrStr = formatCostInr(inr);

  if (format === "slash") {
    return `${usdStr} / ${centsStr} / ${inrStr}`;
  }
  if (format === "inline") {
    return `${usdStr} • ${centsStr} • ${inrStr}`;
  }
  return `${usdStr} (${centsStr} • ${inrStr})`;
}
