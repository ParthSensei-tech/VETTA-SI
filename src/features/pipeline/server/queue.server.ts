import { getSql } from "../../../platform/db.ts";
import { parseJson } from "../../../shared/utils.ts";
import type { CompanyStage, ParsedProfile, WorkMode } from "../../recruiting/domain/types";

function newId(): string {
  return crypto.randomUUID();
}

type RoleLite = {
  id: string;
  company_name: string;
  company_stage: string;
  title: string;
  location: string;
  work_mode: string;
  compensation_band: string;
  stack: string;
  must_haves: string;
  nice_to_haves: string;
  jd_text: string;
};

type JobRow = {
  id: string;
  user_id: string;
  batch_id: string;
  role_id: string;
  filename: string;
  resume_text: string;
  status: string;
  application_id: string | null;
  error: string;
  attempts: number;
  created_at?: string;
};

const g = globalThis as typeof globalThis & {
  __vettaQueueTimer__?: ReturnType<typeof setTimeout>;
  __vettaQueueBusy__?: boolean;
};

function fallbackName(resumeText: string, filename: string): string {
  const fromResume =
    resumeText
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.includes("@") && l.length < 80 && !/^https?:/i.test(l)) ?? "";
  if (fromResume) return fromResume.slice(0, 80);
  const base = filename.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const cleaned = base
    .replace(/[._-]+/g, " ")
    .replace(/\b(resume|cv)\b/gi, "")
    .trim();
  return (cleaned || "Unnamed candidate").slice(0, 80);
}

export async function refreshBatchStats(batchId: string) {
  const sql = await getSql();
  const groups = await sql<{ status: string; n: number | string }>`
    select status, count(*) as n from ingest_jobs where batch_id = ${batchId} group by status`;
  const counts: Record<string, number> = {};
  let total = 0;
  for (const gRow of groups) {
    const n = Number(gRow.n);
    const val = Number.isFinite(n) ? n : 0;
    counts[gRow.status] = val;
    total += val;
  }
  const ranked = counts.completed ?? 0;
  const failed = counts.failed ?? 0;
  const remaining = (counts.queued ?? 0) + (counts.ranking ?? 0);
  const parsedRows = await sql<{ n: number | string }>`
    select count(*) as n from ingest_jobs where batch_id = ${batchId} and length(resume_text) >= 40`;
  const parsedCount = Number(parsedRows[0]?.n) || 0;

  const batch = await sql<{
    status: string;
  }>`select status from ingest_batches where id = ${batchId} limit 1`;
  const current = batch[0]?.status ?? "queued";
  if (current === "cancelled") {
    await sql`
      update ingest_batches set
        total_count = ${total},
        parsed_count = ${parsedCount},
        ranked_count = ${ranked},
        failed_count = ${failed},
        updated_at = now()
      where id = ${batchId}`;
    return;
  }

  const prev = current;
  const next =
    total === 0 ? "queued" : remaining > 0 ? "running" : failed === total ? "failed" : "completed";

  await sql`
    update ingest_batches set
      total_count = ${total},
      parsed_count = ${parsedCount},
      ranked_count = ${ranked},
      failed_count = ${failed},
      status = ${next},
      started_at = coalesce(started_at, case when ${next} <> 'queued' then now() else null end),
      completed_at = case
        when ${next} in ('completed','failed') then coalesce(completed_at, now())
        else completed_at
      end,
      updated_at = now()
    where id = ${batchId}`;

  // Auto-deepen top candidates when a batch first completes — no UI button required.
  if (prev !== "completed" && next === "completed" && ranked > 0) {
    const meta = await sql<{ user_id: string; role_id: string }>`
      select user_id, role_id from ingest_batches where id = ${batchId} limit 1`;
    const row = meta[0];
    if (row) {
      void (async () => {
        try {
          const { deepenRoleTopN } = await import("../../ranking/server/deepen.server.ts");
          await deepenRoleTopN({
            userId: row.user_id,
            roleId: row.role_id,
            topN: Math.min(12, ranked),
            // Nobody is watching this one, so a free but slow local arm is worth offering the
            // task — that is exactly the call a 16 s interactive budget has to refuse.
            context: "background",
            deadlineMs: 120_000,
          });
        } catch (err) {
          console.error("[vetta-deepen]", err);
        }
      })();
    }
  }
}

export async function persistRanked(job: JobRow): Promise<{
  applicationId: string;
  name: string;
  candidateId: string;
  orgId: string;
  roleId: string;
}> {
  const sql = await getSql();
  const roles = await sql<RoleLite>`
    select id, company_name, company_stage, title, location, work_mode,
           compensation_band, stack, must_haves, nice_to_haves, jd_text
    from roles where id = ${job.role_id} and user_id = ${job.user_id} limit 1`;
  const role = roles[0];
  if (!role) throw new Error("Role not found");

  const { ensureUserOrg } = await import("../../people/server/org.server.ts");
  const org = await ensureUserOrg(job.user_id);

  let candidateId = newId();
  const applicationId = newId();

  const { recordEmployerIntake } = await import("../../people/server/privacy.server.ts");
  await recordEmployerIntake({
    orgId: org.orgId,
    subjectId: candidateId,
    source: `batch:${job.batch_id}`,
  });

  const { parseAndRank } = await import("../../ai/server/ai.server.ts");
  const ranked = await parseAndRank({
    resumeText: job.resume_text,
    role: {
      companyName: role.company_name,
      companyStage: role.company_stage as CompanyStage,
      title: role.title,
      location: role.location,
      workMode: role.work_mode as WorkMode,
      compensationBand: role.compensation_band,
      stack: parseJson<string[]>(role.stack, []),
      mustHaves: parseJson<string[]>(role.must_haves, []),
      niceToHaves: parseJson<string[]>(role.nice_to_haves, []),
      jdText: role.jd_text,
    },
    // Batch path: parallel local evidence rank with org rubric (notice/CTC weighted).
    mode: "fast",
    userId: job.user_id,
    candidateId,
    applicationId,
    orgId: org.orgId,
    roleId: job.role_id,
  });

  const profile: ParsedProfile = ranked.ok
    ? ranked.profile
    : {
        full_name: fallbackName(job.resume_text, job.filename),
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

  const note = job.filename ? `Batch file: ${job.filename}` : "";
  const resumeHash = ranked.ok ? ranked.resumeHash : "";
  const roleHash = ranked.ok ? ranked.roleHash : "";
  const rankEngine = ranked.ok ? ranked.engine : "";
  const rankJson = ranked.ok ? JSON.stringify(ranked.rank) : "{}";
  const score = ranked.ok ? ranked.rank.score : null;
  const status = ranked.ok ? "ranked" : "ingested";

  // Deduplicate candidates by email if candidate already exists in the org/account
  let existingCandidate = false;
  if (profile.email) {
    const existingCand = await sql<{ id: string }>`
      select id from candidates
      where user_id = ${job.user_id} and email = ${profile.email}
      limit 1`;
    if (existingCand[0]) {
      candidateId = existingCand[0].id;
      existingCandidate = true;
    }
  }

  // Deduplicate applications if this exact resume or candidate already exists for this role
  const existingApp = await sql<{ id: string }>`
    select id from applications
    where user_id = ${job.user_id} and role_id = ${job.role_id}
      and (
        (candidate_id = ${candidateId} and ${existingCandidate})
        or (resume_hash <> '' and resume_hash = ${resumeHash})
      )
    limit 1`;

  if (existingCandidate) {
    await sql`
      update candidates set
        full_name = coalesce(nullif(${profile.full_name}, ''), full_name),
        phone = coalesce(nullif(${profile.phone}, ''), phone),
        location = coalesce(nullif(${profile.location}, ''), location),
        linkedin_url = coalesce(nullif(${profile.linkedin_url}, ''), linkedin_url),
        current_title = coalesce(nullif(${profile.current_title}, ''), current_title),
        current_company = coalesce(nullif(${profile.current_company}, ''), current_company),
        years_experience = coalesce(${profile.years_experience}, years_experience),
        resume_text = ${job.resume_text},
        parsed_json = ${JSON.stringify(profile)},
        updated_at = now()
      where id = ${candidateId} and user_id = ${job.user_id}`;
  } else {
    await sql`
      insert into candidates (
        id, user_id, full_name, email, phone, location, linkedin_url,
        current_title, current_company, years_experience, resume_text, parsed_json, org_id
      ) values (
        ${candidateId}, ${job.user_id}, ${profile.full_name}, ${profile.email}, ${profile.phone},
        ${profile.location}, ${profile.linkedin_url}, ${profile.current_title}, ${profile.current_company},
        ${profile.years_experience}, ${job.resume_text}, ${JSON.stringify(profile)}, ${org.orgId}
      )`;
  }

  const notice = ranked.ok ? ranked.rank.india.notice_period_days : null;
  const expected = ranked.ok ? ranked.rank.india.expected_ctc_lakh : null;
  try {
    const { indexNewCandidate } = await import("./search.server.ts");
    await indexNewCandidate(candidateId, notice, expected, org.orgId);
  } catch {
    /* search index is rebuilt on the next talent query */
  }

  if (existingApp[0]) {
    const appId = existingApp[0].id;
    await sql`
      update applications set
        rank_score = ${score},
        rank_json = ${rankJson},
        resume_hash = ${resumeHash},
        role_hash = ${roleHash},
        rank_engine = ${rankEngine},
        model = ${ranked.ok ? (ranked.model ?? "") : ""},
        provider = ${ranked.ok ? (ranked.provider ?? "") : ""},
        rubric_version_id = ${ranked.ok ? (ranked.rubricVersionId ?? null) : null},
        rubric_version = ${ranked.ok ? (ranked.rubricVersion ?? null) : null},
        rubric_hash = ${ranked.ok ? (ranked.rubricHash ?? "") : ""},
        is_stale = false,
        stale_reason = '',
        recruiter_notes = case
          when recruiter_notes = '' or recruiter_notes is null then ${note}
          when ${note} <> '' and position(${note} in recruiter_notes) = 0 then recruiter_notes || E'\n' || ${note}
          else recruiter_notes
        end,
        updated_at = now()
      where id = ${appId} and user_id = ${job.user_id}`;
    return {
      applicationId: appId,
      name: profile.full_name,
      candidateId,
      orgId: org.orgId,
      roleId: job.role_id,
    };
  }

  await sql`
    insert into applications (
      id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json, recruiter_notes, source,
      resume_hash, role_hash, rank_engine, org_id, rubric_score, rubric_json, rubric_version_id,
      model, provider, rubric_version, rubric_hash, is_stale, stale_reason
    ) values (
      ${applicationId}, ${job.user_id}, ${job.role_id}, ${candidateId}, ${status}, ${score}, ${rankJson},
      ${note}, 'ingest', ${resumeHash}, ${roleHash}, ${rankEngine}, ${org.orgId}, ${score},
      ${ranked.ok ? JSON.stringify(ranked.rank.match ?? {}) : "{}"},
      ${ranked.ok ? (ranked.rubricVersionId ?? null) : null},
      ${ranked.ok ? (ranked.model ?? "") : ""},
      ${ranked.ok ? (ranked.provider ?? "") : ""},
      ${ranked.ok ? (ranked.rubricVersion ?? null) : null},
      ${ranked.ok ? (ranked.rubricHash ?? "") : ""},
      false,
      ''
    )`;
  await sql`update roles set updated_at = now() where id = ${job.role_id} and user_id = ${job.user_id}`;
  await sql`insert into audit_events (id, user_id, entity_type, entity_id, action, meta_json)
    values (${newId()}, ${job.user_id}, 'application', ${applicationId}, ${ranked.ok ? "ranked" : "ingested"},
      ${JSON.stringify({
        name: profile.full_name,
        role: role.title,
        file: job.filename,
        batch: "1",
        engine: rankEngine,
        fromCache: ranked.ok ? ranked.fromCache : false,
      })})`;

  return {
    applicationId,
    name: profile.full_name,
    candidateId,
    orgId: org.orgId,
    roleId: job.role_id,
  };
}

async function recoverStuckJobs() {
  const sql = await getSql();
  await sql`
    update ingest_jobs
    set status = 'queued', updated_at = now()
    where status = 'ranking' and updated_at < now() - interval '6 minutes'`;
}

async function claimNextJob(userId?: string): Promise<JobRow | null> {
  const sql = await getSql();
  const rows = userId
    ? await sql<JobRow>`
        update ingest_jobs set status = 'ranking', attempts = attempts + 1, updated_at = now()
        where id = (
          select id from ingest_jobs
          where status = 'queued' and run_after <= now() and user_id = ${userId}
          order by created_at
          limit 1
        )
        returning *`
    : await sql<JobRow>`
        update ingest_jobs set status = 'ranking', attempts = attempts + 1, updated_at = now()
        where id = (
          select id from ingest_jobs
          where status = 'queued' and run_after <= now()
          order by created_at
          limit 1
        )
        returning *`;
  return rows[0] ?? null;
}

async function processOne(job: JobRow): Promise<"completed" | "failed" | "requeued"> {
  const sql = await getSql();
  const jobStart = Date.now();
  const queueAgeMs = job.created_at
    ? Math.max(0, jobStart - new Date(job.created_at).getTime())
    : 0;

  const recordMetric = (status: "completed" | "failed" | "requeued", error: string = "") => {
    void (async () => {
      try {
        const { recordQueueMetric } =
          await import("../../../platform/observability/observability.server.ts");
        await recordQueueMetric({
          jobId: job.id,
          batchId: job.batch_id,
          userId: job.user_id,
          queueAgeMs,
          durationMs: Date.now() - jobStart,
          status,
          attempts: job.attempts,
          error,
        });
      } catch {
        /* telemetry is best-effort — never block the queue */
      }
    })();
  };

  if (!job.resume_text || job.resume_text.trim().length < 40) {
    await sql`
      update ingest_jobs set status = 'failed', error = 'No readable resume text', updated_at = now()
      where id = ${job.id}`;
    await refreshBatchStats(job.batch_id);
    recordMetric("failed", "No readable resume text");
    return "failed";
  }
  try {
    const saved = await persistRanked(job);
    // Tell the document store whose file this turned out to be. The capture at
    // upload time only ever knew the ingest job; a forensic check later needs the
    // person and the application, and this is the only place that has both. Same
    // firewall, same reason: it can cost a byte-level check and nothing else.
    //
    // It runs before the handoff below for a reason: the verification worker
    // polls on its own clock, so a tick that claims the job it just queued would
    // otherwise ask the store for a file the store has not yet been told about,
    // and the candidate's byte-level checks would report "needs the original
    // file" about a file sitting in the same request.
    try {
      const { bindDocumentToApplication } =
        await import("../../verification/server/documents.server.ts");
      await bindDocumentToApplication({
        ingestJobId: job.id,
        candidateId: saved.candidateId,
        applicationId: saved.applicationId,
      });
    } catch (err) {
      console.error("[vetta-documents]", err);
    }
    // Hand the ranked application to the verification queue. Best-effort in the
    // strict sense: the await is inside its own try, so a ledger that is down,
    // a migration that has not applied, or a queue row that will not insert can
    // cost this candidate a verdict and nothing else. The rank path does not
    // learn from it, does not wait on it beyond one insert and the two indexed
    // reads that ask which ladder this workspace is entitled to, and does not
    // change what it wrote — which is the same firewall the rail enforces in the
    // other direction, kept honest here by `features/verification/server/queue.test.ts`.
    try {
      const { enqueueVerification } = await import("../../verification/server/queue.server.ts");
      await enqueueVerification({
        userId: job.user_id,
        applicationId: saved.applicationId,
        candidateId: saved.candidateId,
        roleId: saved.roleId,
        orgId: saved.orgId,
      });
    } catch (err) {
      console.error("[vetta-verification]", err);
    }
    await sql`
      update ingest_jobs
      set status = 'completed', application_id = ${saved.applicationId}, error = '', updated_at = now()
      where id = ${job.id}`;
    await refreshBatchStats(job.batch_id);
    recordMetric("completed");
    return "completed";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ranking failed";
    if (job.attempts < 3) {
      const mins = Math.max(1, job.attempts);
      await sql`
        update ingest_jobs
        set status = 'queued',
            error = ${message},
            run_after = now() + (${mins} * interval '1 minute'),
            updated_at = now()
        where id = ${job.id}`;
      recordMetric("requeued", message);
      return "requeued";
    }
    await sql`
      update ingest_jobs set status = 'failed', error = ${message}, updated_at = now()
      where id = ${job.id}`;
    await refreshBatchStats(job.batch_id);
    recordMetric("failed", message);
    return "failed";
  }
}

/** Claim up to `limit` queued jobs (FIFO). */
async function claimNextJobs(limit: number, userId?: string): Promise<JobRow[]> {
  const out: JobRow[] = [];
  const n = Math.max(1, Math.min(limit, 32));
  for (let i = 0; i < n; i++) {
    const job = await claimNextJob(userId);
    if (!job) break;
    out.push(job);
  }
  return out;
}

export async function processQueueSlice(opts?: {
  userId?: string;
  maxJobs?: number;
  budgetMs?: number;
  concurrency?: number;
}): Promise<{ processed: number; completed: number; failed: number }> {
  if (g.__vettaQueueBusy__) return { processed: 0, completed: 0, failed: 0 };
  g.__vettaQueueBusy__ = true;
  // High throughput for bulk batches: many local ranks in parallel.
  const maxJobs = Math.max(1, Math.min(opts?.maxJobs ?? 24, 64));
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 8, 16));
  const budgetMs = Math.max(1000, opts?.budgetMs ?? 45_000);
  const started = Date.now();
  let processed = 0;
  let completed = 0;
  let failed = 0;
  try {
    await recoverStuckJobs();
    while (processed < maxJobs && Date.now() - started < budgetMs) {
      const remaining = maxJobs - processed;
      const batch = await claimNextJobs(Math.min(concurrency, remaining), opts?.userId);
      if (batch.length === 0) break;
      const results = await Promise.all(batch.map((job) => processOne(job)));
      for (const result of results) {
        processed += 1;
        if (result === "completed") completed += 1;
        if (result === "failed") failed += 1;
      }
    }
  } finally {
    g.__vettaQueueBusy__ = false;
  }
  return { processed, completed, failed };
}

export function ensureQueueWorker() {
  if (g.__vettaQueueTimer__) return;
  // Verification is queued by the ranks this loop produces, so its worker is
  // armed here rather than from app boot: nothing else in the app enqueues a
  // job, and a timer that starts before the first upload just wakes up idle.
  // The import is dynamic and swallowed for the same reason the handoff below
  // is — a feature that cannot load must not take ingestion with it.
  void (async () => {
    try {
      const { ensureVerificationWorker } =
        await import("../../verification/server/queue.server.ts");
      ensureVerificationWorker();
    } catch (err) {
      console.error("[vetta-verification]", err);
    }
  })();
  const loop = () => {
    void processQueueSlice({ maxJobs: 32, concurrency: 8, budgetMs: 50_000 }).finally(() => {
      // Tight loop while work exists; idle still wakes often enough for UX.
      g.__vettaQueueTimer__ = setTimeout(loop, 400);
    });
  };
  g.__vettaQueueTimer__ = setTimeout(loop, 100);
}
