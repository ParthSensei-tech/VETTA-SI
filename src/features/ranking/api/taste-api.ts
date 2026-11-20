import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/platform/db";
import { authMiddleware } from "@/platform/auth/middleware";
import {
  getClientTasteProfile,
  recordClientFeedbackAndCalibrate,
} from "../server/taste-engine.server";
import type { TasteCategory, ClientFeedbackAction } from "../domain/taste-types";

const submitFeedbackSchema = z.object({
  shareToken: z.string().min(1),
  candidateId: z.string().min(1),
  applicationId: z.string().optional(),
  action: z.enum(["interview", "reject", "hire", "more_info"]),
  category: z.enum([
    "culture_pace",
    "tech_depth",
    "ctc_gap",
    "notice_too_long",
    "service_firm_bias",
    "communication",
    "autonomy",
    "other",
  ]),
  notes: z.string().max(1000).optional(),
  reviewerName: z.string().max(120).optional(),
  reviewerEmail: z.string().email().optional().or(z.literal("")),
});

/**
 * Publicly accessible via verified shareToken — allows hiring managers
 * to click [Interview] or [Reject with Reason] directly on the client review page.
 */
export const submitClientCandidateFeedback = createServerFn({ method: "POST" })
  .validator((input: unknown) => submitFeedbackSchema.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();

    // Verify share token and retrieve role & org context
    const rows = await sql<{
      id: string;
      role_id: string;
      user_id: string;
      company_name?: string;
    }>`
      select cs.id, cs.role_id, cs.user_id, r.company_name
      from client_shares cs
      left join roles r on r.id = cs.role_id
      where cs.token = ${data.shareToken}
      limit 1`;

    const share = rows[0];
    if (!share) {
      throw new Error("Invalid or expired client share link");
    }

    const { ensureUserOrg } = await import("@/features/people/server/org.server");
    const org = await ensureUserOrg(share.user_id);
    const companyName = share.company_name || "Client";

    // Ingest feedback, calibrate latent vector, and update profile
    const result = await recordClientFeedbackAndCalibrate({
      orgId: org.orgId,
      companyName,
      roleId: share.role_id,
      candidateId: data.candidateId,
      applicationId: data.applicationId,
      action: data.action as ClientFeedbackAction,
      category: data.category as TasteCategory,
      notes: data.notes,
      reviewerName: data.reviewerName,
      reviewerEmail: data.reviewerEmail,
    });

    return {
      success: true,
      action: data.action,
      calibrated: true,
      tasteSamplesCount: result.profile.samplesCount,
      requiresHitlReview: result.requiresHitlReview,
    };
  });

/**
 * Recruiter-authenticated endpoint to inspect the calibrated taste profile of a client
 */
export const getClientTasteOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        companyName: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { ensureUserOrg } = await import("@/features/people/server/org.server");
    const org = await ensureUserOrg(context.userId);
    return getClientTasteProfile(org.orgId, data.companyName);
  });
