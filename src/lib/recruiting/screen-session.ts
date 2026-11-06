import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../platform/auth/middleware.ts";
import { getSql } from "../../platform/db.ts";
import { iso, parseJson } from "../../shared/utils.ts";
import { mailtoUrl, whatsappUrl } from "./links.ts";
import {
  answersFromTranscript,
  closingMessage,
  decideNext,
  lastAgentTurn,
  newTurn,
  normalizeQuestions,
  normalizeTranscript,
  openingMessage,
} from "../../features/ingest/domain/normalize-screen.ts";
import type {
  PortalApplication,
  PublicJob,
  ScreenInvite,
  ScreenQuestion,
  ScreenTurn,
} from "./types.ts";

function newId(): string {
  return crypto.randomUUID();
}

type ScreenDb = {
  id: string;
  user_id: string;
  application_id: string;
  questions_json: string;
  answers_json: string;
  evaluation_json: string;
  transcript_json: string;
  status: string;
  invite_token: string | null;
  opened_at: unknown;
  started_at: unknown;
  completed_at: unknown;
  last_reminded_at: unknown;
};

type AppHead = {
  id: string;
  user_id: string;
  role_id: string;
  candidate_id: string;
  org_id: string | null;
  pipeline_status: string;
  source: string;
  created_at: unknown;
  full_name: string;
  email: string;
  phone: string;
  current_title: string;
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
  role_updated_at: unknown;
};

function jobFrom(row: AppHead): PublicJob {
  return {
    id: row.role_id,
    companyName: row.company_name,
    companyStage: row.company_stage as PublicJob["companyStage"],
    title: row.title,
    location: row.location,
    workMode: row.work_mode as PublicJob["workMode"],
    employmentType: row.employment_type as PublicJob["employmentType"],
    compensationBand: row.compensation_band,
    stack: parseJson<string[]>(row.stack, []),
    mustHaves: parseJson<string[]>(row.must_haves, []),
    niceToHaves: parseJson<string[]>(row.nice_to_haves, []),
    jdText: row.jd_text,
    postedAt: iso(row.role_updated_at),
  };
}

function portalStage(
  pipeline: string,
  hasQuestions: boolean,
  screenStatus: string | null,
): PortalApplication["stage"] {
  if (
    screenStatus === "evaluated" ||
    ["ready", "approved", "sent", "rejected", "hold"].includes(pipeline)
  ) {
    return "complete";
  }
  if (hasQuestions || pipeline === "screening") return "screening";
  return "received";
}

function toPortal(row: AppHead, screen: ScreenDb | null): PortalApplication {
  const questions = screen ? normalizeQuestions(screen.questions_json) : [];
  const transcript = screen ? normalizeTranscript(screen.transcript_json) : [];
  const answers = screen
    ? parseJson<{ question_id: string; answer: string }[]>(screen.answers_json, [])
    : [];
  const last = lastAgentTurn(transcript);
  const asked = new Set(
    transcript.filter((t) => t.role === "candidate" && !t.is_followup).map((t) => t.question_id),
  ).size;
  return {
    id: row.id,
    role: jobFrom(row),
    candidateName: row.full_name,
    email: row.email,
    phone: row.phone,
    stage: portalStage(row.pipeline_status, questions.length > 0, screen?.status ?? null),
    questions: questions.length ? questions : null,
    answersSubmitted: answers.some((a) => a.answer.trim()) || screen?.status === "evaluated",
    transcript,
    currentQuestionId: last?.question_id ?? questions[0]?.id ?? null,
    awaitingFollowUp: Boolean(last?.is_followup && last.role === "agent"),
    progress: {
      asked,
      total: questions.length,
      minutes: questions.reduce((s, q) => s + q.time_minutes, 0),
    },
    inviteToken: screen?.invite_token ?? null,
    submittedAt: iso(row.created_at),
  };
}

async function loadHead(applicationId: string): Promise<AppHead> {
  const sql = await getSql();
  const rows = await sql<AppHead>`
    select a.id, a.user_id, a.role_id, a.candidate_id, a.org_id, a.pipeline_status, a.source, a.created_at,
      c.full_name, c.email, c.phone, c.current_title,
      r.company_name, r.company_stage, r.title, r.location, r.work_mode, r.employment_type,
      r.compensation_band, r.stack, r.must_haves, r.nice_to_haves, r.jd_text, r.status,
      r.updated_at as role_updated_at
    from applications a
    join candidates c on c.id = a.candidate_id
    join roles r on r.id = a.role_id
    where a.id = ${applicationId}
    limit 1`;
  const row = rows[0];
  if (!row) throw new Error("Application not found");
  return row;
}

async function loadScreen(applicationId: string, _userId?: string): Promise<ScreenDb | null> {
  const sql = await getSql();
  const rows = await sql<ScreenDb>`
    select id, user_id, application_id, questions_json, answers_json, evaluation_json,
      coalesce(transcript_json, '[]') as transcript_json, status, invite_token,
      opened_at, started_at, completed_at, last_reminded_at
    from screens
    where application_id = ${applicationId}
    order by created_at desc
    limit 1`;
  return rows[0] ?? null;
}

async function ensureOpening(screen: ScreenDb, candidateName: string): Promise<ScreenDb> {
  const questions = normalizeQuestions(screen.questions_json);
  let transcript = normalizeTranscript(screen.transcript_json);
  if (!questions.length) return screen;
  if (transcript.length > 0) return screen;
  const first = questions[0]!;
  const minutes = questions.reduce((s, q) => s + q.time_minutes, 0);
  transcript = [
    newTurn({
      question_id: first.id,
      role: "agent",
      text: `${openingMessage(candidateName, minutes || 50)}\n\n${first.prompt}`,
      is_followup: false,
      kind: first.kind,
    }),
  ];
  const sql = await getSql();
  await sql`
    update screens set transcript_json = ${JSON.stringify(transcript)}, updated_at = now()
    where id = ${screen.id}`;
  return { ...screen, transcript_json: JSON.stringify(transcript) };
}

async function finishScreen(
  screen: ScreenDb,
  questions: ScreenQuestion[],
  transcript: ScreenTurn[],
) {
  const sql = await getSql();
  const answers = answersFromTranscript(transcript);
  const { evaluateScreen } = await import("../../features/ai/server/ai.server");
  const head = await loadHead(screen.application_id);
  const evaluated = await evaluateScreen({
    roleTitle: head.title,
    questions,
    answers,
    orgId: head.org_id,
    subjectId: head.candidate_id,
    applicationId: head.id,
  });
  const evaluation = evaluated.ok
    ? evaluated.evaluation
    : { score: null, verdict: "Needs review", strengths: [], concerns: [], notes: "" };
  await sql`
    update screens set
      answers_json = ${JSON.stringify(answers)},
      evaluation_json = ${JSON.stringify(evaluation)},
      transcript_json = ${JSON.stringify(transcript)},
      status = 'evaluated',
      completed_at = now(),
      updated_at = now()
    where id = ${screen.id}`;
  await sql`
    update applications set pipeline_status = 'ready', updated_at = now()
    where id = ${screen.application_id}`;
}

export const getScreenByToken = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ token: z.string().min(6) }).parse(input))
  .handler(async ({ data }): Promise<PortalApplication> => {
    const sql = await getSql();
    const screens = await sql<ScreenDb>`
      select id, user_id, application_id, questions_json, answers_json, evaluation_json,
        coalesce(transcript_json, '[]') as transcript_json, status, invite_token,
        opened_at, started_at, completed_at, last_reminded_at
      from screens where invite_token = ${data.token} limit 1`;
    const screen = screens[0];
    if (!screen) throw new Error("This screen link is invalid.");
    if (!screen.opened_at) {
      await sql`update screens set opened_at = now() where id = ${screen.id} and opened_at is null`;
    }
    const head = await loadHead(screen.application_id);
    const opened = await ensureOpening(screen, head.full_name);
    return toPortal(head, opened);
  });

export async function loadScreenByApplicationForUser(
  userId: string,
  applicationId: string,
): Promise<PortalApplication> {
  const head = await loadHead(applicationId);
  // Verify caller is a member of the application's org
  if (head.org_id) {
    const { assertOrgMember } = await import("./org.server.ts");
    await assertOrgMember(userId, head.org_id);
  } else if (head.user_id !== userId) {
    throw new Error("Application not found");
  }
  let screen = await loadScreen(head.id, head.user_id);
  if (screen && !screen.opened_at) {
    const sql = await getSql();
    await sql`update screens set opened_at = now() where id = ${screen.id} and opened_at is null`;
  }
  if (screen) screen = await ensureOpening(screen, head.full_name);
  return toPortal(head, screen);
}

export const getScreenByApplication = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ applicationId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<PortalApplication> =>
    loadScreenByApplicationForUser(context.userId, data.applicationId),
  );

export const postScreenTurn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: z.string().min(6).optional(),
        applicationId: z.string().min(1).optional(),
        text: z.string().trim().min(8).max(8000),
        channel: z.enum(["text", "voice", "whatsapp"]).optional(),
        lang: z.string().max(16).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<PortalApplication> => {
    const sql = await getSql();
    let screen: ScreenDb | null = null;
    if (data.token) {
      const rows = await sql<ScreenDb>`
        select id, user_id, application_id, questions_json, answers_json, evaluation_json,
          coalesce(transcript_json, '[]') as transcript_json, status, invite_token,
          opened_at, started_at, completed_at, last_reminded_at
        from screens where invite_token = ${data.token} limit 1`;
      screen = rows[0] ?? null;
    } else if (data.applicationId) {
      const head = await loadHead(data.applicationId);
      screen = await loadScreen(head.id, head.user_id);
    }
    if (!screen) throw new Error("Screen not found");
    if (screen.status === "evaluated") {
      return toPortal(await loadHead(screen.application_id), screen);
    }

    const questions = normalizeQuestions(screen.questions_json);
    let transcript = normalizeTranscript(screen.transcript_json);
    if (transcript.length === 0) {
      screen = await ensureOpening(screen, (await loadHead(screen.application_id)).full_name);
      transcript = normalizeTranscript(screen.transcript_json);
    }
    const last = lastAgentTurn(transcript);
    if (!last) throw new Error("The screen is not ready yet");

    const head = await loadHead(screen.application_id);
    if (data.channel === "voice") {
      const { assertMayProcess } = await import("./privacy.server");
      await assertMayProcess({
        orgId: head.org_id,
        subjectId: head.candidate_id,
        purpose: "voice_prescreen",
      });
    }

    const candidateTurn = newTurn({
      question_id: last.question_id,
      role: "candidate",
      text: data.text.trim(),
      is_followup: last.is_followup,
      kind: last.kind === "system" ? "practical" : last.kind,
      channel: data.channel ?? "text",
      lang: data.lang ?? null,
    });
    transcript = [...transcript, candidateTurn];

    if (!screen.started_at) {
      await sql`update screens set started_at = now() where id = ${screen.id} and started_at is null`;
    }
    await sql`
      update screens set
        transcript_json = ${JSON.stringify(transcript)},
        answers_json = ${JSON.stringify(answersFromTranscript(transcript))},
        status = 'awaiting',
        updated_at = now()
      where id = ${screen.id}`;

    const next = decideNext(questions, transcript);
    if (next.kind === "followup" && next.question) {
      let prompt = next.followUp?.prompt ?? "";
      try {
        const { generateFollowUp } = await import("../../features/ai/server/ai.server");
        const generated = await generateFollowUp({
          roleTitle: head.title,
          question: next.question,
          answer: data.text,
          orgId: head.org_id,
          subjectId: head.candidate_id,
          applicationId: head.id,
        });
        if (generated.ok) prompt = generated.prompt;
      } catch {
        /* seeded follow-up is enough */
      }
      transcript = [
        ...transcript,
        newTurn({
          question_id: next.question.id,
          role: "agent",
          text: prompt,
          is_followup: true,
          kind: next.question.kind,
        }),
      ];
    } else if (next.kind === "next" && next.question) {
      transcript = [
        ...transcript,
        newTurn({
          question_id: next.question.id,
          role: "agent",
          text: `Got it. Next one — this is ${next.question.kind} knowledge.\n\n${next.question.prompt}`,
          is_followup: false,
          kind: next.question.kind,
        }),
      ];
    } else {
      transcript = [
        ...transcript,
        newTurn({
          question_id: last.question_id,
          role: "agent",
          text: closingMessage(),
          is_followup: false,
          kind: "system",
        }),
      ];
      await finishScreen(screen, questions, transcript);
      return toPortal(head, await loadScreen(screen.application_id, screen.user_id));
    }

    await sql`
      update screens set transcript_json = ${JSON.stringify(transcript)}, updated_at = now()
      where id = ${screen.id}`;
    await sql`
      update applications set pipeline_status = 'screening', updated_at = now()
      where id = ${screen.application_id} and user_id = ${screen.user_id}
        and pipeline_status in ('ingested','ranked','shortlisted','screening')`;

    return toPortal(head, {
      ...screen,
      transcript_json: JSON.stringify(transcript),
      status: "awaiting",
    });
  });

export const postScreenVoice = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: z.string().min(6).optional(),
        applicationId: z.string().min(1).optional(),
        pcmBase64: z.string().min(100).max(6_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<PortalApplication> => {
    const sql = await getSql();
    let screenAppId = data.applicationId;
    if (data.token) {
      const s = await sql<{
        application_id: string;
      }>`select application_id from screens where invite_token = ${data.token} limit 1`;
      if (s[0]) screenAppId = s[0].application_id;
    }
    if (!screenAppId) throw new Error("Screen not found");
    const head = await loadHead(screenAppId);
    const { assertMayProcess } = await import("./privacy.server");
    await assertMayProcess({
      orgId: head.org_id,
      subjectId: head.candidate_id,
      purpose: "voice_prescreen",
    });

    const { transcribePcm16 } = await import("../../features/ai/server/transcribe.server");
    const heard = await transcribePcm16(data.pcmBase64);
    return postScreenTurn({
      data: {
        token: data.token,
        applicationId: data.applicationId,
        text: heard.text,
        channel: "voice",
        lang: heard.lang,
      },
    });
  });

export const grantScreenVoiceConsent = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: z.string().min(6).optional(),
        applicationId: z.string().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ granted: boolean }> => {
    const sql = await getSql();
    let screenAppId = data.applicationId;
    if (data.token) {
      const s = await sql<{
        application_id: string;
      }>`select application_id from screens where invite_token = ${data.token} limit 1`;
      if (s[0]) screenAppId = s[0].application_id;
    }
    if (!screenAppId) throw new Error("Screen not found");
    const head = await loadHead(screenAppId);
    if (!head.org_id) throw new Error("Missing organization reference");
    const { recordConsent } = await import("./privacy.server");
    await recordConsent({
      orgId: head.org_id,
      subjectType: "applicant",
      subjectId: head.candidate_id,
      purpose: "voice_prescreen",
      source: "screen_prompt",
      meta: { applicationId: head.id, roleId: head.role_id },
    });
    return { granted: true };
  });

export const getScreenInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ applicationId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<ScreenInvite> => {
    const sql = await getSql();
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId);
    const rows = await sql<{
      id: string;
      invite_token: string | null;
      full_name: string;
      email: string;
      phone: string;
      title: string;
      company_name: string;
    }>`
      select s.id, s.invite_token, c.full_name, c.email, c.phone, r.title, r.company_name
      from screens s
      join applications a on a.id = s.application_id
      join candidates c on c.id = a.candidate_id
      join roles r on r.id = a.role_id
      where s.application_id = ${data.applicationId}
        and (s.org_id = ${org.orgId} or (s.org_id is null and s.user_id = ${context.userId}))
      order by s.created_at desc
      limit 1`;
    const row = rows[0];
    if (!row) throw new Error("Generate the screen first");
    let invite = row.invite_token;
    if (!invite) {
      invite = newId().replace(/-/g, "").slice(0, 16);
      await sql`update screens set invite_token = ${invite} where id = ${row.id}`;
    }
    const { screenUrl: makeScreenUrl } = await import("./origin");
    const url = makeScreenUrl(invite);
    const first = row.full_name.split(" ")[0] || "there";
    const text = `Hi ${first} — quick written screen for ${row.title} at ${row.company_name}. Takes ~45 minutes on your phone. ${url}`;
    return {
      applicationId: data.applicationId,
      candidateName: row.full_name,
      email: row.email,
      phone: row.phone,
      screenUrl: url,
      mailto: row.email
        ? mailtoUrl(row.email, `Written screen · ${row.title}`, text)
        : mailtoUrl("", `Written screen · ${row.title}`, text),
      whatsappUrl: whatsappUrl(row.phone, text),
    };
  });

export const recordScreenReminder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        applicationId: z.string().min(1),
        channel: z.enum(["email", "whatsapp", "copy"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<ScreenInvite> => {
    const invite = await getScreenInvite({ data: { applicationId: data.applicationId } });
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId);
    const sql = await getSql();
    await sql`
      insert into screen_reminders (id, user_id, application_id, channel, meta_json)
      values (${newId()}, ${context.userId}, ${data.applicationId}, ${data.channel}, ${JSON.stringify({ url: invite.screenUrl })})`;
    await sql`
      update screens set last_reminded_at = now()
      where application_id = ${data.applicationId}
        and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId}))`;
    return invite;
  });
