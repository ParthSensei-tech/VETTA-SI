/**
 * The verification wire — the only way the client sees a verdict.
 *
 * Thin on purpose. What a verdict *means* is decided in `domain/report.ts`, and
 * what a workspace is *allowed to see* is decided in `server/report.server.ts`;
 * this file only turns the verified caller into a `userId` and hands it over.
 * That split is what makes the tenant scoping testable without a browser, and
 * it is why neither function below can be reached with a caller-chosen identity.
 *
 * Both are GETs and both take one id — a role for the slate, an application for
 * one report. Neither takes an org id, a user id or a report id from the caller.
 *
 * There is no write path here either, on purpose. Verification is produced by
 * the ingest handoff, not by the browser; a button that re-ran the ladder would
 * be a way for a page to spend money the workspace never agreed to.
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
