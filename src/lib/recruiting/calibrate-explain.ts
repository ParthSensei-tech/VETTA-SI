/**
 * Shortlist calibration (logistic / Platt-style) and bilingual HR explanation.
 * Weights are learned from labels. HR wording is retrieved from ingested text,
 * not from a fixed probability table.
 */

import type { RankResult } from "./types";
import { cosine, hashFeatures } from "./domain-embed.ts";

export const CAL_DIM = 6;
export const MIN_CAL_SAMPLES = 12;

export type CalWeights = {
  w: Float32Array;
  samples: number;
  positives: number;
  brierEma: number;
};

export type HrChunk = {
  lang: "en" | "hi";
  text: string;
  source: string;
};

export type Explanation = {
  /** Null until enough real shortlist/reject labels exist. */
  pShortlist: number | null;
  samples: number;
  brier: number | null;
  en: string;
  hi: string;
  hrTerms: string[];
};

export function initCalWeights(): CalWeights {
  return {
    w: new Float32Array(CAL_DIM),
    samples: 0,
    positives: 0,
    brierEma: 0.25,
  };
}

export function rankFeatures(rank: RankResult): Float32Array {
  const domain = rank.match?.dimensions.find((d) => d.id === "domain_embed");
  const notice = rank.india.notice_period_days;
  const x = new Float32Array(CAL_DIM);
  x[0] = 1;
  x[1] = clamp01(rank.score / 100);
  x[2] = rank.match?.familyAligned === false ? 0 : rank.match ? 1 : 0.5;
  x[3] = notice != null && notice > 60 ? 1 : notice != null ? 0.35 : 0.5;
  x[4] = clamp01(rank.risks.length / 4);
  x[5] = domain ? clamp01(domain.score / 100) : 0.5;
  return x;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function predictProba(w: CalWeights, x: Float32Array): number {
  let z = 0;
  for (let i = 0; i < CAL_DIM; i += 1) z += (w.w[i] ?? 0) * (x[i] ?? 0);
  return sigmoid(z);
}

/** One labeled outcome. y=1 shortlist/hire, y=0 reject. */
export function trainCalibration(
  w: CalWeights,
  x: Float32Array,
  positive: boolean,
  lr = 0.08,
): number {
  const p = predictProba(w, x);
  const y = positive ? 1 : 0;
  const err = p - y;
  for (let i = 0; i < CAL_DIM; i += 1) {
    w.w[i] = (w.w[i] ?? 0) - lr * err * (x[i] ?? 0);
    w.w[i] = Math.max(-6, Math.min(6, w.w[i]!));
  }
  const brier = (p - y) * (p - y);
  w.samples += 1;
  if (positive) w.positives += 1;
  w.brierEma = w.brierEma * 0.95 + brier * 0.05;
  return brier;
}

const TAG = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi;

/** Split a public HR page into English and Hindi sentences. */
export function parseHrPage(html: string, source: string): HrChunk[] {
  const text = html
    .replace(TAG, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ");
  const parts = text.split(/(?<=[.?!।])\s+/);
  const out: HrChunk[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const sentence = raw.trim().slice(0, 320);
    if (sentence.length < 40 || sentence.length > 320) continue;
    const dev = (sentence.match(/\p{Script=Devanagari}/gu) ?? []).length;
    const letters = (sentence.match(/\p{L}/gu) ?? []).length;
    if (letters < 20) continue;
    const lang: "en" | "hi" = dev / Math.max(1, letters) > 0.35 ? "hi" : "en";
    if (
      lang === "en" &&
      !/\b(hr|ctc|notice|offer|hiring|salary|probation|gratuity|employee|recruit)/i.test(sentence)
    ) {
      continue;
    }
    const key = sentence.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lang, text: sentence, source });
    if (out.length >= 80) break;
  }
  return out;
}

function topChunks(query: string, chunks: HrChunk[], lang: "en" | "hi", k: number): HrChunk[] {
  const q = hashFeatures(query);
  return chunks
    .filter((c) => c.lang === lang)
    .map((c) => ({ c, s: cosine(q, hashFeatures(c.text)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .filter((x) => x.s > 0.02)
    .map((x) => x.c);
}

function inr(n: number | null): string {
  if (n == null) return "";
  return `${n} LPA`;
}

/** Fact-grounded HR note. Glossary lines are passed in from the live lexicon. */
export function explainRank(
  rank: RankResult,
  cal: CalWeights | null,
  chunks: HrChunk[],
): Explanation {
  const x = rankFeatures(rank);
  const ready = Boolean(cal && cal.samples >= MIN_CAL_SAMPLES);
  const p = ready && cal ? predictProba(cal, x) : null;
  const pct = p == null ? null : Math.round(p * 100);
  const samples = cal?.samples ?? 0;
  const quote = rank.evidence[0]?.quote?.slice(0, 180) ?? "";
  const gap = rank.gaps[0] ?? "";
  const risk = rank.risks[0] ?? "";
  const notice = rank.india.notice_period_days;
  const expected = rank.india.expected_ctc_lakh;
  const query = [rank.summary, gap, risk, quote, rank.india.notes].filter(Boolean).join(" ");
  const enHits = topChunks(query, chunks, "en", 2);
  const hiHits = topChunks(query || rank.summary, chunks, "hi", 2);

  const noticeEn =
    notice == null
      ? "Notice period is not on the resume."
      : notice <= 30
        ? `Notice is ${notice} days — a normal junior/executive band, buyout rarely needed.`
        : notice <= 60
          ? `Notice is ${notice} days — mid-level market practice; confirm buyout in the offer.`
          : `Notice is ${notice} days — senior band; plan joining date, garden leave, or a funded buyout.`;
  const compEn = expected == null ? "" : ` Expected CTC ${inr(expected)}.`;
  const glossEn = enHits.map((h) => h.text).join(" ");
  const en = ready
    ? `Shortlist chance ${pct}% from ${samples} of your past shortlist and reject calls (not a generic model prior). ${noticeEn}${compEn} ${quote ? `Evidence: “${quote}”.` : ""} ${gap ? `Gap: ${gap}.` : ""} ${risk ? `Risk: ${risk}.` : ""} ${glossEn ? `HR context: ${glossEn}` : ""}`
        .replace(/\s+/g, " ")
        .trim()
    : `Calibration is not ready — it needs ${MIN_CAL_SAMPLES} of your shortlist or reject decisions (you have ${samples}). Until then this is an evidence score, not a probability. ${noticeEn}${compEn} ${quote ? `Evidence: “${quote}”.` : ""} ${glossEn ? `HR context: ${glossEn}` : ""}`
        .replace(/\s+/g, " ")
        .trim();

  const noticeHi =
    notice == null
      ? "रिज्यूमे पर नोटिस पीरियड नहीं लिखा है।"
      : notice <= 30
        ? `नोटिस पीरियड ${notice} दिन है — जूनियर बैंड, बायआउट ज़रूरी नहीं।`
        : notice <= 60
          ? `नोटिस पीरियड ${notice} दिन है — मिड-लेवल प्रैक्टिस; ऑफर में बायआउट कन्फर्म करें।`
          : `नोटिस पीरियड ${notice} दिन है — सीनियर बैंड; जॉइनिंग डेट, गार्डन लीव या बायआउट प्लान करें।`;
  const compHi = expected == null ? "" : ` उम्मीद CTC ${inr(expected)}।`;
  const glossHi = hiHits.map((h) => h.text).join(" ");
  const hi = ready
    ? `आपके ${samples} पुराने शॉर्टलिस्ट/रिजेक्ट फैसलों के हिसाब से शॉर्टलिस्ट चांस ${pct}% है। ${noticeHi}${compHi} ${quote ? `सबूत: “${quote}”.` : ""} ${gap ? `गैप: ${gap}.` : ""} ${risk ? `रिस्क: ${risk}.` : ""} ${glossHi ? `HR संदर्भ: ${glossHi}` : "Hinglish HR भाषा: CTC, नोटिस, ऑफर ड्रॉप और जॉइनिंग इसी स्कोर के साथ देखें।"}`
        .replace(/\s+/g, " ")
        .trim()
    : `कैलिब्रेशन अभी तैयार नहीं — ${MIN_CAL_SAMPLES} शॉर्टलिस्ट या रिजेक्ट फैसलों के बाद संभावना दिखेगी (अभी ${samples})। ${noticeHi}${compHi} ${quote ? `सबूत: “${quote}”.` : ""} ${glossHi ? `HR संदर्भ: ${glossHi}` : ""}`
        .replace(/\s+/g, " ")
        .trim();

  const hrTerms = [...enHits, ...hiHits].map((h) => h.text.slice(0, 80));
  return {
    pShortlist: pct,
    samples,
    brier: ready && cal ? Math.round(cal.brierEma * 1000) / 1000 : null,
    en,
    hi,
    hrTerms,
  };
}

export function serializeCal(w: CalWeights): string {
  return JSON.stringify({
    w: Array.from(w.w),
    samples: w.samples,
    positives: w.positives,
    brierEma: w.brierEma,
  });
}

export function deserializeCal(raw: string): CalWeights | null {
  try {
    const s = JSON.parse(raw) as {
      w: number[];
      samples: number;
      positives: number;
      brierEma: number;
    };
    if (!s.w || s.w.length !== CAL_DIM) return null;
    return {
      w: Float32Array.from(s.w),
      samples: s.samples || 0,
      positives: s.positives || 0,
      brierEma: s.brierEma ?? 0.25,
    };
  } catch {
    return null;
  }
}
