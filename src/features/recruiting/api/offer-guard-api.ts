/**
 * Server Functions for Offer Guard – Offer-to-Joining Pre-Boarding & Renege Prevention
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import {
  getPreboardingDashboardSummary,
  getPreboardingOffers,
  getPreboardingOfferById,
  createOrUpdatePreboardingOffer,
  resolvePreboardingOffer,
  logPreboardingSignal,
  getPreboardingSignals,
  getPreboardingInterventions,
  executeInterventionPlaybook,
  getSilverMedalistCandidates,
  warmSilverMedalistStandby,
  updateTutorialProgress,
  getTutorialProgress,
} from "../server/offer-guard.server.ts";
import {
  OFFER_RESOLUTIONS,
  type HazardAssessment,
  type OfferGuardDashboard,
  type PreboardingIntervention,
  type PreboardingOffer,
  type PreboardingSignal,
  type SignalType,
} from "../domain/types.ts";

export const getOfferGuardDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OfferGuardDashboard> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return getPreboardingDashboardSummary(org.orgId);
  });

/**
 * Close out an offer. `joined` is the only event in the product that can create
 * a billable hire, so the write lives behind auth and the org scope.
 */
export const resolveOffer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        offerId: z.string(),
        resolution: z.enum(OFFER_RESOLUTIONS),
      })
      .parse(input),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{ offer: PreboardingOffer; feeDrafted: boolean; feeReason: string }> => {
      const { ensureUserOrg } = await import("../../people/server/org.server.ts");
      const org = await ensureUserOrg(context.userId);
      return resolvePreboardingOffer({
        orgId: org.orgId,
        offerId: data.offerId,
        resolution: data.resolution,
      });
    },
  );

export const getPreboardingOffer = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ offerId: z.string() }).parse(input))
  .handler(async ({ data }): Promise<PreboardingOffer | null> => {
    return getPreboardingOfferById(data.offerId);
  });

export const savePreboardingOffer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string(),
        candidateId: z.string(),
        applicationId: z.string(),
        targetJoiningDate: z.string(),
        totalNoticeDays: z.number().optional(),
        offeredCtc: z.number(),
        currentCtc: z.number(),
        placementFee: z.number().optional(),
        currency: z.string().optional(),
        currentEmployerType: z
          .enum(["gcc_product", "tier1_it_services", "midmarket_services", "startup", "unknown"])
          .optional(),
        requiresRelocation: z.boolean().optional(),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<PreboardingOffer> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return createOrUpdatePreboardingOffer({
      orgId: org.orgId,
      roleId: data.roleId,
      candidateId: data.candidateId,
      applicationId: data.applicationId,
      targetJoiningDate: data.targetJoiningDate,
      totalNoticeDays: data.totalNoticeDays,
      offeredCtc: data.offeredCtc,
      currentCtc: data.currentCtc,
      placementFee: data.placementFee,
      currency: data.currency || "INR",
      currentEmployerType: data.currentEmployerType,
      requiresRelocation: data.requiresRelocation,
      notes: data.notes,
    });
  });

export const recordSignal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        offerId: z.string(),
        signalType: z.enum([
          "response_latency",
          "resignation_milestone",
          "document_velocity",
          "portal_dwell",
          "recruiter_sentiment",
          "counteroffer_hint",
          "doj_delay_request",
          "manual_override",
        ]),
        signalValue: z.number(),
        payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{ signal: PreboardingSignal; updatedAssessment: HazardAssessment }> => {
      return logPreboardingSignal({
        offerId: data.offerId,
        signalType: data.signalType as SignalType,
        signalValue: data.signalValue,
        payload: data.payload,
        notes: data.notes,
      });
    },
  );

export const getOfferSignals = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ offerId: z.string() }).parse(input))
  .handler(async ({ data }): Promise<PreboardingSignal[]> => {
    return getPreboardingSignals(data.offerId);
  });

export const getOfferInterventions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ offerId: z.string() }).parse(input))
  .handler(async ({ data }): Promise<PreboardingIntervention[]> => {
    return getPreboardingInterventions(data.offerId);
  });

export const executePlaybook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        interventionId: z.string(),
        status: z.enum(["in_progress", "completed", "dismissed"]),
        outcomeNotes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<PreboardingIntervention> => {
    return executeInterventionPlaybook({
      interventionId: data.interventionId,
      status: data.status,
      actorUserId: context.userId,
      outcomeNotes: data.outcomeNotes,
    });
  });

export const fetchSilverMedalists = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    (input: unknown) =>
      z.object({ roleId: z.string(), currentCandidateId: z.string() }).parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<Array<{ id: string; candidateName: string; rankScore: number; headline: string; email: string }>> => {
      return getSilverMedalistCandidates(data.roleId, data.currentCandidateId);
    },
  );

export const triggerSilverMedalistStandby = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: unknown) =>
      z.object({ offerId: z.string(), silverMedalistAppId: z.string() }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await warmSilverMedalistStandby(data.offerId, data.silverMedalistAppId);
    return { ok: true };
  });

export const fetchTutorialProgress = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Record<string, boolean>> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return getTutorialProgress(org.orgId, context.userId);
  });

export const dismissTutorialBubble = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ stepKey: z.string() }).parse(input))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    await updateTutorialProgress(org.orgId, context.userId, data.stepKey, true);
    return { ok: true };
  });
