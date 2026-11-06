import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  acknowledgeAlert,
  getObservabilitySummary,
  resolveAlert,
  retryFailedJobs,
} from "../observability/observability.server.ts";
import type { ObservabilitySummary } from "../observability/types.ts";

/**
 * Fetches the unified system observability overview:
 * Errors, Latency percentiles, Model Cost breakdown, Queue health, Failed jobs, Access logs, and Alerts.
 * Strictly enforces organization authorization (owner/admin) or authorized operator for global metrics.
 */
export const getObservabilityOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        orgId: z.string().optional(),
        scope: z.enum(["org", "global"]).optional(),
      })
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ObservabilitySummary> => {
    if (data?.scope === "global") {
      const { assertAuthorizedOperator } = await import("./rbac.server.ts");
      await assertAuthorizedOperator(context.userId);
      return await getObservabilitySummary({ isOperator: true });
    }

    const { ensureUserOrg } = await import("./org.server.ts");
    const { assertOrgPermission } = await import("./rbac.server.ts");
    const org = await ensureUserOrg(context.userId);
    const targetOrgId = data?.orgId || org.orgId;

    await assertOrgPermission(context.userId, targetOrgId, "observability:view");
    return await getObservabilitySummary({ orgId: targetOrgId });
  });

/**
 * Retries failed ingest queue jobs.
 * Enforces organization scope (owner/admin permission) or authorized operator permission.
 */
export const retryFailedQueueJobs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        jobId: z.string().optional(),
        batchId: z.string().optional(),
        orgId: z.string().optional(),
        scope: z.enum(["org", "global"]).optional(),
      })
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (data?.scope === "global") {
      const { assertAuthorizedOperator } = await import("./rbac.server.ts");
      await assertAuthorizedOperator(context.userId);
      const count = await retryFailedJobs({
        jobId: data?.jobId,
        batchId: data?.batchId,
        isOperator: true,
      });
      return { ok: true, retriedCount: count };
    }

    const { ensureUserOrg } = await import("./org.server.ts");
    const { assertOrgPermission } = await import("./rbac.server.ts");
    const org = await ensureUserOrg(context.userId);
    const targetOrgId = data?.orgId || org.orgId;

    await assertOrgPermission(context.userId, targetOrgId, "observability:manage");
    const count = await retryFailedJobs({
      jobId: data?.jobId,
      batchId: data?.batchId,
      orgId: targetOrgId,
    });
    return { ok: true, retriedCount: count };
  });

/**
 * Acknowledges an active firing alert.
 * Restricted to organization owners/admins or authorized operators.
 */
export const acknowledgeAlertAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        alertId: z.string().min(1),
        orgId: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { isAuthorizedOperator, assertOrgPermission } = await import("./rbac.server.ts");
    const isOperator = await isAuthorizedOperator(context.userId);
    let targetOrgId = data.orgId;

    if (!isOperator) {
      const { ensureUserOrg } = await import("./org.server.ts");
      const org = await ensureUserOrg(context.userId);
      targetOrgId = data.orgId || org.orgId;
      await assertOrgPermission(context.userId, targetOrgId, "observability:manage");
    }

    const ok = await acknowledgeAlert(
      data.alertId,
      context.userId,
      isOperator ? undefined : targetOrgId,
    );
    return { ok };
  });

/**
 * Manually resolves an active system alert.
 * Restricted to organization owners/admins or authorized operators.
 */
export const resolveAlertAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        alertId: z.string().min(1),
        orgId: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { isAuthorizedOperator, assertOrgPermission } = await import("./rbac.server.ts");
    const isOperator = await isAuthorizedOperator(context.userId);
    let targetOrgId = data.orgId;

    if (!isOperator) {
      const { ensureUserOrg } = await import("./org.server.ts");
      const org = await ensureUserOrg(context.userId);
      targetOrgId = data.orgId || org.orgId;
      await assertOrgPermission(context.userId, targetOrgId, "observability:manage");
    }

    const ok = await resolveAlert(
      data.alertId,
      context.userId,
      isOperator ? undefined : targetOrgId,
    );
    return { ok };
  });

/**
 * The per-task model router's state: the daily budget and what is left of it, which arms are
 * eligible right now (key set, circuit closed, local host up) and what each one cost today.
 * Read-only, org-scoped like the rest of the desk.
 */
export const getRouterOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: unknown) =>
    z
      .object({
        orgId: z.string().optional(),
        scope: z.enum(["org", "global"]).optional(),
      })
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { routerStatus } = await import("./model-router.server.ts");
    if (data?.scope === "global") {
      const { assertAuthorizedOperator } = await import("./rbac.server.ts");
      await assertAuthorizedOperator(context.userId);
      return await routerStatus(null);
    }

    const { ensureUserOrg } = await import("./org.server.ts");
    const { assertOrgPermission } = await import("./rbac.server.ts");
    const org = await ensureUserOrg(context.userId);
    const targetOrgId = data?.orgId || org.orgId;
    await assertOrgPermission(context.userId, targetOrgId, "observability:view");
    return await routerStatus(targetOrgId);
  });
