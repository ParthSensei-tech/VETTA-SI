/**
 * Stores hire outcomes and updates the conditional quality model.
 */

import { getSql } from "@/platform/db";
import type { RankResult } from "../../recruiting/domain/types";
import {
  OUTCOME_HEADS,
  deserializeHead,
  forecastFromHeads,
  headsForKind,
  initHead,
  outcomeFeatures,
  serializeHead,
  trainHead,
  type HeadWeights,
  type OutcomeForecast,
  type OutcomeHead,
  type OutcomeKind,
} from "../domain/outcome";

const SHARED = "shared";

function modelId(head: OutcomeHead, orgId: string): string {
  return `${head}:${orgId}`;
}

async function loadHead(head: OutcomeHead, orgId: string): Promise<HeadWeights> {
  const sql = await getSql();
  const rows = await sql<{ weights_json: string }>`
    select weights_json from outcome_models where id = ${modelId(head, orgId)} limit 1`;
  return (rows[0] && deserializeHead(rows[0].weights_json)) || initHead();
}

async function saveHead(head: OutcomeHead, orgId: string, h: HeadWeights): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into outcome_models (id, head, org_id, samples, positives, brier_ema, weights_json, updated_at)
    values (
      ${modelId(head, orgId)}, ${head}, ${orgId}, ${h.samples}, ${h.positives},
      ${h.brierEma}, ${serializeHead(h)}, now()
    )
    on conflict (id) do update set
      samples = excluded.samples,
      positives = excluded.positives,
      brier_ema = excluded.brier_ema,
      weights_json = excluded.weights_json,
      updated_at = now()`;
}

function featuresFromRank(rank: RankResult, screenScore: number | null): Float32Array {
  const domain = rank.match?.dimensions.find((d) => d.id === "domain_embed");
  return outcomeFeatures({
    score: rank.score,
    familyAligned: rank.match ? rank.match.familyAligned : null,
    noticeDays: rank.india.notice_period_days,
    riskCount: rank.risks.length,
    domainScore: domain ? domain.score : null,
    screenScore,
  });
}

async function headsForOrg(orgId: string): Promise<Record<OutcomeHead, HeadWeights>> {
  const sharedInterview = await loadHead("interview", SHARED);
  const out = {} as Record<OutcomeHead, HeadWeights>;
  for (const head of OUTCOME_HEADS) {
    const org = await loadHead(head, orgId);
    const shared = head === "interview" ? sharedInterview : await loadHead(head, SHARED);
    out[head] = org.samples >= shared.samples ? org : shared;
  }
  return out;
}

export async function trainOutcome(input: {
  orgId: string;
  rank: RankResult;
  kind: OutcomeKind;
  screenScore?: number | null;
}): Promise<void> {
  const x = featuresFromRank(input.rank, input.screenScore ?? null);
  for (const step of headsForKind(input.kind)) {
    for (const orgId of [input.orgId, SHARED]) {
      const h = await loadHead(step.head, orgId);
      trainHead(h, x, step.positive);
      await saveHead(step.head, orgId, h);
    }
  }
}

export async function forecastOutcome(
  rank: RankResult,
  orgId?: string | null,
  screenScore?: number | null,
): Promise<OutcomeForecast> {
  const heads = await headsForOrg(orgId || SHARED);
  return forecastFromHeads(heads, featuresFromRank(rank, screenScore ?? null));
}
