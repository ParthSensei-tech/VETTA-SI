#!/usr/bin/env node
/**
 * Offline route replay — recomputes `decideRoute` for the whole call mix a 200-application burst
 * generates, with no DB and no network, and prints the clock each arm is given.
 *
 *   node --experimental-strip-types scripts/replay-router-clock.mjs
 *
 * It exists to answer one question without spending a rupee or a laptop minute: does the deadline
 * derived in `model-router.ts` actually exclude the arms that cannot meet it, and leave the keyless
 * fast path alone? The invariant it asserts is the one the user's design depends on: a recruiter
 * watching a spinner must never be served a CPU-only Ollama arm, and a detached background job may.
 *
 * Deliberately NOT in `npm test`: it is a replay of the current registry priors, so a retuned
 * `decodeTokensPerSec` should change its output rather than break CI.
 */

import { decideRoute } from "../src/features/ai/domain/model-router.ts";
import { buildResumeList, buildRoles, longJdText } from "../src/lib/recruiting/benchmark/corpus.ts";
import { MODEL_ARMS, TASK_PROFILES } from "../src/features/ai/domain/model-registry.ts";

const CLOUD_KEYS = {
  GROQ_API_KEY: "replay",
  GEMINI_API_KEY: "replay",
  OPENAI_API_KEY: "replay",
};

/** A verdict for every engine, so the replay measures the clock rather than the risk gate. */
const ALL_ENGINES = [...new Set(MODEL_ARMS.map((a) => a.provider))];
const gatesFor = (task) => ALL_ENGINES.map((engine) => ({ task, engine }));

const role = buildRoles()[0];
const [resume] = buildResumeList({ count: 1 });
const jd = longJdText(role);

/**
 * Prompt bodies at least as large as the ones the call sites send. `decideRoute` clips each to its
 * profile's `inputClipChars`, so a rank prompt here is the worst case the router ever prices.
 */
const RANK_BODY = `${jd}\n\nResume:\n${resume.resumeText}\n\nMore JD context:\n${jd}`;
const PROMPTS = {
  rank: RANK_BODY,
  evaluate: RANK_BODY,
  client_card: `Draft a shortlist card.\n${jd}\n${resume.resumeText}`,
  screen_generate: `Generate screening questions for:\n${jd}`,
  follow_up: `Candidate answered: 5 years at fintech, 30 days notice, wants 32 LPA.\n${jd}`,
  rubric_draft: `Draft a rubric for:\n${jd}`,
  test: "Reply with JSON only.",
};

/**
 * A day of traffic on a CPU-only laptop: the local arm never finished, so its history is a stack of
 * aborted attempts and the hosted arms have real medians. This is the data that used to make the
 * slow arm look "fast and unreliable".
 */
const CPU_HISTORY = [
  {
    armId: "ollama:qwen2.5:14b",
    task: "rank",
    samples: 30,
    avgPromptTokens: 4_200,
    avgCompletionTokens: 1_500,
    avgCostCents: 0,
    p50DurationMs: 0,
    successRate: 1,
    abortedSamples: 30,
    abortedElapsedMaxMs: 118_000,
  },
  {
    armId: "groq:llama-3.1-8b-instant",
    task: "rank",
    samples: 30,
    avgPromptTokens: 4_200,
    avgCompletionTokens: 1_400,
    avgCostCents: 0.06,
    p50DurationMs: 640,
    successRate: 0.99,
  },
];

const CONTEXTS = [
  { context: "interactive", deadlineMs: 16_000 },
  { context: "bulk", deadlineMs: 45_000 },
  { context: "background", deadlineMs: 120_000 },
];

function routeFor(task, { context, deadlineMs }, env, history, gates) {
  const profile = TASK_PROFILES[task];
  return decideRoute({
    task,
    promptText: PROMPTS[task],
    requestedMaxTokens: profile.outputCeiling,
    env,
    context,
    deadlineMs,
    history,
    gates,
    // The laptop case: Ollama is running, so its arms are live candidates for the clock to judge.
    isHostAvailable: () => true,
  });
}

const rows = [];
const problems = [];

const probe = routeFor("rank", CONTEXTS[0], CLOUD_KEYS, [], gatesFor("rank"));
console.log(
  `rank prompt ${RANK_BODY.length} chars -> clipped to ${TASK_PROFILES.rank.inputClipChars}, ` +
    `priced at ${probe.expectedPromptTokens} prompt tokens`,
);

for (const [scenario, env, history, gates] of [
  ["cloud keys, cold", CLOUD_KEYS, [], gatesFor("rank")],
  ["cloud keys, rank gate CLOSED (a real candidate's fate)", CLOUD_KEYS, [], []],
  ["cloud keys, a day of CPU-only aborts", CLOUD_KEYS, CPU_HISTORY, gatesFor("rank")],
  ["no cloud keys, Ollama up (the burst path)", {}, [], gatesFor("rank")],
]) {
  for (const task of Object.keys(PROMPTS)) {
    for (const ctx of CONTEXTS) {
      const d = routeFor(task, ctx, env, history, gates);
      const excluded = d.armBudgets.filter((b) => b.tooSlow).map((b) => b.armId);
      rows.push({
        scenario,
        task,
        context: ctx.context,
        chosen: d.chosen ? `${d.chosen.id}` : "(none)",
        timeoutMs: d.timeoutMs,
        tokens: `${d.suggestedMaxTokens}/${d.maxTokens}`,
        estMs: d.ranked.find((r) => r.armId === d.chosen?.id)?.expectedMs ?? 0,
        excluded,
      });

      // The invariants.
      if (task === "rank" && ctx.context === "interactive" && d.chosen?.id.startsWith("ollama:")) {
        problems.push(
          `${scenario}: an interactive rank went to ${d.chosen.id} inside ${ctx.deadlineMs}ms`,
        );
      }
      if (d.timeoutMs > ctx.deadlineMs) {
        problems.push(
          `${scenario}/${task}/${ctx.context}: timeout ${d.timeoutMs}ms exceeds the deadline`,
        );
      }
      if (d.timeoutMs < 1_000) {
        problems.push(
          `${scenario}/${task}: timeout ${d.timeoutMs}ms is not a usable attempt budget`,
        );
      }
      if (!d.chosen && Object.keys(env).length > 0) {
        problems.push(
          `${scenario}/${task}/${ctx.context}: nothing eligible, which the keys should prevent`,
        );
      }
      // The 200-application burst is keyless and local, so the clock must cost it exactly nothing.
      if (!Object.keys(env).length && task === "rank" && ctx.context === "interactive") {
        if (d.chosen?.id !== "local:evidence") {
          problems.push(
            `keyless burst rank went to ${d.chosen?.id} instead of the local evidence engine`,
          );
        }
        if (d.timeoutMs !== 14_000) {
          problems.push(`the keyless fast path lost its floor: ${d.timeoutMs}ms`);
        }
      }
    }
  }
}

const pad = (s, n) => String(s).padEnd(n);
for (const scenario of [...new Set(rows.map((r) => r.scenario))]) {
  console.log(`\n=== ${scenario} ===`);
  console.log(
    pad("task", 16) +
      pad("context", 13) +
      pad("chosen", 26) +
      pad("timeout", 9) +
      pad("tokens", 11) +
      pad("p50 est", 9) +
      "clock-excluded",
  );
  for (const r of rows.filter((x) => x.scenario === scenario)) {
    console.log(
      pad(r.task, 16) +
        pad(r.context, 13) +
        pad(r.chosen, 26) +
        pad(`${r.timeoutMs}ms`, 9) +
        pad(r.tokens, 11) +
        pad(`${Math.round(r.estMs)}ms`, 9) +
        (r.excluded.length ? r.excluded.join(", ") : "—"),
    );
  }
}

if (problems.length) {
  console.log("\nINVARIANT VIOLATIONS");
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nAll replay invariants held.");
