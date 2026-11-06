#!/usr/bin/env node
/**
 * Vetta resume -> job-description match benchmark.
 *
 * Answers: how long does checking one resume against a JD take, when that resume
 * arrives as part of a multi-resume slate — and where that time is spent.
 *
 *   npm run bench:match -- --n=25 --reps=30
 *
 * Deliberately NOT part of `npm test`: it is a minute-scale perf harness whose
 * timings are nondeterministic, so it must never gate CI on a slow laptop.
 */

import { resolvedSpecifiers } from "./bench-resolve-hooks.mjs";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const boolFlag = (name, dflt = false) =>
  argv.includes(`--${name}`) ? true : argv.includes(`--no-${name}`) ? false : dflt;

const opts = {
  n: Number(flag("n", 25)),
  reps: Number(flag("reps", 30)),
  warmup: Number(flag("warmup", 5)),
  maxJobs: Number(flag("max-jobs", 24)),
  concurrency: Number(flag("concurrency", 8)),
  budgetMs: Number(flag("budget-ms", 45000)),
  deadlineMs: Number(flag("deadline-ms", 240000)),
  slates: flag("slates", "25,200"),
  orgCoversTraining: boolFlag("org-covers-training", false),
  suppressDeepen: boolFlag("suppress-deepen", true),
  suppressEmbedding: boolFlag("suppress-embedding", true),
  maxDrift: Number(flag("max-drift", 1.15)),
  freezeBaseline: argv.includes("--freeze-baseline"),
};

const t_boot_start = performance.now();
const { getSql, dbSource } = await import("../src/lib/db.ts");
await getSql();
const bootMs = Math.round(performance.now() - t_boot_start);

const P = await import("../src/lib/recruiting/benchmark/phases.ts");
const { calculateModelCost, formatCostSideBySide } = await import("../src/lib/observability/cost.ts");

if (opts.suppressDeepen) P.openAllCircuits();
if (opts.suppressEmbedding) P.suppressEmbeddingWorker();

// ---------------------------------------------------------------------------
// Fidelity gate — refuse to report numbers if the fast path silently fell back.
// ai.server.ts try/catches its embed/calibrate/outcome imports, so an unresolved
// specifier does not error; it just measures a degraded path. `rank.explain` is
// only attached when those modules truly loaded, so it is the probe.
// ---------------------------------------------------------------------------
const ctx = await P.setupBench({ slateSize: Math.max(opts.n, opts.reps) + 10, orgCoversTraining: opts.orgCoversTraining });
{
  const { parseAndRank } = await import("../src/lib/recruiting/ai.server.ts");
  const probeRole = ctx.roles[0];
  const probe = await parseAndRank({
    resumeText: ctx.resumes[5].resumeText,
    role: P.toRankRole(probeRole),
    mode: "fast",
    userId: ctx.userId,
    orgId: ctx.orgId,
    roleId: probeRole.roleId,
    candidateId: "bench_probe",
    bypassCache: true,
  });
  const ok = probe.ok && probe.rank.explain != null;
  if (!ok) {
    console.error(
      "\nBENCHMARK ABORTED — fidelity check failed.\n" +
        "The fast path did not attach `rank.explain`, which means calibrate/outcome/" +
        "domain-embed imports were swallowed by try/catch and the numbers would measure\n" +
        "the pure match engine rather than the production pipeline.\n" +
        `explain=${probe.ok ? String(probe.rank.explain != null) : "n/a"} ` +
        `resolvedSpecifiers=${JSON.stringify(resolvedSpecifiers()).slice(0, 400)}\n`,
    );
    process.exit(2);
  }
  console.log(`fidelity probe: OK (explain attached; ${Object.keys(resolvedSpecifiers()).length} aliased specifiers resolved)`);
}

const uniq = await P.verifyDedupe(ctx.resumes, ctx.userId);
if (!uniq.ok) {
  console.error(`BENCHMARK ABORTED — corpus not unique: ${JSON.stringify(uniq)}`);
  process.exit(2);
}

const L1 = await P.phaseL1(ctx, opts.reps * 10, opts.warmup);
const L2 = await P.phaseL2(ctx, opts.reps, opts.warmup);
const L3 = await P.phaseL3(ctx, Math.max(10, Math.floor(opts.reps / 2)), opts.warmup);
const L4 = await P.phaseL4(ctx, opts.reps, opts.warmup);

const slates = String(opts.slates)
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((x) => Number.isFinite(x) && x > 0);
const L5 = [];
for (const size of slates) {
  console.log(`  running ${size}-resume slate...`);
  L5.push(await P.phaseL5(ctx, { n: size, maxJobs: opts.maxJobs, concurrency: opts.concurrency, budgetMs: opts.budgetMs, deadlineMs: opts.deadlineMs }));
}
const L6 = await P.phaseL6(ctx, { n: 3, openCircuits: opts.suppressDeepen });

// Post-run check: did the slates actually materialize as distinct candidate rows,
// or did email/resume_hash dedupe silently collapse them into cache hits?
const uniqAfter = await P.verifyDedupe(ctx.resumes, ctx.userId);

// ---------------------------------------------------------------------------
// Pricing outputs: what a free rank costs vs what a paid (provider) rank costs.
// ---------------------------------------------------------------------------
const sql = await getSql();
const localCost = await sql`
  select sum(cost_cents)::float8 as total_cents, count(*)::int as n
  from model_cost_logs where user_id = ${ctx.userId} and provider = 'local'`;
const costCentsPerRankLocal =
  Number(localCost[0]?.total_cents ?? 0) > 0 && Number(localCost[0]?.n ?? 0) > 0
    ? Number(localCost[0].total_cents) / Number(localCost[0].n)
    : 0;

// Provider COGS per rank, estimated from the prompt the ladder would actually send.
// Two completion figures, because they differ by ~9x:
//   typical = what a local/short rank actually returns (recordModelCost uses 250)
//   cap     = maxTokens 2200 passed to the rank call (ai.server.ts:672)
const { RANK_SYSTEM } = await import("../src/lib/recruiting/ai.server.ts");
const PROVIDERS = [
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "gemini", model: "gemini-2.0-flash" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "xai", model: "grok-4.5" },
];
// Resume body sizes the estimate is computed at: the gold fixture, a typical PDF
// extract, a content-rich CV, and the 40k-char ingest cap (batch.ts:MAX_RESUME_CHARS).
const RESUME_SIZES = [
  { label: "gold_fixture", chars: (ctx.resumes[4]?.resumeText ?? "").length },
  { label: "typical_4k", chars: 4000 },
  { label: "rich_12k", chars: 12000 },
  { label: "ingest_cap_40k", chars: 40000 },
];
const JD_TYPICAL = 3000;
const JD_CAP = 8000; // MAX_JD_CHARS, ai.server.ts:38

const costMatrix = [];
for (const size of RESUME_SIZES) {
  for (const jdChars of [JD_TYPICAL, JD_CAP]) {
    const promptText = `${RANK_SYSTEM}\n${"x".repeat(size.chars)}\n${"y".repeat(jdChars)}`;
    for (const p of PROVIDERS) {
      const typical = calculateModelCost({
        provider: p.provider, model: p.model, promptText, completionText: "z".repeat(250 * 3.8),
      });
      const capped = calculateModelCost({
        provider: p.provider, model: p.model, promptText, completionText: "z".repeat(2200 * 3.8),
      });
      costMatrix.push({
        resumeChars: size.chars,
        resumeBucket: size.label,
        jdChars,
        provider: p.provider,
        model: p.model,
        promptTokens: typical.promptTokens,
        completionTokensTypical: typical.completionTokens,
        completionTokensCap: capped.completionTokens,
        inrTypical: typical.costInr,
        inrCap: capped.costInr,
        usdTypical: typical.costUsd,
        usdCap: capped.costUsd,
        tokensEstimated: true,
      });
    }
  }
}
const cheapestPerTypicalRank = Math.min(
  ...costMatrix.filter((c) => c.resumeBucket === "typical_4k" && c.jdChars === JD_TYPICAL).map((c) => c.inrTypical),
);
const dearestPerTypicalRank = Math.max(
  ...costMatrix.filter((c) => c.resumeBucket === "typical_4k" && c.jdChars === JD_TYPICAL).map((c) => c.inrTypical),
);

const cores = os.cpus().length;
const freeTier = {
  cpuMsPerRank_p95: L1.stats.p95,
  cores,
  ranksPerSecPerCore: Math.round(1000 / Math.max(0.001, L1.stats.mean)),
  note: "Pure match-engine CPU. No external COGS — this is why local ranking can be free.",
};

const allStats = { L1: L1.stats, L2: L2.stats, L4: L4.stats };
const dominant = (() => {
  const pairs = [
    ["L1_engine_cpu", L1.stats.p50],
    ["L2_fast_path_db_work", Math.max(0, L2.stats.p50 - L1.stats.p50)],
    ["L4_ingest_writes", Math.max(0, L4.stats.p50 - L2.stats.p50)],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0][0];
})();

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------
const BASELINE_PATH = path.join("artifacts", "benchmarks", "baseline.json");
let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  baseline = null;
}
const gate = { passed: true, reasons: [], mode: baseline ? "vs-baseline" : "vs-in-file-targets" };
const targets = { L1_p95: 50, L2_p95: 4000, L4_p95: 8000 };
if (baseline) {
  for (const k of ["L1", "L2", "L4"]) {
    const b = baseline?.phases?.[k]?.p95;
    if (typeof b === "number" && allStats[k].p95 > b * opts.maxDrift) {
      gate.passed = false;
      gate.reasons.push(`${k}.p95 ${allStats[k].p95}ms exceeds baseline ${b}ms x ${opts.maxDrift}`);
    }
  }
} else {
  for (const [k, t] of [["L1", targets.L1_p95], ["L2", targets.L2_p95], ["L4", targets.L4_p95]]) {
    if (allStats[k].p95 > t) {
      gate.passed = false;
      gate.reasons.push(`${k}.p95 ${allStats[k].p95}ms exceeds provisional target ${t}ms (no baseline.json yet)`);
    }
  }
}
// sanity floors — if these fail, the harness itself is wrong
if (!(L2.stats.p50 > L1.stats.p50)) gate.reasons.push("ORDERING: L2.p50 is not greater than L1.p50 — fast path may not be doing real work");
if (!(L3.mem.p50 < L2.stats.p50)) gate.reasons.push("ORDERING: L3 memHit is not faster than L2 — cache may not be engaged");
if (L5.some((s) => s.notCompleted !== 0)) gate.reasons.push(`QUEUE: slates left jobs uncompleted (${L5.map((s) => s.notCompleted).join(", ")})`);
if (uniqAfter.distinctCandidates < Math.max(...slates, 0)) {
  gate.reasons.push(
    `DEDUPE: slate produced only ${uniqAfter.distinctCandidates} distinct candidates for a ${Math.max(...slates, 0)}-resume corpus — timings would be cache hits, not fresh ranks`,
  );
}
if (L5.some((s) => s.failed > 0)) gate.reasons.push(`QUEUE: slates had failed jobs (${L5.map((s) => s.failed).join(", ")})`);
if (!L6.engines.every((e) => e === "local")) gate.reasons.push(`L6: ladder engines not all local: ${JSON.stringify(L6.engines)}`);
if (gate.reasons.length && gate.passed) gate.passed = false;

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const row = (label, st, extra = "") =>
  `${label.padEnd(34)} n=${String(st.n).padStart(4)}  p50=${String(st.p50).padStart(9)}  p95=${String(st.p95).padStart(10)}  p99=${String(st.p99).padStart(10)}  max=${String(st.max).padStart(10)}${extra}`;

console.log("\n=================================================================");
console.log(`Vetta resume -> JD match benchmark   [${String(vendor())}]`);
console.log("=================================================================");
console.log(row("L1 pure match engine (rankLocally)", L1.stats));
console.log(row("L2 fast path, forced cache miss", L2.stats));
console.log(row("L3 cache hit (process-local map)", L3.mem, `  dbHits=${L3.dbHits}`));
console.log(row("L3 cache hit (DB tier)", L3.db));
console.log(row("L4 full ingest (persistRanked)", L4.stats, `  errors=${L4.errors.length}`));
for (const s of L5) {
  console.log(
    `L5 slate n=${String(s.n).padEnd(4)} wall=${s.wallMs}ms  perResume=${s.perResumeMs}ms  ` +
      `${s.resumesPerSec}/sec  processed=${s.processed} completed=${s.completed} failed=${s.failed}  ` +
      `slices=${s.slices} derivedParallelism=${s.derivedParallelism}`,
  );
  console.log(`     job durations p50=${s.jobDuration.p50} p95=${s.jobDuration.p95} p99=${s.jobDuration.p99}  queueAge p95=${s.queueAge.p95}`);
}
console.log(row("L6 LLM ladder (overhead, no keys)", L6.stats, `  engines=${[...new Set(L6.engines)].join("/")}`));
console.log("-----------------------------------------------------------------");
console.log(`dominant time sink: ${dominant}`);
console.log(`free-tier headroom: ${freeTier.cpuMsPerRank_p95}ms CPU/rank p95 across ${cores} cores => ~${freeTier.ranksPerSecPerCore} ranks/sec/core`);
console.log(`local COGS/rank (measured): ${costCentsPerRankLocal.toFixed(4)} cents`);
console.log("\nLLM COGS per rank (ESTIMATED tokens, no live provider calls):");
console.log(`  ${"resume/JD".padEnd(22)}${"provider".padEnd(26)}promptTok  typical      capped`);
for (const c of costMatrix) {
  const bucket = `${c.resumeBucket}/${c.jdChars}jd`;
  console.log(
    `  ${bucket.padEnd(22)}${(c.provider + "/" + c.model).padEnd(26)}` +
      `${String(c.promptTokens).padEnd(11)}${formatCostSideBySide(c.usdTypical, "parens").padEnd(13)}${formatCostSideBySide(c.usdCap, "parens")}`,
  );
}
console.log(`  typical 4k resume + 3k JD band: ₹${cheapestPerTypicalRank.toFixed(3)}–₹${dearestPerTypicalRank.toFixed(3)} per rank`);
console.log("");
console.log(`L2 internal meta.latencyMs p50=${L2.internalLatency.p50} (cross-check vs wall ${L2.stats.p50})`);
console.log(`gate: ${gate.passed ? "PASS" : "FAIL"} (${gate.mode})${gate.reasons.length ? "\n  - " + gate.reasons.join("\n  - ") : ""}`);
console.log("=================================================================\n");

function vendor() {
  return `${process.version} / ${dbSource} / ${os.platform()} / ${os.cpus()[0]?.model?.trim().slice(0, 28) ?? "cpu"}`;
}

const artifact = {
  schema: "vetta.benchmark.resume-match/v1",
  generatedAt: new Date().toISOString(),
  env: {
    node: process.version,
    backend: dbSource,
    platform: os.platform(),
    cpus: cores,
    aiConfigured: L6.aiConfigured,
    providersAvailable: L6.providersAvailable,
    circuitsPreOpened: opts.suppressDeepen,
    embeddingWorkerSuppressed: opts.suppressEmbedding,
  },
  boot: { ms: bootMs, excludedFromPerResume: true },
  corpus: uniq,
  corpusPostRun: uniqAfter,
  flags: opts,
  phases: {
    L1: L1.stats,
    L2: { ...L2.stats, internalLatencyMs: L2.internalLatency },
    L3: { memHit: L3.mem, dbHit: L3.db, dbHits: L3.dbHits },
    L4: { ...L4.stats, errors: L4.errors.slice(0, 5) },
    L5: { slates: L5 },
    L6: { ...L6.stats, engines: L6.engines, note: L6.note },
  },
  dominantLayer: dominant,
  pricing: {
    freeTierHeadroom: freeTier,
    costCentsPerRankLocal,
    localRankExternalCogsIsZero: costCentsPerRankLocal === 0,
    llm: {
      cheapestInrPerTypicalRank: cheapestPerTypicalRank,
      dearestInrPerTypicalRank: dearestPerTypicalRank,
      matrix: costMatrix,
    },
    cacheHitsUnbilled: true,
  },
  gate,
};

mkdirSync(path.join("artifacts", "benchmarks"), { recursive: true });
const stamp = artifact.generatedAt.replace(/[:.]/g, "-");
writeFileSync(path.join("artifacts", "benchmarks", `resume-match-${stamp}.json`), JSON.stringify(artifact, null, 2));
writeFileSync(path.join("artifacts", "benchmarks", "latest.json"), JSON.stringify(artifact, null, 2));
if (opts.freezeBaseline) {
  const slim = {
    schema: "vetta.benchmark.baseline/v1",
    frozenAt: artifact.generatedAt,
    env: artifact.env,
    phases: { L1: { p95: L1.stats.p95 }, L2: { p95: L2.stats.p95 }, L4: { p95: L4.stats.p95 } },
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(slim, null, 2));
  console.log(`baseline written to ${BASELINE_PATH}`);
}
console.log(`artifact: artifacts/benchmarks/resume-match-${stamp}.json (+ latest.json)`);

process.exitCode = gate.passed ? 0 : 1;
