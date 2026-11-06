import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/platform/db";
import { iso, parseJson } from "@/shared/utils";
import { normalizeQuestions, normalizeTranscript, lastAgentTurn } from "../../features/ingest/domain/normalize-screen";
import type {
  CompanyStage,
  EmploymentType,
  ParsedProfile,
  PortalApplication,
  PortalStage,
  PublicJob,
  RankResult,
  ScreenAnswer,
  WorkMode,
} from "./types";

const applySchema = z.object({
  roleId: z.string().min(1),
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).default(""),
  location: z.string().trim().max(80).default(""),
  linkedinUrl: z.string().trim().max(240).default(""),
  currentTitle: z.string().trim().max(120).default(""),
  currentCompany: z.string().trim().max(120).default(""),
  yearsExperience: z.string().trim().max(12).default(""),
  noticePeriod: z.string().trim().max(80).default(""),
  expectedCtc: z.string().trim().max(80).default(""),
  coverNote: z.string().trim().max(4000).default(""),
  resumeText: z.string().trim().min(40).max(40000),
  /** DPDP: explicit consent to process personal data for this recruitment */
  consentToProcess: z.literal(true, {
    message: "Consent is required to process your application.",
  }),
  shareWithClient: z.boolean().optional(),
  improveModel: z.boolean().optional(),
  voiceAnswers: z.boolean().optional(),
});

const idSchema = z.object({ roleId: z.string().min(1) });
const applicationIdSchema = z.object({ applicationId: z.string().min(1) });

type RoleRow = {
  id: string;
  user_id: string;
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
};

function newId(): string {
  return crypto.randomUUID();
}

function mapPublicJob(row: RoleRow): PublicJob {
  return {
    id: row.id,
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
    postedAt: iso(row.updated_at || row.created_at),
  };
}

function composeResume(data: z.infer<typeof applySchema>): string {
  const header = [
    "APPLICANT DETAILS",
    `Name: ${data.fullName}`,
    `Email: ${data.email}`,
    data.phone ? `Phone: ${data.phone}` : null,
    data.location ? `Location: ${data.location}` : null,
    data.linkedinUrl ? `LinkedIn: ${data.linkedinUrl}` : null,
    data.currentTitle ? `Current title: ${data.currentTitle}` : null,
    data.currentCompany ? `Current company: ${data.currentCompany}` : null,
    data.yearsExperience ? `Years of experience: ${data.yearsExperience}` : null,
    data.noticePeriod ? `Notice period: ${data.noticePeriod}` : null,
    data.expectedCtc ? `Expected CTC: ${data.expectedCtc}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const cover = data.coverNote ? `\n\nCOVER NOTE\n${data.coverNote}` : "";
  return `${header}${cover}\n\nRESUME\n${data.resumeText}`.trim();
}

function yearsFrom(raw: string): number | null {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function portalStage(
  pipeline: string,
  hasQuestions: boolean,
  screenStatus: string | null,
): PortalStage {
  if (
    screenStatus === "evaluated" ||
    ["ready", "approved", "sent", "rejected", "hold"].includes(pipeline)
  ) {
    return "complete";
  }
  if (hasQuestions || pipeline === "screening") return "screening";
  return "received";
}

async function writeAudit(
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  meta: Record<string, string> = {},
) {
  const sql = await getSql();
  await sql`insert into audit_events (id, user_id, entity_type, entity_id, action, meta_json)
    values (${newId()}, ${userId}, ${entityType}, ${entityId}, ${action}, ${JSON.stringify(meta)})`;
}

async function loadOpenRole(roleId: string): Promise<RoleRow> {
  const sql = await getSql();
  const rows = await sql<RoleRow>`
    select * from roles where id = ${roleId} and status = 'open' limit 1`;
  const row = rows[0];
  if (!row) throw new Error("This role is not open for applications");
  return row;
}

async function loadPortalBundle(applicationId: string): Promise<PortalApplication> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    pipeline_status: string;
    created_at: unknown;
    full_name: string;
    email: string;
    phone: string;
    role_id: string;
    user_id: string;
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
    role_created_at: unknown;
    role_updated_at: unknown;
  }>`
    select a.id, a.pipeline_status, a.created_at,
      c.full_name, c.email, c.phone,
      r.id as role_id, r.user_id, r.company_name, r.company_stage, r.title, r.location,
      r.work_mode, r.employment_type, r.compensation_band, r.stack, r.must_haves,
      r.nice_to_haves, r.jd_text, r.status, r.created_at as role_created_at, r.updated_at as role_updated_at
    from applications a
    join candidates c on c.id = a.candidate_id
    join roles r on r.id = a.role_id
    where a.id = ${applicationId} and a.source = 'portal'
    limit 1`;
  const row = rows[0];
  if (!row) throw new Error("Application not found");

  const screens = await sql<{
    questions_json: string;
    answers_json: string;
    status: string;
    transcript_json?: string;
    invite_token?: string | null;
  }>`
    select questions_json, answers_json, status, coalesce(transcript_json, '[]') as transcript_json, invite_token from screens
    where application_id = ${applicationId}
    order by created_at desc limit 1`;
  const screen = screens[0] ?? null;
  const questions = screen ? normalizeQuestions(screen.questions_json) : [];
  const answers = screen ? parseJson<ScreenAnswer[]>(screen.answers_json, []) : [];
  const transcript = screen
    ? normalizeTranscript((screen as { transcript_json?: string }).transcript_json ?? "[]")
    : [];
  const last = lastAgentTurn(transcript);
  const asked = new Set(
    transcript.filter((t) => t.role === "candidate" && !t.is_followup).map((t) => t.question_id),
  ).size;

  return {
    id: row.id,
    role: mapPublicJob({
      id: row.role_id,
      user_id: row.user_id,
      company_name: row.company_name,
      company_stage: row.company_stage,
      title: row.title,
      location: row.location,
      work_mode: row.work_mode,
      employment_type: row.employment_type,
      compensation_band: row.compensation_band,
      stack: row.stack,
      must_haves: row.must_haves,
      nice_to_haves: row.nice_to_haves,
      jd_text: row.jd_text,
      status: row.status,
      created_at: row.role_created_at,
      updated_at: row.role_updated_at,
    }),
    candidateName: row.full_name,
    email: row.email,
    phone: row.phone,
    stage: portalStage(row.pipeline_status, questions.length > 0, screen?.status ?? null),
    questions: questions.length ? questions : null,
    answersSubmitted:
      answers.some((a) => a.answer.trim().length > 0) || screen?.status === "evaluated",
    transcript,
    currentQuestionId: last?.question_id ?? questions[0]?.id ?? null,
    awaitingFollowUp: Boolean(last?.is_followup),
    progress: {
      asked,
      total: questions.length,
      minutes: questions.reduce((s, q) => s + q.time_minutes, 0),
    },
    inviteToken: (screen as { invite_token?: string | null })?.invite_token ?? null,
    submittedAt: iso(row.created_at),
  };
}

async function ensureScreen(args: {
  ownerId: string;
  applicationId: string;
  role: PublicJob;
  candidateName: string;
  currentTitle: string;
  rank: RankResult | null;
  orgId?: string | null;
  subjectId?: string | null;
}) {
  const sql = await getSql();
  const existing = await sql<{ id: string }>`
    select id from screens where application_id = ${args.applicationId} and user_id = ${args.ownerId}
    order by created_at desc limit 1`;
  if (existing[0]) return;

  const { generateScreen } = await import("../../features/ai/server/ai.server");
  const generated = await generateScreen({
    roleTitle: args.role.title,
    companyName: args.role.companyName,
    jdText: args.role.jdText,
    stack: args.role.stack,
    candidateName: args.candidateName,
    currentTitle: args.currentTitle,
    rankSummary: args.rank?.summary ?? "",
    screenFocus: args.rank?.screen_focus?.length ? args.rank.screen_focus : (args.rank?.gaps ?? []),
    orgId: args.orgId,
    subjectId: args.subjectId,
    applicationId: args.applicationId,
  });
  if (!generated.ok) return;
  const id = newId();
  const invite = newId().replace(/-/g, "").slice(0, 16);
  await sql`
    insert into screens (id, user_id, org_id, application_id, questions_json, status, invite_token)
    values (${id}, ${args.ownerId}, ${args.orgId ?? null}, ${args.applicationId}, ${JSON.stringify(generated.questions)}, 'draft', ${invite})`;
  await sql`
    update applications set pipeline_status = 'screening', updated_at = now()
    where id = ${args.applicationId} and (${args.orgId ?? ""} = '' or org_id = ${args.orgId ?? ""} or org_id is null or user_id = ${args.ownerId})`;
  await writeAudit(args.ownerId, "screen", id, "generated", {
    candidate: args.candidateName,
    source: "portal",
  });
}

export const listOpenJobs = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicJob[]> => {
    const sql = await getSql();
    const rows = await sql<RoleRow>`
    select * from roles where status = 'open' order by updated_at desc limit 80`;
    return rows.map(mapPublicJob);
  },
);

export const getPublicJob = createServerFn({ method: "GET" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }): Promise<PublicJob> => {
    return mapPublicJob(await loadOpenRole(data.roleId));
  });

export const applyToJob = createServerFn({ method: "POST" })
  .validator((input: unknown) => applySchema.parse(input))
  .handler(async ({ data }): Promise<PortalApplication> => {
    const roleRow = await loadOpenRole(data.roleId);
    const role = mapPublicJob(roleRow);
    const ownerId = roleRow.user_id;
    const email = data.email.trim().toLowerCase();
    const sql = await getSql();

    const prior = await sql<{ id: string }>`
      select a.id from applications a
      join candidates c on c.id = a.candidate_id
      where a.role_id = ${data.roleId} and a.user_id = ${ownerId}
        and lower(c.email) = ${email} and a.source = 'portal'
      order by a.created_at desc
      limit 1`;
    if (prior[0]) {
      const existing = await loadPortalBundle(prior[0].id);
      if (existing.stage === "received") {
        const apps = await sql<{ rank_json: string }>`
          select rank_json from applications where id = ${prior[0].id} limit 1`;
        const rank = parseJson<RankResult | null>(apps[0]?.rank_json ?? "{}", null);
        await ensureScreen({
          ownerId,
          applicationId: prior[0].id,
          role,
          candidateName: existing.candidateName,
          currentTitle: data.currentTitle,
          rank: rank && typeof rank.score === "number" ? rank : null,
        });
        return loadPortalBundle(prior[0].id);
      }
      return existing;
    }

    const resumeText = composeResume(data);
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(ownerId, role.companyName);

    const candidateId = newId();
    const applicationId = newId();

    const { parseAndRank } = await import("../../features/ai/server/ai.server");
    const ranked = await parseAndRank({
      resumeText,
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
      userId: ownerId,
      orgId: org.orgId,
      roleId: data.roleId,
      candidateId,
      applicationId,
    });

    const parsed: ParsedProfile = ranked.ok
      ? ranked.profile
      : {
          full_name: data.fullName,
          email,
          phone: data.phone,
          location: data.location,
          linkedin_url: data.linkedinUrl,
          current_title: data.currentTitle,
          current_company: data.currentCompany,
          years_experience: yearsFrom(data.yearsExperience),
          skills: [],
          summary: "",
        };

    const profile: ParsedProfile = {
      ...parsed,
      full_name: data.fullName || parsed.full_name,
      email: email || parsed.email,
      phone: data.phone || parsed.phone,
      location: data.location || parsed.location,
      linkedin_url: data.linkedinUrl || parsed.linkedin_url,
      current_title: data.currentTitle || parsed.current_title,
      current_company: data.currentCompany || parsed.current_company,
      years_experience: yearsFrom(data.yearsExperience) ?? parsed.years_experience,
    };

    await sql`
      insert into candidates (
        id, user_id, full_name, email, phone, location, linkedin_url,
        current_title, current_company, years_experience, resume_text, parsed_json, org_id
      ) values (
        ${candidateId}, ${ownerId}, ${profile.full_name}, ${profile.email}, ${profile.phone},
        ${profile.location}, ${profile.linkedin_url}, ${profile.current_title}, ${profile.current_company},
        ${profile.years_experience}, ${resumeText}, ${JSON.stringify(profile)}, ${org.orgId}
      )`;
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
        id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json, source,
        resume_hash, role_hash, rank_engine, org_id, rubric_score, rubric_json, rubric_version_id,
        consent_granted, consent_at
      ) values (
        ${applicationId}, ${ownerId}, ${data.roleId}, ${candidateId}, ${status}, ${score}, ${rankJson}, 'portal',
        ${resumeHash}, ${roleHash}, ${rankEngine}, ${org.orgId}, ${score},
        ${ranked.ok ? JSON.stringify(ranked.rank.match ?? {}) : "{}"},
        ${ranked.ok ? (ranked.rubricVersionId ?? null) : null},
        ${true}, now()
      )`;

    // DPDP: record consent for recruitment processing (portal apply = explicit consent).
    try {
      const { recordConsent } = await import("./privacy.server");
      const purposes: Array<{ purpose: string; on: boolean }> = [
        { purpose: "recruitment_evaluation", on: true },
        { purpose: "client_disclosure", on: Boolean(data.shareWithClient) },
        { purpose: "model_improvement", on: Boolean(data.improveModel) },
        { purpose: "voice_prescreen", on: Boolean(data.voiceAnswers) },
      ];
      for (const item of purposes) {
        if (!item.on) continue;
        await recordConsent({
          orgId: org.orgId,
          subjectType: "applicant",
          subjectId: candidateId,
          purpose: item.purpose,
          source: "portal",
          meta: { roleId: data.roleId, applicationId },
        });
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Could not record consent.");
    }
    await sql`update roles set updated_at = now() where id = ${data.roleId} and user_id = ${ownerId}`;
    await writeAudit(ownerId, "application", applicationId, ranked.ok ? "ranked" : "ingested", {
      name: profile.full_name,
      role: role.title,
      source: "portal",
      engine: rankEngine,
    });

    await ensureScreen({
      ownerId,
      applicationId,
      role,
      candidateName: profile.full_name,
      currentTitle: profile.current_title,
      rank: ranked.ok ? ranked.rank : null,
      orgId: org.orgId,
      subjectId: candidateId,
    });

    return loadPortalBundle(applicationId);
  });

export const getPortalApplication = createServerFn({ method: "GET" })
  .validator((input: unknown) => applicationIdSchema.parse(input))
  .handler(async ({ data }): Promise<PortalApplication> => {
    return loadPortalBundle(data.applicationId);
  });
