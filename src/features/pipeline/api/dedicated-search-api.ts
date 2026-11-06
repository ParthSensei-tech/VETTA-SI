/**
 * Dedicated pgvector + PostgreSQL Search API (Client-callable Server Functions)
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import {
  executeDedicatedHybridSearch,
  getSearchInfrastructureTelemetry,
  reviewAndAdvanceCandidate,
  type DedicatedSearchResponse,
} from "../server/dedicated-search.server.ts";
import type { PipelineStatus } from "../../../lib/recruiting/types.ts";

export const dedicatedHybridSearch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        queryText: z.string().max(300).optional(),
        roleId: z.string().optional(),
        location: z.string().max(100).optional(),
        noticeMaxDays: z.number().int().positive().max(365).nullable().optional(),
        ctcMaxLakh: z.number().positive().max(500).nullable().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        enableCrossEncoderRerank: z.boolean().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<DedicatedSearchResponse> => {
    const { ensureUserOrg } = await import("../../../lib/recruiting/org.server.ts");
    const org = await ensureUserOrg(context.userId);

    return executeDedicatedHybridSearch({
      userId: context.userId,
      orgId: org.orgId,
      queryText: data.queryText,
      roleId: data.roleId,
      location: data.location,
      noticeMaxDays: data.noticeMaxDays,
      ctcMaxLakh: data.ctcMaxLakh,
      limit: data.limit,
      enableCrossEncoderRerank: data.enableCrossEncoderRerank ?? true,
    });
  });

export const advanceCandidateStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        candidateId: z.string().min(1),
        roleId: z.string().min(1),
        nextStatus: z.enum([
          "ingested",
          "ranked",
          "shortlisted",
          "screening",
          "ready",
          "approved",
          "sent",
          "hold",
          "rejected",
        ]),
        notes: z.string().max(1000).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { ensureUserOrg } = await import("../../../lib/recruiting/org.server.ts");
    const org = await ensureUserOrg(context.userId);

    return reviewAndAdvanceCandidate({
      candidateId: data.candidateId,
      roleId: data.roleId,
      orgId: org.orgId,
      nextStatus: data.nextStatus as PipelineStatus,
      recruiterNotes: data.notes,
      recruiterUserId: context.userId,
    });
  });

export const getSearchTelemetry = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureUserOrg } = await import("../../../lib/recruiting/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return getSearchInfrastructureTelemetry(org.orgId);
  });
