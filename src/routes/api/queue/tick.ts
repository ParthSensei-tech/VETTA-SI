import { createFileRoute } from "@tanstack/react-router";
import type { VerificationSliceResult } from "@/features/verification/server/queue.server";
import { processQueueSlice } from "@/features/pipeline/server/queue.server";

/**
 * The verification half of the tick, reported under its own key.
 *
 * Additive by shape — never spread over the ingest counts the batch UI polls —
 * and free-tier only: this route is unauthenticated, so a caller with a curl can
 * trigger local checks the workspace already gets for nothing, but cannot reach
 * a paid arm or spend the owner's quota. A failure reports as `null` rather than
 * a 500, because blanking the recruiter's upload progress over a verification
 * outage would be a regression in the feature that was already here.
 */
async function verificationSlice(): Promise<VerificationSliceResult | null> {
  try {
    const { processVerificationSlice } =
      await import("@/features/verification/server/queue.server");
    return await processVerificationSlice({ maxJobs: 4, budgetMs: 10_000 });
  } catch (err) {
    console.error("[vetta-verification]", err);
    return null;
  }
}

async function tick() {
  const result = await processQueueSlice({ maxJobs: 4, budgetMs: 50_000 });
  const verification = await verificationSlice();
  return Response.json({ ok: true, ...result, verification });
}

export const Route = createFileRoute("/api/queue/tick")({
  server: {
    handlers: {
      GET: () => tick(),
      POST: () => tick(),
    },
  },
});
