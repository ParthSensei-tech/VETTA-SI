/**
 * Checkout, from the buyer's side: ask for an order, hand it to Razorpay's
 * sheet. Nothing here grants anything — the webhook does, and this file cannot
 * reach it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import type { CheckoutOrder } from "../server/razorpay.server.ts";

export const createCheckoutOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ plan: z.enum(["starter", "growth"]) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<CheckoutOrder> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const { createOrderForPlan } = await import("../server/razorpay.server.ts");
    const org = await ensureUserOrg(context.userId);
    return createOrderForPlan({ orgId: org.orgId, userId: context.userId, plan: data.plan });
  });
