/**
 * Layered latency measurement for resume -> job-description matching.
 *
 * The layers exist because the pipeline is not one number: the match engine is pure
 * CPU, but the production fast path around it performs rubric loads, privacy checks,
 * embedding observation, calibration and cache writes — many DB round-trips per resume.
 * Measuring only the engine understates real per-resume cost by orders of magnitude.
 *
 * L0 boot   L1 pure engine   L2 fast path (cache miss)   L3 cache hits
 * L4 full ingest (persistRanked)   L5 whole multi-resume slate (queue)   L6 LLM ladder
 * L7 live arms — the only phase that does not pre-open the circuits, i.e. the only one that
 * measures a model instead of measuring the decision to skip one.
 */

import { getSql } from "../../../platform/db.ts";
import { rankLocally } from "../local-rank.ts";
import type { CallContext } from "../../../features/ai/domain/model-registry.ts";
import {
  buildResumeList,
  buildRoles,
  verifyUniqueness,
  type BenchResume,
  type BenchRole,
} from "./corpus.ts";

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

export type Stats = {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
};

/** Local copy: the harness `percentile` (harness/scorer.ts:71) is not exported. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export function summarize(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return {
    n: s.length,
    min: round3(s[0] ?? 0),
    p50: round3(percentile(s, 0.5) ?? 0),
    p95: round3(percentile(s, 0.95) ?? 0),
    p99: round3(percentile(s, 0.99) ?? 0),
    max: round3(s[s.length - 1] ?? 0),
    mean: round3(mean),
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// async-tail suppression
// ---------------------------------------------------------------------------

const PROVIDER_NAMES = ["groq", "gemini", "openai", "ollama", "xai"];

/**
 * Pre-open every provider circuit. Two effects: L6 measures ladder overhead rather
 * than burning real network timeouts, and the auto-deepen tail that fires when a batch
 * completes (queue.server.ts:106-124, top-12 mode:"full") degrades to local instantly
 * instead of contaminating the slate wall-clock with 12 ladder walks.
 */
export function openAllCircuits(): void {
  const g = globalThis as typeof globalThis & {
    __vettaCircuits__?: Map<string, { openUntil: number; fails: number }>;
  };
  g.__vettaCircuits__ ??= new Map();
  for (const p of PROVIDER_NAMES)
    g.__vettaCircuits__.set(p, { openUntil: Date.now() + 60 * 60_000, fails: 5 });
}

/**
 * The embedding worker self-schedules from `indexNewCandidate` and lazily loads
 * `@xenova/transformers` (network + heavy CPU on this same loop). Installing a
 * sentinel timer makes `ensureEmbeddingWorker()` (embedding-queue.server.ts:340-341)
 * return early, so L4/L5 measure ingest cost rather than model loading.
 */
export function suppressEmbeddingWorker(): void {
  const g = globalThis as typeof globalThis & {
    __vettaEmbeddingTimer__?: ReturnType<typeof setTimeout>;
  };
  const sentinel = setTimeout(() => {}, 0);
  clearTimeout(sentinel);
  g.__vettaEmbeddingTimer__ = sentinel;
}

export function restoreEmbeddingWorker(): void {
  const g = globalThis as typeof globalThis & {
    __vettaEmbeddingTimer__?: ReturnType<typeof setTimeout>;
  };
  g.__vettaEmbeddingTimer__ = undefined;
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

export type BenchCtx = {
  userId: string;
  orgId: string;
  roles: BenchRole[];
  roleById: Map<string, BenchRole>;
  resumes: BenchResume[];
  backend: string;
};

function newId(): string {
  return crypto.randomUUID();
}

/** Rank-role object the pipeline expects (ai.server.ts RankRoleInput shape). */
export function toRankRole(r: BenchRole) {
  return {
    companyName: r.companyName,
    companyStage: r.companyStage,
    title: r.title,
    location: r.location,
    workMode: r.workMode,
    compensationBand: r.compensationBand,
    stack: r.stack,
    mustHaves: r.mustHaves,
    niceToHaves: r.niceToHaves,
    jdText: r.jdText,
  } as unknown as Parameters<typeof rankLocally>[0]["role"];
}

export async function setupBench(opts: {
  slateSize: number;
  orgCoversTraining?: boolean;
}): Promise<BenchCtx> {
  const sql = await getSql();
  const userId = `bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { ensureUserOrg } = await import("../org.server.ts");
  const org = await ensureUserOrg(userId, `Vetta Bench Org ${Date.now()}`);

  if (opts.orgCoversTraining) {
    // Default is false (migration 0015:9), which makes ai.server.ts skip the *resume*
    // embedding observation. Flip it to measure the heavier variant too.
    await sql`update organizations set employer_covers_model_training = true where id = ${org.orgId}`;
  }

  const roles = buildRoles();
  // Suffix role ids per run so repeat runs never collide (harmless on in-memory
  // PGLite, mandatory before this ever points at a real Postgres).
  const runTag = Date.now().toString(36).slice(-5);
  for (const r of roles) {
    r.roleId = `${r.roleId}_${runTag}`;
    await sql`
      insert into roles (id, user_id, company_name, company_stage, title, location, work_mode,
        compensation_band, stack, must_haves, nice_to_haves, jd_text, status, org_id)
      values (${r.roleId}, ${userId}, ${r.companyName}, ${r.companyStage}, ${r.title}, ${r.location},
        ${r.workMode}, ${r.compensationBand}, ${JSON.stringify(r.stack)}, ${JSON.stringify(r.mustHaves)},
        ${JSON.stringify(r.niceToHaves)}, ${r.jdText}, 'open', ${org.orgId})`;
  }

  const { dbSource } = await import("../../../platform/db.ts");
  return {
    userId,
    orgId: org.orgId,
    roles,
    roleById: new Map(roles.map((r) => [r.roleId, r])),
    resumes: buildResumeList({ count: opts.slateSize, roles }),
    backend: dbSource,
  };
}

/** Real `ingest_batches` / `ingest_jobs` rows, so L5 drives the production queue. */
export async function seedSlate(ctx: BenchCtx, list: BenchResume[]): Promise<string> {
  const sql = await getSql();
  const batchId = `bench_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Job ids must be unique across every slate seeded in one process (L4 + each L5 size).
  const jobPrefix = `bj_${batchId.slice(-6)}_`;
  await sql`
    insert into ingest_batches (id, user_id, role_id, source_name, status, total_count, org_id)
    values (${batchId}, ${ctx.userId}, ${list[0]?.roleId ?? ctx.roles[0].roleId}, 'benchmark', 'queued',
      ${list.length}, ${ctx.orgId})`;
  // Chunk 25 per statement, mirroring MAX_ITEMS_PER_APPEND (batch.ts:8).
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    for (const r of chunk) {
      await sql`
        insert into ingest_jobs (id, user_id, batch_id, role_id, filename, resume_text, status, org_id)
        values (${jobPrefix + r.index}, ${ctx.userId}, ${batchId}, ${r.roleId}, ${r.filename},
          ${r.resumeText}, 'queued', ${ctx.orgId})`;
    }
  }
  return batchId;
}

/**
 * The correctness assertion that protects every downstream number: if email or
 * resume_hash collided, `persistRanked` dedupes the slate into fewer applications
 * and the timings silently become cache hits.
 */
export async function verifyDedupe(
  list: BenchResume[],
  scopeUserId?: string,
): Promise<{
  ok: boolean;
  n: number;
  distinctEmails: number;
  distinctTexts: number;
  distinctHashes: number;
  distinctCandidates: number;
}> {
  const mem = verifyUniqueness(list);
  const sql = await getSql();
  const { hashResumeText } = await import("../hash.ts");
  const hashes = new Set(list.map((r) => hashResumeText(r.resumeText)));
  const rows = scopeUserId
    ? await sql<{ c: number }>`
        select count(distinct email)::int as c from candidates
        where user_id = ${scopeUserId} and email like '%@bench.invalid'`
    : await sql<{ c: number }>`
        select count(distinct email)::int as c from candidates
        where email like '%@bench.invalid'`;
  return {
    ok: mem.ok && hashes.size === list.length,
    n: list.length,
    distinctEmails: mem.distinctEmails,
    distinctTexts: mem.distinctTexts,
    distinctHashes: hashes.size,
    distinctCandidates: rows[0]?.c ?? 0,
  };
}

// ---------------------------------------------------------------------------
// phases
// ---------------------------------------------------------------------------

/** Time `fn` over the first `n` resumes, dropping `warmup` leading samples. */
async function timed(
  n: number,
  warmup: number,
  fn: (resume: BenchResume, i: number) => Promise<void>,
  resumes: BenchResume[],
): Promise<{ samples: number[]; skipped: number; errors: number }> {
  const samples: number[] = [];
  let errors = 0;
  for (let i = 0; i < n + warmup; i++) {
    const resume = resumes[i % resumes.length];
    const t = performance.now();
    try {
      await fn(resume, i);
    } catch {
      errors += 1;
    }
    const dt = performance.now() - t;
    if (i >= warmup) samples.push(dt);
  }
  return { samples, skipped: warmup, errors };
}

/** L1 — pure match-engine CPU, no I/O. The floor a free tier is made of. */
export async function phaseL1(ctx: BenchCtx, n: number, warmup: number) {
  const roleFor = (r: BenchResume) => ctx.roleById.get(r.roleId) ?? ctx.roles[0];
  const res = await timed(
    n,
    warmup,
    async (r) => {
      rankLocally({ resumeText: r.resumeText, role: toRankRole(roleFor(r)) });
    },
    ctx.resumes,
  );
  return { ...res, stats: summarize(res.samples) };
}

/** L2 — production fast path, forced cache miss. This is real per-resume pipeline cost. */
export async function phaseL2(ctx: BenchCtx, n: number, warmup: number) {
  const { parseAndRank } = await import("../../../features/ai/server/ai.server.ts");
  const internalLatency: number[] = [];
  const res = await timed(
    n,
    warmup,
    async (r) => {
      const role = ctx.roleById.get(r.roleId) ?? ctx.roles[0];
      const out = await parseAndRank({
        resumeText: r.resumeText,
        role: toRankRole(role),
        mode: "fast",
        userId: ctx.userId,
        orgId: ctx.orgId,
        roleId: role.roleId,
        candidateId: newId(),
        bypassCache: true,
      });
      if (out.ok) internalLatency.push(out.meta.latencyMs);
      else throw new Error(out.error);
    },
    ctx.resumes,
  );
  return { ...res, stats: summarize(res.samples), internalLatency: summarize(internalLatency) };
}

/**
 * L3 — cache hit, split into the two very different kinds:
 * `memHit` (process-local Map) and `dbHit` (SELECT + hit_count UPDATE).
 */
export async function phaseL3(ctx: BenchCtx, n: number, warmup: number) {
  const { parseAndRank } = await import("../../../features/ai/server/ai.server.ts");
  const { clearRankCache } = await import("../rank-cache.server.ts");
  const role = ctx.roles[0];
  const target = ctx.resumes[3] ?? ctx.resumes[0];
  const args = {
    resumeText: target.resumeText,
    role: toRankRole(role),
    mode: "fast" as const,
    userId: ctx.userId,
    orgId: ctx.orgId,
    roleId: role.roleId,
    candidateId: newId(),
  };

  // prime both tiers
  await parseAndRank(args);

  const mem: number[] = [];
  for (let i = 0; i < n + warmup; i++) {
    const t = performance.now();
    await parseAndRank(args);
    const dt = performance.now() - t;
    if (i >= warmup) mem.push(dt);
  }

  const db: number[] = [];
  let dbHits = 0;
  for (let i = 0; i < n + warmup; i++) {
    clearRankCache(); // force the DB tier
    const t = performance.now();
    const out = await parseAndRank(args);
    const dt = performance.now() - t;
    if (out.ok && out.fromCache) dbHits += 1;
    if (i >= warmup) db.push(dt);
  }

  return { mem: summarize(mem), db: summarize(db), dbHits, n: n + warmup };
}

/** L4 — full ingest of one resume: rank + candidate/application writes + search index. */
export async function phaseL4(ctx: BenchCtx, n: number, warmup: number) {
  const { persistRanked } = await import("../queue.server.ts");
  const batchId = await seedSlate(ctx, ctx.resumes.slice(0, Math.max(n + warmup, 4)));
  const sql = await getSql();
  const samples: number[] = [];
  const errors: string[] = [];
  for (let i = 0; i < n + warmup; i++) {
    const rows = await sql<Record<string, unknown>>`
      select * from ingest_jobs where batch_id = ${batchId} and status = 'queued'
      order by created_at limit 1`;
    const job = rows[0];
    if (!job) break;
    await sql`update ingest_jobs set status = 'ranking' where id = ${String((job as { id: string }).id)}`;
    const t = performance.now();
    try {
      await persistRanked(job as never);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    const dt = performance.now() - t;
    if (i >= warmup) samples.push(dt);
    await sql`update ingest_jobs set status = 'completed' where id = ${String((job as { id: string }).id)}`;
  }
  return { samples, errors, stats: summarize(samples) };
}

/** L5 — the asked question: whole multi-resume slate through the real queue. */
export async function phaseL5(
  ctx: BenchCtx,
  opts: { n: number; maxJobs: number; concurrency: number; budgetMs: number; deadlineMs: number },
) {
  const { processQueueSlice } = await import("../queue.server.ts");
  const list = buildResumeList({ count: opts.n, roles: ctx.roles });
  const batchId = await seedSlate(ctx, list);
  const sql = await getSql();

  // Slices run sequentially on purpose: processQueueSlice holds a global mutex
  // (queue.server.ts:425), so overlapping them would only measure lock contention.
  let processed = 0;
  let completed = 0;
  let failed = 0;
  const sliceTimes: number[] = [];
  const t0 = performance.now();
  let slices = 0;
  while (processed < opts.maxJobs * 1000) {
    if (performance.now() - t0 > opts.deadlineMs) break;
    const ts = performance.now();
    const r = await processQueueSlice({
      userId: ctx.userId,
      maxJobs: opts.maxJobs,
      concurrency: opts.concurrency,
      budgetMs: opts.budgetMs,
    });
    sliceTimes.push(performance.now() - ts);
    slices += 1;
    processed += r.processed;
    completed += r.completed;
    failed += r.failed;
    if (r.processed === 0) break;
  }
  const wallMs = performance.now() - t0;

  const remaining = await sql<{ c: number }>`
    select count(*)::int as c from ingest_jobs where batch_id = ${batchId} and status <> 'completed'`;
  const metrics = await sql<{ duration_ms: number | null; queue_age_ms: number | null }>`
    select duration_ms, queue_age_ms from queue_metrics
    where batch_id = ${batchId}`;
  const durations = metrics.map((m) => Number(m.duration_ms ?? 0)).filter((x) => x > 0);
  const ages = metrics.map((m) => Number(m.queue_age_ms ?? 0)).filter((x) => x > 0);
  // Real overlap: if every job's own duration were summed and divided by the slate
  // wall-clock, the ratio is how many jobs effectively ran at once. `concurrency` is
  // configured, not achieved — PGLite serialises all DB work on one connection, so
  // overlap only covers each job's non-DB (CPU) portion.
  const sumJobMs = durations.reduce((a, b) => a + b, 0);
  const derivedParallelism = wallMs > 0 ? sumJobMs / wallMs : 0;

  return {
    n: opts.n,
    batchId,
    wallMs: round3(wallMs),
    perResumeMs: round3(wallMs / Math.max(1, processed)),
    resumesPerSec: round3((processed / Math.max(1, wallMs)) * 1000),
    processed,
    completed,
    failed,
    notCompleted: remaining[0]?.c ?? -1,
    slices,
    configuredConcurrency: opts.concurrency,
    derivedParallelism: round3(derivedParallelism),
    sumJobMs: round3(sumJobMs),
    sliceStats: summarize(sliceTimes),
    jobDuration: summarize(durations),
    queueAge: summarize(ages),
  };
}

/** L6 — the routed model path (`parseAndRank` mode "full"). Without keys this measures the
 *  router's own overhead plus refused provider connections, not model latency. */
export async function phaseL6(ctx: BenchCtx, opts: { n: number; openCircuits: boolean }) {
  const { parseAndRank, isAiConfigured, describeAi } = await import("../../../features/ai/server/ai.server.ts");
  const { availableLadderProviders } = await import("../../../features/ai/server/providers.server.ts");
  if (opts.openCircuits) openAllCircuits();
  const role = ctx.roles[1] ?? ctx.roles[0];
  const samples: number[] = [];
  const engines: string[] = [];
  for (let i = 0; i < opts.n; i++) {
    const r = ctx.resumes[(i + 4) % ctx.resumes.length];
    const t = performance.now();
    try {
      const out = await parseAndRank({
        resumeText: r.resumeText,
        role: toRankRole(role),
        mode: "full",
        userId: ctx.userId,
        orgId: ctx.orgId,
        roleId: role.roleId,
        candidateId: newId(),
        bypassCache: true,
      });
      const dt = performance.now() - t;
      samples.push(dt);
      engines.push(out.ok ? out.engine : `error:${out.error.slice(0, 60)}`);
    } catch (err) {
      samples.push(performance.now() - t);
      engines.push(`throw:${err instanceof Error ? err.message.slice(0, 60) : "?"}`);
    }
  }
  return {
    aiConfigured: isAiConfigured(),
    described: describeAi(),
    providersAvailable: availableLadderProviders(),
    circuitsPreOpened: opts.openCircuits,
    stats: summarize(samples),
    engines,
    note: opts.openCircuits
      ? "Provider circuits pre-opened: the router skips them, so this is decision + fallback overhead, NOT measured model latency."
      : "Router attempted real arms; with no keys this is ECONNREFUSED + backoff overhead before the local arm answers.",
  };
}

/**
 * L7 — live arms. Every other phase pre-opens the provider circuits, so no phase measures an actual
 * model; this one refuses to, because the point is to replace the registry's declared throughput
 * priors with numbers from *this* machine. Arms are grouped by provider and each group runs with
 * only that provider's credentials in the environment: keys are what isolates a provider, while
 * which arm inside it answers stays the router's choice — and that choice is part of the measurement.
 *
 * The runs write real `model_cost_logs` rows, so when this finishes `routerHistory()` — and with it
 * `expectedMs`, `timeoutMs` and the deadline filter — stops reading my estimates and starts reading
 * measurements. That is the whole reason Phase A's derived timeouts can be trusted.
 */
export async function phaseLiveArms(
  ctx: BenchCtx,
  opts: {
    reps: number;
    context: CallContext;
    deadlineMs: number;
    allowOwnerQuota?: boolean;
    deepenApps?: number;
  },
) {
  const { parseAndRank } = await import("../../../features/ai/server/ai.server.ts");
  const { MODEL_ARMS, armModel } = await import("../../../features/ai/domain/model-registry.ts");
  const { routerHistory, ollamaHostUp } = await import("../../../features/ai/server/model-router.server.ts");

  const KEY_NAMES = [
    "GROQ_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "OLLAMA_MODEL",
  ];
  const savedEnv = new Map<string, string | undefined>(KEY_NAMES.map((k) => [k, process.env[k]]));
  const savedCircuits = (
    globalThis as typeof globalThis & { __vettaCircuits__?: Map<string, unknown> }
  ).__vettaCircuits__;

  const arms = MODEL_ARMS.filter((a) => a.provider !== "local" && a.provider !== "xenova");
  const hostUp = await ollamaHostUp();

  const eligible: typeof arms = [];
  const skipped: Array<{ armId: string; why: string }> = [];
  for (const arm of arms) {
    if (arm.spendsOwnerQuota && !opts.allowOwnerQuota) {
      skipped.push({
        armId: arm.id,
        why: "spends the app owner's real quota — pass --allow-owner-quota",
      });
      continue;
    }
    if (arm.provider === "ollama" && !hostUp) {
      skipped.push({ armId: arm.id, why: "no Ollama server answering on OLLAMA_HOST" });
      continue;
    }
    if (!arm.envKeys.every((k) => (process.env[k] ?? "").trim())) {
      skipped.push({
        armId: arm.id,
        why: `missing ${arm.envKeys.filter((k) => !(process.env[k] ?? "").trim()).join(", ")}`,
      });
      continue;
    }
    eligible.push(arm);
  }

  const role = ctx.roles[1] ?? ctx.roles[0];
  /**
   * Measured per *provider*, not per arm: pinning the credentials is what isolates a provider, but
   * which arm inside it answers is still the router's choice — and that choice is part of what is
   * being measured. The ledger rows keep the arm split, so the report shows which arm actually served.
   */
  const byProvider = new Map<string, typeof eligible>();
  for (const arm of eligible) {
    const list = byProvider.get(arm.provider);
    if (list) list.push(arm);
    else byProvider.set(arm.provider, [arm]);
  }

  type LedgerView = {
    armId: string;
    samples: number;
    p50DurationMs: number;
    avgCompletionTokens: number;
    avgCostCents: number;
    successRate: number;
    abortedSamples: number;
    abortedElapsedMaxMs: number;
    tokensPerSec: number | null;
  };
  const measurements: Array<{
    provider: string;
    armsOffered: string[];
    reps: number;
    /** Wall time of the product call, which is the number a recruiter actually feels. */
    stats: Stats;
    /** The provider answered *and* its answer was the one used. */
    servedByProvider: number;
    /** A provider was asked and did not land (its error, or an answer that failed validation). */
    askedButFinishedLocal: number;
    /** The router pinned this provider and still chose the free local arm. */
    choseLocalAnyway: number;
    errored: number;
    /** What the ledger now says for this provider's arms — the inputs the next timeout computes from. */
    ledger: LedgerView[];
  }> = [];

  const toLedgerView = (h: {
    armId: string;
    samples: number;
    p50DurationMs: number;
    avgCompletionTokens: number;
    avgCostCents: number;
    successRate: number;
    abortedSamples?: number;
    abortedElapsedMaxMs?: number;
  }): LedgerView => ({
    armId: h.armId,
    samples: h.samples,
    p50DurationMs: Math.round(h.p50DurationMs),
    avgCompletionTokens: Math.round(h.avgCompletionTokens),
    avgCostCents: Math.round(h.avgCostCents * 1_000) / 1_000,
    successRate: Math.round(h.successRate * 100) / 100,
    abortedSamples: h.abortedSamples ?? 0,
    abortedElapsedMaxMs: Math.round(h.abortedElapsedMaxMs ?? 0),
    tokensPerSec:
      h.p50DurationMs > 0 && h.avgCompletionTokens > 0
        ? round1((h.avgCompletionTokens / h.p50DurationMs) * 1_000)
        : null,
  });

  for (const [provider, group] of byProvider) {
    // Pin the environment so this provider is the only one the router can reach.
    for (const k of KEY_NAMES) delete process.env[k];
    for (const arm of group) {
      for (const k of arm.envKeys) {
        const value = savedEnv.get(k);
        if (value) process.env[k] = value;
      }
    }
    (
      globalThis as typeof globalThis & { __vettaOllamaUp__?: { at: number; up: boolean } }
    ).__vettaOllamaUp__ = {
      at: Date.now(),
      up: provider === "ollama",
    };
    (
      globalThis as typeof globalThis & { __vettaCircuits__?: Map<string, unknown> }
    ).__vettaCircuits__ = new Map();

    const samples: number[] = [];
    let servedByProvider = 0;
    let askedButFinishedLocal = 0;
    let choseLocalAnyway = 0;
    let errored = 0;
    for (let i = 0; i < opts.reps; i++) {
      const r = ctx.resumes[(i + 4) % ctx.resumes.length];
      const t = performance.now();
      try {
        const out = await parseAndRank({
          resumeText: r.resumeText,
          role: toRankRole(role),
          mode: "full",
          userId: ctx.userId,
          orgId: ctx.orgId,
          roleId: role.roleId,
          candidateId: newId(),
          bypassCache: true,
          // Nobody is watching a benchmark: buy the honest number, not a censored one.
          context: opts.context,
          deadlineMs: opts.deadlineMs,
        });
        samples.push(performance.now() - t);
        // `meta.engine` is the provider's name only when its answer is the one that was used. A
        // local finish carries `fallback: true` when a provider was asked and did not land (its own
        // error, or an answer that failed validation) and `false` when the router picked the free
        // arm outright — which, with only this provider's keys in the environment, means the
        // deadline or a quality floor excluded it. That distinction is the interesting result.
        if (!out.ok) errored += 1;
        else if (out.meta.engine !== "local") servedByProvider += 1;
        else if (out.meta.fallback) askedButFinishedLocal += 1;
        else choseLocalAnyway += 1;
      } catch {
        samples.push(performance.now() - t);
        errored += 1;
      }
    }

    // The product path writes its own ledger row fire-and-forget, so read it only after that has
    // had a chance to land; otherwise this phase would report an arm it just measured as unseen.
    await sleep(400);

    // The join is the router's own: whatever these runs wrote is what `planRoute` reads next.
    const prefix = `${provider}:`;
    measurements.push({
      provider,
      armsOffered: group.map((a) => `${a.id} -> ${armModel(a)}`),
      reps: opts.reps,
      stats: summarize(samples),
      servedByProvider,
      askedButFinishedLocal,
      choseLocalAnyway,
      errored,
      ledger: (await routerHistory("rank", ctx.orgId))
        .filter((h) => h.armId.startsWith(prefix))
        .map(toLedgerView),
    });
  }

  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  (
    globalThis as typeof globalThis & { __vettaCircuits__?: Map<string, unknown> }
  ).__vettaCircuits__ = savedCircuits ?? new Map();

  // A 30-app deep-rank walk is what a shortlist actually costs; 200 is the same number x ~7.
  // Runs after the env is restored, so it measures the product path — every key the user has —
  // rather than the isolated single-provider slice above.
  let deepen: { apps: number; wallMs: number; perAppMs: number; projected200Ms: number } | null =
    null;
  if (
    opts.deepenApps &&
    opts.deepenApps > 0 &&
    measurements.some((m) => m.servedByProvider + m.askedButFinishedLocal > 0)
  ) {
    const started = Date.now();
    for (let i = 0; i < opts.deepenApps; i++) {
      const r = ctx.resumes[i % ctx.resumes.length];
      await parseAndRank({
        resumeText: r.resumeText,
        role: toRankRole(role),
        mode: "full",
        userId: ctx.userId,
        orgId: ctx.orgId,
        roleId: role.roleId,
        candidateId: newId(),
        bypassCache: true,
        context: "bulk",
        deadlineMs: 45_000,
      });
    }
    const wallMs = Date.now() - started;
    deepen = {
      apps: opts.deepenApps,
      wallMs,
      perAppMs: Math.round(wallMs / opts.deepenApps),
      projected200Ms: Math.round((wallMs / opts.deepenApps) * 200),
    };
  }

  return {
    context: opts.context,
    deadlineMs: opts.deadlineMs,
    ollamaHostUp: hostUp,
    armsMeasured: measurements,
    armsSkipped: skipped,
    deepen,
    note: measurements.length
      ? "These rows are now in model_cost_logs, so the router's per-call timeout is computed from this machine."
      : "No live arm: every provider key is missing and no Ollama host answered. Nothing was spent.",
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { buildResumeList, buildRoles };
