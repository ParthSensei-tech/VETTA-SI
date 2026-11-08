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
 *     display feature; the slate still has to be ranked when it is down. The
 *     entitlement read on the way in obeys the same rule: a meter nobody can
 *     read asks for the free ladder, never for the expensive one.
 *  2. **A tick cannot spend the workspace's trial.** `/api/queue/tick` requires a
 *     session and claims only that caller's jobs, and the default slice is
 *     `tier_a` — the free, local, zero-cost ladder. The arms outside it are
 *     claimed by the background worker, and each of those jobs is authorised
 *     against the meter again immediately before it runs: the job row is a
 *     request, the charge is the decision, and the gap between them is what a
 *     200-resume drop is made of.
 *  3. **The queue decides entitlement; the ledger decides truth.** This file may
 *     choose which check ids and which already-gated documents reach
 *     `runVerification`, and nothing else — it cannot make a verdict, cannot open
 *     a file itself (only `documents.server.ts` decides what is readable, and it
 *     hands over the reading), cannot charge for a report (only
 *     `quota.server.ts` writes the meter), and `adjudicate()` cannot tell
 *     whether it was run from a worker or from a button.
 */
import { getSql } from "../../../platform/db.ts";
import { CHECK_REGISTRY } from "../domain/checks/registry.ts";
import type { DocumentForensics } from "../domain/forensics.ts";
import { PLAN_TIER_FREE, PLAN_TIER_PAID } from "../domain/quota.ts";
import { chargeVerificationUse, entitlementForOrg } from "./quota.server.ts";
import { runVerification } from "./ledger.server.ts";

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

/**
 * Which ladder this workspace's next job should ask for.
 *
 * A read that fails asks for the free ladder. That is the only failure shape
 * available: the alternative is that a meter which cannot be reached becomes a
 * licence to run the expensive arms, and the workspace finds out from an invoice.
 *
 * This is the *request*, not the permission — see rule 2 above. A slate of two
 * hundred jobs resolved here can outspend a trial of four, and does, until each
 * job meets the meter again on its way into the ladder.
 */
export async function planTierForOrg(orgId: string): Promise<string> {
  try {
    const { entitlement } = await entitlementForOrg(orgId);
    return entitlement.planTier;
  } catch (err) {
    console.error("[vetta-verification-plan]", err);
    return PLAN_TIER_FREE;
  }
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
 *
 * A caller that names no plan gets the one the workspace's meter supports: four
 * candidate reports with the byte arms switched on, and the free ladder after
 * that unless the workspace has a plan. The row records what was asked for;
 * `processOneVerification` is where it is checked against what is still owed.
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
  const planTier = args.planTier ?? (await planTierForOrg(args.orgId ?? ""));

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
    // Which arms this run may attempt. The job row records what the handoff
    // asked for; the meter decides what is still owed, and it is read here
    // because the two are separated by a whole slate — 200 jobs enqueued against
    // four free uses all ask for the paid ladder, and the four that get the byte
    // arms are the four the workspace was actually sold. A job that outran the
    // trial degrades to the free ladder rather than failing, and the report it
    // writes says which arms it could not run and why.
    //
    // A meter that cannot be read is the same case as a meter that says no: the
    // free ladder, no charge, and a verdict the recruiter still gets.
    let allowedCheckIds = checkIdsForPlan(PLAN_TIER_FREE);
    let mayCharge = false;
    if (job.plan_tier === PLAN_TIER_PAID) {
      try {
        const { entitlement } = await entitlementForOrg(job.org_id ?? "");
        if (entitlement.entitled) {
          allowedCheckIds = checkIdsForPlan(PLAN_TIER_PAID);
          mayCharge = true;
        }
      } catch (err) {
        console.error("[vetta-verification-meter]", err);
      }
    }

    // Whether a byte-level arm *could* run is the store's answer, not the org's
    // intention: a workspace that turned retention on at 4pm and off at 4:30 has
    // no files to forensicate, and a ladder that read the settings table instead
    // would record checks that no arm was ever handed a document for.
    let hasRawBytes = false;
    // Read apart from the gate below, because the gate answers "is there a file"
    // from the state column alone and this pulls the file: a workspace that never
    // opted into retention must not pay a byte read per resume for the answer
    // `false`. The arms take the list they are handed, so an empty list with
    // `hasRawBytes` still true is the honest shape of a store that would not open.
    let documents: readonly DocumentForensics[] = [];
    let documentFingerprint = "";
    // And only when the run is entitled to read it: opening a candidate's file
    // to answer questions this workspace's plan has already switched off is a
    // privacy cost with no verdict on the other side of it.
    if (mayCharge) {
      try {
        const { documentBytesAvailableForApplication, analyzeDocumentsForApplication } =
          await import("./documents.server.ts");
        hasRawBytes = (await documentBytesAvailableForApplication(job.application_id))
          .available;
        if (hasRawBytes) {
          const read = await analyzeDocumentsForApplication(job.application_id);
          documents = read.documents;
          documentFingerprint = read.documentFingerprint;
        }
      } catch (err) {
        // A store that cannot be read is a store that holds nothing, which is the
        // same verdict the row would carry and the safe one to run the ladder with.
        console.error("[vetta-documents]", err);
      }
    }
    const run = await runVerification({
      orgId: job.org_id ?? "",
      userId: job.user_id,
      candidateId: job.candidate_id ?? "",
      applicationId: job.application_id,
      roleId: job.role_id,
      resumeText,
      hasRawBytes,
      documents,
      documentFingerprint,
      // No external arm is wired yet, so even a paid plan reads this as
      // "waiting on dns / registry / issuer". Configuring one is a deliberate
      // act, not a default a tick inherits.
      availableDependencies: new Set<string>(),
      allowedCheckIds,
    });
    await sql`
      update verification_jobs
      set status = 'completed', report_id = ${run.reportId}, error = '', updated_at = now()
      where id = ${job.id}`;
    // Charged after the verdict is safely on disk, and never instead of it: a
    // meter that will not write costs the workspace a free report, not the
    // recruiter an absent one. A retry of this job re-reads the same report id,
    // so the unique key makes the second charge a no-op rather than a duplicate.
    if (mayCharge) {
      try {
        await chargeVerificationUse({
          orgId: job.org_id ?? "",
          userId: job.user_id,
          candidateId: job.candidate_id ?? "",
          reportId: run.reportId,
          engineVersion: run.engineVersion,
          costPaise: run.costPaise,
        });
      } catch (err) {
        console.error("[vetta-verification-meter]", err);
      }
    }
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
 *
 * Two drains, in this order, and the order is the whole point. The free slice
 * first: it is what `/api/queue/tick` also serves, it spends nothing, and a
 * recruiter watching a slate wants its rows filled before anything else. The
 * paid slice second and slower — the byte arms read and parse whole files, so
 * concurrency costs the rank loop far more than it buys here. The paid slice
 * belongs to this worker and nowhere else: a request that arrives from outside
 * can only ever claim the free ladder, so the trial is spent by a process the
 * workspace owns, never by whoever can reach a route.
 */
export function ensureVerificationWorker() {
  if (g.__vettaVerificationTimer__) return;
  const loop = () => {
    void processVerificationSlice({ maxJobs: 8, concurrency: 4, budgetMs: 20_000 })
      .then(() =>
        processVerificationSlice({
          planTier: PLAN_TIER_PAID,
          maxJobs: 4,
          concurrency: 2,
          budgetMs: 20_000,
        }),
      )
      .finally(() => {
        g.__vettaVerificationTimer__ = setTimeout(loop, 900);
      });
  };
  g.__vettaVerificationTimer__ = setTimeout(loop, 300);
}
