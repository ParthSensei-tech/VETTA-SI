import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../platform/auth/middleware.ts";
import { getSql } from "../../platform/db.ts";
import { iso, parseJson } from "../../shared/utils.ts";
import type {
  Application,
  Approval,
  ApprovalStatus,
  ArtifactType,
  AuditEvent,
  Candidate,
  ClientCard,
  CompanyStage,
  EmploymentType,
  ParsedProfile,
  PipelineStatus,
  RankProvenance,
  RankResult,
  Role,
  RoleStatus,
  Screen,
  ScreenAnswer,
  ScreenCompletionStats,
  ScreenEvaluation,
  ScreenStatus,
  WorkMode,
  WorkspaceSnapshot,
} from "./types.ts";
import {
  answersFromTranscript,
  normalizeQuestions,
  normalizeTranscript,
} from "../../features/ingest/domain/normalize-screen.ts";

const stageSchema = z.enum(["seed", "series_a", "series_b"]);
const workModeSchema = z.enum(["onsite", "hybrid", "remote"]);
const employmentSchema = z.enum(["full_time", "contract"]);

const pipelineSchema = z.enum([
  "ingested",
  "ranked",
  "shortlisted",
  "screening",
  "ready",
  "approved",
  "sent",
  "hold",
  "rejected",
]);
const artifactSchema = z.enum(["client_card", "screen_pack", "outreach"]);
const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "sent"]);

const roleInputSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  companyStage: stageSchema,
  title: z.string().trim().min(1).max(160),
  location: z.string().trim().max(80).default(""),
  workMode: workModeSchema.default("hybrid"),
  employmentType: employmentSchema.default("full_time"),
  compensationBand: z.string().trim().max(120).default(""),
  stack: z.array(z.string().trim().min(1).max(40)).max(16).default([]),
  mustHaves: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  niceToHaves: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  jdText: z.string().trim().max(20000).default(""),
});

type RoleRow = {
  id: string;
  user_id: string;
  org_id?: string | null;
  company_name: string;
  company_stage: string;
  title: string;
  location: string;
  work_mode: string;
  employment_type: string;
  compensation_band: string;
  stack: string;
  must_haves: string;
  nice_to_haves: string;
  jd_text: string;
  status: string;
  created_at: unknown;
  updated_at: unknown;
  candidate_count?: number | string;
  shortlist_count?: number | string;
  pending_approvals?: number | string;
};

type CandidateRow = {
  id: string;
  user_id?: string;
  org_id?: string | null;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_url: string;
  current_title: string;
  current_company: string;
  years_experience: number | string | null;
  resume_text: string;
  parsed_json: string;
  created_at: unknown;
  updated_at: unknown;
};

type ApplicationRow = {
  id: string;
  user_id?: string;
  role_id: string;
  candidate_id: string;
  pipeline_status: string;
  rank_score: number | null;
  rank_json: string;
  recruiter_notes: string;
  source?: string;
  org_id?: string | null;
  rank_engine?: string | null;
  model?: string | null;
  provider?: string | null;
  rubric_version_id?: string | null;
  rubric_version?: number | null;
  rubric_hash?: string | null;
  is_stale?: boolean | null;
  stale_reason?: string | null;
  created_at: unknown;
  updated_at: unknown;
};

type ScreenRow = {
  id: string;
  user_id?: string;
  org_id?: string | null;
  application_id: string;
  questions_json: string;
  answers_json: string;
  evaluation_json: string;
  status: string;
  created_at: unknown;
  updated_at: unknown;
  transcript_json?: string;
  invite_token?: string | null;
  opened_at?: unknown;
  started_at?: unknown;
  completed_at?: unknown;
  last_reminded_at?: unknown;
};

type ApprovalRow = {
  id: string;
  user_id?: string;
  org_id?: string | null;
  application_id: string;
  role_id: string;
  artifact_type: string;
  title: string;
  payload_json: string;
  status: string;
  reviewer_note: string;
  decided_at: unknown;
  created_at: unknown;
  role_title?: string;
  company_name?: string;
  candidate_name?: string;
};

function newId(): string {
  return crypto.randomUUID();
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapRole(row: RoleRow): Role {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    companyName: row.company_name,
    companyStage: row.company_stage as CompanyStage,
    title: row.title,
    location: row.location,
    workMode: row.work_mode as WorkMode,
    employmentType: row.employment_type as EmploymentType,
    compensationBand: row.compensation_band,
    stack: parseJson<string[]>(row.stack, []),
    mustHaves: parseJson<string[]>(row.must_haves, []),
    niceToHaves: parseJson<string[]>(row.nice_to_haves, []),
    jdText: row.jd_text,
    status: row.status as RoleStatus,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    candidateCount: asNumber(row.candidate_count),
    shortlistCount: asNumber(row.shortlist_count),
    pendingApprovals: asNumber(row.pending_approvals),
  };
}

function mapCandidate(row: CandidateRow): Candidate {
  const parsed = parseJson<ParsedProfile>(row.parsed_json, {
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    linkedin_url: row.linkedin_url,
    current_title: row.current_title,
    current_company: row.current_company,
    years_experience: row.years_experience == null ? null : asNumber(row.years_experience),
    skills: [],
    summary: "",
  });
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    linkedinUrl: row.linkedin_url,
    currentTitle: row.current_title,
    currentCompany: row.current_company,
    yearsExperience: row.years_experience == null ? null : asNumber(row.years_experience),
    resumeText: row.resume_text,
    parsed,
    createdAt: iso(row.created_at),
  };
}

function mapScreen(row: ScreenRow, reminderCount = 0): Screen {
  const questions = normalizeQuestions(row.questions_json);
  const transcript = normalizeTranscript(row.transcript_json ?? "[]");
  const answers = parseJson<ScreenAnswer[]>(row.answers_json, []);
  return {
    id: row.id,
    applicationId: row.application_id,
    questions,
    answers: answers.length ? answers : answersFromTranscript(transcript),
    transcript,
    evaluation: parseJson<ScreenEvaluation>(row.evaluation_json, {
      score: null,
      verdict: "",
      strengths: [],
      concerns: [],
      notes: "",
    }),
    status: row.status as ScreenStatus,
    inviteToken: row.invite_token ?? null,
    openedAt: row.opened_at ? iso(row.opened_at) : null,
    startedAt: row.started_at ? iso(row.started_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    lastRemindedAt: row.last_reminded_at ? iso(row.last_reminded_at) : null,
    reminderCount,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapApproval(row: ApprovalRow, shareUrl: string | null = null): Approval {
  return {
    id: row.id,
    applicationId: row.application_id,
    roleId: row.role_id,
    roleTitle: row.role_title ?? "",
    companyName: row.company_name ?? "",
    candidateName: row.candidate_name ?? "",
    artifactType: row.artifact_type as ArtifactType,
    title: row.title,
    payload: parseJson<ClientCard>(row.payload_json, {
      candidate_name: row.candidate_name ?? "",
      headline: "",
      fit_label: "",
      summary: "",
      highlights: [],
      watchouts: [],
      interview_probes: [],
      location: "",
      availability: "",
    }),
    status: row.status as ApprovalStatus,
    reviewerNote: row.reviewer_note,
    decidedAt: row.decided_at ? iso(row.decided_at) : null,
    createdAt: iso(row.created_at),
    shareUrl,
  };
}

async function writeAudit(
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  meta: Record<string, string | number | boolean | string[] | null | undefined> = {},
) {
  const sql = await getSql();
  const orgId = typeof meta.orgId === "string" ? meta.orgId : null;
  await sql`insert into audit_events (id, user_id, entity_type, entity_id, action, meta_json, org_id)
    values (${newId()}, ${userId}, ${entityType}, ${entityId}, ${action}, ${JSON.stringify(meta)}, ${orgId})`;
}

async function isUserOrgMember(userId: string, orgId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from organization_members
    where user_id = ${userId} and org_id = ${orgId} and status = 'active'`;
  return Boolean(rows[0] && Number(rows[0].n) > 0);
}

export async function loadRoleOrThrow(userId: string, roleId: string): Promise<RoleRow> {
  const sql = await getSql();
  const rows = await sql<RoleRow>`
    select r.*,
      (select count(*) from applications a where a.role_id = r.id) as candidate_count,
      (select count(*) from applications a where a.role_id = r.id
        and a.pipeline_status in ('shortlisted','screening','ready','approved','sent')) as shortlist_count,
      (select count(*) from approvals ap where ap.role_id = r.id and ap.status = 'pending') as pending_approvals
    from roles r
    where r.id = ${roleId}
    limit 1`;
  const row = rows[0];
  if (!row) throw new Error("Role not found");

  if (row.org_id) {
    const isMember = await isUserOrgMember(userId, row.org_id);
    if (!isMember) throw new Error("Role not found");
  } else if (row.user_id !== userId) {
    throw new Error("Role not found");
  }

  return row;
}

export async function loadApplicationBundle(userId: string, applicationId: string) {
  const sql = await getSql();
  const apps = await sql<ApplicationRow>`
    select * from applications where id = ${applicationId} limit 1`;
  const app = apps[0];
  if (!app) throw new Error("Application not found");

  if (app.org_id) {
    const isMember = await isUserOrgMember(userId, app.org_id);
    if (!isMember) throw new Error("Application not found");
  } else if (app.user_id !== userId) {
    throw new Error("Application not found");
  }

  const cands = await sql<CandidateRow>`
    select * from candidates where id = ${app.candidate_id} limit 1`;
  const cand = cands[0];
  if (!cand) throw new Error("Candidate not found");

  const screens = await sql<ScreenRow>`
    select * from screens where application_id = ${app.id}
    order by created_at desc limit 1`;
  const approvals = await sql<{ id: string; status: string }>`
    select id, status from approvals
    where application_id = ${app.id}
    order by created_at desc limit 1`;
  const pending = await sql<{ id: string }>`
    select id from approvals
    where application_id = ${app.id} and status = 'pending'
    limit 1`;
  return { app, cand, screen: screens[0] ?? null, latestApproval: approvals[0] ?? null, pending };
}

function toApplication(
  app: ApplicationRow,
  cand: CandidateRow,
  screen: ScreenRow | null,
  pendingId: string | null,
  latestStatus: ApprovalStatus | null,
): Application {
  const rank = parseJson<RankResult | Record<string, never>>(app.rank_json, {});
  const hasRank = rank && "score" in rank;
  const parsedRank = hasRank ? (rank as RankResult) : null;
  const isStale = Boolean(app.is_stale);
  const staleReason = app.stale_reason ?? null;
  const rankEngine = app.rank_engine || (parsedRank?.provenance?.engine ?? "local");
  const isLocal = rankEngine === "local";

  const provenance: RankProvenance | null =
    parsedRank?.provenance ??
    (hasRank
      ? {
          engine: rankEngine,
          isLocal,
          provider: app.provider || (isLocal ? "local" : "unknown"),
          model: app.model || (isLocal ? "evidence" : "unknown"),
          rubricVersion: app.rubric_version ?? null,
          rubricVersionId: app.rubric_version_id ?? null,
          rubricHash: app.rubric_hash ?? null,
          evaluatedAt: iso(app.updated_at),
          isStale,
          staleReason,
        }
      : null);

  if (provenance) {
    provenance.isStale = isStale;
    provenance.staleReason = staleReason;
    if (parsedRank) {
      parsedRank.provenance = provenance;
    }
  }

  return {
    id: app.id,
    roleId: app.role_id,
    candidate: mapCandidate(cand),
    pipelineStatus: app.pipeline_status as PipelineStatus,
    rankScore: app.rank_score,
    rank: parsedRank,
    recruiterNotes: app.recruiter_notes,
    screen: screen ? mapScreen(screen) : null,
    pendingApprovalId: pendingId,
    latestApprovalStatus: latestStatus,
    source: app.source === "portal" ? "portal" : "ingest",
    provenance,
    isStale,
    staleReason,
    rankEngine,
    rubricVersionId: app.rubric_version_id ?? null,
    createdAt: iso(app.created_at),
    updatedAt: iso(app.updated_at),
  };
}

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WorkspaceSnapshot> => {
    const sql = await getSql();
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId);
    const orgId = org.orgId;

    const roleRows = await sql<RoleRow>`
      select r.*,
        (select count(*) from applications a where a.role_id = r.id) as candidate_count,
        (select count(*) from applications a where a.role_id = r.id
          and a.pipeline_status in ('shortlisted','screening','ready','approved','sent')) as shortlist_count,
        (select count(*) from approvals ap where ap.role_id = r.id and ap.status = 'pending') as pending_approvals
      from roles r
      where (r.org_id = ${orgId} or (r.org_id is null and r.user_id = ${context.userId}))
      order by r.updated_at desc`;

    const pendingRows = await sql<ApprovalRow>`
      select ap.*, r.title as role_title, r.company_name, c.full_name as candidate_name
      from approvals ap
      join roles r on r.id = ap.role_id
      join applications a on a.id = ap.application_id
      join candidates c on c.id = a.candidate_id
      where (ap.org_id = ${orgId} or (ap.org_id is null and ap.user_id = ${context.userId})) and ap.status = 'pending'
      order by ap.created_at desc
      limit 20`;

    const activity = await sql<{
      id: string;
      entity_type: string;
      entity_id: string;
      action: string;
      meta_json: string;
      created_at: unknown;
    }>`
      select id, entity_type, entity_id, action, meta_json, created_at
      from audit_events
      where (org_id = ${orgId} or (org_id is null and user_id = ${context.userId}))
      order by created_at desc
      limit 12`;

    const ranked = await sql<{ n: number }>`
      select count(*) as n from applications
      where (org_id = ${orgId} or (org_id is null and user_id = ${context.userId})) and rank_score is not null`;
    const sentWeek = await sql<{ n: number }>`
      select count(*) as n from approvals
      where (org_id = ${orgId} or (org_id is null and user_id = ${context.userId})) and status = 'sent'
        and created_at > now() - interval '7 days'`;

    const screenRows = await sql<{
      sent: number;
      opened: number;
      started: number;
      completed: number;
    }>`
      select
        count(*)::int as sent,
        count(*) filter (where opened_at is not null)::int as opened,
        count(*) filter (where started_at is not null or status in ('awaiting','evaluated'))::int as started,
        count(*) filter (where completed_at is not null or status = 'evaluated')::int as completed
      from screens
      where (org_id = ${orgId} or (org_id is null and user_id = ${context.userId}))`;
    const sc = screenRows[0];
    const sent = asNumber(sc?.sent);
    const completed = asNumber(sc?.completed);
    const screenCompletion: ScreenCompletionStats = {
      sent,
      opened: asNumber(sc?.opened),
      started: asNumber(sc?.started),
      completed,
      rate: sent > 0 ? Math.round((completed / sent) * 100) : 0,
    };

    const { describeAi } = await import("../../features/ai/server/ai.server");
    const ai = describeAi();
    let domainModel = {
      steps: 0,
      docs: 0,
      rankSteps: 0,
      metrics: 0,
      asOf: null as string | null,
      ready: false,
    };
    try {
      const { domainModelStatus, refreshMarketSnapshot } = await import("../../features/ai/server/domain-embed.server");
      void refreshMarketSnapshot(false).catch(() => undefined);
      const { refreshHrLexicon } = await import("../../features/ranking/server/calibrate.server");
      void refreshHrLexicon(false).catch(() => undefined);
      domainModel = await domainModelStatus();
    } catch {
      /* model tables not migrated yet */
    }

    return {
      roles: roleRows.map(mapRole),
      pendingApprovals: pendingRows.map((row) => mapApproval(row)),
      recentActivity: activity.map((e): AuditEvent => ({
        id: e.id,
        entityType: e.entity_type,
        entityId: e.entity_id,
        action: e.action,
        meta: parseJson<Record<string, string>>(e.meta_json, {}),
        createdAt: iso(e.created_at),
      })),
      stats: {
        openRoles: roleRows.filter((r) => r.status === "open").length,
        rankedCandidates: asNumber(ranked[0]?.n),
        awaitingApproval: pendingRows.length,
        sentThisWeek: asNumber(sentWeek[0]?.n),
        screenCompletion,
      },
      aiAvailable: ai.available,
      aiEngine: ai.engine,
      aiModel: ai.model,
      domainModel,
    };
  });

export const createRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => roleInputSchema.parse(input))
  .handler(async ({ context, data }): Promise<Role> => {
    const sql = await getSql();
    const id = newId();
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId, data.companyName);
    await sql`
      insert into roles (
        id, user_id, company_name, company_stage, title, location, work_mode,
        employment_type, compensation_band, stack, must_haves, nice_to_haves, jd_text, org_id
      ) values (
        ${id}, ${context.userId}, ${data.companyName}, ${data.companyStage}, ${data.title},
        ${data.location}, ${data.workMode}, ${data.employmentType}, ${data.compensationBand},
        ${JSON.stringify(data.stack)}, ${JSON.stringify(data.mustHaves)},
        ${JSON.stringify(data.niceToHaves)}, ${data.jdText}, ${org.orgId}
      )`;
    await writeAudit(context.userId, "role", id, "created", {
      title: data.title,
      orgId: org.orgId,
    });
    try {
      const { generateRubricDraft } = await import("../../features/ranking/server/rubric-version.server");
      await generateRubricDraft({ userId: context.userId, roleId: id, heuristicOnly: true });
    } catch {
      /* rubric_versions may not exist yet */
    }
    return mapRole(await loadRoleOrThrow(context.userId, id));
  });

export async function loadRoleWorkspaceForUser(
  userId: string,
  roleId: string,
): Promise<{ role: Role; applications: Application[] }> {
  const role = mapRole(await loadRoleOrThrow(userId, roleId));
  const sql = await getSql();
  const apps = role.orgId
    ? await sql<ApplicationRow>`
        select * from applications
        where role_id = ${roleId} and org_id = ${role.orgId}
        order by coalesce(rank_score, -1) desc, created_at desc`
    : await sql<ApplicationRow>`
        select * from applications
        where role_id = ${roleId} and user_id = ${userId}
        order by coalesce(rank_score, -1) desc, created_at desc`;
  if (apps.length === 0) return { role, applications: [] };

  const candIds = [...new Set(apps.map((a) => a.candidate_id))];
  const appIds = apps.map((a) => a.id);
  const candPlace = candIds.map((_, i) => `$${i + 2}`).join(", ");
  const appPlace = appIds.map((_, i) => `$${i + 1}`).join(", ");
  const cands = role.orgId
    ? await sql.query<CandidateRow>(
        `select * from candidates where org_id = $1 and id in (${candPlace})`,
        [role.orgId, ...candIds],
      )
    : await sql.query<CandidateRow>(
        `select * from candidates where user_id = $1 and id in (${candPlace})`,
        [userId, ...candIds],
      );
  const screens = await sql.query<ScreenRow>(
    `select * from screens where application_id in (${appPlace}) order by created_at desc`,
    [...appIds],
  );
  const approvals = await sql.query<{ application_id: string; id: string; status: string }>(
    `select application_id, id, status from approvals where application_id in (${appPlace}) order by created_at desc`,
    [...appIds],
  );
  const candById = new Map(cands.map((c) => [c.id, c]));
  const screenByApp = new Map<string, ScreenRow>();
  for (const s of screens) {
    if (!screenByApp.has(s.application_id)) screenByApp.set(s.application_id, s);
  }
  const latestByApp = new Map<string, { id: string; status: string }>();
  const pendingByApp = new Map<string, string>();
  for (const a of approvals) {
    if (!latestByApp.has(a.application_id)) latestByApp.set(a.application_id, a);
    if (a.status === "pending" && !pendingByApp.has(a.application_id)) {
      pendingByApp.set(a.application_id, a.id);
    }
  }
  const applications: Application[] = [];
  for (const app of apps) {
    const cand = candById.get(app.candidate_id);
    if (!cand) continue;
    const latest = latestByApp.get(app.id);
    applications.push(
      toApplication(
        app,
        cand,
        screenByApp.get(app.id) ?? null,
        pendingByApp.get(app.id) ?? null,
        (latest?.status as ApprovalStatus | undefined) ?? null,
      ),
    );
  }
  return { role, applications };
}

export const getRoleWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<{ role: Role; applications: Application[] }> => {
    return loadRoleWorkspaceForUser(context.userId, data.roleId);
  });

export const ingestResume = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        resumeText: z.string().trim().min(40).max(40000),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ application: Application; warning?: string }> => {
    const roleRow = await loadRoleOrThrow(context.userId, data.roleId);
    const role = mapRole(roleRow);
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId, role.companyName);

    const candidateId = newId();
    const applicationId = newId();

    const { parseAndRank } = await import("../../features/ai/server/ai.server");
    const ranked = await parseAndRank({
      resumeText: data.resumeText,
      role: {
        companyName: role.companyName,
        companyStage: role.companyStage,
        title: role.title,
        location: role.location,
        workMode: role.workMode,
        compensationBand: role.compensationBand,
        stack: role.stack,
        mustHaves: role.mustHaves,
        niceToHaves: role.niceToHaves,
        jdText: role.jdText,
      },
      mode: "fast",
      userId: context.userId,
      orgId: org.orgId,
      roleId: data.roleId,
      candidateId,
      applicationId,
    });

    const fallbackName =
      data.resumeText
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.includes("@") && l.length < 80) ?? "Unnamed candidate";

    const profile = ranked.ok
      ? ranked.profile
      : {
          full_name: fallbackName.slice(0, 80),
          email: "",
          phone: "",
          location: "",
          linkedin_url: "",
          current_title: "",
          current_company: "",
          years_experience: null,
          skills: [],
          summary: "",
        };

    const sql = await getSql();
    await sql`
      insert into candidates (
        id, user_id, full_name, email, phone, location, linkedin_url,
        current_title, current_company, years_experience, resume_text, parsed_json, org_id
      ) values (
        ${candidateId}, ${context.userId}, ${profile.full_name}, ${profile.email}, ${profile.phone},
        ${profile.location}, ${profile.linkedin_url}, ${profile.current_title}, ${profile.current_company},
        ${profile.years_experience}, ${data.resumeText}, ${JSON.stringify(profile)}, ${org.orgId}
      )`;

    // Record employer intake under DPDP
    try {
      const { recordEmployerIntake } = await import("./privacy.server");
      await recordEmployerIntake({ orgId: org.orgId, subjectId: candidateId });
    } catch {
      /* best effort intake record */
    }

    try {
      const { indexNewCandidate } = await import("../../features/pipeline/server/search.server");
      await indexNewCandidate(
        candidateId,
        ranked.ok ? ranked.rank.india.notice_period_days : null,
        ranked.ok ? ranked.rank.india.expected_ctc_lakh : null,
        org.orgId,
      );
    } catch {
      /* indexed on the next talent search */
    }

    const rankJson = ranked.ok ? JSON.stringify(ranked.rank) : "{}";
    const score = ranked.ok ? ranked.rank.score : null;
    const status = ranked.ok ? "ranked" : "ingested";
    const resumeHash = ranked.ok ? ranked.resumeHash : "";
    const roleHash = ranked.ok ? ranked.roleHash : "";
    const rankEngine = ranked.ok ? ranked.engine : "";
    await sql`
      insert into applications (
        id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json,
        resume_hash, role_hash, rank_engine, org_id,
        model, provider, rubric_version_id, rubric_version, rubric_hash, is_stale, stale_reason
      ) values (
        ${applicationId}, ${context.userId}, ${data.roleId}, ${candidateId}, ${status}, ${score}, ${rankJson},
        ${resumeHash}, ${roleHash}, ${rankEngine}, ${org.orgId},
        ${ranked.ok ? (ranked.model ?? "") : ""},
        ${ranked.ok ? (ranked.provider ?? "") : ""},
        ${ranked.ok ? (ranked.rubricVersionId ?? null) : null},
        ${ranked.ok ? (ranked.rubricVersion ?? null) : null},
        ${ranked.ok ? (ranked.rubricHash ?? "") : ""},
        false,
        ''
      )`;
    await sql`update roles set updated_at = now() where id = ${data.roleId} and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId}))`;
    await writeAudit(
      context.userId,
      "application",
      applicationId,
      ranked.ok ? "ranked" : "ingested",
      {
        name: profile.full_name,
        role: role.title,
        engine: rankEngine,
        fromCache: ranked.ok ? ranked.fromCache : false,
        orgId: org.orgId,
      },
    );

    const bundle = await loadApplicationBundle(context.userId, applicationId);
    return {
      application: toApplication(bundle.app, bundle.cand, bundle.screen, null, null),
      warning: ranked.ok ? undefined : ranked.error,
    };
  });

export const rerankApplication = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ applicationId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<Application> => {
    const bundle = await loadApplicationBundle(context.userId, data.applicationId);
    const role = mapRole(await loadRoleOrThrow(context.userId, bundle.app.role_id));
    const { parseAndRank } = await import("../../features/ai/server/ai.server");
    const ranked = await parseAndRank({
      resumeText: bundle.cand.resume_text,
      role: {
        companyName: role.companyName,
        companyStage: role.companyStage,
        title: role.title,
        location: role.location,
        workMode: role.workMode,
        compensationBand: role.compensationBand,
        stack: role.stack,
        mustHaves: role.mustHaves,
        niceToHaves: role.niceToHaves,
        jdText: role.jdText,
      },
      mode: "full",
      userId: context.userId,
      orgId: bundle.app.org_id ?? undefined,
      roleId: bundle.app.role_id,
      candidateId: bundle.cand.id,
      applicationId: bundle.app.id,
      bypassCache: true,
    });
    if (!ranked.ok) throw new Error(ranked.error);
    const sql = await getSql();
    const p = ranked.profile;
    await sql`
      update candidates set
        full_name = ${p.full_name},
        email = ${p.email},
        phone = ${p.phone},
        location = ${p.location},
        linkedin_url = ${p.linkedin_url},
        current_title = ${p.current_title},
        current_company = ${p.current_company},
        years_experience = ${p.years_experience},
        parsed_json = ${JSON.stringify(p)},
        updated_at = now()
      where id = ${bundle.cand.id} and (org_id = ${bundle.app.org_id} or (org_id is null and user_id = ${context.userId}))`;
    const nextStatus =
      bundle.app.pipeline_status === "ingested" ? "ranked" : bundle.app.pipeline_status;
    await sql`
      update applications set
        rank_score = ${ranked.rank.score},
        rank_json = ${JSON.stringify(ranked.rank)},
        pipeline_status = ${nextStatus},
        resume_hash = ${ranked.resumeHash},
        role_hash = ${ranked.roleHash},
        rank_engine = ${ranked.engine},
        model = ${ranked.model || ""},
        provider = ${ranked.provider || ""},
        rubric_version_id = ${ranked.rubricVersionId || null},
        rubric_version = ${ranked.rubricVersion || null},
        rubric_hash = ${ranked.rubricHash || ""},
        is_stale = false,
        stale_reason = '',
        updated_at = now()
      where id = ${bundle.app.id} and (org_id = ${bundle.app.org_id} or (org_id is null and user_id = ${context.userId}))`;
    const next = await loadApplicationBundle(context.userId, data.applicationId);
    return toApplication(
      next.app,
      next.cand,
      next.screen,
      next.pending[0]?.id ?? null,
      (next.latestApproval?.status as ApprovalStatus | undefined) ?? null,
    );
  });

/** Optional manual deepen — prefer auto background deepen after batch complete. */
export const deepenTopCandidates = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        topN: z.number().int().min(1).max(25).default(12),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ deepened: number; engines: string[] }> => {
    await loadRoleOrThrow(context.userId, data.roleId);
    const { deepenRoleTopN } = await import("../../features/ranking/server/deepen.server");
    const result = await deepenRoleTopN({
      userId: context.userId,
      roleId: data.roleId,
      topN: data.topN,
    });
    await writeAudit(context.userId, "role", data.roleId, "deepen_top", {
      topN: data.topN,
      deepened: result.deepened,
      engines: result.engines,
    });
    return result;
  });

/** Re-rank all stale applications for a role after a rubric edit. */
export const rerankStaleApplications = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        topN: z.number().int().min(1).max(100).default(50),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ deepened: number; engines: string[] }> => {
    await loadRoleOrThrow(context.userId, data.roleId);
    const { deepenRoleTopN } = await import("../../features/ranking/server/deepen.server");
    const result = await deepenRoleTopN({
      userId: context.userId,
      roleId: data.roleId,
      topN: data.topN,
      forceStale: true,
    });
    await writeAudit(context.userId, "role", data.roleId, "rerank_stale", {
      topN: data.topN,
      deepened: result.deepened,
      engines: result.engines,
    });
    return result;
  });
export const updateApplication = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        applicationId: z.string().min(1),
        pipelineStatus: pipelineSchema.optional(),
        recruiterNotes: z.string().max(8000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<Application> => {
    const bundle = await loadApplicationBundle(context.userId, data.applicationId);
    const sql = await getSql();
    if (data.pipelineStatus) {
      await sql`
        update applications set pipeline_status = ${data.pipelineStatus}, updated_at = now()
        where id = ${data.applicationId} and (org_id = ${bundle.app.org_id} or (org_id is null and user_id = ${context.userId}))`;
      await writeAudit(context.userId, "application", data.applicationId, "status", {
        status: data.pipelineStatus,
        orgId: bundle.app.org_id ?? undefined,
      });
    }
    if (data.recruiterNotes != null) {
      await sql`
        update applications set recruiter_notes = ${data.recruiterNotes}, updated_at = now()
        where id = ${data.applicationId} and (org_id = ${bundle.app.org_id} or (org_id is null and user_id = ${context.userId}))`;
    }
    const next = await loadApplicationBundle(context.userId, data.applicationId);
    return toApplication(
      next.app,
      next.cand,
      next.screen,
      next.pending[0]?.id ?? null,
      (next.latestApproval?.status as ApprovalStatus | undefined) ?? null,
    );
  });

export const generateAsyncScreen = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ applicationId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<Application> => {
    const bundle = await loadApplicationBundle(context.userId, data.applicationId);
    const role = mapRole(await loadRoleOrThrow(context.userId, bundle.app.role_id));
    const rank = parseJson<RankResult>(bundle.app.rank_json, {
      score: 0,
      level: "maybe",
      summary: "",
      evidence: [],
      gaps: [],
      risks: [],
      india: {
        location_fit: "unknown",
        notice_period_days: null,
        current_ctc_lakh: null,
        expected_ctc_lakh: null,
        early_stage_fit: "unknown",
        notes: "",
      },
      stack_match: [],
      screen_focus: [],
    });
    const { generateScreen } = await import("../../features/ai/server/ai.server");
    const generated = await generateScreen({
      roleTitle: role.title,
      companyName: role.companyName,
      jdText: role.jdText,
      stack: role.stack,
      candidateName: bundle.cand.full_name,
      currentTitle: bundle.cand.current_title,
      rankSummary: rank.summary,
      screenFocus: rank.screen_focus.length ? rank.screen_focus : rank.gaps,
      orgId: bundle.app.org_id,
      subjectId: bundle.cand.id,
      applicationId: bundle.app.id,
    });
    if (!generated.ok) throw new Error(generated.error);
    const sql = await getSql();
    const id = newId();
    const invite = newId().replace(/-/g, "").slice(0, 16);
    await sql`
      insert into screens (id, user_id, application_id, questions_json, status, invite_token, org_id)
      values (${id}, ${context.userId}, ${bundle.app.id}, ${JSON.stringify(generated.questions)}, 'draft', ${invite}, ${bundle.app.org_id})`;
    await sql`
      update applications set pipeline_status = 'screening', updated_at = now()
      where id = ${bundle.app.id} and (org_id = ${bundle.app.org_id} or (org_id is null and user_id = ${context.userId}))`;
    await writeAudit(context.userId, "screen", id, "generated", {
      candidate: bundle.cand.full_name,
      orgId: bundle.app.org_id ?? undefined,
    });
    const next = await loadApplicationBundle(context.userId, data.applicationId);
    return toApplication(
      next.app,
      next.cand,
      next.screen,
      next.pending[0]?.id ?? null,
      (next.latestApproval?.status as ApprovalStatus | undefined) ?? null,
    );
  });

export const saveScreenAnswers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        screenId: z.string().min(1),
        answers: z
          .array(z.object({ question_id: z.string(), answer: z.string().max(12000) }))
          .max(16),
        evaluate: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<Application> => {
    const sql = await getSql();
    const screens = await sql<ScreenRow>`
      select * from screens where id = ${data.screenId} limit 1`;
    const screen = screens[0];
    if (!screen) throw new Error("Screen not found");
    const bundle = await loadApplicationBundle(context.userId, screen.application_id);
    const questions = normalizeQuestions(screen.questions_json);
    await sql`
      update screens set answers_json = ${JSON.stringify(data.answers)}, status = 'awaiting', updated_at = now()
      where id = ${screen.id}`;

    if (data.evaluate) {
      const { evaluateScreen } = await import("../../features/ai/server/ai.server");
      const app = bundle.app;
      const role = mapRole(await loadRoleOrThrow(context.userId, app.role_id));
      const evaluated = await evaluateScreen({
        roleTitle: role.title,
        questions,
        answers: data.answers,
      });
      if (!evaluated.ok) throw new Error(evaluated.error);
      await sql`
        update screens set evaluation_json = ${JSON.stringify(evaluated.evaluation)}, status = 'evaluated', updated_at = now()
        where id = ${screen.id}`;
      await sql`
        update applications set pipeline_status = 'ready', updated_at = now()
        where id = ${app.id}`;
      const verdict = evaluated.evaluation.verdict;
      if (verdict === "advance" || verdict === "reject") {
        try {
          const { trainOutcome } = await import("../../features/ranking/server/outcome.server");
          const { ensureUserOrg } = await import("./org.server");
          const org = await ensureUserOrg(context.userId);
          const rank = parseJson<import("./types").RankResult>(app.rank_json, {
            score: app.rank_score ?? 0,
            level: "maybe",
            summary: "",
            evidence: [],
            gaps: [],
            risks: [],
            india: {
              location_fit: "unknown",
              notice_period_days: null,
              current_ctc_lakh: null,
              expected_ctc_lakh: null,
              early_stage_fit: "unknown",
              notes: "",
            },
            stack_match: [],
            screen_focus: [],
          });
          await trainOutcome({
            orgId: app.org_id || org.orgId,
            rank,
            kind: verdict === "advance" ? "interview_pass" : "interview_fail",
            screenScore: evaluated.evaluation.score,
          });
        } catch {
          /* outcome model optional until migration */
        }
      }
      await writeAudit(context.userId, "screen", screen.id, "evaluated", {
        orgId: bundle.app.org_id ?? undefined,
      });
    }

    const next = await loadApplicationBundle(context.userId, screen.application_id);
    return toApplication(
      next.app,
      next.cand,
      next.screen,
      next.pending[0]?.id ?? null,
      (next.latestApproval?.status as ApprovalStatus | undefined) ?? null,
    );
  });

export const prepareClientPack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        applicationId: z.string().min(1),
        artifactType: artifactSchema.default("client_card"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<Approval> => {
    const bundle = await loadApplicationBundle(context.userId, data.applicationId);
    const role = mapRole(await loadRoleOrThrow(context.userId, bundle.app.role_id));
    const rank = parseJson<RankResult | null>(bundle.app.rank_json, null);
    if (!rank || typeof rank.score !== "number") {
      throw new Error("Rank the candidate before preparing a client pack");
    }
    const screenEval = bundle.screen
      ? parseJson<ScreenEvaluation>(bundle.screen.evaluation_json, {
          score: null,
          verdict: "",
          strengths: [],
          concerns: [],
          notes: "",
        })
      : null;

    if (bundle.app.org_id) {
      const { assertMayProcess } = await import("./privacy.server");
      await assertMayProcess({
        orgId: bundle.app.org_id,
        subjectId: bundle.cand.id,
        purpose: "client_disclosure",
      });
    }

    const { draftClientCard } = await import("../../features/ai/server/ai.server");
    const drafted = await draftClientCard({
      roleTitle: role.title,
      companyName: role.companyName,
      candidateName: bundle.cand.full_name,
      currentTitle: bundle.cand.current_title,
      currentCompany: bundle.cand.current_company,
      location: bundle.cand.location,
      rank,
      screen: bundle.screen?.status === "evaluated" ? screenEval : null,
      orgId: bundle.app.org_id,
      subjectId: bundle.cand.id,
      applicationId: bundle.app.id,
    });
    if (!drafted.ok) throw new Error(drafted.error);

    const sql = await getSql();
    await sql`
      update approvals set status = 'rejected', reviewer_note = 'Superseded by a new pack', decided_at = now()
      where application_id = ${bundle.app.id} and (org_id = ${bundle.app.org_id} or (org_id is null and user_id = ${context.userId})) and status = 'pending'`;
    const id = newId();
    const title = `Client card · ${bundle.cand.full_name}`;
    await sql`
      insert into approvals (
        id, user_id, application_id, role_id, artifact_type, title, payload_json, status, org_id
      ) values (
        ${id}, ${context.userId}, ${bundle.app.id}, ${role.id}, ${data.artifactType},
        ${title}, ${JSON.stringify(drafted.card)}, 'pending', ${bundle.app.org_id}
      )`;
    await sql`
      update applications set pipeline_status = 'ready', updated_at = now()
      where id = ${bundle.app.id} and (org_id = ${bundle.app.org_id} or (org_id is null and user_id = ${context.userId}))`;
    await writeAudit(context.userId, "approval", id, "queued", {
      candidate: bundle.cand.full_name,
      orgId: bundle.app.org_id ?? undefined,
    });
    const rows = await sql<ApprovalRow>`
      select ap.*, r.title as role_title, r.company_name, c.full_name as candidate_name
      from approvals ap
      join roles r on r.id = ap.role_id
      join applications a on a.id = ap.application_id
      join candidates c on c.id = a.candidate_id
      where ap.id = ${id} and (ap.org_id = ${bundle.app.org_id} or (ap.org_id is null and ap.user_id = ${context.userId}))
      limit 1`;
    return mapApproval(rows[0]!);
  });

async function shareUrlByApplication(userId: string, orgId?: string): Promise<Map<string, string>> {
  const sql = await getSql();
  const { shareUrl: makeShareUrl } = await import("./origin");
  const shares = orgId
    ? await sql<{ token: string; payload_json: string }>`
        select token, payload_json from client_shares
        where org_id = ${orgId} or (org_id is null and user_id = ${userId})
        order by created_at desc
        limit 200`
    : await sql<{ token: string; payload_json: string }>`
        select token, payload_json from client_shares
        where user_id = ${userId}
        order by created_at desc
        limit 200`;
  const map = new Map<string, string>();
  for (const share of shares) {
    const view = parseJson<{ candidates?: Array<{ applicationId?: string }> }>(
      share.payload_json,
      {},
    );
    for (const candidate of view.candidates ?? []) {
      if (candidate.applicationId && !map.has(candidate.applicationId)) {
        map.set(candidate.applicationId, makeShareUrl(share.token));
      }
    }
  }
  return map;
}

export const listApprovals = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ status: approvalStatusSchema.optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<Approval[]> => {
    const sql = await getSql();
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId);
    const orgId = org.orgId;
    const rows = data.status
      ? await sql<ApprovalRow>`
          select ap.*, r.title as role_title, r.company_name, c.full_name as candidate_name
          from approvals ap
          join roles r on r.id = ap.role_id
          join applications a on a.id = ap.application_id
          join candidates c on c.id = a.candidate_id
          where (ap.org_id = ${orgId} or (ap.org_id is null and ap.user_id = ${context.userId})) and ap.status = ${data.status}
          order by ap.created_at desc
          limit 80`
      : await sql<ApprovalRow>`
          select ap.*, r.title as role_title, r.company_name, c.full_name as candidate_name
          from approvals ap
          join roles r on r.id = ap.role_id
          join applications a on a.id = ap.application_id
          join candidates c on c.id = a.candidate_id
          where (ap.org_id = ${orgId} or (ap.org_id is null and ap.user_id = ${context.userId}))
          order by case ap.status when 'pending' then 0 when 'approved' then 1 else 2 end, ap.created_at desc
          limit 80`;
    const urls = await shareUrlByApplication(context.userId, orgId);
    return rows.map((row) => mapApproval(row, urls.get(row.application_id) ?? null));
  });

export const decideApproval = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        approvalId: z.string().min(1),
        decision: z.enum(["approved", "rejected", "sent"]),
        reviewerNote: z.string().max(4000).optional(),
        payload: z.unknown().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<Approval> => {
    const sql = await getSql();
    const existing = await sql<ApprovalRow>`
      select * from approvals where id = ${data.approvalId} limit 1`;
    const row = existing[0];
    if (!row) throw new Error("Approval not found");

    if (row.org_id) {
      const isMember = await isUserOrgMember(context.userId, row.org_id);
      if (!isMember) throw new Error("Approval not found");
    } else if (row.user_id !== context.userId) {
      throw new Error("Approval not found");
    }

    if (data.decision === "sent" && row.status !== "approved" && row.status !== "sent") {
      throw new Error("Only an approved pack can be sent to a client");
    }
    const payloadJson = data.payload ? JSON.stringify(data.payload) : row.payload_json;
    const note = data.reviewerNote ?? row.reviewer_note;
    await sql`
      update approvals set
        status = ${data.decision},
        reviewer_note = ${note},
        payload_json = ${payloadJson},
        decided_at = now()
      where id = ${row.id}`;

    const nextPipeline =
      data.decision === "approved" ? "approved" : data.decision === "sent" ? "sent" : "ready";
    await sql`
      update applications set pipeline_status = ${nextPipeline}, updated_at = now()
      where id = ${row.application_id}`;
    await writeAudit(context.userId, "approval", row.id, data.decision, {
      orgId: row.org_id ?? undefined,
    });

    // Lock active rubric when a client pack is stamped (approved or sent).
    if (data.decision === "approved" || data.decision === "sent") {
      try {
        const { lockRubricForRole } = await import("../../features/ranking/server/rubric-version.server");
        await lockRubricForRole({ userId: context.userId, roleId: row.role_id });
      } catch {
        /* rubric_versions may not exist until migration */
      }
    }

    const rows = await sql<ApprovalRow>`
      select ap.*, r.title as role_title, r.company_name, c.full_name as candidate_name
      from approvals ap
      join roles r on r.id = ap.role_id
      join applications a on a.id = ap.application_id
      join candidates c on c.id = a.candidate_id
      where ap.id = ${row.id}
      limit 1`;
    return mapApproval(rows[0]!);
  });
