/**
 * Live test script: Calls OpenRouter google/gemma-4-31b-it:free with the user's exact
 * strawberry prompt and prints streamed response + reasoning tokens.
 *
 * Usage:
 *   node --experimental-strip-types scripts/test-openrouter.ts
 */

// Load .env before anything else (Node 22 --env-file alternative for scripts)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
try {
  const envPath = resolve(process.cwd(), ".env");
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch { /* .env optional */ }

import { OpenRouter } from "../src/features/ai/server/openrouter-client.server.ts";
import { fetchOpenRouterKeyInfo, getOpenRouterBudgetLimits } from "../src/features/ai/server/openrouter-guardrail.server.ts";

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Vetta ATS — OpenRouter Live Test (google/gemma-4-31b-it:free)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const limits = getOpenRouterBudgetLimits();
  console.log(`📊 Budget Guardrails:`);
  console.log(`   Credit Limit  : $${limits.creditLimitUsd.toFixed(2)} USD`);
  console.log(`   Warn Threshold: $${limits.warnLimitUsd.toFixed(2)} USD`);
  console.log(`   Hard Cutoff   : $${limits.hardLimitUsd.toFixed(2)} USD`);
  console.log(`   Max Tokens/req: ${limits.maxTokensPerCall}\n`);

  // Fetch live key info from OpenRouter
  console.log("🔑 Fetching live key info from OpenRouter /auth/key ...");
  const keyInfo = await fetchOpenRouterKeyInfo();
  if (keyInfo) {
    console.log(`   Usage    : $${keyInfo.usage.toFixed(4)} USD`);
    console.log(`   Limit    : ${keyInfo.limit !== null ? `$${keyInfo.limit.toFixed(2)} USD` : "unlimited"}`);
    console.log(`   Free Tier: ${keyInfo.isFreeTier}`);
    if (keyInfo.rateLimit) {
      console.log(`   Rate Limit: ${keyInfo.rateLimit.requests} requests / ${keyInfo.rateLimit.interval}`);
    }
  } else {
    console.log("   (Could not fetch key info — proceeding with local in-memory guardrail)\n");
  }

  console.log("\n🤖 Sending streaming request ...");
  console.log("   Model  : google/gemma-4-31b-it:free");
  console.log("   Prompt : \"How many r's are in the word 'strawberry'?\"\n");
  console.log("── Response ─────────────────────────────────────────────────\n");

  const openrouter = new OpenRouter();

  // Exact interface from user's snippet
  const stream = await openrouter.chat.send({
    chatRequest: {
      model: "google/gemma-4-31b-it:free",
      messages: [
        {
          role: "user",
          content: "How many r's are in the word 'strawberry'?",
        },
      ],
      stream: true,
    },
  });

  let response = "";
  let reasoningTokens: number | undefined;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for await (const chunk of stream as AsyncIterable<any>) {
    const content = chunk.choices[0]?.delta?.content;
    const reasoning = chunk.choices[0]?.delta?.reasoning;
    if (content) {
      response += content;
      process.stdout.write(content);
    } else if (reasoning) {
      process.stdout.write(reasoning);
    }

    // Usage information comes in the final chunk (exact SDK parity)
    if (chunk.usage) {
      totalPromptTokens = chunk.usage.prompt_tokens ?? totalPromptTokens;
      totalCompletionTokens = chunk.usage.completion_tokens ?? totalCompletionTokens;
      reasoningTokens = chunk.usage.completionTokensDetails?.reasoningTokens ?? reasoningTokens;
    }
  }

  console.log("\n\n── Telemetry ─────────────────────────────────────────────────\n");
  console.log(`   Prompt Tokens    : ${totalPromptTokens}`);
  console.log(`   Completion Tokens: ${totalCompletionTokens}`);
  if (reasoningTokens !== undefined) {
    console.log(`   Reasoning Tokens : ${reasoningTokens}`);
  } else {
    console.log(`   Reasoning Tokens : (not reported by model on this call)`);
  }

  // Verify key info again to show delta (best effort)
  const keyInfoAfter = await fetchOpenRouterKeyInfo();
  if (keyInfoAfter) {
    console.log(`\n   Budget After Request:`);
    console.log(`   Usage : $${keyInfoAfter.usage.toFixed(6)} USD`);
    console.log(`   Remaining : $${(keyInfoAfter.limit ?? limits.creditLimitUsd) - keyInfoAfter.usage > 0 ? ((keyInfoAfter.limit ?? limits.creditLimitUsd) - keyInfoAfter.usage).toFixed(4) : "N/A"} USD`);
  }

  console.log("\n✅ Test complete — OpenRouter :free model works with $0 token cost.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err.message || err);
  process.exit(1);
});
