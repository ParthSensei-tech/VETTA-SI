import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/platform/auth/middleware";
import { getSql } from "@/platform/db";
import { iso } from "@/shared/utils";
import type { IngestBatch, IngestBatchStatus, IngestJob, IngestJobStatus } from "../../recruiting/domain/types";

const MAX_ITEMS_PER_APPEND = 25;
const MAX_JOBS_PER_BATCH = 200;
const MAX_BASE64 = 8_000_000;

function newId(): string {
  return crypto.randomUUID();
}

type BatchRow = {
  id: string;
  user_id: string;
  role_id: string;
  source_name: string;
  status: string;
  total_count: number | string;
  parsed_count: number | string;
  ranked_count: number | string;
  failed_count: number | string;
  error_summary: string;
  started_at: unknown;
  completed_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  role_title?: string;
  company_name?: string;
};

type JobListRow = {
  id: string;
  filename: string;
  status: string;
  error: string;
  application_id: string | null;
  updated_at: unknown;
  rank_score: number | null;
};

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapBatch(row: BatchRow, jobs?: IngestJob[]): IngestBatch {
  return {
    id: row.id,
    roleId: row.role_id,
    roleTitle: row.role_title ?? "",
    companyName: row.company_name ?? "",
    sourceName: row.source_name,
    status: row.status as IngestBatchStatus,
    totalCount: asNumber(row.total_count),
    parsedCount: asNumber(row.parsed_count),
    rankedCount: asNumber(row.ranked_count),
    failedCount: asNumber(row.failed_count),
    errorSummary: row.error_summary,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: row.started_at ? iso(row.started_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    jobs,
  };
}

async function loadOwnedBatch(userId: string, batchId: string): Promise<BatchRow> {
  const sql = await getSql();
  const { ensureUserOrg } = await import("../../people/server/org.server");
  const org = await ensureUserOrg(userId);
  const rows = await sql<BatchRow>`
    select b.*, r.title as role_title, r.company_name
    from ingest_batches b
    join roles r on r.id = b.role_id
    where b.id = ${batchId} and (b.org_id = ${org.orgId} or (b.org_id is null and b.user_id = ${userId}))
    limit 1`;
  const row = rows[0];
  if (!row) throw new Error("Batch not found");
  return row;
}

async function loadJobs(userId: string, batchId: string): Promise<IngestJob[]> {
  const sql = await getSql();
  const { ensureUserOrg } = await import("../../people/server/org.server");
  const org = await ensureUserOrg(userId);
  const rows = await sql<JobListRow>`
    select j.id, j.filename, j.status, j.error, j.application_id, j.updated_at, a.rank_score
    from ingest_jobs j
    left join applications a on a.id = j.application_id
    where j.batch_id = ${batchId} and (j.org_id = ${org.orgId} or (j.org_id is null and j.user_id = ${userId}))
    order by j.created_at
    limit 60`;
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    status: row.status as IngestJobStatus,
    error: row.error,
    applicationId: row.application_id,
    rankScore: row.rank_score,
    updatedAt: iso(row.updated_at),
  }));
}

export const createIngestBatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        sourceName: z.string().trim().max(180).default(""),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<IngestBatch> => {
    const sql = await getSql();
    const { ensureUserOrg } = await import("../../people/server/org.server");
    const org = await ensureUserOrg(context.userId);
    const roles = await sql<{ id: string }>`
      select id from roles where id = ${data.roleId} and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId})) limit 1`;
    if (!roles[0]) throw new Error("Role not found");
    const id = newId();
    await sql`
      insert into ingest_batches (id, user_id, role_id, source_name, status, org_id)
      values (${id}, ${context.userId}, ${data.roleId}, ${data.sourceName}, 'queued', ${org.orgId})`;
    const { ensureQueueWorker } = await import("../../pipeline/server/queue.server");
    ensureQueueWorker();
    return mapBatch(await loadOwnedBatch(context.userId, id));
  });

export const appendIngestItems = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        batchId: z.string().min(1),
        items: z
          .array(
            z.object({
              filename: z.string().trim().min(1).max(240),
              contentBase64: z.string().max(MAX_BASE64).optional(),
              resumeText: z.string().max(40000).optional(),
            }),
          )
          .min(1)
          .max(MAX_ITEMS_PER_APPEND),
      })
      .parse(input),
  )
  .handler(
    async ({ context, data }): Promise<{ added: number; failed: number; errors: string[] }> => {
      const { decodeBase64, parseUploadToResumes } = await import("../server/parse.server");
      const { ensureQueueWorker, processQueueSlice, refreshBatchStats } =
        await import("../../pipeline/server/queue.server");
      const batch = await loadOwnedBatch(context.userId, data.batchId);
      if (
        batch.status === "cancelled" ||
        batch.status === "completed" ||
        batch.status === "failed"
      ) {
        throw new Error("This batch is already closed");
      }
      const sql = await getSql();
      const existing = await sql<{ n: number | string }>`
      select count(*) as n from ingest_jobs where batch_id = ${data.batchId}`;
      let used = asNumber(existing[0]?.n);
      const errors: string[] = [];
      let added = 0;
      let failed = 0;

      for (const item of data.items) {
        if (used >= MAX_JOBS_PER_BATCH) {
          errors.push("Batch is full (200 resumes). Start another drop for the rest.");
          break;
        }
        try {
          let resumes: Array<{ filename: string; resumeText: string }> = [];
          if (item.resumeText && item.resumeText.trim().length >= 40) {
            resumes = [{ filename: item.filename, resumeText: item.resumeText.trim() }];
          } else if (item.contentBase64) {
            const bytes = decodeBase64(item.contentBase64);
            resumes = await parseUploadToResumes(item.filename, bytes);
          } else {
            throw new Error("Missing file contents");
          }
          if (resumes.length === 0) throw new Error(`No resumes found in ${item.filename}`);
          const room = MAX_JOBS_PER_BATCH - used;
          const slice = resumes.slice(0, room);
          for (const resume of slice) {
            const id = newId();
            await sql`
            insert into ingest_jobs (
              id, user_id, batch_id, role_id, filename, resume_text, status
            ) values (
              ${id}, ${context.userId}, ${data.batchId}, ${batch.role_id}, ${resume.filename},
              ${resume.resumeText}, 'queued'
            )`;
            added += 1;
            used += 1;
          }
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : `Could not parse ${item.filename}`;
          errors.push(message);
          const id = newId();
          await sql`
          insert into ingest_jobs (
            id, user_id, batch_id, role_id, filename, resume_text, status, error
          ) values (
            ${id}, ${context.userId}, ${data.batchId}, ${batch.role_id}, ${item.filename},
            '', 'failed', ${message}
          )`;
          used += 1;
        }
      }

      await refreshBatchStats(data.batchId);
      ensureQueueWorker();
      void processQueueSlice({ userId: context.userId, maxJobs: 1, budgetMs: 8_000 });
      return { added, failed, errors: errors.slice(0, 8) };
    },
  );

export const listIngestBatches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ roleId: z.string().min(1).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<IngestBatch[]> => {
    const { ensureQueueWorker } = await import("../../pipeline/server/queue.server");
    ensureQueueWorker();
    const sql = await getSql();
    const { ensureUserOrg } = await import("../../people/server/org.server");
    const org = await ensureUserOrg(context.userId);
    const rows = data.roleId
      ? await sql<BatchRow>`
          select b.*, r.title as role_title, r.company_name
          from ingest_batches b
          join roles r on r.id = b.role_id
          where (b.org_id = ${org.orgId} or (b.org_id is null and b.user_id = ${context.userId})) and b.role_id = ${data.roleId}
          order by b.created_at desc
          limit 20`
      : await sql<BatchRow>`
          select b.*, r.title as role_title, r.company_name
          from ingest_batches b
          join roles r on r.id = b.role_id
          where (b.org_id = ${org.orgId} or (b.org_id is null and b.user_id = ${context.userId}))
          order by b.created_at desc
          limit 20`;
    return rows.map((row) => mapBatch(row));
  });

export const getIngestBatch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ batchId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<IngestBatch> => {
    const { ensureQueueWorker } = await import("../../pipeline/server/queue.server");
    ensureQueueWorker();
    const row = await loadOwnedBatch(context.userId, data.batchId);
    const jobs = await loadJobs(context.userId, data.batchId);
    return mapBatch(row, jobs);
  });

export const cancelIngestBatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ batchId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<IngestBatch> => {
    const { refreshBatchStats } = await import("../../pipeline/server/queue.server");
    const { ensureUserOrg } = await import("../../people/server/org.server");
    const org = await ensureUserOrg(context.userId);
    const sql = await getSql();
    await loadOwnedBatch(context.userId, data.batchId);
    await sql`
      update ingest_jobs
      set status = 'failed', error = 'Cancelled', updated_at = now()
      where batch_id = ${data.batchId} and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId})) and status = 'queued'`;
    await sql`
      update ingest_batches
      set status = 'cancelled', completed_at = coalesce(completed_at, now()), updated_at = now()
      where id = ${data.batchId} and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId}))`;
    await refreshBatchStats(data.batchId);
    return mapBatch(
      await loadOwnedBatch(context.userId, data.batchId),
      await loadJobs(context.userId, data.batchId),
    );
  });

export const tickMyQueue = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureQueueWorker, processQueueSlice } = await import("../../pipeline/server/queue.server");
    ensureQueueWorker();
    return processQueueSlice({ userId: context.userId, maxJobs: 2, budgetMs: 25_000 });
  });
