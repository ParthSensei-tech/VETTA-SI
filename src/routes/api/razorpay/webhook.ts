import { createFileRoute } from "@tanstack/react-router";
import { handleWebhookDelivery } from "@/features/billing/server/razorpay.server";

/**
 * Razorpay webhook — the only way a payment becomes a plan.
 *
 * Order of operations here is the whole security property: read the body as
 * text, verify the HMAC over those exact bytes, and only then let anything
 * parse. A route that called `request.json()` first would be verifying a
 * re-serialisation of the payload instead of the payload, and every genuine
 * signature would fail while a forged one that happened to re-serialise
 * identically would pass.
 *
 * Always answer 200 for a verified event, applied or not. Anything else tells
 * Razorpay the delivery failed, and it retries — which is exactly what the
 * `razorpay_events` spine is here to make harmless, but not what a duplicate
 * of an unverified probe should be for.
 */
export const Route = createFileRoute("/api/razorpay/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const outcome = await handleWebhookDelivery({ rawBody, signature });
        return Response.json(
          { ok: outcome.status < 400, applied: outcome.applied, reason: outcome.reason },
          { status: outcome.status },
        );
      },
    },
  },
});
