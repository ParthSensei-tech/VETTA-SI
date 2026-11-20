/**
 * Feedback Signal Server — The Data Flywheel Core
 *
 * Every approve/reject/unlock decision a founder makes on a candidate card is
 * captured here. This labeled dataset compounds daily and is what makes
 * Vetta's taste engine progressively impossible to replicate from scratch.
 *
 * A competitor copying our UI on Day 1 of Year 2 starts with zero of this.
 * We have 12 months of labeled Indian hiring decisions by then.
 */

import { getSql } from "@/platform/db";
import { z } from "zod";

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const FeedbackAction = z.enum([
  "pass",
  "unlock",
  "shortlist",
  "reject_post_unlock",
]);
export type FeedbackAction = z.infer<typeof FeedbackAction>;

export const FeedbackReasonCode = z.enum([
  "notice_too_long",
  "ctc_gap",
  "comm_quality",
  "tech_weak",
  "culture_fit",
  "strong_hire",
  "overqualified",
  "service_firm_bias",
  "other",
  "unspecified",
]);
export type FeedbackReasonCode = z.infer<typeof FeedbackReasonCode>;

export const RecordFeedbackInputSchema = z.object({
  orgId: z.string().min(1),
  candidateId: z.string().min(1),
  roleId: z.string().min(1),
  sessionId: z.string().default(""),
  action: FeedbackAction,
  reasonCode: FeedbackReasonCode.default("unspecified"),
  reasonNote: z.string().default(""),
  matchScoreAtDecision: z.number().int().min(0).max(100).default(0),
  decisionLatencyMs: z.number().int().min(0).default(0),
  audioPlayed: z.boolean().default(false),
  hinglishFlags: z.array(z.string()).default([]),
});

export type RecordFeedbackInput = z.infer<typeof RecordFeedbackInputSchema>;

// ─── Database Operations ─────────────────────────────────────────────────────

/**
 * Records a single triage decision in the database.
 */
export async function recordFeedbackSignalDb(data: RecordFeedbackInput) {
  const sql = await getSql();

  await sql.query(
    `INSERT INTO feedback_signals (
      org_id, candidate_id, role_id, session_id,
      action, reason_code, reason_note,
      match_score_at_decision, decision_latency_ms,
      audio_played, hinglish_flags
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      data.orgId,
      data.candidateId,
      data.roleId,
      data.sessionId,
      data.action,
      data.reasonCode,
      data.reasonNote,
      data.matchScoreAtDecision,
      data.decisionLatencyMs,
      data.audioPlayed,
      JSON.stringify(data.hinglishFlags),
    ],
  );

  return { ok: true, action: data.action };
}

/**
 * Returns aggregated feedback stats for an org.
 */
export async function getOrgFeedbackStatsDb(orgId: string) {
  const sql = await getSql();

  const rows = await sql.query<{
    action: string;
    count: string;
    avg_latency_ms: string;
  }>(
    `SELECT
       action,
       COUNT(*)::text AS count,
       ROUND(AVG(decision_latency_ms))::text AS avg_latency_ms
     FROM feedback_signals
     WHERE org_id = $1
     GROUP BY action
     ORDER BY action`,
    [orgId],
  );

  const stats = rows.reduce(
    (
      acc: Record<string, { count: number; avgLatencyMs: number }>,
      row: { action: string; count: string; avg_latency_ms: string },
    ) => {
      acc[row.action] = {
        count: parseInt(row.count, 10),
        avgLatencyMs: parseInt(row.avg_latency_ms, 10),
      };
      return acc;
    },
    {} as Record<string, { count: number; avgLatencyMs: number }>,
  );

  return { orgId, stats };
}

/**
 * Updates the outcome of a past decision (did the candidate join?).
 */
export async function updateFeedbackOutcomeDb(
  candidateId: string,
  roleId: string,
  outcomeJoined: boolean,
) {
  const sql = await getSql();

  await sql.query(
    `UPDATE feedback_signals
     SET outcome_joined = $1, outcome_checked_at = now()
     WHERE candidate_id = $2 AND role_id = $3
       AND action = 'unlock'
       AND outcome_joined IS NULL`,
    [outcomeJoined, candidateId, roleId],
  );

  return { ok: true };
}
