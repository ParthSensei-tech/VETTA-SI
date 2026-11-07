import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import { assertOrgPermission } from "../../people/server/rbac.server.ts";
import {
  getEmbeddingIndexStatus,
  startModelReindex,
  switchActiveEmbeddingModel,
  cancelModelReindex,
  triggerEmbeddingBackfill,
  processEmbeddingQueueBatch,
  type EmbeddingIndexStatus,
} from "../server/embedding-queue.server.ts";

/**
 * Retrieves comprehensive semantic indexing progress, coverage, and model version info for the organization.
 */
export const getEmbeddingIndexStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<EmbeddingIndexStatus> => {
    const org = await ensureUserOrg(context.userId);
    return getEmbeddingIndexStatus(org.orgId);
  });

/**
 * Triggers a background backfill for all unindexed candidates using the active embedding model.
 */
export const triggerEmbeddingBackfillFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const org = await ensureUserOrg(context.userId);
    return triggerEmbeddingBackfill({ orgId: org.orgId });
  });

/**
 * Initiates model-version-aware reindexing across all candidates in the organization.
 * The active model continues serving search requests while the target model index is built.
 */
export const startModelReindexFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        targetModel: z.string().min(1),
        autoSwitch: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "observability:manage");
    return startModelReindex({
      orgId: org.orgId,
      targetModel: data.targetModel,
      autoSwitch: data.autoSwitch,
    });
  });

/**
 * Manually switches the active embedding model (e.g. once reindexing finishes).
 */
export const switchActiveEmbeddingModelFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        newActiveModel: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "observability:manage");
    return switchActiveEmbeddingModel({
      orgId: org.orgId,
      newActiveModel: data.newActiveModel,
    });
  });

/**
 * Cancels an ongoing model reindex job.
 */
export const cancelModelReindexFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "observability:manage");
    return cancelModelReindex({ orgId: org.orgId });
  });

/**
 * Executes an immediate queue slice (useful for synchronous tests and manual pump).
 */
export const processEmbeddingBatchNowFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        batchSize: z.number().int().min(1).max(100).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return processEmbeddingQueueBatch({
      batchSize: data.batchSize,
      orgId: org.orgId,
    });
  });
