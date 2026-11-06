import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateModelCost,
  estimateTokensFromText,
  formatCostCents,
  formatCostInr,
  formatCostRupees,
  formatCostSideBySide,
  formatCostUsd,
  USD_TO_INR_RATE,
} from "./cost.ts";
import { getRecentAccessLogs, recordAccessLog } from "./access-logger.server.ts";
import { DEFAULT_ALERT_RULES } from "./observability.server.ts";

test("calculateModelCost computes correct costs for OpenAI models in USD, Cents, and Rupees (INR)", () => {
  // 1000 prompt tokens, 500 completion tokens on gpt-4o
  // Prompt: (1000 / 1M) * $2.50 = $0.0025
  // Completion: (500 / 1M) * $10.00 = $0.005
  // Total: $0.0075 = 0.75 cents
  // In Rupees at 86.5: 0.0075 * 86.5 = 0.64875 INR ~ 0.65 INR
  const cost = calculateModelCost({
    provider: "openai",
    model: "gpt-4o",
    promptTokens: 1000,
    completionTokens: 500,
  });

  assert.equal(cost.promptTokens, 1000);
  assert.equal(cost.completionTokens, 500);
  assert.equal(cost.totalTokens, 1500);
  assert.equal(cost.costUsd, 0.0075);
  assert.equal(cost.costCents, 0.75);
  assert.ok(cost.costInr > 0.64 && cost.costInr < 0.66);
  assert.equal(cost.costRupees, cost.costInr);
  assert.equal(cost.isEstimatedTokens, false);
});

test("calculateModelCost uses token estimation fallbacks when token counts are missing or zero", () => {
  const promptText =
    "Analyze this candidate profile for Senior Infrastructure Architect role with Kubernetes experience.";
  const completionText = '{"fit": "high", "score": 92}';

  const cost = calculateModelCost({
    provider: "openai",
    model: "gpt-4o-mini",
    promptText,
    completionText,
  });

  assert.ok(cost.promptTokens > 0);
  assert.ok(cost.completionTokens > 0);
  assert.ok(cost.totalTokens > 0);
  assert.equal(cost.isEstimatedTokens, true);
  assert.ok(cost.costUsd > 0);
  assert.ok(cost.costCents > 0);
  assert.ok(cost.costInr > 0);
});

test("calculateModelCost computes zero cost for local/ollama models with benchmark savings", () => {
  const cost = calculateModelCost({
    provider: "ollama",
    model: "qwen3.6:27b",
    promptTokens: 2000,
    completionTokens: 500,
  });

  assert.equal(cost.costUsd, 0);
  assert.equal(cost.costCents, 0);
  // Benchmark baseline cost (gpt-4o rates): (2000/1M)*2.5 + (500/1M)*10 = 0.005 + 0.005 = $0.01
  assert.ok(cost.baselineUsd > 0);
  assert.equal(cost.savingsUsd, cost.baselineUsd);
});

test("calculateModelCost handles Gemini and Groq pricing", () => {
  const groqCost = calculateModelCost({
    provider: "groq",
    model: "llama-3.1-8b-instant",
    promptTokens: 10_000,
    completionTokens: 2_000,
  });
  assert.ok(groqCost.costUsd > 0);
  assert.ok(groqCost.costUsd < 0.01); // Groq 8b is very economical

  const geminiCost = calculateModelCost({
    provider: "gemini",
    model: "gemini-1.5-flash",
    promptTokens: 50_000,
    completionTokens: 10_000,
  });
  assert.ok(geminiCost.costUsd > 0);
  assert.ok(geminiCost.costCents > 0);
});

test("estimateTokensFromText produces reliable token counts", () => {
  assert.equal(estimateTokensFromText(""), 0);
  const sample = "Senior Full Stack Engineer with 7 years experience in distributed systems.";
  const tokens = estimateTokensFromText(sample);
  assert.ok(tokens >= 15 && tokens <= 25);
});

test("formatCostUsd and formatCostCents formats correctly", () => {
  assert.equal(formatCostUsd(0), "$0.00");
  assert.equal(formatCostUsd(0.00005), "<$0.0001");
  assert.equal(formatCostUsd(0.0045), "$0.0045");
  assert.equal(formatCostUsd(12.5), "$12.50");

  assert.equal(formatCostCents(0), "0.00¢");
  assert.equal(formatCostCents(0.75), "0.75¢");
  assert.equal(formatCostCents(120.45), "120.45¢");
});

test("formatCostInr and formatCostRupees formats correctly with rupee symbol", () => {
  assert.equal(formatCostInr(0), "₹0.00");
  assert.equal(formatCostInr(0.0005), "<₹0.001");
  assert.equal(formatCostInr(0.0055), "₹0.0055");
  assert.equal(formatCostInr(0.648), "₹0.648");
  assert.equal(formatCostInr(12.5), "₹12.50");
  assert.equal(formatCostRupees(12.5), "₹12.50");
});

test("formatCostSideBySide formats Rupee standing side by side with dollars and cents", () => {
  // $0.0075 -> 0.75¢ -> ₹0.64875 (~₹0.649)
  const sideBySideParens = formatCostSideBySide(0.0075, "parens");
  assert.ok(sideBySideParens.includes("$0.0075"));
  assert.ok(sideBySideParens.includes("0.75¢"));
  assert.ok(sideBySideParens.includes("₹"));

  const sideBySideSlash = formatCostSideBySide(0.0075, "slash");
  assert.ok(sideBySideSlash.includes("/"));
  assert.ok(sideBySideSlash.includes("$0.0075"));
  assert.ok(sideBySideSlash.includes("₹"));

  const sideBySideInline = formatCostSideBySide(0.0075, "inline");
  assert.ok(sideBySideInline.includes("•"));
  assert.ok(sideBySideInline.includes("$0.0075"));
  assert.ok(sideBySideInline.includes("₹"));

  // Object input
  const fromObject = formatCostSideBySide({ usd: 1.5, cents: 150, inr: 129.75 }, "parens");
  assert.equal(fromObject, "$1.50 (150.00¢ • ₹129.75)");
});

test("recordAccessLog and getRecentAccessLogs stores and retrieves logs in ring buffer", async () => {
  await recordAccessLog({
    method: "GET",
    path: "/api/test-observability",
    statusCode: 200,
    durationMs: 42,
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0 Test",
  });

  await recordAccessLog({
    method: "POST",
    path: "/api/test-error",
    statusCode: 500,
    durationMs: 120,
    errorMessage: "Internal server test error",
  });

  const recent = await getRecentAccessLogs(20);
  assert.ok(recent.length >= 2);
  const postErr = recent.find((l) => l.path === "/api/test-error");
  assert.ok(postErr);
  assert.equal(postErr?.status_code, 500);

  const errorsOnly = await getRecentAccessLogs(20, true);
  assert.ok(errorsOnly.every((l) => l.status_code >= 400));
  assert.ok(errorsOnly.some((l) => l.path === "/api/test-error"));
});

test("DEFAULT_ALERT_RULES contains standard production conditions", () => {
  const ruleIds = DEFAULT_ALERT_RULES.map((r) => r.id);
  assert.ok(ruleIds.includes("error_rate_high"));
  assert.ok(ruleIds.includes("queue_lag_high"));
  assert.ok(ruleIds.includes("failed_jobs_spike"));
  assert.ok(ruleIds.includes("latency_p95_high"));
  assert.ok(ruleIds.includes("cost_spike"));
});
