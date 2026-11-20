/**
 * TanStack Start Server Functions for DPDP Act & DPDP Rules Enterprise Compliance Service.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import {
  auditOrgDpdpCompliance,
  configureGrievanceOfficer,
  createDsarRequest,
  generateDpbiFiling,
  listBreachIncidents,
  listDsarRequests,
  logBreachIncident,
  recordDpaAgreement,
  resolveDsarRequest,
  runDpdpRetentionGc,
  type BreachIncidentRecord,
  type DpaRecord,
  type DsarRequestRecord,
  type GrievanceOfficerRecord,
  type OrgComplianceSummary,
} from "../server/dpdp.server.ts";
import type { DsarRequestType } from "../domain/dpdp.ts";

export const getOrgDpdpAudit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OrgComplianceSummary> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return auditOrgDpdpCompliance(org.orgId);
  });

export const signDpaAgreement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        signerName: z.string().min(2, "Signer name is required"),
        signerTitle: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<DpaRecord> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return recordDpaAgreement({
      orgId: org.orgId,
      userId: context.userId,
      signerName: data.signerName,
      signerTitle: data.signerTitle,
    });
  });

export const updateGrievanceOfficer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        officerName: z.string().min(2),
        officerEmail: z.string().email(),
        officerPhone: z.string().min(8),
        physicalAddress: z.string().min(10),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<GrievanceOfficerRecord> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return configureGrievanceOfficer({
      orgId: org.orgId,
      ...data,
    });
  });

export const getOrgDsarQueue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DsarRequestRecord[]> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return listDsarRequests(org.orgId);
  });

export const resolveDsar = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string(),
        resolutionNotes: z.string().min(5),
        status: z.enum(["resolved", "rejected"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    await resolveDsarRequest({
      orgId: org.orgId,
      requestId: data.requestId,
      resolvedByUserId: context.userId,
      resolutionNotes: data.resolutionNotes,
      status: data.status,
    });
    return { success: true };
  });

export const getOrgBreachIncidents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BreachIncidentRecord[]> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return listBreachIncidents(org.orgId);
  });

export const reportBreach = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(3),
        affectedCandidatesCount: z.number().int().nonnegative(),
        dataCategories: z.array(z.string()),
        rootCause: z.string().min(5),
        containmentActions: z.string().min(5),
        isExfiltrationConfirmed: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<BreachIncidentRecord> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return logBreachIncident({
      orgId: org.orgId,
      ...data,
    });
  });

export const getDpbiFilingText = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ incidentId: z.string() }).parse(input))
  .handler(async ({ context, data }): Promise<{ filingText: string }> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    const filingText = await generateDpbiFiling({
      orgId: org.orgId,
      incidentId: data.incidentId,
    });
    return { filingText };
  });

export const triggerRetentionPurge = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ purged: number }> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    return runDpdpRetentionGc(org.orgId);
  });

export const submitPublicCandidateDsar = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        orgId: z.string(),
        candidateId: z.string().optional(),
        applicationId: z.string().optional(),
        requestType: z.enum(["access_summary", "correction", "erasure", "grievance", "nomination"]),
        subjectEmail: z.string().email(),
        subjectName: z.string().optional(),
        details: z.string().min(5),
        nomineeName: z.string().optional(),
        nomineeContact: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ success: boolean; requestId: string }> => {
    const req = await createDsarRequest({
      orgId: data.orgId,
      candidateId: data.candidateId ?? null,
      applicationId: data.applicationId ?? null,
      requestType: data.requestType as DsarRequestType,
      subjectEmail: data.subjectEmail,
      subjectName: data.subjectName ?? null,
      details: data.details,
      nomineeName: data.nomineeName ?? null,
      nomineeContact: data.nomineeContact ?? null,
    });
    return { success: true, requestId: req.id };
  });
