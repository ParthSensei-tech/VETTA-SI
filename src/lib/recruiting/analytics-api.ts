import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUserOrg } from "./org.server";
import { assertOrgPermission } from "./rbac.server";
import {
  recordStageTransition,
  recordPlacement,
  updatePlacementLifecycle,
  getFunnelAnalytics,
} from "./funnel-analytics.server";

const funnelStageSchema = z.enum([
  "sourced",
  "shortlisted",
  "interview",
  "offered",
  "offer_accepted",
  "joined",
  "retained_90d",
  "rejected",
  "offer_declined",
  "reneged",
  "attrited_early",
]);

/**
 * Retrieves comprehensive recruitment funnel analytics, cycle times,
 * repeat mandates, and gross margins.
 */
export const getFunnelAnalyticsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().optional(),
        clientId: z.string().optional(),
        recruiterId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        currency: z.enum(["INR", "USD", "ALL"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "analytics:view");

    return getFunnelAnalytics({
      orgId: org.orgId,
      roleId: data.roleId,
      clientId: data.clientId,
      recruiterId: data.recruiterId,
      startDate: data.startDate,
      endDate: data.endDate,
      currency: data.currency,
    });
  });

/**
 * Records a pipeline stage transition with audit timestamp.
 */
export const recordStageTransitionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        applicationId: z.string().min(1),
        candidateId: z.string().optional(),
        roleId: z.string().optional(),
        toStage: funnelStageSchema,
        fromStage: z.string().optional(),
        reason: z.string().max(500).optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "applications:move_stage");

    return recordStageTransition({
      orgId: org.orgId,
      applicationId: data.applicationId,
      candidateId: data.candidateId,
      roleId: data.roleId,
      toStage: data.toStage,
      fromStage: data.fromStage,
      actorUserId: context.userId,
      reason: data.reason,
      metadata: data.metadata,
    });
  });

/**
 * Records placement commercials and gross margin.
 */
export const recordPlacementFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        candidateId: z.string().min(1),
        applicationId: z.string().min(1),
        offeredCtc: z.number().min(0),
        feePercentage: z.number().min(0).max(100).optional(),
        directSourcingCost: z.number().min(0).optional(),
        recruiterCommission: z.number().min(0).optional(),
        currency: z.enum(["INR", "USD"]).optional(),
        offerDate: z.string().optional(),
        offerAcceptedDate: z.string().optional(),
        joiningDate: z.string().optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "placements:manage");

    return recordPlacement({
      orgId: org.orgId,
      roleId: data.roleId,
      candidateId: data.candidateId,
      applicationId: data.applicationId,
      offeredCtc: data.offeredCtc,
      feePercentage: data.feePercentage,
      directSourcingCost: data.directSourcingCost,
      recruiterCommission: data.recruiterCommission,
      currency: data.currency,
      offerDate: data.offerDate,
      offerAcceptedDate: data.offerAcceptedDate,
      joiningDate: data.joiningDate,
      notes: data.notes,
    });
  });

/**
 * Updates post-offer lifecycle status (joining, retention, clawback).
 */
export const updatePlacementLifecycleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        applicationId: z.string().min(1),
        joiningStatus: z.enum(["pending", "joined", "reneged", "no_show"]).optional(),
        retentionStatus: z
          .enum(["pending", "retained_30d", "retained_60d", "retained_90d", "attrited_early"])
          .optional(),
        retentionDays: z.number().int().min(0).optional(),
        clawbackAmount: z.number().min(0).optional(),
        invoiceStatus: z.enum(["draft", "billed", "collected", "clawed_back"]).optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "placements:manage");

    return updatePlacementLifecycle({
      orgId: org.orgId,
      applicationId: data.applicationId,
      joiningStatus: data.joiningStatus,
      retentionStatus: data.retentionStatus,
      retentionDays: data.retentionDays,
      clawbackAmount: data.clawbackAmount,
      invoiceStatus: data.invoiceStatus,
      notes: data.notes,
    });
  });
