/**
 * Persists per-org calibration and the live EN/HI HR lexicon.
 */

import { getSql } from "@/platform/db";
import type { RankResult } from "../../../lib/recruiting/types";
import { hashFeatures } from "../../ai/domain/domain-embed";
import {
  deserializeCal,
  explainRank,
  initCalWeights,
  parseHrPage,
  rankFeatures,
  serializeCal,
  trainCalibration,
  type CalWeights,
  type Explanation,
  type HrChunk,
} from "../domain/calibrate-explain";

const SHARED = "shared";

const HR_URLS = [
  "https://hrsoftwaredelhi.com/hr-glossary/",
  "https://acerecruitment.in/notice-period-rules-india/",
  "https://trykaiwa.com/blog/hindi-workplace-office-phrases-2026",
];

async function loadCal(orgId: string): Promise<CalWeights> {
  const sql = await getSql();
  const rows = await sql<{ weights_json: string }>`
    select weights_json from calibration_models where org_id = ${orgId} limit 1`;
  const parsed = rows[0] ? deserializeCal(rows[0].weights_json) : null;
  return parsed ?? initCalWeights();
}

async function saveCal(orgId: string, w: CalWeights): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into calibration_models (org_id, samples, positives, brier_ema, weights_json, updated_at)
    values (${orgId}, ${w.samples}, ${w.positives}, ${w.brierEma}, ${serializeCal(w)}, now())
    on conflict (org_id) do update set
      samples = excluded.samples,
      positives = excluded.positives,
      brier_ema = excluded.brier_ema,
      weights_json = excluded.weights_json,
      updated_at = now()`;
}

export async function trainCalibrationOnLabel(input: {
  orgId: string;
  rank: RankResult;
  positive: boolean;
}): Promise<void> {
  const x = rankFeatures(input.rank);
  const org = await loadCal(input.orgId);
  trainCalibration(org, x, input.positive);
  await saveCal(input.orgId, org);
  const shared = await loadCal(SHARED);
  trainCalibration(shared, x, input.positive);
  await saveCal(SHARED, shared);
}

async function lexiconChunks(): Promise<HrChunk[]> {
  const sql = await getSql();
  const rows = await sql<{ lang: string; text: string; source: string }>`
    select lang, text, source from hr_lexicon
    order by fetched_at desc
    limit 160`;
  return rows
    .filter((r) => r.lang === "en" || r.lang === "hi")
    .map((r) => ({ lang: r.lang as "en" | "hi", text: r.text, source: r.source }));
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "VettaHrLexicon/1.0", accept: "text/html" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 300_000);
  } catch {
    return null;
  }
}

/** Pull current HR pages (English glossary + Hindi workplace language). */
export async function refreshHrLexicon(
  force = false,
): Promise<{ chunks: number; skipped: boolean }> {
  const sql = await getSql();
  if (!force) {
    const recent = await sql<{ n: number }>`
      select count(*) as n from hr_lexicon
      where fetched_at > now() - interval '24 hours'`;
    const n = Number(recent[0]?.n ?? 0);
    if (n >= 8) return { chunks: n, skipped: true };
  }
  let stored = 0;
  for (const url of HR_URLS) {
    const html = await fetchPage(url);
    if (!html) continue;
    const chunks = parseHrPage(html, url);
    for (const c of chunks) {
      const id = `${c.lang}:${c.text.slice(0, 48)}:${stored}`;
      const embed = JSON.stringify(Array.from(hashFeatures(c.text).slice(0, 32)));
      await sql`
        insert into hr_lexicon (id, lang, text, source, embed_json)
        values (${id}, ${c.lang}, ${c.text}, ${c.source}, ${embed})
        on conflict (id) do update set text = excluded.text, fetched_at = now()`;
      stored += 1;
    }
  }
  return { chunks: stored, skipped: false };
}

export async function attachExplanation(
  rank: RankResult,
  orgId?: string | null,
): Promise<RankResult> {
  const org = orgId ? await loadCal(orgId) : initCalWeights();
  const shared = await loadCal(SHARED);
  const cal = org.samples >= 12 ? org : shared.samples >= 12 ? shared : org;
  let chunks: HrChunk[] = [];
  try {
    chunks = await lexiconChunks();
  } catch {
    chunks = [];
  }
  const explain: Explanation = explainRank(rank, cal.samples > 0 ? cal : null, chunks);
  return { ...rank, explain };
}
