import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

const RecordFeedbackInputSchema = z.object({
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

export const recordFeedbackSignal = createServerFn({ method: "POST" })
  .validator((data: unknown) => RecordFeedbackInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { recordFeedbackSignalDb } = await import("../server/feedback-signal.server");
    return recordFeedbackSignalDb(data);
  });

export const getOrgFeedbackStats = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ orgId: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const { getOrgFeedbackStatsDb } = await import("../server/feedback-signal.server");
    return getOrgFeedbackStatsDb(data.orgId);
  });

export const updateFeedbackOutcome = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        candidateId: z.string().min(1),
        roleId: z.string().min(1),
        outcomeJoined: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { updateFeedbackOutcomeDb } = await import("../server/feedback-signal.server");
    return updateFeedbackOutcomeDb(data.candidateId, data.roleId, data.outcomeJoined);
  });
