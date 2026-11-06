/**
 * Formal weighted match rubric — per organization, optional per-role override.
 * Notice and CTC are first-class weighted criteria (not extract-only).
 * Rank labels nudge weights toward what this org actually shortlists.
 */

import { getSql } from "../../../platform/db.ts";
import { parseJson } from "../../../shared/utils.ts";

export type RubricWeights = {
  function: number;
  skills: number;
  must_haves: number;
  seniority: number;
  location: number;
  compensation: number;
  notice: number;
  early_stage: number;
};

/** Industry default weights — notice & compensation are active score drivers. */
export const DEFAULT_RUBRIC_WEIGHTS: RubricWeights = {
  function: 0.22,
  skills: 0.18,
  must_haves: 0.16,
  seniority: 0.1,
  location: 0.08,
  compensation: 0.1,
  notice: 0.09,
  early_stage: 0.07,
};

const KEYS = Object.keys(DEFAULT_RUBRIC_WEIGHTS) as (keyof RubricWeights)[];

export function normalizeWeights(raw: Partial<RubricWeights> | null | undefined): RubricWeights {
  const base = { ...DEFAULT_RUBRIC_WEIGHTS };
  if (raw) {
    for (const k of KEYS) {
      const v = raw[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) base[k] = v;
    }
  }
  const sum = KEYS.reduce((s, k) => s + base[k], 0) || 1;
  for (const k of KEYS) base[k] = base[k] / sum;
  return base;
}

export async function loadRubricWeights(opts: {
  orgId: string;
  roleId?: string | null;
}): Promise<RubricWeights> {
  const sql = await getSql();
  if (opts.roleId) {
    const roleRows = await sql<{ weights_json: string }>`
      select weights_json from match_rubrics
      where org_id = ${opts.orgId} and role_id = ${opts.roleId}
      order by updated_at desc limit 1`;
    if (roleRows[0]) {
      return normalizeWeights(parseJson<Partial<RubricWeights>>(roleRows[0].weights_json, {}));
    }
  }
  const orgRows = await sql<{ weights_json: string }>`
    select weights_json from match_rubrics
    where org_id = ${opts.orgId} and role_id is null
    order by updated_at desc limit 1`;
  if (orgRows[0]) {
    return normalizeWeights(parseJson<Partial<RubricWeights>>(orgRows[0].weights_json, {}));
  }
  return { ...DEFAULT_RUBRIC_WEIGHTS };
}

export async function saveOrgRubric(opts: {
  orgId: string;
  weights: Partial<RubricWeights>;
  source?: string;
}): Promise<RubricWeights> {
  const sql = await getSql();
  const weights = normalizeWeights(opts.weights);
  const existing = await sql<{ id: string }>`
    select id from match_rubrics where org_id = ${opts.orgId} and role_id is null limit 1`;
  if (existing[0]) {
    await sql`
      update match_rubrics set
        weights_json = ${JSON.stringify(weights)},
        source = ${opts.source ?? "manual"},
        updated_at = now()
      where id = ${existing[0].id}`;
  } else {
    await sql`
      insert into match_rubrics (id, org_id, role_id, name, weights_json, source)
      values (
        ${crypto.randomUUID()}, ${opts.orgId}, ${null}, ${"default"},
        ${JSON.stringify(weights)}, ${opts.source ?? "manual"}
      )`;
  }
  return weights;
}

/**
 * Learn-to-rank (lightweight): from positive vs negative labels, nudge weights
 * toward dimensions that correlated with shortlist/hire labels for this org.
 */
export async function recomputeRubricFromLabels(orgId: string): Promise<RubricWeights | null> {
  const sql = await getSql();
  const rows = await sql<{ label: string; dimension_scores_json: string }>`
    select label, dimension_scores_json from rank_labels
    where org_id = ${orgId}
    order by created_at desc
    limit 200`;
  if (rows.length < 8) return null;

  const positive = new Set(["shortlist", "hire", "yes", "strong_yes"]);
  const negative = new Set(["reject", "no", "false_positive"]);

  const posAvg: Record<string, { sum: number; n: number }> = {};
  const negAvg: Record<string, { sum: number; n: number }> = {};
  for (const k of KEYS) {
    posAvg[k] = { sum: 0, n: 0 };
    negAvg[k] = { sum: 0, n: 0 };
  }

  let posN = 0;
  let negN = 0;
  for (const row of rows) {
    const scores = parseJson<Record<string, number>>(row.dimension_scores_json, {});
    const bucket = positive.has(row.label) ? posAvg : negative.has(row.label) ? negAvg : null;
    if (!bucket) continue;
    if (positive.has(row.label)) posN += 1;
    else negN += 1;
    for (const k of KEYS) {
      const v = scores[k];
      if (typeof v === "number") {
        bucket[k]!.sum += v;
        bucket[k]!.n += 1;
      }
    }
  }
  if (posN < 3 || negN < 3) return null;

  // Lift = how much higher positive labels score on each dimension
  const lift: Partial<RubricWeights> = {};
  for (const k of KEYS) {
    const p = posAvg[k]!.n ? posAvg[k]!.sum / posAvg[k]!.n : 50;
    const n = negAvg[k]!.n ? negAvg[k]!.sum / negAvg[k]!.n : 50;
    const delta = (p - n) / 100; // -1..1-ish
    const current = DEFAULT_RUBRIC_WEIGHTS[k];
    // Soft nudge: keep within 0.5x–1.8x of default
    lift[k] = Math.max(current * 0.5, Math.min(current * 1.8, current * (1 + delta * 0.6)));
  }

  return saveOrgRubric({ orgId, weights: lift, source: "learned" });
}
