/**
 * Server Functions for Official Company Career Portal Direct Ingestion
 *
 * Provides endpoints for configuring role-level portal sync, toggling
 * permissions, running on-demand syncs, and retrieving audit logs.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import {
  getRoleExternalPortalConfig as loadConfig,
  updateRoleExternalPortalConfig as saveConfig,
  syncExternalPortalFeed as runSync,
  getRolePortalSyncLogs as loadLogs,
} from "../server/external-portal-sync.server.ts";
import type {
  RoleExternalPortalConfig,
  PortalSyncLog,
  ExternalPortalSyncSummary,
  PortalSyncMode,
} from "../../recruiting/domain/types.ts";

export const getRolePortalConfig = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string() }).parse(input))
  .handler(async ({ context, data }): Promise<RoleExternalPortalConfig> => {
    const { ensureUserOrg } = await import("../server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return loadConfig({ roleId: data.roleId, orgId: org.orgId });
  });

export const updateRolePortalConfig = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string(),
        isEnabled: z.boolean(),
        portalJobUrl: z.string().optional(),
        syncMode: z.enum(["webhook_push", "feed_pull", "manual_pull"]).optional(),
        feedApiUrl: z.string().optional(),
        feedAuthToken: z.string().optional(),
        autoShortlist: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<RoleExternalPortalConfig> => {
    const { ensureUserOrg } = await import("../server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return saveConfig({
      roleId: data.roleId,
      orgId: org.orgId,
      userId: context.userId,
      isEnabled: data.isEnabled,
      portalJobUrl: data.portalJobUrl,
      syncMode: data.syncMode as PortalSyncMode,
      feedApiUrl: data.feedApiUrl,
      feedAuthToken: data.feedAuthToken,
      autoShortlist: data.autoShortlist,
    });
  });

export const triggerPortalFeedSync = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string() }).parse(input))
  .handler(async ({ context, data }): Promise<ExternalPortalSyncSummary> => {
    const { ensureUserOrg } = await import("../server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return runSync({ roleId: data.roleId, orgId: org.orgId });
  });

export const getRolePortalLogs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ roleId: z.string(), limit: z.number().optional() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<PortalSyncLog[]> => {
    const { ensureUserOrg } = await import("../server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return loadLogs({ roleId: data.roleId, orgId: org.orgId, limit: data.limit });
  });
