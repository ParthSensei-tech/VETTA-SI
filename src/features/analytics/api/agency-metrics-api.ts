import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/platform/auth/middleware";
import { computeAgencyMetrics } from "../server/agency-metrics.server";

export const getAgencyMetricsOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureUserOrg } = await import("@/features/people/server/org.server");
    const org = await ensureUserOrg(context.userId);
    return computeAgencyMetrics(org.orgId);
  });
