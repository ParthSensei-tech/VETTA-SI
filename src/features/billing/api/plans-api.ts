/**
 * The plan wire — how a workspace sees what it is on and what it has spent.
 *
 * Read-only by design, like the verification quota wire: nothing on this file
 * can flip a plan or hand a workspace an unlimited month. The writers are the
 * checkout webhook (when it exists) and the manual upgrade path, and neither is
 * reachable from a page.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import type { ProductPlanSummary } from "../server/plans.server.ts";

export const getEntitlement = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ProductPlanSummary> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const { productPlanSummary } = await import("../server/plans.server.ts");
    const org = await ensureUserOrg(context.userId);
    return productPlanSummary(org.orgId);
  });
