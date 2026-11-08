/**
 * The verification wire — the only way the client sees a verdict.
 *
 * Thin on purpose. What a verdict *means* is decided in `domain/report.ts`, and
 * what a workspace is *allowed to see* is decided in `server/report.server.ts`;
 * this file only turns the verified caller into a `userId` and hands it over.
 * That split is what makes the tenant scoping testable without a browser, and
 * it is why neither function below can be reached with a caller-chosen identity.
 *
 * Both reads are GETs and both take one id — a role for the slate, an application
 * for one report. Neither takes an org id, a user id or a report id from the caller.
 *
 * No caller can ask for a verdict to be produced. The two writes are both
 * postures, never conclusions: the retention wire changes what this workspace
 * keeps, and the plan wire records which ladder it bought. Neither can make a
 * check conclude anything, and neither takes a number that would move the meter —
 * the uses are counted from the charges the runs themselves left behind, so a
 * page cannot hand its own workspace an unlimited trial.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import type { SlateVerdict, VerificationReportView } from "../domain/report.ts";
import { reportForUser, slateVerdictsFor } from "../server/report.server.ts";

export const getSlateVerdicts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<{ verdicts: SlateVerdict[] }> => ({
    verdicts: await slateVerdictsFor(context.userId, data.roleId),
  }));

export const getVerificationReport = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ applicationId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<VerificationReportView> =>
    reportForUser(context.userId, data.applicationId),
  );

/**
 * The document store's two wires — one read, one decision.
 *
 * This is the first of the feature's two writes, and it is deliberately the
 * smallest one: it changes what *this workspace* agrees to keep, never what a
 * verdict says. Neither function takes an org id, so a caller cannot aim the
 * setting at somebody else's tenant; `ensureUserOrg` derives it from the session
 * the middleware verified.
 */
export const getDocumentStore = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const { documentStoreSummaryForOrg } = await import("../server/documents.server.ts");
    const org = await ensureUserOrg(context.userId);
    return documentStoreSummaryForOrg(org.orgId);
  });

export const setDocumentStoreRetention = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        byteRetention: z.boolean(),
        // The domain clamps to 90 whatever arrives; the validator only has to
        // refuse nonsense before it gets that far.
        retentionDays: z.number().int().positive().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const { setByteRetention, documentStoreSummaryForOrg } =
      await import("../server/documents.server.ts");
    const org = await ensureUserOrg(context.userId);
    const result = await setByteRetention({
      orgId: org.orgId,
      userId: context.userId,
      byteRetention: data.byteRetention,
      retentionDays: data.retentionDays ?? null,
    });
    return { ...result, store: await documentStoreSummaryForOrg(org.orgId) };
  });

/**
 * The plan and its meter — the workspace's own commercial state, and nothing
 * else's.
 *
 * No id comes in, for the same reason the store read takes none: `orgId` is
 * derived from the verified session, so a page cannot ask about another tenant's
 * allowance. The summary is the server's arithmetic over the charges the runs
 * left behind, which is why the read is safe to show and a client-side count
 * would not be.
 */
export const getVerificationQuota = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const { verificationQuotaSummary } = await import("../server/quota.server.ts");
    const org = await ensureUserOrg(context.userId);
    return verificationQuotaSummary(org.orgId);
  });

/**
 * Record that this workspace has a verification plan — or that it no longer does.
 *
 * This is the second write, and the one thing it does not do is take money.
 * Nothing in this repo bills: the flag records an agreement made outside the
 * product, which is what switches the checks that need the original file on for
 * the reports after it. A validator that accepted `freeQuota` would let any
 * logged-in page hand its workspace an unlimited trial, so the number a
 * workspace was granted is not a field on this wire, and the meter itself has no
 * write path at all — it is counted from the charges.
 */
export const setVerificationPlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ plan: z.enum(["free", "paid"]) }).parse(input))
  .handler(async ({ context, data }) => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const { setVerificationPlan: writePlan, verificationQuotaSummary } =
      await import("../server/quota.server.ts");
    const org = await ensureUserOrg(context.userId);
    await writePlan({ orgId: org.orgId, userId: context.userId, plan: data.plan });
    return verificationQuotaSummary(org.orgId);
  });
