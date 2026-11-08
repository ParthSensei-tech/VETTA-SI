import { createFileRoute } from "@tanstack/react-router";
import type { VerificationSliceResult } from "@/features/verification/server/queue.server";

/**
 * The verification half of the tick, reported under its own key.
 *
 * Additive by shape — never spread over the ingest counts the batch UI polls. A
 * failure reports as `null` rather than a 500, because blanking the recruiter's
 * upload progress over a verification outage would be a regression in the feature
 * that was already here.
 */
async function verificationSlice(
  userId: string,
): Promise<VerificationSliceResult | null> {
  try {
    const { processVerificationSlice } =
      await import("@/features/verification/server/queue.server");
    return await processVerificationSlice({ userId, maxJobs: 4, budgetMs: 10_000 });
  } catch (err) {
    console.error("[vetta-verification]", err);
    return null;
  }
}

/**
 * Drain a little of the queue for whoever is asking.
 *
 * This route used to be open, and the reason it is not any more is on the other
 * side of the same sentence: an unauthenticated `curl` that runs *every* tenant's
 * ingest jobs is a way to make this workspace do work — and, once a paid
 * verification arm exists, spend the owner's quota — that nobody agreed to. The
 * two slices are now scoped to the verified caller, which is also what makes the
 * budget honest: 4 jobs of *your* queue, not 4 jobs of whoever's is next.
 *
 * Nothing in the app calls this. The progress the batch UI shows comes from
 * `ensureQueueWorker()`, armed inside the server functions the page already
 * calls, so a signed-out caller was never keeping anybody's upload alive — they
 * were just reading someone else's queue. Cron and external pollers are the
 * intended caller, and both ride the session cookie.
 */
async function tick(request: Request) {
  const { requireUserId } = await import("@/platform/auth/verify.server");
  const { assertSameSiteRequest } = await import("@/platform/auth/isolation.server");
  assertSameSiteRequest();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const userId = await requireUserId(bearer);
  const { processQueueSlice } = await import("@/features/pipeline/server/queue.server");
  const result = await processQueueSlice({ userId, maxJobs: 4, budgetMs: 50_000 });
  const verification = await verificationSlice(userId);
  return Response.json({ ok: true, ...result, verification });
}

function unauthorized(err: unknown): Response {
  const expected = err instanceof Error && /unauthorized|unauthenticated|sign in/i.test(err.message);
  return Response.json(
    { ok: false, error: expected ? "Unauthorized" : "Queue tick failed" },
    { status: expected ? 401 : 500 },
  );
}

export const Route = createFileRoute("/api/queue/tick")({
  server: {
    handlers: {
      // The handler receives the request so the bearer token can be read: in the
      // live preview the session rides a header rather than a cookie, and a tick
      // that could not see it would 401 the one caller it exists for.
      GET: ({ request }) => tick(request).catch(unauthorized),
      POST: ({ request }) => tick(request).catch(unauthorized),
    },
  },
});
