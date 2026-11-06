/**
 * Persists the domain encoder, refreshes live India market pages,
 * and scores resume↔role alignment. Numbers are whatever the pages return.
 */

import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import type { RankResult } from "./types";
import {
  EMBED_DIM,
  alignmentScore,
  cosine,
  deserializeWeights,
  embedText,
  hashFeatures,
  initWeights,
  metricsToDocument,
  parseMarketPage,
  serializeWeights,
  trainPair,
  trainReconstruction,
  type EmbedWeights,
  type MarketMetric,
} from "./domain-embed";

const MODEL_ID = "universal";

/** Public pages. Figures are parsed at fetch time — not copied into source. */
const MARKET_URLS = [
  "https://www.naukri.com/blog/naukri-jobspeak-october-2026-white-collar-hiring-ai-ml-growth/",
  "https://www.naukri.com/blog/naukri-jobspeak-white-collar-hiring-grows-14-in-aug-fresher-hiring-ai-roles-lead/",
  "https://theirstack.com/en/job-postings-data/india",
];

const MIN_STEPS_TO_SCORE = 8;

function hashDoc(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Drop the "already trained" mark for this text. Weights are an aggregate and stay. */
export async function forgetObservedDocument(text: string): Promise<number> {
  const body = text.trim().slice(0, 8000);
  if (body.length < 40) return 0;
  const sql = await getSql();
  const removed = await sql<{ count: number }>`
    with d as (delete from domain_embed_seen where doc_hash = ${hashDoc(body)} returning 1)
    select count(*)::int as count from d`;
  return Number(removed[0]?.count ?? 0);
}

async function loadWeights(): Promise<EmbedWeights> {
  const sql = await getSql();
  const rows = await sql<{ weights_json: string }>`
    select weights_json from domain_embed_models where id = ${MODEL_ID} limit 1`;
  const parsed = rows[0] ? deserializeWeights(rows[0].weights_json) : null;
  if (parsed) return parsed;
  const fresh = initWeights();
  await sql`
    insert into domain_embed_models (id, weights_json)
    values (${MODEL_ID}, ${serializeWeights(fresh)})
    on conflict (id) do nothing`;
  return fresh;
}

async function saveWeights(w: EmbedWeights): Promise<void> {
  const sql = await getSql();
  const json = serializeWeights(w);
  await sql`
    insert into domain_embed_models (id, version, steps, docs, recon_loss, rank_steps, weights_json, updated_at)
    values (${MODEL_ID}, ${w.version}, ${w.steps}, ${w.docs}, ${w.reconLossEma}, ${w.rankSteps}, ${json}, now())
    on conflict (id) do update set
      version = excluded.version,
      steps = excluded.steps,
      docs = excluded.docs,
      recon_loss = excluded.recon_loss,
      rank_steps = excluded.rank_steps,
      weights_json = excluded.weights_json,
      updated_at = now()`;
}

async function loadBias(orgId: string): Promise<Float32Array> {
  const sql = await getSql();
  const rows = await sql<{ bias_json: string }>`
    select bias_json from domain_embed_adapters where org_id = ${orgId} limit 1`;
  const bias = new Float32Array(EMBED_DIM);
  if (!rows[0]) return bias;
  try {
    const arr = JSON.parse(rows[0].bias_json) as number[];
    for (let i = 0; i < EMBED_DIM && i < arr.length; i += 1) bias[i] = arr[i] ?? 0;
  } catch {
    /* empty adapter */
  }
  return bias;
}

async function saveBias(orgId: string, bias: Float32Array, steps: number): Promise<void> {
  const sql = await getSql();
  const json = JSON.stringify(Array.from(bias));
  await sql`
    insert into domain_embed_adapters (org_id, steps, bias_json, updated_at)
    values (${orgId}, ${steps}, ${json}, now())
    on conflict (org_id) do update set
      steps = excluded.steps,
      bias_json = excluded.bias_json,
      updated_at = now()`;
}

/** Train on a real resume or JD once. Safe to call on every rank. */
export async function observeDocument(text: string): Promise<void> {
  const body = text.trim();
  if (body.length < 40) return;
  const sql = await getSql();
  const h = hashDoc(body.slice(0, 8000));
  const seen = await sql<{ doc_hash: string }>`
    select doc_hash from domain_embed_seen where doc_hash = ${h} limit 1`;
  if (seen.length) return;
  const w = await loadWeights();
  trainReconstruction(w, hashFeatures(body.slice(0, 8000)));
  await saveWeights(w);
  await sql`insert into domain_embed_seen (doc_hash) values (${h}) on conflict do nothing`;
}

export async function trainOnLabel(input: {
  orgId: string;
  resumeText: string;
  roleText: string;
  positive: boolean;
}): Promise<void> {
  if (input.resumeText.trim().length < 40 || input.roleText.trim().length < 20) return;
  const w = await loadWeights();
  const bias = await loadBias(input.orgId);
  trainPair(
    w,
    hashFeatures(input.resumeText.slice(0, 8000)),
    hashFeatures(input.roleText.slice(0, 8000)),
    input.positive,
    bias,
  );
  await saveWeights(w);
  const rows = await (await getSql())<{ steps: number }>`
    select steps from domain_embed_adapters where org_id = ${input.orgId} limit 1`;
  await saveBias(input.orgId, bias, (rows[0]?.steps ?? 0) + 1);
}

async function latestSnapshot(): Promise<{
  id: string;
  fetched_at: string;
  metrics_json: string;
  document_text: string;
  embed_json: string;
} | null> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    fetched_at: string;
    metrics_json: string;
    document_text: string;
    embed_json: string;
  }>`
    select id, fetched_at::text as fetched_at, metrics_json, document_text, embed_json
    from market_snapshots
    order by fetched_at desc
    limit 1`;
  return rows[0] ?? null;
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "VettaMarketModel/1.0 (hiring research; +https://vetta.app)",
        accept: "text/html",
      },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 250_000);
  } catch {
    return null;
  }
}

/** Pull public India hiring pages and fold them into the encoder. */
export async function refreshMarketSnapshot(force = false): Promise<{
  metrics: number;
  sources: number;
  skipped: boolean;
}> {
  const current = await latestSnapshot();
  if (!force && current?.fetched_at) {
    const age = Date.now() - new Date(current.fetched_at).getTime();
    if (age < 12 * 60 * 60 * 1000 && current.document_text.length > 20) {
      return {
        metrics: safeMetrics(current.metrics_json).length,
        sources: 1,
        skipped: true,
      };
    }
  }

  const metrics: MarketMetric[] = [];
  const sources: string[] = [];
  for (const url of MARKET_URLS) {
    const html = await fetchPage(url);
    if (!html) continue;
    const parsed = parseMarketPage(html, url);
    if (parsed.length === 0) continue;
    sources.push(url);
    metrics.push(...parsed);
  }

  if (metrics.length === 0) {
    return { metrics: safeMetrics(current?.metrics_json).length, sources: 0, skipped: false };
  }

  const document = metricsToDocument(metrics);
  const w = await loadWeights();
  trainReconstruction(w, hashFeatures(document), 0.03);
  await saveWeights(w);
  const embed = Array.from(embedText(document, w));
  const sql = await getSql();
  await sql`
    insert into market_snapshots (id, sources_json, metrics_json, document_text, embed_json)
    values (
      ${crypto.randomUUID()},
      ${JSON.stringify(sources)},
      ${JSON.stringify(metrics)},
      ${document},
      ${JSON.stringify(embed)}
    )`;
  return { metrics: metrics.length, sources: sources.length, skipped: false };
}

function safeMetrics(raw: string | undefined): MarketMetric[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as MarketMetric[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseEmbed(raw: string): Float32Array | null {
  try {
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr) || arr.length !== EMBED_DIM) return null;
    return Float32Array.from(arr);
  } catch {
    return null;
  }
}

export async function scoreDomainAlignment(input: {
  resumeText: string;
  roleText: string;
  orgId?: string | null;
}): Promise<{
  ready: boolean;
  alignment: number;
  market: number | null;
  steps: number;
  docs: number;
  note: string;
}> {
  const w = await loadWeights();
  if (w.steps < MIN_STEPS_TO_SCORE) {
    return {
      ready: false,
      alignment: 50,
      market: null,
      steps: w.steps,
      docs: w.docs,
      note: "Domain model is still warming up on live resumes and market pages.",
    };
  }
  const bias = input.orgId ? await loadBias(input.orgId) : null;
  const zr = embedText(input.resumeText, w, bias);
  const zp = embedText(input.roleText, w, null);
  const alignment = alignmentScore(cosine(zr, zp));
  const snap = await latestSnapshot();
  const marketVec = snap ? parseEmbed(snap.embed_json) : null;
  const market = marketVec ? alignmentScore(cosine(zp, marketVec)) : null;
  const metricN = safeMetrics(snap?.metrics_json).length;
  const note =
    market == null
      ? `Domain embedding ${alignment}/100 · encoder steps ${w.steps} · market feed not available yet`
      : `Domain embedding ${alignment}/100 · role vs live India market ${market}/100 · ${metricN} metrics · steps ${w.steps}`;
  return { ready: true, alignment, market, steps: w.steps, docs: w.docs, note };
}

function levelFromScore(score: number): RankResult["level"] {
  if (score >= 85) return "strong_yes";
  if (score >= 70) return "yes";
  if (score >= 50) return "maybe";
  return "no";
}

/** Blend embedding alignment into a finished rank. Hard gates stay caps. */
export function applyDomainToRank(
  rank: RankResult,
  domain: {
    ready: boolean;
    alignment: number;
    market: number | null;
    note: string;
  },
): RankResult {
  if (!domain.ready || !rank.match) return rank;
  const dims = [...rank.match.dimensions];
  const domainWeight = 0.18;
  const scale = 1 - domainWeight;
  for (const d of dims) d.weight *= scale;
  dims.push({
    id: "domain_embed",
    label: "India market embedding",
    score: domain.alignment,
    weight: domainWeight,
    note: domain.note,
  });
  let score = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0));
  const gates = rank.match.hardGates ?? [];
  if (gates.some((g) => g.startsWith("Function mismatch"))) score = Math.min(score, 42);
  if (gates.some((g) => g.startsWith("No must-have"))) score = Math.min(score, 48);
  score = Math.max(0, Math.min(100, score));
  const mismatch = gates.some((g) => g.startsWith("Function mismatch"));
  return {
    ...rank,
    score,
    level: mismatch ? "no" : levelFromScore(score),
    summary: `${rank.summary} ${domain.note}`,
    match: { ...rank.match, dimensions: dims },
    risks:
      domain.market != null && domain.market < 35
        ? [...rank.risks, "Role sits away from where India hiring demand is growing right now"]
        : rank.risks,
  };
}

export async function domainModelStatus(): Promise<{
  steps: number;
  docs: number;
  rankSteps: number;
  metrics: number;
  asOf: string | null;
  ready: boolean;
}> {
  try {
    const w = await loadWeights();
    const snap = await latestSnapshot();
    return {
      steps: w.steps,
      docs: w.docs,
      rankSteps: w.rankSteps,
      metrics: safeMetrics(snap?.metrics_json).length,
      asOf: snap?.fetched_at ?? null,
      ready: w.steps >= MIN_STEPS_TO_SCORE,
    };
  } catch {
    return { steps: 0, docs: 0, rankSteps: 0, metrics: 0, asOf: null, ready: false };
  }
}
