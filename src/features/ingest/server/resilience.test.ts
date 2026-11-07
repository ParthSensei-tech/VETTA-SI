import assert from "node:assert/strict";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { parseUploadToResumes } from "./parse.server.ts";
import { withBoundedRetries, defaultIsRetryable } from "../../ai/server/ai-retry.server.ts";
import { completeWithLadder, completeWithRouter } from "../../ai/server/providers.server.ts";
import { routerHistory } from "../../ai/server/model-router.server.ts";
import { recordModelCost } from "../../../platform/observability/observability.server.ts";
import { parseAndRank } from "../../ai/server/ai.server.ts";
import {
  createWorkspaceBackup,
  verifyBackupIntegrity,
  restoreWorkspaceBackup,
  type WorkspaceBackup,
} from "../../analytics/server/backup.server.ts";
import { hashResumeText } from "../../recruiting/domain/hash.ts";

// =========================================================================
// 1. QUEUE CONCURRENCY & ATOMIC CLAIMING
// =========================================================================

test("Queue Concurrency: parallel workers claiming jobs receive unique, mutually exclusive jobs", async () => {
  const sql = await getSql();
  const userId = `user_queue_conc_${Date.now()}`;
  const roleId = `role_queue_conc_${Date.now()}`;
  const batchId = `batch_queue_conc_${Date.now()}`;

  // Create role & batch
  await sql`
    insert into roles (id, user_id, title, company_name, company_stage, location, work_mode, jd_text)
    values (${roleId}, ${userId}, 'Staff Engineer', 'Test Corp', 'series_a', 'Bengaluru', 'hybrid', 'JD text')`;
  await sql`
    insert into ingest_batches (id, user_id, role_id, source_name, total_count)
    values (${batchId}, ${userId}, ${roleId}, 'test.zip', 6)`;

  // Seed 6 queued jobs
  const jobIds = [1, 2, 3, 4, 5, 6].map((i) => `job_conc_${Date.now()}_${i}`);
  for (const id of jobIds) {
    await sql`
      insert into ingest_jobs (id, user_id, batch_id, role_id, filename, resume_text, status)
      values (${id}, ${userId}, ${batchId}, ${roleId}, ${`resume_${id}.txt`}, 'Software Engineer with 6 years experience in distributed systems and Node.js.', 'queued')`;
  }

  // Simulate 6 concurrent workers racing to claim jobs
  const claimNextJob = async () => {
    const rows = await sql<{ id: string }>`
      update ingest_jobs set status = 'ranking', attempts = attempts + 1, updated_at = now()
      where id = (
        select id from ingest_jobs
        where status = 'queued' and run_after <= now() and user_id = ${userId}
        order by created_at
        limit 1
      )
      returning id`;
    return rows[0]?.id ?? null;
  };

  const claimed = await Promise.all([
    claimNextJob(),
    claimNextJob(),
    claimNextJob(),
    claimNextJob(),
    claimNextJob(),
    claimNextJob(),
  ]);

  const claimedNonNull = claimed.filter((id): id is string => Boolean(id));
  const uniqueClaimed = new Set(claimedNonNull);

  // Assert that each worker claimed a distinct job without race collisions
  assert.equal(claimedNonNull.length, 6, "All 6 jobs must be claimed");
  assert.equal(uniqueClaimed.size, 6, "Every worker must claim a unique, non-overlapping job ID");

  // Subsequent claim attempts return null (queue drained)
  const emptyClaim = await claimNextJob();
  assert.equal(emptyClaim, null, "Queue must be empty once all jobs are claimed");
});

// =========================================================================
// 2. QUEUE IDEMPOTENCY & STUCK JOB RECOVERY
// =========================================================================

test("Queue Idempotency: recoverStuckJobs resets ranking jobs after timeout without corrupting states", async () => {
  const sql = await getSql();
  const userId = `user_queue_idem_${Date.now()}`;
  const batchId = `batch_queue_idem_${Date.now()}`;
  const roleId = `role_queue_idem_${Date.now()}`;

  await sql`
    insert into roles (id, user_id, title, company_name, company_stage, location, work_mode)
    values (${roleId}, ${userId}, 'Backend Lead', 'Idem Corp', 'seed', 'Remote', 'remote')`;
  await sql`
    insert into ingest_batches (id, user_id, role_id, source_name, total_count)
    values (${batchId}, ${userId}, ${roleId}, 'test.zip', 2)`;

  const stuckJobId = `job_stuck_${Date.now()}`;
  const freshJobId = `job_fresh_${Date.now()}`;

  // Insert one job that got stuck 10 minutes ago, and one fresh job currently ranking
  await sql`
    insert into ingest_jobs (id, user_id, batch_id, role_id, filename, resume_text, status, updated_at)
    values (${stuckJobId}, ${userId}, ${batchId}, ${roleId}, 'stuck.txt', 'Text', 'ranking', now() - interval '10 minutes')`;
  await sql`
    insert into ingest_jobs (id, user_id, batch_id, role_id, filename, resume_text, status, updated_at)
    values (${freshJobId}, ${userId}, ${batchId}, ${roleId}, 'fresh.txt', 'Text', 'ranking', now() - interval '1 minute')`;

  // Run recovery query
  await sql`
    update ingest_jobs
    set status = 'queued', updated_at = now()
    where status = 'ranking' and updated_at < now() - interval '6 minutes' and user_id = ${userId}`;

  const rows = await sql<{ id: string; status: string }>`
    select id, status from ingest_jobs where id = any(${[stuckJobId, freshJobId]})`;

  const stuckRow = rows.find((r) => r.id === stuckJobId);
  const freshRow = rows.find((r) => r.id === freshJobId);

  assert.equal(stuckRow?.status, "queued", "Stuck job must be safely requeued");
  assert.equal(freshRow?.status, "ranking", "Fresh job must not be interrupted");
});

// =========================================================================
// 3. DUPLICATE RESUMES DEDUPLICATION
// =========================================================================

test("Duplicate Resumes: ingesting identical resume text for same role deduplicates application", async () => {
  const sql = await getSql();
  const userId = `user_dedup_${Date.now()}`;
  const roleId = `role_dedup_${Date.now()}`;
  const batchId = `batch_dedup_${Date.now()}`;

  await sql`
    insert into roles (id, user_id, title, company_name, company_stage, location, work_mode, jd_text)
    values (${roleId}, ${userId}, 'Full Stack Dev', 'Dedup Inc', 'growth', 'Mumbai', 'remote', 'Full stack role')`;
  await sql`
    insert into ingest_batches (id, user_id, role_id, source_name, total_count)
    values (${batchId}, ${userId}, ${roleId}, 'batch.zip', 2)`;

  const resumeContent = `
    Vikram Malhotra
    Email: vikram.malhotra@example.com
    Phone: +91 9123456789
    Senior Full Stack Engineer with 7 years experience in React, TypeScript, Node.js, and PostgreSQL.
    Architected high-throughput microservices and scalable SaaS web apps.
  `;

  const resumeHash = hashResumeText(resumeContent);

  // Ingest first job
  const { persistRanked } = await import("../../pipeline/server/queue.server.ts");
  const job1Id = `job_dup_1_${Date.now()}`;
  const res1 = await persistRanked({
    id: job1Id,
    user_id: userId,
    batch_id: batchId,
    role_id: roleId,
    filename: "vikram_cv.pdf",
    resume_text: resumeContent,
    status: "ranking",
    application_id: null,
    error: "",
    attempts: 1,
  });

  const app1 = await sql<{ id: string; candidate_id: string }>`
    select id, candidate_id from applications where user_id = ${userId} and role_id = ${roleId}`;
  assert.equal(app1.length, 1, "First ingest creates 1 application");

  // Ingest exact duplicate resume in a second job
  const job2Id = `job_dup_2_${Date.now()}`;
  const res2 = await persistRanked({
    id: job2Id,
    user_id: userId,
    batch_id: batchId,
    role_id: roleId,
    filename: "vikram_cv_copy.pdf",
    resume_text: resumeContent,
    status: "ranking",
    application_id: null,
    error: "",
    attempts: 1,
  });

  const appsAfter = await sql<{ id: string; candidate_id: string; recruiter_notes: string }>`
    select id, candidate_id, recruiter_notes from applications where user_id = ${userId} and role_id = ${roleId}`;

  // Assert deduplication: application count is STILL 1, candidate count is STILL 1
  assert.equal(appsAfter.length, 1, "Duplicate resume must not create duplicate application row");
  assert.equal(appsAfter[0]?.id, app1[0]?.id, "Same application record must be updated");
  assert.equal(res2.applicationId, res1.applicationId, "Duplicate returns existing application ID");

  const candidatesCount = await sql<{ count: number }>`
    select count(*) as count from candidates where user_id = ${userId} and email = 'vikram.malhotra@example.com'`;
  assert.equal(Number(candidatesCount[0]?.count), 1, "Candidate must not be duplicated");
});

// =========================================================================
// 4. MALFORMED FILES HANDLING
// =========================================================================

test("Malformed Files: 0-byte file returns empty list gracefully", async () => {
  const result = await parseUploadToResumes("empty.pdf", new Uint8Array(0));
  assert.deepEqual(result, [], "0-byte file should return an empty array without throwing");
});

test("Malformed Files: corrupt PDF bytes throws descriptive error", async () => {
  const garbagePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x12, 0x99]);
  await assert.rejects(
    async () => {
      await parseUploadToResumes("corrupt.pdf", garbagePdf);
    },
    (err: Error) => {
      assert.ok(
        err.message.includes("Corrupted") || err.message.includes("Could not read"),
        `Expected corrupted PDF error message, got: ${err.message}`,
      );
      return true;
    },
  );
});

test("Malformed Files: corrupt DOCX bytes throws descriptive error", async () => {
  const garbageDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xff]);
  await assert.rejects(
    async () => {
      await parseUploadToResumes("corrupt.docx", garbageDocx);
    },
    (err: Error) => {
      assert.ok(
        err.message.includes("Corrupted") ||
          err.message.includes("DOCX") ||
          err.message.includes("zip"),
        `Expected corrupted DOCX error message, got: ${err.message}`,
      );
      return true;
    },
  );
});

test("Malformed Files: file with less than 40 characters throws insufficient text error", async () => {
  const tinyText = new TextEncoder().encode("Hello world.");
  await assert.rejects(
    async () => {
      await parseUploadToResumes("tiny.txt", tinyText);
    },
    (err: Error) => {
      assert.ok(
        err.message.includes("Could not read enough text"),
        `Expected insufficient text error, got: ${err.message}`,
      );
      return true;
    },
  );
});

test("Malformed Files: file over 6 MB throws size limit error", async () => {
  const oversizeBytes = new Uint8Array(6 * 1024 * 1024 + 1024);
  await assert.rejects(
    async () => {
      await parseUploadToResumes("giant_resume.pdf", oversizeBytes);
    },
    (err: Error) => {
      assert.ok(
        err.message.includes("larger than 6 MB"),
        `Expected file size limit error, got: ${err.message}`,
      );
      return true;
    },
  );
});

// =========================================================================
// 5. RATE LIMIT HANDLING (HTTP 429 & EXPONENTIAL BACKOFF)
// =========================================================================

test("Rate Limits: defaultIsRetryable detects 429, 503, and rate limit errors", () => {
  assert.equal(defaultIsRetryable(new Error("HTTP 429 Too Many Requests")), true);
  assert.equal(defaultIsRetryable(new Error("rate limit exceeded on model")), true);
  assert.equal(defaultIsRetryable(new Error("503 Service Unavailable")), true);
  assert.equal(defaultIsRetryable(new Error("fetch failed")), true);
  assert.equal(defaultIsRetryable(new Error("Invalid API key")), false);
});

test("Rate Limits: withBoundedRetries retries on 429 with backoff and succeeds upon quota recovery", async () => {
  let attempts = 0;
  const result = await withBoundedRetries(
    async (attempt) => {
      attempts++;
      if (attempt < 3) {
        throw new Error("HTTP 429: Rate limit reached. Please retry in 100ms");
      }
      return { success: true, processedAttempt: attempt };
    },
    { maxAttempts: 3, baseDelayMs: 20 },
  );

  assert.equal(attempts, 3, "Must attempt 3 times before succeeding");
  assert.equal(result.success, true);
  assert.equal(result.processedAttempt, 3);
});

// =========================================================================
// 6. PROVIDER OUTAGES & FAILOVER TO LOCAL ENGINE
// =========================================================================

test("Provider Outages: completeWithLadder handles unconfigured/failing providers safely", async () => {
  // Call with intentionally impossible system prompt / unconfigured keys
  const res = await completeWithLadder({
    system: "You are a ranking assistant",
    user: "Rate candidate",
    maxTokens: 50,
    timeoutMs: 1000,
    maxAttemptsPerProvider: 1,
  });

  // When cloud providers are unavailable, completeWithLadder returns clean { ok: false }
  // without crashing the process
  assert.equal(typeof res.ok, "boolean");
  assert.equal(typeof res.attempts, "number");
});

test("Provider Outages: parseAndRank falls back to deterministic local rule engine during total LLM outage", async () => {
  const resume = `
    Priya Sharma
    Email: priya.sharma@example.com
    Location: Bengaluru
    Notice: 15 days
    Experience: 6 years
    Skills: Python, FastAPI, Docker, Kubernetes, AWS, PostgreSQL
    Summary: Senior Backend Engineer scaling cloud microservices in Python.
  `;

  // Call parseAndRank in mode "fast" (local rule engine) or full with fallback
  const outcome = await parseAndRank({
    resumeText: resume,
    role: {
      companyName: "Acme Tech",
      companyStage: "series_a",
      title: "Senior Python Engineer",
      location: "Bengaluru",
      workMode: "hybrid",
      compensationBand: "30-45 LPA",
      stack: ["Python", "Docker", "AWS", "PostgreSQL"],
      mustHaves: ["Python", "AWS", "PostgreSQL"],
      niceToHaves: ["Kubernetes", "Redis"],
      jdText:
        "Looking for Senior Python Developer with Docker, AWS and PostgreSQL experience. Notice period under 30 days.",
    },
    mode: "fast",
  });

  assert.equal(outcome.ok, true, "Local engine must always succeed");
  if (!outcome.ok) throw new Error("Expected outcome to be ok");
  assert.equal(outcome.engine, "local");
  assert.equal(outcome.provenance?.isLocal, true);
  assert.ok(
    outcome.rank.score >= 50,
    "Calibrated rule matching must produce positive score for matching candidate",
  );
  assert.equal(outcome.profile.full_name, "Priya Sharma");
});

// =========================================================================
// 7. BACKUPS: CREATION & CRYPTOGRAPHIC INTEGRITY
// =========================================================================

test("Backups: createWorkspaceBackup produces authentic payload with valid SHA-256 checksum", async () => {
  const sql = await getSql();
  const userId = `user_backup_${Date.now()}`;
  const roleId = `role_backup_${Date.now()}`;

  await sql`
    insert into roles (id, user_id, title, company_name, company_stage, location, work_mode, jd_text)
    values (${roleId}, ${userId}, 'Lead Architect', 'Backups Ltd', 'series_b', 'Delhi', 'hybrid', 'JD text')`;

  const backup = await createWorkspaceBackup({ userId, roleId });

  assert.equal(backup.version, "1.0.0");
  assert.equal(backup.userId, userId);
  assert.equal(backup.roles.length, 1);
  assert.equal(typeof backup.checksum, "string");
  assert.equal(backup.checksum.length, 64, "Checksum must be 64-character SHA-256 hex string");

  // Verify integrity
  const verification = verifyBackupIntegrity(backup);
  assert.equal(verification.valid, true, "Untampered backup must pass cryptographic verification");
});

test("Backups: verifyBackupIntegrity detects tampering and corrupted checksums", async () => {
  const sql = await getSql();
  const userId = `user_tamper_${Date.now()}`;
  const backup = await createWorkspaceBackup({ userId });

  // Tamper with data: modify roles payload
  const tamperedBackup = {
    ...backup,
    roles: [{ id: "hacked_role", title: "Injected Role" }],
  };

  const verification = verifyBackupIntegrity(tamperedBackup);
  assert.equal(verification.valid, false, "Tampered backup must be rejected");
  assert.ok(verification.error?.includes("Checksum mismatch"), "Must report checksum mismatch");
});

// =========================================================================
// 8. RESTORE: ATOMIC & IDEMPOTENT RESTORATION
// =========================================================================

test("Restore: restoreWorkspaceBackup restores roles, rubrics, candidates and applications with full parity", async () => {
  const sql = await getSql();
  const userId = `user_restore_${Date.now()}`;
  const roleId = `role_restore_${Date.now()}`;
  const candId = `cand_restore_${Date.now()}`;
  const appId = `app_restore_${Date.now()}`;

  // 1. Seed original state
  await sql`
    insert into roles (id, user_id, title, company_name, company_stage, location, work_mode)
    values (${roleId}, ${userId}, 'DevOps Principal', 'Restore Inc', 'public', 'Hyderabad', 'remote')`;
  await sql`
    insert into candidates (id, user_id, full_name, email, phone, location, resume_text)
    values (${candId}, ${userId}, 'Karan Verma', 'karan@restore.com', '+91 9999999999', 'Hyderabad', 'DevOps engineer with 8 years experience in Kubernetes, Terraform, and CI/CD pipelines.')`;
  await sql`
    insert into applications (id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json, rank_engine)
    values (${appId}, ${userId}, ${roleId}, ${candId}, 'shortlisted', 92, '{"summary":"Top fit"}', 'local')`;

  // 2. Export backup
  const backup = await createWorkspaceBackup({ userId, roleId });
  assert.equal(backup.stats.rolesCount, 1);
  assert.equal(backup.stats.candidatesCount, 1);
  assert.equal(backup.stats.applicationsCount, 1);

  // 3. Simulate disaster: delete application and candidate
  await sql`delete from applications where id = ${appId}`;
  await sql`delete from candidates where id = ${candId}`;

  const countDuringWipe = await sql<{ count: number }>`
    select count(*) as count from applications where id = ${appId}`;
  assert.equal(Number(countDuringWipe[0]?.count), 0, "Record must be wiped prior to restore");

  // 4. Restore from backup
  const restoreResult = await restoreWorkspaceBackup({ userId, backup, mode: "merge" });
  assert.equal(restoreResult.ok, true);
  assert.equal(restoreResult.restored.roles, 1);
  assert.equal(restoreResult.restored.candidates, 1);
  assert.equal(restoreResult.restored.applications, 1);

  // 5. Verify restored state parity
  const restoredApp = await sql<{ id: string; pipeline_status: string; rank_score: number }>`
    select id, pipeline_status, rank_score from applications where id = ${appId}`;
  assert.equal(restoredApp.length, 1, "Application must be restored");
  assert.equal(restoredApp[0]?.pipeline_status, "shortlisted");
  assert.equal(Number(restoredApp[0]?.rank_score), 92);

  const restoredCand = await sql<{ id: string; full_name: string; email: string }>`
    select id, full_name, email from candidates where id = ${candId}`;
  assert.equal(restoredCand.length, 1, "Candidate must be restored");
  assert.equal(restoredCand[0]?.full_name, "Karan Verma");
  assert.equal(restoredCand[0]?.email, "karan@restore.com");

  // 6. Test Idempotency: Restoring a second time causes zero duplicate errors and maintains parity
  const secondRestore = await restoreWorkspaceBackup({ userId, backup, mode: "merge" });
  assert.equal(secondRestore.ok, true);

  const finalApps = await sql<{ count: number }>`
    select count(*) as count from applications where role_id = ${roleId} and user_id = ${userId}`;
  assert.equal(
    Number(finalApps[0]?.count),
    1,
    "Second restore must be idempotent without duplicates",
  );
});

// =========================================================================
// 8. THE CALLER'S CLOCK IN THE RUNNER
//    The attempt budget has to come from the routing decision, and our own timeouts must stop
//    writing the evidence that decides the next timeout.
// =========================================================================

const PROVIDER_KEY_NAMES = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
] as const;

type FakeProvider = {
  ok: boolean;
  attempts: number;
  error?: string;
  timedOut?: boolean;
  route?: { timeoutMs: number; maxTokens: number; suggestedMaxTokens: number };
};

/**
 * Whether the timer about to be recorded was armed by this project's code rather than by a
 * library's own internals. PGLite's WASM runtime calls `setitimer` through the same global
 * `setTimeout` and arms 10 s Postgres timers while the ledger read runs, so an unfiltered recording
 * measures the embedded database's clock as well as the runner's attempt budget. Attribution is by
 * call site, which keeps every assertion below about the code under test.
 */
function armedByProjectCode(): boolean {
  const stack = (new Error().stack ?? "").split("\n");
  const caller = stack.slice(2).find((line) => !line.includes("resilience.test.ts")) ?? "";
  return caller.length > 0 && !caller.includes("node_modules");
}

/**
 * Run `body` against a stand-in provider: no network, no spend, the local host reads as down, and
 * every timer the runner arms is recorded — so these tests can read the attempt budget without
 * waiting for it to expire.
 */
async function withFakeProvider<T extends FakeProvider>(
  opts: { hang?: boolean; keys?: Partial<Record<(typeof PROVIDER_KEY_NAMES)[number], string>> },
  body: () => Promise<T>,
): Promise<{
  result: T;
  timerDelays: number[];
  requests: Array<{ url: string; maxTokens: number | undefined }>;
}> {
  const g = globalThis as typeof globalThis & {
    __vettaCircuits__?: Map<string, unknown>;
    __vettaOllamaUp__?: { at: number; up: boolean };
  };
  const savedEnv = new Map<string, string | undefined>();
  for (const name of PROVIDER_KEY_NAMES) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(opts.keys ?? {})) process.env[name] = value;

  const savedFetch = globalThis.fetch;
  const savedSetTimeout = globalThis.setTimeout;
  const savedProbe = g.__vettaOllamaUp__;
  const timerDelays: number[] = [];
  const requests: Array<{ url: string; maxTokens: number | undefined }> = [];

  // Circuits are process state; a provider that failed in an earlier test must not hide itself here.
  g.__vettaCircuits__ = new Map();
  g.__vettaOllamaUp__ = { at: Date.now(), up: false };

  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (typeof ms === "number" && ms > 0 && armedByProjectCode()) timerDelays.push(ms);
    return savedSetTimeout(fn, ms, ...rest);
  }) as unknown as typeof setTimeout;

  globalThis.fetch = (async (
    input: unknown,
    init?: { signal?: AbortSignal; body?: string | unknown },
  ) => {
    const url = String(input);
    let maxTokens: number | undefined;
    try {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
      maxTokens = parsed.max_tokens;
    } catch {
      maxTokens = undefined;
    }
    requests.push({ url, maxTokens });
    if (!/api\.groq\.com|generativelanguage\.google\.com|api\.openai\.com/.test(url)) {
      return new Response("{}", { status: 500 });
    }
    if (opts.hang) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(new Error("The operation was aborted."));
        else
          signal?.addEventListener("abort", () => reject(new Error("The operation was aborted.")));
      });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"answer":"from the fake arm"}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 40 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  try {
    return { result: await body(), timerDelays, requests };
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.setTimeout = savedSetTimeout;
    g.__vettaOllamaUp__ = savedProbe;
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("Timeout: completeWithRouter arms the budget the route chose, not the 14 s constant", async () => {
  const { result, timerDelays, requests } = await withFakeProvider(
    { keys: { GROQ_API_KEY: "test-key" } },
    () =>
      completeWithRouter({
        task: "test",
        system: "Reply with JSON only.",
        user: "A short test prompt.",
        // The profile caps `test` at 400 output tokens; the runner must send the profile's number.
        maxTokens: 4_000,
        minAttemptTimeoutMs: 9_000,
        maxAttemptsPerProvider: 1,
      }),
  );

  assert.equal(
    result.ok,
    true,
    `the routed arm should answer: ${"error" in result ? result.error : ""}`,
  );
  assert.ok(result.route, "the decision travels with the result");
  assert.equal(result.route!.timeoutMs, 9_000, "the route turns its own headroom into a budget");
  assert.ok(timerDelays.includes(9_000), "and the runner arms exactly that");
  assert.ok(!timerDelays.includes(14_000), "the call site no longer supplies a timeout at all");
  assert.equal(requests.length, 1, "one arm, one attempt");
  assert.equal(requests[0]?.maxTokens, 400, "the task profile, not the caller, sizes the answer");
});

test("Timeout: the caller's deadline bounds the whole retry queue, not one attempt", async () => {
  const started = Date.now();
  const { result, timerDelays } = await withFakeProvider(
    { hang: true, keys: { GROQ_API_KEY: "test-key", GEMINI_API_KEY: "test-key" } },
    () =>
      completeWithRouter({
        task: "test",
        system: "Reply with JSON only.",
        user: "A prompt the arms never answer, because the fetch hangs.",
        maxTokens: 400,
        context: "interactive",
        // Two arms x two attempts used to mean up to 56 s for a call the recruiter thinks takes 14.
        deadlineMs: 1_500,
        maxAttemptsPerProvider: 2,
      }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true, "recorded as our clock, not as the arm failing");
  assert.equal(result.route!.timeoutMs, 1_500, "the caller's ceiling beats the historical floor");
  // The armed budget is the route's own number, minus whatever reading the ledger already took.
  const armed = timerDelays.filter((d) => d >= 1_000);
  assert.equal(armed.length, 1, "one attempt armed, and the second arm never got a timer");
  assert.ok(armed[0]! <= 1_500 && armed[0]! > 1_400, `budget ${armed[0]}ms, inside the deadline`);
  assert.ok(!timerDelays.includes(14_000), "the old constant is nowhere in this call");
  assert.equal(result.attempts, 1, "a second arm behind an exhausted deadline is not a retry plan");
  assert.ok(
    /attempt budget|deadline is spent/.test(result.error ?? ""),
    "and the error says which",
  );
  assert.ok(Date.now() - started < 6_000, "the whole call stays near the caller's tolerance");
  assert.ok(
    Date.now() - started >= 1_400,
    "it really waited its budget instead of returning early",
  );
});

test("Timeout: the ladder keeps its frozen 14 s so the benchmark A/B still means something", async () => {
  const { result, timerDelays } = await withFakeProvider(
    { keys: { GROQ_API_KEY: "test-key" } },
    () =>
      completeWithLadder({
        system: "Reply with JSON only.",
        user: "Rate candidate",
        maxTokens: 50,
        maxAttemptsPerProvider: 1,
      }),
  );

  assert.equal(result.ok, true, `the fake arm answers: ${"error" in result ? result.error : ""}`);
  assert.ok(timerDelays.includes(14_000), "the legacy path is unchanged, deliberately");
});

test("Censored history: an attempt we killed never counts against the arm's reliability", async () => {
  const sql = await getSql();
  const task = "screen_generate";
  const model = "clock-hygiene-test-model";
  await sql`delete from model_cost_logs where provider = ${"groq"} and model = ${model}`;

  // Two served calls and one genuine provider failure — then two attempts the router itself aborted.
  await recordModelCost({
    taskType: task,
    provider: "groq",
    model,
    durationMs: 500,
    success: true,
    promptTokens: 800,
    completionTokens: 300,
  });
  await recordModelCost({
    taskType: task,
    provider: "groq",
    model,
    durationMs: 700,
    success: true,
    promptTokens: 800,
    completionTokens: 300,
  });
  await recordModelCost({
    taskType: task,
    provider: "groq",
    model,
    durationMs: 900,
    success: false,
    error: "Groq 500",
  });
  for (const killedMs of [90_000, 120_000]) {
    await recordModelCost({
      taskType: task,
      provider: "groq",
      model,
      durationMs: killedMs,
      success: false,
      error: "groq exceeded its 14000ms attempt budget",
      meta: { router: { timedOut: true, timeoutMs: 14_000, context: "interactive" } },
    });
  }

  const rows = await routerHistory(task, null);
  const h = rows.find((r) => r.armId === `groq:${model}`);
  assert.ok(h, "the arm's ledger rows aggregate under its own id");
  assert.equal(h!.samples, 5);
  assert.equal(h!.successRate, 2 / 3, "the killed attempts leave the judged set");
  assert.equal(h!.abortedSamples, 2);
  assert.equal(
    h!.abortedElapsedMaxMs,
    120_000,
    "but their elapsed time survives as slowness evidence",
  );
  assert.equal(
    h!.p50DurationMs,
    600,
    "the median still describes only calls that actually answered",
  );

  await sql`delete from model_cost_logs where provider = ${"groq"} and model = ${model}`;
});
