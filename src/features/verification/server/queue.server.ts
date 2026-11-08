/**
 * The verification queue — the handoff from ingestion to the ledger.
 *
 * This is the file that makes the feature run by itself. A recruiter drops two
 * hundred resumes on a role, the ingest queue ranks them, and each ranked
 * application gets one row here; a worker that never blocks the rank path
 * extracts the claims, runs the ladder and writes the verdict. Nothing in the UI
 * has to ask, and nothing in the rank path has to know.
 *
 * The shape deliberately mirrors `features/pipeline/server/queue.server.ts` —
 * claim-by-`run_after`, `attempts` with a bounded backoff, a stuck-row watchdog,
 * a `globalThis` mutex — because that is the queue this repo already trusts, and
 * two queues that behave differently is two sets of surprises.
 *
 * Three rules this file exists to hold:
 *  1. **The handoff cannot break ingestion.** `enqueueVerification` is called
 *     from inside the rank path's success branch, and every caller of it treats
 *     a throw as a lost verdict, never a lost application. Verification is a
 *     display feature; the slate still has to be ranked when it is down.
 *  2. **A tick cannot spend money.** `/api/queue/tick` requires a session and
 *     claims only that caller's jobs, and the default slice is `tier_a` — the
 *     free, local, zero-cost ladder. A paid arm is queued work that only an
 *     explicitly paid slice claims, and even that one is capped by what
 *     `availableDependencies` says is configured.
 *  3. **The queue decides entitlement; the ledger decides truth.** This file may
 *     choose which check ids reach `runVerification`, and nothing else — it
 *     cannot make a verdict, and `adjudicate()` cannot tell whether it was run
 *     from a worker or from a button.
 */
import { getSql } from "../../../platform/db.ts";
import { CHECK_REGISTRY } from "../domain/checks/registry.ts";
import { runVerification } from "./ledger.server.ts";

/** The plan every workspace has, whether or not anybody bought anything. */
export const PLAN_TIER_FREE = "tier_a";
/** Reserved for V5: the only plan whose ladder includes the arms that cost. */
export const PLAN_TIER_PAID = "paid";

type VerificationJobRow = {
  id: string;
  org_id: string | null;
  user_id: string;
  application_id: string;
  candidate_id: string | null;
  role_id: string | null;
  report_id: string | null;
  status: string;
  plan_tier: string;
  error: string;
  attempts: number;
  created_at?: string;
};

export type VerificationSliceResult = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
};

const g = globalThis as typeof globalThis & {
  __vettaVerificationTimer__?: ReturnType<typeof setTimeout>;
  __vettaVerificationBusy__?: boolean;
};

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Which checks a plan is entitled to.
 *
 * Unknown tiers fail closed to the free ladder: a plan string nobody recognised
 * must not be a way to reach the ₹500 arm. The set is derived from the registry
 * rather than listed here, so registering a check is the only step needed to make
 * it reachable — and a check marked into the free tier by its author is marked
 * into it for the queue too.
 */
export function checkIdsForPlan(planTier: string): ReadonlySet<string> {
  const paid = planTier === PLAN_TIER_PAID;
  return new Set(CHECK_REGISTRY.filter((c) => paid || c.includedInFreeTier).map((c) => c.id));
}

export type EnqueueResult = {
  jobId: string;
  /** False when the application already has a job queued or in flight. */
  queued: boolean;
  status: string;
};

/**
 * Ask for this application to be verified — once, however many times asked.
 *
 * The upsert is the whole design: `(application_id, plan_tier)` is unique
 * (migration 0028), so a retried ingest, a second tick, or a re-uploaded resume
 * cannot pile up duplicate work, and a finished job asked about again is
 * re-queued rather than duplicated. Re-queueing resets `attempts` because the
 * retry budget belongs to one piece of work, not to an application forever: a
 * row that failed three times in March must still get three tries in September.
 * `runVerification` is then a cache hit whenever the claims did not change, so
 * the refresh costs the ladder but not the ledger.
 */
export async function enqueueVerification(args: {
  userId: string;
  applicationId: string;
  orgId?: string | null;
  candidateId?: string | null;
  roleId?: string | null;
  planTier?: string;
}): Promise<EnqueueResult> {
  const sql = await getSql();
  const planTier = args.planTier ?? PLAN_TIER_FREE;

  const touched = await sql<{ id: string; status: string }>`
    insert into verification_jobs (
      id, org_id, user_id, application_id, candidate_id, role_id,
      status, plan_tier, error, attempts, run_after
    ) values (
      ${newId()}, ${args.orgId ?? null}, ${args.userId}, ${args.applicationId},
      ${args.candidateId ?? null}, ${args.roleId ?? null},
      'queued', ${planTier}, '', 0, now()
    )
    on conflict (application_id, plan_tier) do update set
      status = 'queued',
      candidate_id = excluded.candidate_id,
      role_id = excluded.role_id,
      org_id = excluded.org_id,
      error = '',
      attempts = 0,
      run_after = now(),
      updated_at = now()
    where verification_jobs.status in ('completed', 'failed', 'skipped')
    returning id, status`;

  if (touched[0]) return { jobId: touched[0].id, queued: true, status: "queued" };

  // No row came back: a job for this application is already queued or running,
  // and a second handoff must not disturb work in flight.
  const existing = await sql<{ id: string; status: string }>`
    select id, status from verification_jobs
    where application_id = ${args.applicationId} and plan_tier = ${planTier}
    limit 1`;
  return {
    jobId: existing[0]?.id ?? "",
    queued: false,
    status: existing[0]?.status ?? "",
  };
}

/** The ingest queue's watchdog, same window: a row stuck mid-run is work lost. */
async function recoverStuckVerificationJobs(): Promise<void> {
  const sql = await getSql();
  await sql`
    update verification_jobs
    set status = 'queued', updated_at = now()
    where status = 'running' and updated_at < now() - interval '6 minutes'`;
}

async function claimNextVerificationJob(
  planTier: string,
  userId?: string,
): Promise<VerificationJobRow | null> {
  const sql = await getSql();
  const rows = userId
    ? await sql<VerificationJobRow>`
        update verification_jobs
        set status = 'running', attempts = attempts + 1, updated_at = now()
        where id = (
          select id from verification_jobs
          where status = 'queued' and run_after <= now()
            and plan_tier = ${planTier} and user_id = ${userId}
          order by created_at
          limit 1
        )
        returning *`
    : await sql<VerificationJobRow>`
        update verification_jobs
        set status = 'running', attempts = attempts + 1, updated_at = now()
        where id = (
          select id from verification_jobs
          where status = 'queued' and run_after <= now() and plan_tier = ${planTier}
          order by created_at
          limit 1
        )
        returning *`;
  return rows[0] ?? null;
}

async function claimNextVerificationJobs(
  limit: number,
  planTier: string,
  userId?: string,
): Promise<VerificationJobRow[]> {
  const out: VerificationJobRow[] = [];
  const n = Math.max(1, Math.min(limit, 32));
  for (let i = 0; i < n; i++) {
    const job = await claimNextVerificationJob(planTier, userId);
    if (!job) break;
    out.push(job);
  }
  return out;
}

/**
 * Run the ladder for one claimed job.
 *
 * The document comes from `candidates.resume_text`, re-read rather than carried
 * on the job row: the candidate row is what a recruiter can edit or delete
 * between the handoff and the run, and a verdict on bytes nobody still has is
 * worse than no verdict. The join is scoped by `user_id` on both sides, so a job
 * row that named another tenant's application reads nothing at all.
 */
async function processOneVerification(
  job: VerificationJobRow,
): Promise<"completed" | "failed" | "requeued" | "skipped"> {
  const sql = await getSql();

  const doc = await sql<{ resume_text: string }>`
    select c.resume_text
    from applications a
    join candidates c on c.id = a.candidate_id and c.user_id = a.user_id
    where a.id = ${job.application_id} and a.user_id = ${job.user_id}
    limit 1`;
  const resumeText = doc[0]?.resume_text ?? "";

  if (!resumeText || resumeText.trim().length < 40) {
    // Not a failure: the application is gone, or the text was never readable.
    // Saying so in a row is what keeps a deleted candidate from being retried
    // until the retry budget runs out, and keeps the reason in the queue view.
    await sql`
      update verification_jobs
      set status = 'skipped', error = ${"No readable resume text for this application"},
          updated_at = now()
      where id = ${job.id}`;
    return "skipped";
  }

  try {
    // Whether a byte-level arm *could* run is the store's answer, not the org's
    // intention: a workspace that turned retention on at 4pm and off at 4:30 has
    // no files to forensicate, and a ladder that read the settings table instead
    // would record checks that no arm was ever handed a document for.
    let hasRawBytes = false;
    try {
      const { documentBytesAvailableForApplication } =
        await import("./documents.server.ts");
      hasRawBytes = (await documentBytesAvailableForApplication(job.application_id))
        .available;
    } catch (err) {
      // A store that cannot be read is a store that holds nothing, which is the
      // same verdict the row would carry and the safe one to run the ladder with.
      console.error("[vetta-documents]", err);
    }
    const run = await runVerification({
      orgId: job.org_id ?? "",
      userId: job.user_id,
      candidateId: job.candidate_id ?? "",
      applicationId: job.application_id,
      roleId: job.role_id,
      resumeText,
      hasRawBytes,
      // No external arm is wired yet, so even a paid plan reads this as
      // "waiting on dns / registry / issuer". Configuring one is a deliberate
      // act, not a default a tick inherits.
      availableDependencies: new Set<string>(),
      allowedCheckIds: checkIdsForPlan(job.plan_tier),
    });
    await sql`
      update verification_jobs
      set status = 'completed', report_id = ${run.reportId}, error = '', updated_at = now()
      where id = ${job.id}`;
    return "completed";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification run failed";
    if (job.attempts < 3) {
      const mins = Math.max(1, job.attempts);
      await sql`
        update verification_jobs
        set status = 'queued',
            error = ${message},
            run_after = now() + (${mins} * interval '1 minute'),
            updated_at = now()
        where id = ${job.id}`;
      return "requeued";
    }
    await sql`
      update verification_jobs
      set status = 'failed', error = ${message}, updated_at = now()
      where id = ${job.id}`;
    return "failed";
  }
}

/**
 * One slice of the verification queue.
 *
 * Smaller budget and lower concurrency than the ingest slice on purpose: this
 * runs in the same process as the queue that ranks resumes, and a verdict that
 * arrives after the recruiter closed the tab is worth nothing. The mutex is the
 * ingest queue's — a tick and the worker overlapping would double-claim nothing
 * (the claim is atomic) but would double the load for no extra verdicts.
 */
export async function processVerificationSlice(opts?: {
  userId?: string;
  planTier?: string;
  maxJobs?: number;
  budgetMs?: number;
  concurrency?: number;
}): Promise<VerificationSliceResult> {
  if (g.__vettaVerificationBusy__) return { processed: 0, completed: 0, failed: 0, skipped: 0 };
  g.__vettaVerificationBusy__ = true;
  const planTier = opts?.planTier ?? PLAN_TIER_FREE;
  const maxJobs = Math.max(1, Math.min(opts?.maxJobs ?? 8, 32));
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 8));
  const budgetMs = Math.max(1000, opts?.budgetMs ?? 20_000);
  const started = Date.now();
  const result: VerificationSliceResult = { processed: 0, completed: 0, failed: 0, skipped: 0 };
  try {
    await recoverStuckVerificationJobs();
    while (result.processed < maxJobs && Date.now() - started < budgetMs) {
      const remaining = maxJobs - result.processed;
      const batch = await claimNextVerificationJobs(
        Math.min(concurrency, remaining),
        planTier,
        opts?.userId,
      );
      if (batch.length === 0) break;
      for (const outcome of await Promise.all(batch.map((job) => processOneVerification(job)))) {
        result.processed += 1;
        if (outcome === "completed") result.completed += 1;
        if (outcome === "failed") result.failed += 1;
        if (outcome === "skipped") result.skipped += 1;
      }
    }
  } finally {
    g.__vettaVerificationBusy__ = false;
  }
  return result;
}

/**
 * The background worker, armed by the ingest worker.
 *
 * Idle delay is deliberately longer than the rank loop's 400 ms: verdicts are
 * read a minute later by a page that is already open, and the queue that shares
 * this event loop is the one the recruiter is watching.
 */
export function ensureVerificationWorker() {
  if (g.__vettaVerificationTimer__) return;
  const loop = () => {
    void processVerificationSlice({ maxJobs: 8, concurrency: 4, budgetMs: 20_000 }).finally(() => {
      g.__vettaVerificationTimer__ = setTimeout(loop, 900);
    });
  };
  g.__vettaVerificationTimer__ = setTimeout(loop, 300);
}
