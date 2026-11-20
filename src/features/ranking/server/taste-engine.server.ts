/**
 * Client Taste Memory & Calibration Engine
 * 
 * Implements the YC "Service-as-Software" Taste Learning loop (Perfectly wedge):
 * Records client decisions (interview, reject, hire, notes) from client review slates,
 * maintains an evolving 32-d latent preference centroid per client org,
 * and dynamically calibrates candidate ranking rubrics.
 */

import { getSql } from "../../../platform/db.ts";
import { parseJson } from "../../../shared/utils.ts";
import { EMBED_DIM, hashFeatures } from "../../ai/domain/domain-embed.ts";
import type {
  ClientFeedbackAction,
  ClientFeedbackEvent,
  ClientTasteProfile,
  TasteCalibrationResult,
  TasteCategory,
} from "../domain/taste-types.ts";

export function createZeroVector(dim = EMBED_DIM): number[] {
  return new Array(dim).fill(0);
}

export function normalizeVector(v: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i]! * v[i]!;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return [...v];
  return v.map((x) => x / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

/**
 * Fast in-tree text-to-vector projection (32-d) without external API costs.
 */
export function extractCandidateFeatureVector(text: string): number[] {
  const hashed = hashFeatures(text);
  // Compress 192 hash features into 32 embedding features via structured folding
  const v = new Array(EMBED_DIM).fill(0);
  for (let i = 0; i < hashed.length; i++) {
    const targetIdx = i % EMBED_DIM;
    v[targetIdx] += hashed[i]!;
  }
  return normalizeVector(v);
}

/**
 * Loads a client organization's taste profile or returns a default baseline.
 */
export async function getClientTasteProfile(
  orgId: string,
  companyName: string,
): Promise<ClientTasteProfile> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    org_id: string;
    company_name: string;
    taste_vector: string;
    positive_signals: string;
    negative_signals: string;
    samples_count: number;
    positive_count: number;
    negative_count: number;
    culture_pace_bias: string;
    last_calibrated_at: string;
    created_at: string;
  }>`
    select * from client_taste_profiles
    where org_id = ${orgId} and lower(company_name) = lower(${companyName})
    limit 1`;

  if (rows[0]) {
    const r = rows[0];
    return {
      id: r.id,
      orgId: r.org_id,
      companyName: r.company_name,
      tasteVector: parseJson<number[]>(r.taste_vector, createZeroVector()),
      positiveSignals: parseJson<string[]>(r.positive_signals, []),
      negativeSignals: parseJson<string[]>(r.negative_signals, []),
      samplesCount: r.samples_count,
      positiveCount: r.positive_count,
      negativeCount: r.negative_count,
      culturePaceBias: (r.culture_pace_bias as any) || "high_velocity",
      lastCalibratedAt: r.last_calibrated_at,
      createdAt: r.created_at,
    };
  }

  // Baseline default profile
  return {
    id: `taste_${orgId}_${encodeURIComponent(companyName.toLowerCase())}`,
    orgId,
    companyName,
    tasteVector: createZeroVector(),
    positiveSignals: [],
    negativeSignals: [],
    samplesCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    culturePaceBias: "high_velocity",
    lastCalibratedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Ingests a client feedback decision, recalculates the latent preference vector,
 * and saves both the audit event and updated profile.
 */
export async function recordClientFeedbackAndCalibrate(input: {
  orgId: string;
  companyName: string;
  roleId: string;
  candidateId: string;
  applicationId?: string;
  action: ClientFeedbackAction;
  category: TasteCategory;
  notes?: string;
  reviewerName?: string;
  reviewerEmail?: string;
  candidateSummaryText?: string;
}): Promise<TasteCalibrationResult> {
  const sql = await getSql();
  const eventId = `cfb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1. Insert audit event
  await sql`
    insert into client_feedback_events (
      id, org_id, company_name, role_id, candidate_id, application_id,
      action, category, notes, reviewer_name, reviewer_email, calibrated, created_at
    ) values (
      ${eventId}, ${input.orgId}, ${input.companyName}, ${input.roleId}, ${input.candidateId},
      ${input.applicationId ?? null}, ${input.action}, ${input.category}, ${input.notes ?? ""},
      ${input.reviewerName ?? ""}, ${input.reviewerEmail ?? ""}, true, now()
    )`;

  // 2. Load existing profile
  const profile = await getClientTasteProfile(input.orgId, input.companyName);
  const oldVector = [...profile.tasteVector];

  // 3. Extract candidate representation
  const candVector = extractCandidateFeatureVector(input.candidateSummaryText || input.notes || input.category);

  // 4. Directional gradient step based on client action
  let pullWeight = 0;
  if (input.action === "interview") pullWeight = 1.0;
  else if (input.action === "hire") pullWeight = 2.0;
  else if (input.action === "reject") pullWeight = -0.6;
  else if (input.action === "more_info") pullWeight = 0.2;

  // Adaptive learning rate decaying with sample count
  const eta = 1 / Math.sqrt(profile.samplesCount + 1);

  const updatedVector = new Array(EMBED_DIM).fill(0);
  for (let i = 0; i < EMBED_DIM; i++) {
    updatedVector[i] = (profile.tasteVector[i] || 0) + eta * pullWeight * candVector[i]!;
  }
  const normalizedNewVector = normalizeVector(updatedVector);

  // 5. Measure drift distance
  const driftScore = 1 - Math.max(0, cosineSimilarity(oldVector, normalizedNewVector));
  const requiresHitlReview = driftScore > 0.35 && profile.samplesCount > 5;

  // 6. Update signals
  const isPositive = pullWeight > 0;
  const signalKey = `${input.category}:${input.notes?.slice(0, 32) || input.action}`;
  const posSet = new Set(profile.positiveSignals);
  const negSet = new Set(profile.negativeSignals);

  if (isPositive) {
    posSet.add(signalKey);
  } else {
    negSet.add(signalKey);
  }

  const updatedProfile: ClientTasteProfile = {
    ...profile,
    tasteVector: normalizedNewVector,
    positiveSignals: Array.from(posSet).slice(-20),
    negativeSignals: Array.from(negSet).slice(-20),
    samplesCount: profile.samplesCount + 1,
    positiveCount: isPositive ? profile.positiveCount + 1 : profile.positiveCount,
    negativeCount: !isPositive ? profile.negativeCount + 1 : profile.negativeCount,
    lastCalibratedAt: new Date().toISOString(),
  };

  // 7. Persist updated profile
  await sql`
    insert into client_taste_profiles (
      id, org_id, company_name, taste_vector, positive_signals, negative_signals,
      samples_count, positive_count, negative_count, culture_pace_bias, last_calibrated_at, created_at
    ) values (
      ${updatedProfile.id}, ${updatedProfile.orgId}, ${updatedProfile.companyName},
      ${JSON.stringify(updatedProfile.tasteVector)},
      ${JSON.stringify(updatedProfile.positiveSignals)},
      ${JSON.stringify(updatedProfile.negativeSignals)},
      ${updatedProfile.samplesCount}, ${updatedProfile.positiveCount}, ${updatedProfile.negativeCount},
      ${updatedProfile.culturePaceBias}, now(), ${updatedProfile.createdAt}
    )
    on conflict (org_id, company_name) do update set
      taste_vector = excluded.taste_vector,
      positive_signals = excluded.positive_signals,
      negative_signals = excluded.negative_signals,
      samples_count = excluded.samples_count,
      positive_count = excluded.positive_count,
      negative_count = excluded.negative_count,
      culture_pace_bias = excluded.culture_pace_bias,
      last_calibrated_at = now()`;

  return {
    profile: updatedProfile,
    driftScore,
    requiresHitlReview,
  };
}

/**
 * Computes taste-adjusted match score blending standard rubric score with client taste similarity.
 * Returns score 0-100.
 */
export function computeTasteAdjustedScore(
  baseRubricScore: number,
  clientTasteVector: number[],
  candidateText: string,
  samplesCount: number,
): { finalScore: number; tasteDelta: number; similarity: number } {
  if (samplesCount === 0 || clientTasteVector.every((x) => x === 0)) {
    return { finalScore: baseRubricScore, tasteDelta: 0, similarity: 0 };
  }

  const candVector = extractCandidateFeatureVector(candidateText);
  const sim = cosineSimilarity(clientTasteVector, candVector); // -1.0 to 1.0

  // Lambda scales from 0.10 up to 0.30 as we accumulate up to 20 client samples
  const lambda = Math.min(0.3, 0.1 + (samplesCount / 20) * 0.2);

  // Map cosine similarity from [-1, 1] to [0, 100]
  const tasteScoreScaled = ((sim + 1) / 2) * 100;

  const finalScore = Math.round((1 - lambda) * baseRubricScore + lambda * tasteScoreScaled);
  const tasteDelta = finalScore - baseRubricScore;

  return { finalScore, tasteDelta, similarity: sim };
}
