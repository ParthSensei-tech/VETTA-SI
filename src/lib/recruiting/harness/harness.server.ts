import { createHash } from "node:crypto";
import { getSql } from "@/platform/db";
import { iso, parseJson } from "@/shared/utils";
import {
  RANK_SYSTEM,
  STRICT_RANK_SYSTEM,
  hashPrompt,
  type RankMeta,
  type RankRoleInput,
} from "../ai.server";
import { calibrateRank, calibrationFromPrompt, rankLocally } from "../local-rank";
import type {
  EvalCase,
  EvalRun,
  EvalRunCase,
  FitLevel,
  HarnessSettings,
  HarnessSnapshot,
  HarnessVerdict,
  PromptVersion,
  RankResult,
  RankTrace,
  ShadowComparison,
} from "../types";
import { GOLD_EVAL_CASES } from "./gold";
import { regressionGate, scoreCase, summarizeRun } from "./scorer";

function nid(): string {
  return crypto.randomUUID();
}

function sha12(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function asNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

const FIT: FitLevel[] = ["strong_yes", "yes", "maybe", "no"];
function asFit(value: unknown): FitLevel {
  return FIT.includes(value as FitLevel) ? (value as FitLevel) : "maybe";
}

type SettingsRow = {
  user_id: string;
  shadow_enabled: boolean | string;
  min_agreement_pct: number | string;
  max_false_shortlist_pct: number | string;
  production_prompt_id: string | null;
  candidate_prompt_id: string | null;
};

export async function ensureHarness(userId: string): Promise<HarnessSettings> {
  const sql = await getSql();
  const existing = await sql<SettingsRow>`
    select * from harness_settings where user_id = ${userId} limit 1`;
  if (existing[0] && existing[0].production_prompt_id) {
    await seedGoldIfEmpty(userId);
    return mapSettings(existing[0]);
  }

  const prodId = nid();
  const candId = nid();
  await sql`
    insert into prompt_versions (id, user_id, name, body, hash, status)
    values
      (${prodId}, ${userId}, ${"Production"}, ${RANK_SYSTEM}, ${hashPrompt(RANK_SYSTEM)}, ${"production"}),
      (${candId}, ${userId}, ${"Candidate — conservative"}, ${STRICT_RANK_SYSTEM}, ${hashPrompt(STRICT_RANK_SYSTEM)}, ${"candidate"})
    on conflict (id) do nothing`;

  await sql`
    insert into harness_settings (
      user_id, shadow_enabled, min_agreement_pct, max_false_shortlist_pct,
      production_prompt_id, candidate_prompt_id
    ) values (
      ${userId}, ${true}, ${75}, ${15}, ${prodId}, ${candId}
    )
    on conflict (user_id) do update set
      production_prompt_id = coalesce(harness_settings.production_prompt_id, excluded.production_prompt_id),
      candidate_prompt_id = coalesce(harness_settings.candidate_prompt_id, excluded.candidate_prompt_id),
      updated_at = now()`;

  await seedGoldIfEmpty(userId);
  const row =
    await sql<SettingsRow>`select * from harness_settings where user_id = ${userId} limit 1`;
  return mapSettings(row[0]!);
}

async function seedGoldIfEmpty(userId: string) {
  const sql = await getSql();
  const count = await sql<{
    n: number;
  }>`select count(*) as n from eval_cases where user_id = ${userId} and source = 'gold'`;
  if (asNum(count[0]?.n) > 0) return;
  for (const c of GOLD_EVAL_CASES) {
    await sql`
      insert into eval_cases (
        id, user_id, slug, title, company_name, company_stage, role_title, location, work_mode,
        compensation_band, stack_json, must_haves_json, nice_to_haves_json, jd_text, resume_text,
        human_label, expect_shortlist, notes, source, frozen
      ) values (
        ${nid()}, ${userId}, ${c.slug}, ${c.title}, ${c.companyName}, ${c.companyStage}, ${c.roleTitle},
        ${c.location}, ${c.workMode}, ${c.compensationBand},
        ${JSON.stringify(c.stack)}, ${JSON.stringify(c.mustHaves)}, ${JSON.stringify(c.niceToHaves)},
        ${c.jdText}, ${c.resumeText}, ${c.humanLabel}, ${c.expectShortlist}, ${c.notes}, ${"gold"}, ${true}
      )
      on conflict (user_id, slug) do nothing`;
  }
}

function mapSettings(row: SettingsRow): HarnessSettings {
  return {
    shadowEnabled: asBool(row.shadow_enabled),
    minAgreementPct: asNum(row.min_agreement_pct),
    maxFalseShortlistPct: asNum(row.max_false_shortlist_pct),
    productionPromptId: row.production_prompt_id,
    candidatePromptId: row.candidate_prompt_id,
  };
}

export async function loadPromptBody(
  userId: string,
  which: "production" | "candidate",
): Promise<{ id: string; body: string; hash: string } | null> {
  const sql = await getSql();
  const settings = await ensureHarness(userId);
  const id = which === "production" ? settings.productionPromptId : settings.candidatePromptId;
  if (!id) return null;
  const rows = await sql<{ id: string; body: string; hash: string }>`
    select id, body, hash from prompt_versions where id = ${id} and user_id = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function rankWithProductionPrompt(
  userId: string,
  input: { resumeText: string; role: RankRoleInput },
) {
  await ensureHarness(userId);
  const prompt = await loadPromptBody(userId, "production");
  const { parseAndRank } = await import("../ai.server");
  return parseAndRank({
    resumeText: input.resumeText,
    role: input.role,
    systemPrompt: prompt?.body,
  });
}

export async function safeRecordLiveRank(ctx: LiveRankContext): Promise<void> {
  try {
    await recordLiveRank(ctx);
  } catch (err) {
    console.error("[vetta-harness]", err);
  }
}

export type LiveRankContext = {
  userId: string;
  applicationId: string;
  resumeText: string;
  role: RankRoleInput;
  result: { rank: RankResult; meta: RankMeta };
};

export async function recordLiveRank(ctx: LiveRankContext): Promise<void> {
  const sql = await getSql();
  await ensureHarness(ctx.userId);
  const settings =
    await sql<SettingsRow>`select * from harness_settings where user_id = ${ctx.userId} limit 1`;
  const shadowOn = settings[0] ? asBool(settings[0].shadow_enabled) : true;
  const prodPrompt = await loadPromptBody(ctx.userId, "production");

  await sql`
    update applications set
      rank_engine = ${ctx.result.meta.engine},
      rank_latency_ms = ${ctx.result.meta.latencyMs},
      rank_fallback = ${ctx.result.meta.fallback},
      rank_at = now(),
      updated_at = now()
    where id = ${ctx.applicationId} and user_id = ${ctx.userId}`;

  const pairId = nid();
  const prodTraceId = await insertTrace({
    userId: ctx.userId,
    applicationId: ctx.applicationId,
    pairId,
    mode: "production",
    meta: ctx.result.meta,
    promptVersionId: prodPrompt?.id ?? null,
    role: ctx.role,
    resumeText: ctx.resumeText,
    rank: ctx.result.rank,
  });

  if (!shadowOn) return;

  const candPrompt = await loadPromptBody(ctx.userId, "candidate");
  const shadowStarted = Date.now();
  const local = rankLocally({ resumeText: ctx.resumeText, role: ctx.role });
  const shadowRank = calibrateRank(
    local.rank,
    calibrationFromPrompt(candPrompt?.body ?? STRICT_RANK_SYSTEM),
  );
  const shadowMeta: RankMeta = {
    engine: "local",
    model: "evidence",
    latencyMs: Date.now() - shadowStarted,
    fallback: false,
    promptHash: candPrompt?.hash ?? hashPrompt(STRICT_RANK_SYSTEM),
  };
  const shadowTraceId = await insertTrace({
    userId: ctx.userId,
    applicationId: ctx.applicationId,
    pairId,
    mode: "shadow",
    meta: shadowMeta,
    promptVersionId: candPrompt?.id ?? null,
    role: ctx.role,
    resumeText: ctx.resumeText,
    rank: shadowRank,
  });

  const disagreed = shadowRank.level !== ctx.result.rank.level;
  await sql`
    insert into shadow_comparisons (
      id, user_id, application_id, production_trace_id, shadow_trace_id,
      production_level, shadow_level, production_score, shadow_score, disagreed
    ) values (
      ${nid()}, ${ctx.userId}, ${ctx.applicationId}, ${prodTraceId}, ${shadowTraceId},
      ${ctx.result.rank.level}, ${shadowRank.level}, ${ctx.result.rank.score}, ${shadowRank.score}, ${disagreed}
    )`;
}

async function insertTrace(args: {
  userId: string;
  applicationId?: string | null;
  evalCaseId?: string | null;
  evalRunId?: string | null;
  pairId?: string | null;
  mode: "production" | "shadow" | "eval";
  meta: RankMeta;
  promptVersionId: string | null;
  role: RankRoleInput;
  resumeText: string;
  rank: RankResult;
}): Promise<string> {
  const sql = await getSql();
  const id = nid();
  const input = {
    title: args.role.title,
    company: args.role.companyName,
    jd: args.role.jdText.slice(0, 400),
    resume: args.resumeText.slice(0, 400),
  };
  await sql`
    insert into rank_traces (
      id, user_id, application_id, eval_case_id, eval_run_id, pair_id, mode,
      engine, model, prompt_hash, prompt_version_id, jd_hash, resume_hash,
      score, level, fallback, latency_ms, input_json, output_json
    ) values (
      ${id}, ${args.userId}, ${args.applicationId ?? null}, ${args.evalCaseId ?? null},
      ${args.evalRunId ?? null}, ${args.pairId ?? null}, ${args.mode},
      ${args.meta.engine}, ${args.meta.model}, ${args.meta.promptHash}, ${args.promptVersionId},
      ${sha12(args.role.jdText)}, ${sha12(args.resumeText)},
      ${args.rank.score}, ${args.rank.level}, ${args.meta.fallback}, ${args.meta.latencyMs},
      ${JSON.stringify(input)}, ${JSON.stringify({ score: args.rank.score, level: args.rank.level, summary: args.rank.summary })}
    )`;
  return id;
}

export async function runEvalSet(opts: {
  userId: string;
  kind: "production" | "candidate";
  engine: "local" | "live";
}): Promise<EvalRun> {
  const sql = await getSql();
  const settings = await ensureHarness(opts.userId);
  const prompt = await loadPromptBody(opts.userId, opts.kind);
  if (!prompt) throw new Error("No prompt version loaded");

  const cases = await sql<{
    id: string;
    title: string;
    company_name: string;
    company_stage: string;
    role_title: string;
    location: string;
    work_mode: string;
    compensation_band: string;
    stack_json: string;
    must_haves_json: string;
    nice_to_haves_json: string;
    jd_text: string;
    resume_text: string;
    human_label: string;
  }>`select * from eval_cases where user_id = ${opts.userId} order by created_at`;

  if (cases.length === 0) throw new Error("Eval set is empty");

  const runId = nid();
  await sql`
    insert into eval_runs (id, user_id, engine, kind, prompt_version_id, prompt_hash, status, notes)
    values (${runId}, ${opts.userId}, ${opts.engine === "live" ? "live" : "local"}, ${opts.kind},
      ${prompt.id}, ${prompt.hash}, ${"running"}, ${""})`;

  const scored: Array<{
    caseId: string;
    title: string;
    human: FitLevel;
    predicted: FitLevel;
    score: number;
    agree: boolean;
    adjacent: boolean;
    falseShortlist: boolean;
    falseReject: boolean;
    latencyMs: number;
    engine: string;
    fallback: boolean;
  }> = [];

  for (const c of cases) {
    const role: RankRoleInput = {
      companyName: c.company_name,
      companyStage: c.company_stage,
      title: c.role_title,
      location: c.location,
      workMode: c.work_mode,
      compensationBand: c.compensation_band,
      stack: parseJson<string[]>(c.stack_json, []),
      mustHaves: parseJson<string[]>(c.must_haves_json, []),
      niceToHaves: parseJson<string[]>(c.nice_to_haves_json, []),
      jdText: c.jd_text,
    };
    const started = Date.now();
    let predicted: FitLevel;
    let score: number;
    let engine = "local";
    let fallback = false;
    let latency = 0;
    let rank: RankResult;

    if (opts.engine === "live") {
      const { parseAndRank } = await import("../ai.server");
      const ranked = await parseAndRank({
        resumeText: c.resume_text,
        role,
        systemPrompt: prompt.body,
      });
      if (!ranked.ok) throw new Error(ranked.error);
      predicted = ranked.rank.level;
      score = ranked.rank.score;
      engine = ranked.meta.engine;
      fallback = ranked.meta.fallback;
      latency = ranked.meta.latencyMs;
      rank = ranked.rank;
      await insertTrace({
        userId: opts.userId,
        evalCaseId: c.id,
        evalRunId: runId,
        mode: "eval",
        meta: ranked.meta,
        promptVersionId: prompt.id,
        role,
        resumeText: c.resume_text,
        rank,
      });
    } else {
      const local = rankLocally({ resumeText: c.resume_text, role });
      rank = calibrateRank(local.rank, calibrationFromPrompt(prompt.body));
      predicted = rank.level;
      score = rank.score;
      latency = Date.now() - started;
      await insertTrace({
        userId: opts.userId,
        evalCaseId: c.id,
        evalRunId: runId,
        mode: "eval",
        meta: {
          engine: "local",
          model: "evidence",
          latencyMs: latency,
          fallback: false,
          promptHash: prompt.hash,
        },
        promptVersionId: prompt.id,
        role,
        resumeText: c.resume_text,
        rank,
      });
    }

    const human = asFit(c.human_label);
    const marks = scoreCase(predicted, human);
    scored.push({
      caseId: c.id,
      title: c.title,
      human,
      predicted,
      score,
      ...marks,
      latencyMs: latency,
      engine,
      fallback,
    });
    await sql`
      insert into eval_run_cases (
        id, user_id, run_id, case_id, predicted_level, predicted_score, agree,
        false_shortlist, false_reject, latency_ms, engine, fallback
      ) values (
        ${nid()}, ${opts.userId}, ${runId}, ${c.id}, ${predicted}, ${score}, ${marks.agree},
        ${marks.falseShortlist}, ${marks.falseReject}, ${latency}, ${engine}, ${fallback}
      )`;
  }

  const totals = summarizeRun(scored);
  const baseline = await sql<{ agreement_pct: number | null }>`
    select agreement_pct from eval_runs
    where user_id = ${opts.userId} and kind = 'production' and status = 'completed' and agreement_pct is not null
    order by created_at desc limit 1`;
  const baselinePct = baseline[0]?.agreement_pct == null ? null : asNum(baseline[0].agreement_pct);
  const gate = regressionGate({
    agreementPct: totals.agreementPct,
    falseShortlistRate: totals.falseShortlistRate,
    minAgreementPct: settings.minAgreementPct,
    maxFalseShortlistPct: settings.maxFalseShortlistPct,
    baselineAgreementPct: opts.kind === "candidate" ? baselinePct : null,
  });

  await sql`
    update eval_runs set
      labeled_count = ${totals.labeled},
      agree_count = ${totals.agree},
      false_shortlist = ${totals.falseShortlist},
      false_reject = ${totals.falseReject},
      agreement_pct = ${totals.agreementPct},
      adjacent_pct = ${totals.adjacentPct},
      false_shortlist_rate = ${totals.falseShortlistRate},
      false_reject_rate = ${totals.falseRejectRate},
      p50_latency_ms = ${totals.p50LatencyMs},
      p95_latency_ms = ${totals.p95LatencyMs},
      gate_passed = ${gate.passed},
      gate_reason = ${gate.reason},
      compared_to_run_id = ${null},
      status = ${"completed"},
      notes = ${gate.reason},
      engine = ${opts.engine === "live" ? (scored[0]?.engine ?? "live") : "local"}
    where id = ${runId} and user_id = ${opts.userId}`;

  // The router only trades quality for cost on a critical task once an eval has proven the cheap
  // arm agrees with humans. This is that proof, remembered per engine rather than recomputed.
  try {
    const { recordRouterGates } = await import("../model-router.server.ts");
    await recordRouterGates({
      task: "rank",
      engines: Array.from(new Set(scored.map((s) => s.engine))),
      evalRunId: runId,
      passed: gate.passed,
      reason: gate.reason,
      agreementPct: totals.agreementPct,
      falseShortlistRate: totals.falseShortlistRate,
    });
  } catch (err) {
    console.error("[router-gate-record-error]", err);
  }

  return {
    id: runId,
    engine: opts.engine === "live" ? (scored[0]?.engine ?? "live") : "local",
    kind: opts.kind,
    promptHash: prompt.hash,
    labeledCount: totals.labeled,
    agreeCount: totals.agree,
    falseShortlist: totals.falseShortlist,
    falseReject: totals.falseReject,
    agreementPct: totals.agreementPct,
    adjacentPct: totals.adjacentPct,
    falseShortlistRate: totals.falseShortlistRate,
    falseRejectRate: totals.falseRejectRate,
    p50LatencyMs: totals.p50LatencyMs,
    p95LatencyMs: totals.p95LatencyMs,
    gatePassed: gate.passed,
    gateReason: gate.reason,
    notes: gate.reason,
    createdAt: new Date().toISOString(),
    cases: scored.map((s): EvalRunCase => ({
      caseId: s.caseId,
      title: s.title,
      humanLabel: s.human,
      predictedLevel: s.predicted,
      predictedScore: s.score,
      agree: s.agree,
      falseShortlist: s.falseShortlist,
      falseReject: s.falseReject,
      latencyMs: s.latencyMs,
      engine: s.engine,
    })),
  };
}

export async function promoteCandidatePrompt(userId: string): Promise<HarnessSettings> {
  const sql = await getSql();
  const settings = await ensureHarness(userId);
  if (!settings.candidatePromptId) throw new Error("No candidate prompt");

  const latest = await sql<{ gate_passed: boolean | string | null; kind: string }>`
    select gate_passed, kind from eval_runs
    where user_id = ${userId} and prompt_version_id = ${settings.candidatePromptId} and status = 'completed'
    order by created_at desc limit 1`;
  if (!latest[0] || !asBool(latest[0].gate_passed)) {
    throw new Error(
      "Regression gate blocked this prompt. Run eval on the candidate and pass the gate first.",
    );
  }

  if (settings.productionPromptId) {
    await sql`
      update prompt_versions set status = 'archived'
      where id = ${settings.productionPromptId} and user_id = ${userId}`;
  }
  await sql`
    update prompt_versions set status = 'production'
    where id = ${settings.candidatePromptId} and user_id = ${userId}`;

  const nextCand = nid();
  const body = STRICT_RANK_SYSTEM;
  await sql`
    insert into prompt_versions (id, user_id, name, body, hash, status)
    values (${nextCand}, ${userId}, ${"Candidate — next"}, ${body}, ${hashPrompt(body)}, ${"candidate"})`;
  await sql`
    update harness_settings set
      production_prompt_id = ${settings.candidatePromptId},
      candidate_prompt_id = ${nextCand},
      updated_at = now()
    where user_id = ${userId}`;
  return ensureHarness(userId);
}

export async function saveCandidatePrompt(
  userId: string,
  body: string,
  name?: string,
): Promise<PromptVersion> {
  const sql = await getSql();
  const settings = await ensureHarness(userId);
  const trimmed = body.trim();
  if (trimmed.length < 40) throw new Error("Prompt is too short");
  const id = settings.candidatePromptId ?? nid();
  const hash = hashPrompt(trimmed);
  const label = (name?.trim() || "Candidate").slice(0, 80);
  const existing = await sql<{ id: string }>`
    select id from prompt_versions where id = ${id} and user_id = ${userId} limit 1`;
  if (existing[0]) {
    await sql`
      update prompt_versions set name = ${label}, body = ${trimmed}, hash = ${hash}
      where id = ${id} and user_id = ${userId}`;
  } else {
    await sql`
      insert into prompt_versions (id, user_id, name, body, hash, status)
      values (${id}, ${userId}, ${label}, ${trimmed}, ${hash}, ${"candidate"})`;
    await sql`
      update harness_settings set candidate_prompt_id = ${id}, updated_at = now()
      where user_id = ${userId}`;
  }
  return {
    id,
    name: label,
    body: trimmed,
    hash,
    status: "candidate",
    createdAt: new Date().toISOString(),
  };
}

export async function setShadowEnabled(userId: string, enabled: boolean): Promise<HarnessSettings> {
  await ensureHarness(userId);
  const sql = await getSql();
  await sql`
    update harness_settings set shadow_enabled = ${enabled}, updated_at = now()
    where user_id = ${userId}`;
  return ensureHarness(userId);
}

export async function labelApplication(opts: {
  userId: string;
  applicationId: string;
  humanLabel: FitLevel;
  verdict: HarnessVerdict;
  notes: string;
  addToEval: boolean;
}): Promise<void> {
  const sql = await getSql();
  const apps = await sql<{
    id: string;
    role_id: string;
    rank_json: string;
    candidate_id: string;
  }>`select id, role_id, rank_json, candidate_id from applications where id = ${opts.applicationId} and user_id = ${opts.userId} limit 1`;
  const app = apps[0];
  if (!app) throw new Error("Application not found");
  const rank = parseJson<RankResult | null>(app.rank_json, null);
  const predicted = rank && FIT.includes(rank.level) ? rank.level : "";

  await sql`
    insert into rank_feedback (
      id, user_id, application_id, human_label, notes, predicted_level, verdict, added_to_eval
    ) values (
      ${nid()}, ${opts.userId}, ${opts.applicationId}, ${opts.humanLabel}, ${opts.notes.slice(0, 2000)},
      ${predicted}, ${opts.verdict}, ${opts.addToEval}
    )
    on conflict (user_id, application_id) do update set
      human_label = excluded.human_label,
      notes = excluded.notes,
      predicted_level = excluded.predicted_level,
      verdict = excluded.verdict,
      added_to_eval = excluded.added_to_eval,
      created_at = now()`;

  if (!opts.addToEval) return;

  const roles = await sql<{
    company_name: string;
    company_stage: string;
    title: string;
    location: string;
    work_mode: string;
    compensation_band: string;
    stack: string;
    must_haves: string;
    nice_to_haves: string;
    jd_text: string;
  }>`select * from roles where id = ${app.role_id} and user_id = ${opts.userId} limit 1`;
  const cands = await sql<{ full_name: string; resume_text: string }>`
    select full_name, resume_text from candidates where id = ${app.candidate_id} and user_id = ${opts.userId} limit 1`;
  const role = roles[0];
  const cand = cands[0];
  if (!role || !cand) return;
  const slug = `label-${opts.applicationId.slice(0, 8)}`;
  await sql`
    insert into eval_cases (
      id, user_id, slug, title, company_name, company_stage, role_title, location, work_mode,
      compensation_band, stack_json, must_haves_json, nice_to_haves_json, jd_text, resume_text,
      human_label, expect_shortlist, notes, source, application_id, frozen
    ) values (
      ${nid()}, ${opts.userId}, ${slug},
      ${`${cand.full_name} · ${role.title}`}, ${role.company_name}, ${role.company_stage}, ${role.title},
      ${role.location}, ${role.work_mode}, ${role.compensation_band},
      ${role.stack}, ${role.must_haves}, ${role.nice_to_haves}, ${role.jd_text}, ${cand.resume_text},
      ${opts.humanLabel}, ${opts.humanLabel === "yes" || opts.humanLabel === "strong_yes"},
      ${opts.notes.slice(0, 2000)}, ${"label"}, ${opts.applicationId}, ${false}
    )
    on conflict (user_id, slug) do update set
      human_label = excluded.human_label,
      notes = excluded.notes,
      expect_shortlist = excluded.expect_shortlist`;
}

export async function loadHarnessSnapshot(userId: string): Promise<HarnessSnapshot> {
  const sql = await getSql();
  const settings = await ensureHarness(userId);

  const promptRows = await sql<{
    id: string;
    name: string;
    body: string;
    hash: string;
    status: string;
    created_at: unknown;
  }>`select id, name, body, hash, status, created_at from prompt_versions where user_id = ${userId} order by created_at desc`;

  const caseRows = await sql<{
    id: string;
    slug: string;
    title: string;
    company_name: string;
    role_title: string;
    human_label: string;
    expect_shortlist: boolean | string;
    notes: string;
    source: string;
    frozen: boolean | string;
    created_at: unknown;
  }>`select id, slug, title, company_name, role_title, human_label, expect_shortlist, notes, source, frozen, created_at
     from eval_cases where user_id = ${userId} order by created_at`;

  const lastPred = await sql<{ case_id: string; predicted_level: string; agree: boolean | string }>`
    select case_id, predicted_level, agree
    from eval_run_cases
    where user_id = ${userId}
    order by created_at desc`;
  const predByCase = new Map<
    string,
    { case_id: string; predicted_level: string; agree: boolean | string }
  >();
  for (const row of lastPred) {
    if (!predByCase.has(row.case_id)) predByCase.set(row.case_id, row);
  }

  const runRows = await sql<{
    id: string;
    engine: string;
    kind: string;
    prompt_hash: string;
    labeled_count: number | string;
    agree_count: number | string;
    false_shortlist: number | string;
    false_reject: number | string;
    agreement_pct: number | string | null;
    adjacent_pct: number | string | null;
    false_shortlist_rate: number | string | null;
    false_reject_rate: number | string | null;
    p50_latency_ms: number | string | null;
    p95_latency_ms: number | string | null;
    gate_passed: boolean | string | null;
    gate_reason: string;
    notes: string;
    created_at: unknown;
  }>`select * from eval_runs where user_id = ${userId} order by created_at desc limit 12`;

  const traceRows = await sql<{
    id: string;
    application_id: string | null;
    mode: string;
    engine: string;
    model: string;
    prompt_hash: string;
    jd_hash: string;
    resume_hash: string;
    score: number | string | null;
    level: string;
    fallback: boolean | string;
    latency_ms: number | string | null;
    created_at: unknown;
  }>`select id, application_id, mode, engine, model, prompt_hash, jd_hash, resume_hash, score, level, fallback, latency_ms, created_at
     from rank_traces where user_id = ${userId} order by created_at desc limit 40`;

  const shadowRows = await sql<{
    id: string;
    application_id: string | null;
    production_level: string;
    shadow_level: string;
    production_score: number | string | null;
    shadow_score: number | string | null;
    disagreed: boolean | string;
    created_at: unknown;
  }>`select id, application_id, production_level, shadow_level, production_score, shadow_score, disagreed, created_at
     from shadow_comparisons where user_id = ${userId} order by created_at desc limit 20`;

  const labelRows = await sql<{
    id: string;
    application_id: string;
    human_label: string;
    predicted_level: string;
    verdict: string;
    notes: string;
    added_to_eval: boolean | string;
    created_at: unknown;
  }>`select id, application_id, human_label, predicted_level, verdict, notes, added_to_eval, created_at
     from rank_feedback where user_id = ${userId} order by created_at desc limit 30`;

  const prompts: PromptVersion[] = promptRows.map((p) => ({
    id: p.id,
    name: p.name,
    body: p.body,
    hash: p.hash,
    status: p.status as PromptVersion["status"],
    createdAt: iso(p.created_at),
  }));
  const prod = prompts.find((p) => p.id === settings.productionPromptId);
  const cand = prompts.find((p) => p.id === settings.candidatePromptId);

  const lastRun = runRows[0];
  const shadowDisagreements = shadowRows.filter((s) => asBool(s.disagreed)).length;

  return {
    settings,
    prompts,
    cases: caseRows.map((c): EvalCase => {
      const pred = predByCase.get(c.id);
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        companyName: c.company_name,
        roleTitle: c.role_title,
        humanLabel: asFit(c.human_label),
        expectShortlist: asBool(c.expect_shortlist),
        notes: c.notes,
        source: c.source === "label" ? "label" : "gold",
        frozen: asBool(c.frozen),
        createdAt: iso(c.created_at),
        lastPredicted: pred ? asFit(pred.predicted_level) : null,
        lastAgree: pred ? asBool(pred.agree) : null,
      };
    }),
    runs: runRows.map((r): EvalRun => ({
      id: r.id,
      engine: r.engine,
      kind: r.kind === "candidate" ? "candidate" : "production",
      promptHash: r.prompt_hash,
      labeledCount: asNum(r.labeled_count),
      agreeCount: asNum(r.agree_count),
      falseShortlist: asNum(r.false_shortlist),
      falseReject: asNum(r.false_reject),
      agreementPct: asNum(r.agreement_pct),
      adjacentPct: asNum(r.adjacent_pct),
      falseShortlistRate: asNum(r.false_shortlist_rate),
      falseRejectRate: asNum(r.false_reject_rate),
      p50LatencyMs: r.p50_latency_ms == null ? null : asNum(r.p50_latency_ms),
      p95LatencyMs: r.p95_latency_ms == null ? null : asNum(r.p95_latency_ms),
      gatePassed: r.gate_passed == null ? null : asBool(r.gate_passed),
      gateReason: r.gate_reason,
      notes: r.notes,
      createdAt: iso(r.created_at),
    })),
    traces: traceRows.map((t): RankTrace => ({
      id: t.id,
      applicationId: t.application_id,
      mode: t.mode === "shadow" ? "shadow" : t.mode === "eval" ? "eval" : "production",
      engine: t.engine,
      model: t.model,
      promptHash: t.prompt_hash,
      jdHash: t.jd_hash,
      resumeHash: t.resume_hash,
      score: t.score == null ? null : asNum(t.score),
      level: t.level,
      fallback: asBool(t.fallback),
      latencyMs: t.latency_ms == null ? null : asNum(t.latency_ms),
      createdAt: iso(t.created_at),
    })),
    shadows: shadowRows.map((s): ShadowComparison => ({
      id: s.id,
      applicationId: s.application_id,
      productionLevel: s.production_level,
      shadowLevel: s.shadow_level,
      productionScore: s.production_score == null ? null : asNum(s.production_score),
      shadowScore: s.shadow_score == null ? null : asNum(s.shadow_score),
      disagreed: asBool(s.disagreed),
      createdAt: iso(s.created_at),
    })),
    labels: labelRows.map((l) => ({
      id: l.id,
      applicationId: l.application_id,
      humanLabel: asFit(l.human_label),
      predictedLevel: l.predicted_level,
      verdict: (["agree", "too_generous", "too_harsh", "wrong_function"] as const).includes(
        l.verdict as HarnessVerdict,
      )
        ? (l.verdict as HarnessVerdict)
        : "agree",
      notes: l.notes,
      addedToEval: asBool(l.added_to_eval),
      createdAt: iso(l.created_at),
    })),
    stats: {
      labeled: labelRows.length,
      traces: asNum(
        (
          await sql<{ n: number }>`select count(*) as n from rank_traces where user_id = ${userId}`
        )[0]?.n,
      ),
      shadowDisagreements,
      lastAgreementPct: lastRun?.agreement_pct == null ? null : asNum(lastRun.agreement_pct),
      lastGatePassed: lastRun?.gate_passed == null ? null : asBool(lastRun.gate_passed),
      productionHash: prod?.hash ?? "",
      candidateHash: cand?.hash ?? null,
    },
  };
}

export async function loadRunDetail(userId: string, runId: string): Promise<EvalRun> {
  const sql = await getSql();
  const runs = await sql<{
    id: string;
    engine: string;
    kind: string;
    prompt_hash: string;
    labeled_count: number | string;
    agree_count: number | string;
    false_shortlist: number | string;
    false_reject: number | string;
    agreement_pct: number | string | null;
    adjacent_pct: number | string | null;
    false_shortlist_rate: number | string | null;
    false_reject_rate: number | string | null;
    p50_latency_ms: number | string | null;
    p95_latency_ms: number | string | null;
    gate_passed: boolean | string | null;
    gate_reason: string;
    notes: string;
    created_at: unknown;
  }>`select * from eval_runs where id = ${runId} and user_id = ${userId} limit 1`;
  const run = runs[0];
  if (!run) throw new Error("Eval run not found");
  const cases = await sql<{
    case_id: string;
    title: string;
    human_label: string;
    predicted_level: string;
    predicted_score: number | string;
    agree: boolean | string;
    false_shortlist: boolean | string;
    false_reject: boolean | string;
    latency_ms: number | string | null;
    engine: string;
  }>`
    select rc.case_id, c.title, c.human_label, rc.predicted_level, rc.predicted_score,
           rc.agree, rc.false_shortlist, rc.false_reject, rc.latency_ms, rc.engine
    from eval_run_cases rc
    join eval_cases c on c.id = rc.case_id
    where rc.run_id = ${runId} and rc.user_id = ${userId}
    order by c.created_at`;
  return {
    id: run.id,
    engine: run.engine,
    kind: run.kind === "candidate" ? "candidate" : "production",
    promptHash: run.prompt_hash,
    labeledCount: asNum(run.labeled_count),
    agreeCount: asNum(run.agree_count),
    falseShortlist: asNum(run.false_shortlist),
    falseReject: asNum(run.false_reject),
    agreementPct: asNum(run.agreement_pct),
    adjacentPct: asNum(run.adjacent_pct),
    falseShortlistRate: asNum(run.false_shortlist_rate),
    falseRejectRate: asNum(run.false_reject_rate),
    p50LatencyMs: run.p50_latency_ms == null ? null : asNum(run.p50_latency_ms),
    p95LatencyMs: run.p95_latency_ms == null ? null : asNum(run.p95_latency_ms),
    gatePassed: run.gate_passed == null ? null : asBool(run.gate_passed),
    gateReason: run.gate_reason,
    notes: run.notes,
    createdAt: iso(run.created_at),
    cases: cases.map((c) => ({
      caseId: c.case_id,
      title: c.title,
      humanLabel: asFit(c.human_label),
      predictedLevel: asFit(c.predicted_level),
      predictedScore: asNum(c.predicted_score),
      agree: asBool(c.agree),
      falseShortlist: asBool(c.false_shortlist),
      falseReject: asBool(c.false_reject),
      latencyMs: c.latency_ms == null ? null : asNum(c.latency_ms),
      engine: c.engine,
    })),
  };
}
