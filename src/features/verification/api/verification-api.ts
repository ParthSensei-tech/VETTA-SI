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
 * No caller can ask for a verdict to be produced. The only write is the retention
 * posture below, which changes what this workspace keeps, not what any check
 * concluded — a button that re-ran the ladder would be a way for a page to spend
 * money the workspace never agreed to.
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
 * This is the one write the verification feature exposes, and it is deliberately
 * the smallest one: it changes what *this workspace* agrees to keep, never what a
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
