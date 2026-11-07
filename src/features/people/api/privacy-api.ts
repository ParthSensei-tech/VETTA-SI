import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/platform/auth/middleware";
import { getSql } from "@/platform/db";
import { ensureUserOrg } from "../server/org.server";
import {
  eraseSubject,
  orgPrivacySummary,
  purgeExpiredCandidateData,
  setOrgPrivacyFlags,
  withdrawConsent,
} from "../server/privacy.server";

export const getOrgPrivacy = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const org = await ensureUserOrg(context.userId);
    return orgPrivacySummary(org.orgId);
  });

export const saveOrgPrivacy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        retentionDays: z.number().int().min(30).max(2555),
        employerCoversClientShare: z.boolean(),
        employerCoversModelTraining: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await setOrgPrivacyFlags({ orgId: org.orgId, ...data });
    return orgPrivacySummary(org.orgId);
  });

export const runRetention = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const org = await ensureUserOrg(context.userId);
    const result = await purgeExpiredCandidateData(org.orgId);
    return { ...result, privacy: await orgPrivacySummary(org.orgId) };
  });

export const eraseCandidateData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ candidateId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const org = await ensureUserOrg(context.userId);
    const rows = await sql<{ id: string }>`
      select id from candidates
      where id = ${data.candidateId} and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId}))
      limit 1`;
    if (!rows[0]) throw new Error("That person is not in this workspace.");
    return eraseSubject({ orgId: org.orgId, subjectId: data.candidateId, reason: "request" });
  });

export const candidatePrivacyAction = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        applicationId: z.string().min(1),
        email: z.string().trim().email(),
        action: z.enum(["erase", "stop_sharing", "stop_learning", "stop_voice"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<{ id: string; org_id: string | null; email: string }>`
      select c.id, c.org_id, c.email
      from applications a
      join candidates c on c.id = a.candidate_id
      where a.id = ${data.applicationId}
      limit 1`;
    const person = rows[0];
    if (!person || !person.email || person.email.toLowerCase() !== data.email.toLowerCase()) {
      throw new Error("That email does not match this application.");
    }
    if (!person.org_id) throw new Error("This application is not tied to a company yet.");
    if (data.action === "erase") {
      return withdrawConsent({
        orgId: person.org_id,
        subjectId: person.id,
        purpose: "recruitment_evaluation",
      });
    }
    const purpose =
      data.action === "stop_sharing"
        ? "client_disclosure"
        : data.action === "stop_voice"
          ? "voice_prescreen"
          : "model_improvement";
    return withdrawConsent({
      orgId: person.org_id,
      subjectId: person.id,
      purpose,
    });
  });
