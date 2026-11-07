/**
 * Autonomous Career Portal & Multi-Stage Ingestion API
 * Server Functions for portal configuration, strict HITL decision queues,
 * ATS webhook relays, and public candidate application & dynamic intake.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import {
  ensureAutonomousPortal,
  updateAutonomousPortal,
  getAutonomousPortalBySlug,
  loadHitlCheckpoints,
  decideHitlCheckpoint,
  createHitlCheckpoint,
  processAtsWebhookIngestion,
  generateInteractiveProbes,
  CLIENT_HELPING_STEPS,
  type ClientOptionGuide,
} from "../server/autonomous-portal.server.ts";
import type {
  AutonomousPortal,
  HitlDecision,
  HitlDecisionStatus,
  HitlCheckpointType,
  HitlPolicy,
  AtsWebhookPayload,
} from "../../../lib/recruiting/types.ts";
import { getSql } from "../../../platform/db.ts";
import { randomUUID } from "node:crypto";
import { parseJson } from "../../../shared/utils.ts";
import { matchCandidateToRole } from "../../ranking/domain/match-engine.ts";

export const getAutonomousPortalConfig = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async ({
      context,
    }): Promise<{
      portal: AutonomousPortal;
      guides: Record<string, ClientOptionGuide>;
    }> => {
      const { ensureUserOrg } = await import("../server/org.server.ts");
      const org = await ensureUserOrg(context.userId);
      const defaultSlug =
        org.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 30) || "careers";

      const portal = await ensureAutonomousPortal({
        orgId: org.orgId,
        defaultSlug,
        defaultName: org.name || "Our Company",
      });

      return {
        portal,
        guides: CLIENT_HELPING_STEPS,
      };
    },
  );

export const updateAutonomousPortalConfig = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        portalId: z.string(),
        slug: z.string().min(2).max(50).optional(),
        portalName: z.string().min(2).max(100).optional(),
        headline: z.string().max(200).optional(),
        description: z.string().max(1000).optional(),
        tier: z.enum(["freemium", "premium"]).optional(),
        hitlPolicy: z.enum(["strict", "balanced", "autonomous"]).optional(),
        autoShortlistThreshold: z.number().int().min(40).max(95).optional(),
        requireHumanRejection: z.boolean().optional(),
        interactiveIntakeEnabled: z.boolean().optional(),
        connectedAts: z.enum(["none", "workday", "taleo", "greenhouse", "lever"]).optional(),
        channels: z
          .object({
            careerPortal: z.boolean(),
            embedWidget: z.boolean(),
            atsWebhook: z.boolean(),
            directDrop: z.boolean(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; portal: AutonomousPortal }> => {
    const updated = await updateAutonomousPortal(data.portalId, {
      slug: data.slug,
      portalName: data.portalName,
      headline: data.headline,
      description: data.description,
      tier: data.tier,
      hitlPolicy: data.hitlPolicy as HitlPolicy,
      autoShortlistThreshold: data.autoShortlistThreshold,
      requireHumanRejection: data.requireHumanRejection,
      interactiveIntakeEnabled: data.interactiveIntakeEnabled,
      connectedAts: data.connectedAts,
      channels: data.channels,
    });

    return { ok: true, portal: updated };
  });

export const getHitlQueue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        status: z.enum(["pending", "approved", "rejected", "clarification_requested"]).optional(),
        checkpointType: z
          .enum([
            "rubric_approval",
            "missing_info_probe",
            "shortlist_interview",
            "candidate_rejection",
          ])
          .optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(
    async ({ context, data }): Promise<{ checkpoints: HitlDecision[]; pendingCount: number }> => {
      const { ensureUserOrg } = await import("../server/org.server.ts");
      const org = await ensureUserOrg(context.userId);

      const checkpoints = await loadHitlCheckpoints({
        orgId: org.orgId,
        status: data.status as HitlDecisionStatus,
        checkpointType: data.checkpointType as HitlCheckpointType,
        limit: data.limit,
      });

      const pendingAll = await loadHitlCheckpoints({
        orgId: org.orgId,
        status: "pending",
        limit: 100,
      });

      return {
        checkpoints,
        pendingCount: pendingAll.length,
      };
    },
  );

export const submitHitlDecision = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        checkpointId: z.string(),
        decision: z.enum(["approved", "rejected", "clarification_requested"]),
        reviewerNotes: z.string().max(1000).default(""),
        calibrationDelta: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean; status: HitlDecisionStatus }> => {
    return decideHitlCheckpoint({
      checkpointId: data.checkpointId,
      reviewerId: context.userId,
      decision: data.decision,
      reviewerNotes: data.reviewerNotes,
      calibrationDelta: data.calibrationDelta,
    });
  });

export const simulateAtsRelayPing = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        portalId: z.string(),
        ats: z.enum(["workday", "taleo", "greenhouse", "lever"]),
        candidateName: z.string().default("Alex Chen"),
        candidateEmail: z.string().email().default("alex.chen@example.com"),
        roleTitle: z.string().optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      candidateName: string;
      score: number;
      fitLevel: string;
      checkpointCreated: boolean;
      message: string;
    }> => {
      const mockPayload: AtsWebhookPayload = {
        ats: data.ats,
        event: "candidate.created",
        candidate: {
          name: data.candidateName,
          email: data.candidateEmail,
          phone: "+91 9876543210",
          location: "Bengaluru",
          resumeText: `
          ${data.candidateName}
          Staff Systems Architect | Bengaluru
          Email: ${data.candidateEmail} | Phone: +91 9876543210
          
          Experience:
          - 7 years architecting high-scale distributed backend systems with Go, PostgreSQL, and Kafka.
          - Optimized transaction processing throughput to 50k RPS with sub-10ms P99 latency.
          - Mentored 6 engineers on microservice design and fault tolerance.
        `,
        },
        job: {
          externalJobId: `ext-${Date.now()}`,
          title: data.roleTitle,
        },
      };

      const res = await processAtsWebhookIngestion({
        portalId: data.portalId,
        payload: mockPayload,
      });

      return {
        ...res,
        message: `Simulated incoming candidate from ${data.ats.toUpperCase()} successfully. Multi-stage retrieval completed.`,
      };
    },
  );

// ============================================================================
// PUBLIC ENDPOINTS (CANDIDATE CAREER PORTAL & DYNAMIC INTAKE)
// ============================================================================

export type PublicPortalRole = {
  id: string;
  title: string;
  location: string;
  workMode: string;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  jdText: string;
};

export type PublicPortalData = {
  portal: AutonomousPortal;
  roles: PublicPortalRole[];
};

export const getPublicPortal = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ slug: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<PublicPortalData> => {
    const portal = await getAutonomousPortalBySlug(data.slug);
    if (!portal) throw new Error("Autonomous portal not found");

    const sql = await getSql();
    const rows = await sql`
      select id, title, location, work_mode, compensation_band, stack, must_haves, jd_text
      from roles
      where org_id = ${portal.orgId} and status = 'open'
      order by created_at desc
    `;

    const roles: PublicPortalRole[] = rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      location: String(r.location || "Remote"),
      workMode: String(r.work_mode || "hybrid"),
      compensationBand: String(r.compensation_band || "Competitive"),
      stack: parseJson<string[]>(String(r.stack || "[]"), []),
      mustHaves: parseJson<string[]>(String(r.must_haves || "[]"), []),
      jdText: String(r.jd_text || ""),
    }));

    return { portal, roles };
  });

export const submitAutonomousApplication = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        slug: z.string(),
        roleId: z.string(),
        fullName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().default(""),
        location: z.string().default(""),
        linkedinUrl: z.string().default(""),
        resumeText: z.string().min(40),
        coverNote: z.string().default(""),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      applicationId: string;
      score: number;
      fitLevel: string;
      intakeRequired: boolean;
      intakeToken?: string;
      probes?: Array<{ id: string; prompt: string; field: string; required: boolean }>;
      summary: string;
    }> => {
      const portal = await getAutonomousPortalBySlug(data.slug);
      if (!portal) throw new Error("Portal not found");

      const sql = await getSql();
      const [roleRow] = await sql`
      select * from roles where id = ${data.roleId} and org_id = ${portal.orgId} limit 1
    `;
      if (!roleRow) throw new Error("Role not found");

      const roleInput = {
        companyName: String(roleRow.company_name || roleRow.companyName || portal.portalName),
        companyStage: String(roleRow.company_stage || roleRow.companyStage || "seed"),
        title: String(roleRow.title),
        location: String(roleRow.location || ""),
        workMode: String(roleRow.work_mode || "hybrid"),
        employmentType: String(roleRow.employment_type || "full_time"),
        compensationBand: String(roleRow.compensation_band || ""),
        stack: parseJson<string[]>(String(roleRow.stack || "[]"), []),
        mustHaves: parseJson<string[]>(String(roleRow.must_haves || "[]"), []),
        niceToHaves: parseJson<string[]>(String(roleRow.nice_to_haves || "[]"), []),
        jdText: String(roleRow.jd_text || ""),
      };

      // 1. Run multi-stage retrieval & evidence grounded match
      const match = matchCandidateToRole({
        resumeText: data.resumeText,
        role: roleInput,
      });

      const candidateId = randomUUID();
      const applicationId = randomUUID();

      // 2. Insert candidate
      await sql`
      insert into candidates (
        id, user_id, org_id, full_name, email, phone, location,
        linkedin_url, current_title, current_company, years_experience,
        resume_text, parsed_json, created_at, updated_at
      ) values (
        ${candidateId}, ${portal.orgId}, ${portal.orgId},
        ${data.fullName}, ${data.email}, ${data.phone}, ${data.location || match.profile.location},
        ${data.linkedinUrl || match.profile.linkedin_url}, ${match.profile.current_title},
        ${match.profile.current_company}, ${match.profile.years_experience},
        ${data.resumeText}, ${JSON.stringify(match.profile)}, now(), now()
      )
    `;

      // 3. Insert application
      await sql`
      insert into applications (
        id, user_id, org_id, role_id, candidate_id, pipeline_status,
        rank_score, rank_json, source, recruiter_notes, created_at, updated_at
      ) values (
        ${applicationId}, ${portal.orgId}, ${portal.orgId}, ${data.roleId}, ${candidateId},
        'ingested', ${match.rank.score}, ${JSON.stringify(match.rank)}, 'autonomous_portal',
        ${data.coverNote || "Direct application through Autonomous Career Portal."},
        now(), now()
      )
    `;

      // 4. Evaluate missing information probes
      const probes = portal.interactiveIntakeEnabled
        ? generateInteractiveProbes(match.rank.requirements || [])
        : [];

      let intakeToken: string | undefined;
      if (probes.length > 0) {
        intakeToken = randomUUID();
        await sql`
        insert into portal_intake_sessions (
          id, portal_id, role_id, application_id, candidate_email,
          candidate_name, intake_token, probes_json, responses_json, status, created_at, updated_at
        ) values (
          ${randomUUID()}, ${portal.id}, ${data.roleId}, ${applicationId}, ${data.email},
          ${data.fullName}, ${intakeToken}, ${JSON.stringify(probes)}, '[]', 'pending', now(), now()
        )
      `;
      }

      // 5. Create HITL checkpoints based on policy
      if (portal.hitlPolicy === "strict" || portal.hitlPolicy === "balanced") {
        if (match.rank.score >= portal.autoShortlistThreshold && match.rank.level !== "no") {
          await createHitlCheckpoint({
            orgId: portal.orgId,
            roleId: data.roleId,
            applicationId,
            portalId: portal.id,
            checkpointType: "shortlist_interview",
            candidateName: data.fullName,
            roleTitle: roleInput.title,
            aiRecommendation: "advance",
            aiScore: match.rank.score,
            aiFitLevel: match.rank.level,
            evidenceSummary: match.rank.summary,
            missingRequirements: match.rank.requirements
              ?.filter((r) => r.status === "missing_info")
              .map((m) => m.requirement),
          });
        } else if (probes.length > 0) {
          await createHitlCheckpoint({
            orgId: portal.orgId,
            roleId: data.roleId,
            applicationId,
            portalId: portal.id,
            checkpointType: "missing_info_probe",
            candidateName: data.fullName,
            roleTitle: roleInput.title,
            aiRecommendation: "probe",
            aiScore: match.rank.score,
            aiFitLevel: match.rank.level,
            evidenceSummary: `Candidate has ${probes.length} missing information items pending clarification.`,
            missingRequirements: probes.map((p) => p.prompt),
          });
        } else if (portal.requireHumanRejection && match.rank.level === "no") {
          await createHitlCheckpoint({
            orgId: portal.orgId,
            roleId: data.roleId,
            applicationId,
            portalId: portal.id,
            checkpointType: "candidate_rejection",
            candidateName: data.fullName,
            roleTitle: roleInput.title,
            aiRecommendation: "reject",
            aiScore: match.rank.score,
            aiFitLevel: match.rank.level,
            evidenceSummary: match.rank.summary,
            missingRequirements: match.rank.gaps,
          });
        }
      }

      return {
        ok: true,
        applicationId,
        score: match.rank.score,
        fitLevel: match.rank.level,
        intakeRequired: probes.length > 0,
        intakeToken,
        probes: probes.length > 0 ? probes : undefined,
        summary: match.rank.summary,
      };
    },
  );

export const submitIntakeResponses = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        intakeToken: z.string(),
        responses: z.array(
          z.object({
            id: z.string(),
            prompt: z.string(),
            answer: z.string(),
          }),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const sql = await getSql();

    const [session] = await sql`
      select * from portal_intake_sessions where intake_token = ${data.intakeToken} limit 1
    `;
    if (!session) throw new Error("Intake session not found");

    await sql`
      update portal_intake_sessions
      set
        responses_json = ${JSON.stringify(data.responses)},
        status = 'submitted',
        updated_at = now()
      where intake_token = ${data.intakeToken}
    `;

    // Also update HITL checkpoint with candidate responses
    const appId = session.application_id || session.applicationId;
    if (appId) {
      await sql`
        update hitl_decisions
        set
          candidate_responses_json = ${JSON.stringify(data.responses)},
          status = 'clarification_requested'
        where application_id = ${appId} and checkpoint_type = 'missing_info_probe'
      `;
    }

    return {
      ok: true,
      message: "Thank you! Your responses have been submitted to the hiring team for review.",
    };
  });
