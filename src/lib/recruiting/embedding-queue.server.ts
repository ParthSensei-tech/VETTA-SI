import { getSql } from "../../platform/db.ts";
import {
  DEFAULT_EMBEDDING_MODEL,
  SUPPORTED_EMBEDDING_MODELS,
  embedTexts,
  getModelInfo,
  toModelDto,
  type EmbeddingModelDto,
  type EmbeddingModelInfo,
} from "../../features/ai/server/embed-text.server.ts";
import { candidateDocument } from "./retrieve.ts";

function newId(): string {
  return crypto.randomUUID();
}

export type EmbeddingJobStatus = "queued" | "processing" | "completed" | "failed";

export type EmbeddingIndexStatus = {
  orgId: string;
  activeModel: EmbeddingModelDto;
  targetModel: EmbeddingModelDto | null;
  reindexStatus: "idle" | "reindexing" | "completed" | "failed";
  reindexStartedAt: string | null;
  reindexCompletedAt: string | null;
  autoSwitch: boolean;
  totalCandidates: number;
  indexedCandidates: number;
  pendingJobs: number;
  processingJobs: number;
  failedJobs: number;
  coveragePercent: number;
  targetCoveragePercent: number;
  isFullyIndexed: boolean;
  recentErrors: Array<{
    candidateId: string;
    model: string;
    error: string;
    attempts: number;
  }>;
  supportedModels: EmbeddingModelDto[];
};

const g = globalThis as typeof globalThis & {
  __vettaEmbeddingTimer__?: ReturnType<typeof setTimeout>;
  __vettaEmbeddingBusy__?: boolean;
};

/**
 * Retrieves the currently active embedding model for an organization.
 */
export async function getActiveEmbeddingModel(orgId?: string | null): Promise<string> {
  if (!orgId) return DEFAULT_EMBEDDING_MODEL;
  const sql = await getSql();
  const rows = await sql<{ active_model: string }>`
    select active_model from embedding_index_configs where org_id = ${orgId} limit 1`;
  return rows[0]?.active_model || DEFAULT_EMBEDDING_MODEL;
}

/**
 * Enqueues a single candidate for embedding.
 * Uses priority 10 for interactive ingestion and priority 0 for bulk backfills.
 */
export async function enqueueCandidateForEmbedding(opts: {
  candidateId: string;
  orgId?: string | null;
  priority?: number;
  model?: string;
}): Promise<string> {
  const sql = await getSql();
  const id = newId();
  const model = opts.model || (await getActiveEmbeddingModel(opts.orgId));
  const priority = opts.priority ?? 10;
  const orgId = opts.orgId ?? null;

  await sql`
    insert into embedding_jobs (
      id, org_id, candidate_id, model, status, priority, attempts, error, created_at, updated_at
    ) values (
      ${id}, ${orgId}, ${opts.candidateId}, ${model}, 'queued', ${priority}, 0, '', now(), now()
    )
    on conflict (candidate_id, model) do update set
      status = case when embedding_jobs.status = 'completed' then 'completed' else 'queued' end,
      priority = greatest(embedding_jobs.priority, excluded.priority),
      updated_at = now()`;

  ensureEmbeddingWorker();
  return id;
}

/**
 * Enqueues multiple candidates in bulk (e.g. workspace backfill or multi-resume drop).
 */
export async function enqueueCandidatesBulk(opts: {
  candidateIds: string[];
  orgId?: string | null;
  priority?: number;
  model?: string;
}): Promise<number> {
  if (opts.candidateIds.length === 0) return 0;
  const sql = await getSql();
  const model = opts.model || (await getActiveEmbeddingModel(opts.orgId));
  const priority = opts.priority ?? 0;
  const orgId = opts.orgId ?? null;

  let count = 0;
  for (const candidateId of opts.candidateIds) {
    const id = newId();
    await sql`
      insert into embedding_jobs (
        id, org_id, candidate_id, model, status, priority, attempts, error, created_at, updated_at
      ) values (
        ${id}, ${orgId}, ${candidateId}, ${model}, 'queued', ${priority}, 0, '', now(), now()
      )
      on conflict (candidate_id, model) do update set
        status = case when embedding_jobs.status = 'completed' then 'completed' else 'queued' end,
        priority = greatest(embedding_jobs.priority, excluded.priority),
        updated_at = now()`;
    count++;
  }

  ensureEmbeddingWorker();
  return count;
}

/**
 * Processes a single slice of queued embedding jobs with concurrency safety and model batching.
 */
export async function processEmbeddingQueueBatch(opts?: {
  batchSize?: number;
  budgetMs?: number;
  orgId?: string;
}): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}> {
  const sql = await getSql();
  const batchSize = Math.min(Math.max(opts?.batchSize ?? 25, 1), 100);
  const orgFilter = opts?.orgId ?? "";

  // 1. Fetch queued jobs
  const queued = await sql<{
    id: string;
    org_id: string | null;
    candidate_id: string;
    model: string;
    priority: number;
    attempts: number;
  }>`
    select id, org_id, candidate_id, model, priority, attempts
    from embedding_jobs
    where status in ('queued', 'failed')
      and attempts < 4
      and (${orgFilter} = '' or org_id = ${orgFilter})
    order by priority desc, created_at asc
    limit ${batchSize}`;

  if (queued.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, remaining: 0 };
  }

  const jobIds = queued.map((j) => j.id);
  const candidateIds = queued.map((j) => j.candidate_id);

  // 2. Mark jobs as processing
  for (const id of jobIds) {
    await sql`
      update embedding_jobs
      set status = 'processing', attempts = attempts + 1, updated_at = now()
      where id = ${id}`;
  }

  // 3. Load candidate details
  const candRows = await sql<{
    id: string;
    full_name: string;
    current_title: string;
    current_company: string;
    location: string;
    resume_text: string;
    org_id: string | null;
  }>`
    select id, full_name, current_title, current_company, location, resume_text, org_id
    from candidates
    where id = any(${candidateIds})`;

  const candidateMap = new Map(candRows.map((c) => [c.id, c]));

  // 4. Group jobs by model for vector extraction efficiency
  const byModel = new Map<string, typeof queued>();
  for (const job of queued) {
    const list = byModel.get(job.model) || [];
    list.push(job);
    byModel.set(job.model, list);
  }

  let succeeded = 0;
  let failed = 0;

  for (const [model, jobs] of byModel.entries()) {
    const validJobs: typeof jobs = [];
    const texts: string[] = [];

    for (const job of jobs) {
      const cand = candidateMap.get(job.candidate_id);
      if (!cand) {
        // Candidate was deleted or not found
        await sql`
          update embedding_jobs
          set status = 'failed', error = 'Candidate not found', updated_at = now()
          where id = ${job.id}`;
        failed++;
        continue;
      }

      const doc = candidateDocument({
        fullName: cand.full_name || "",
        title: cand.current_title || "",
        company: cand.current_company || "",
        location: cand.location || "",
        resumeText: cand.resume_text || "",
      });

      validJobs.push(job);
      texts.push(doc);
    }

    if (texts.length === 0) continue;

    try {
      const vectors = await embedTexts(texts, "passage", model);
      const modelInfo = getModelInfo(model);

      for (let i = 0; i < validJobs.length; i++) {
        const job = validJobs[i]!;
        const vec = vectors[i]!;
        const cand = candidateMap.get(job.candidate_id);
        const orgId = cand?.org_id || job.org_id || null;

        await sql`
          insert into candidate_embeddings (
            candidate_id, model, dim, vector_json, org_id, updated_at
          ) values (
            ${job.candidate_id}, ${model}, ${vec.length || modelInfo.dim},
            ${JSON.stringify(vec)}, ${orgId}, now()
          )
          on conflict (candidate_id, model) do update set
            dim = excluded.dim,
            vector_json = excluded.vector_json,
            org_id = excluded.org_id,
            updated_at = now()`;

        await sql`
          update embedding_jobs
          set status = 'completed', error = '', updated_at = now()
          where id = ${job.id}`;

        succeeded++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      for (const job of validJobs) {
        await sql`
          update embedding_jobs
          set status = 'failed', error = ${errMsg}, updated_at = now()
          where id = ${job.id}`;
        failed++;
      }
    }
  }

  // 5. Check reindex auto-switch for each affected organization
  await checkReindexAutoSwitch();

  const remainingRows = await sql<{ n: number }>`
    select count(*)::int as n
    from embedding_jobs
    where status in ('queued', 'processing')
      and (${orgFilter} = '' or org_id = ${orgFilter})`;

  return {
    processed: queued.length,
    succeeded,
    failed,
    remaining: Number(remainingRows[0]?.n || 0),
  };
}

/**
 * Checks all organizations currently undergoing reindexing to determine
 * if target coverage is 100% complete and auto-switch should occur.
 */
async function checkReindexAutoSwitch() {
  const sql = await getSql();
  const reindexingOrgs = await sql<{
    org_id: string;
    active_model: string;
    target_model: string;
    auto_switch: boolean;
  }>`
    select org_id, active_model, target_model, auto_switch
    from embedding_index_configs
    where reindex_status = 'reindexing' and target_model is not null`;

  for (const config of reindexingOrgs) {
    const pending = await sql<{ n: number }>`
      select count(*)::int as n from embedding_jobs
      where org_id = ${config.org_id}
        and model = ${config.target_model}
        and status in ('queued', 'processing')`;

    if (Number(pending[0]?.n || 0) === 0) {
      // All jobs for target model finished
      if (config.auto_switch) {
        await sql`
          update embedding_index_configs set
            active_model = ${config.target_model},
            target_model = null,
            reindex_status = 'completed',
            reindex_completed_at = now(),
            updated_at = now()
          where org_id = ${config.org_id}`;
      } else {
        await sql`
          update embedding_index_configs set
            reindex_status = 'completed',
            reindex_completed_at = now(),
            updated_at = now()
          where org_id = ${config.org_id}`;
      }
    }
  }
}

/**
 * Background worker pump to execute embedding tasks asynchronously.
 */
export function ensureEmbeddingWorker() {
  if (g.__vettaEmbeddingTimer__) return;

  const tick = async () => {
    if (g.__vettaEmbeddingBusy__) {
      g.__vettaEmbeddingTimer__ = setTimeout(tick, 2000);
      return;
    }
    g.__vettaEmbeddingBusy__ = true;
    try {
      const res = await processEmbeddingQueueBatch({ batchSize: 20 });
      if (res.remaining > 0) {
        g.__vettaEmbeddingTimer__ = setTimeout(tick, 500);
      } else {
        g.__vettaEmbeddingTimer__ = undefined;
      }
    } catch (err) {
      console.error("[embedding-worker-error]", err);
      g.__vettaEmbeddingTimer__ = setTimeout(tick, 5000);
    } finally {
      g.__vettaEmbeddingBusy__ = false;
    }
  };

  g.__vettaEmbeddingTimer__ = setTimeout(tick, 100);
}

/**
 * Returns comprehensive backfill and indexing status for an organization.
 */
export async function getEmbeddingIndexStatus(orgId: string): Promise<EmbeddingIndexStatus> {
  const sql = await getSql();

  // Load config or initialize default
  const configRows = await sql<{
    active_model: string;
    target_model: string | null;
    reindex_status: string;
    reindex_started_at: unknown;
    reindex_completed_at: unknown;
    auto_switch: boolean;
  }>`
    select active_model, target_model, reindex_status, reindex_started_at, reindex_completed_at, auto_switch
    from embedding_index_configs
    where org_id = ${orgId}
    limit 1`;

  const config = configRows[0] || {
    active_model: DEFAULT_EMBEDDING_MODEL,
    target_model: null,
    reindex_status: "idle",
    reindex_started_at: null,
    reindex_completed_at: null,
    auto_switch: true,
  };

  const activeModel = getModelInfo(config.active_model);
  const targetModel = config.target_model ? getModelInfo(config.target_model) : null;

  // Counts
  const totalCands = await sql<{ n: number }>`
    select count(*)::int as n from candidates
    where (org_id = ${orgId} or org_id is null)`;
  const totalCount = Number(totalCands[0]?.n || 0);

  const indexedCands = await sql<{ n: number }>`
    select count(*)::int as n
    from candidate_embeddings e
    join candidates c on c.id = e.candidate_id
    where (c.org_id = ${orgId} or c.org_id is null)
      and e.model = ${activeModel.id}`;
  const indexedCount = Number(indexedCands[0]?.n || 0);

  const jobCounts = await sql<{ status: string; n: number }>`
    select status, count(*)::int as n
    from embedding_jobs
    where (org_id = ${orgId} or org_id is null)
      and model = ${activeModel.id}
    group by status`;

  let pending = 0;
  let processing = 0;
  let failed = 0;

  for (const j of jobCounts) {
    if (j.status === "queued") pending += Number(j.n);
    else if (j.status === "processing") processing += Number(j.n);
    else if (j.status === "failed") failed += Number(j.n);
  }

  let targetIndexed = 0;
  if (targetModel) {
    const targetRows = await sql<{ n: number }>`
      select count(*)::int as n
      from candidate_embeddings e
      join candidates c on c.id = e.candidate_id
      where (c.org_id = ${orgId} or c.org_id is null)
        and e.model = ${targetModel.id}`;
    targetIndexed = Number(targetRows[0]?.n || 0);
  }

  const coveragePercent =
    totalCount > 0 ? Math.min(100, Math.round((indexedCount / totalCount) * 100)) : 100;

  const targetCoveragePercent =
    totalCount > 0 && targetModel
      ? Math.min(100, Math.round((targetIndexed / totalCount) * 100))
      : 0;

  const errorRows = await sql<{
    candidate_id: string;
    model: string;
    error: string;
    attempts: number;
  }>`
    select candidate_id, model, error, attempts
    from embedding_jobs
    where (org_id = ${orgId} or org_id is null)
      and status = 'failed'
    order by updated_at desc
    limit 10`;

  return {
    orgId,
    activeModel: toModelDto(activeModel),
    targetModel: targetModel ? toModelDto(targetModel) : null,
    reindexStatus: config.reindex_status as EmbeddingIndexStatus["reindexStatus"],
    reindexStartedAt: config.reindex_started_at ? String(config.reindex_started_at) : null,
    reindexCompletedAt: config.reindex_completed_at ? String(config.reindex_completed_at) : null,
    autoSwitch: config.auto_switch,
    totalCandidates: totalCount,
    indexedCandidates: indexedCount,
    pendingJobs: pending,
    processingJobs: processing,
    failedJobs: failed,
    coveragePercent,
    targetCoveragePercent,
    isFullyIndexed: totalCount > 0 ? indexedCount >= totalCount && pending === 0 : true,
    recentErrors: errorRows.map((r) => ({
      candidateId: r.candidate_id,
      model: r.model,
      error: r.error,
      attempts: r.attempts,
    })),
    supportedModels: Object.values(SUPPORTED_EMBEDDING_MODELS).map(toModelDto),
  };
}

/**
 * Initiates a model-version-aware reindex for an organization.
 * The active model continues serving search queries while the target model is backfilled.
 */
export async function startModelReindex(opts: {
  orgId: string;
  targetModel: string;
  autoSwitch?: boolean;
}): Promise<{
  reindexStarted: true;
  targetModel: EmbeddingModelDto;
  candidatesQueued: number;
}> {
  const modelInfo = getModelInfo(opts.targetModel);
  const sql = await getSql();

  // Load current active model
  const currentActive = await getActiveEmbeddingModel(opts.orgId);
  const autoSwitch = opts.autoSwitch ?? true;

  await sql`
    insert into embedding_index_configs (
      org_id, active_model, target_model, reindex_status, reindex_started_at,
      reindex_completed_at, auto_switch, updated_at
    ) values (
      ${opts.orgId}, ${currentActive}, ${modelInfo.id}, 'reindexing', now(),
      null, ${autoSwitch}, now()
    )
    on conflict (org_id) do update set
      target_model = excluded.target_model,
      reindex_status = 'reindexing',
      reindex_started_at = now(),
      reindex_completed_at = null,
      auto_switch = excluded.auto_switch,
      updated_at = now()`;

  // Find all candidates in the organization missing embeddings for the target model
  const missingCandidates = await sql<{ id: string }>`
    select c.id
    from candidates c
    left join candidate_embeddings e on e.candidate_id = c.id and e.model = ${modelInfo.id}
    where (c.org_id = ${opts.orgId} or c.org_id is null)
      and e.candidate_id is null`;

  const candIds = missingCandidates.map((c) => c.id);
  const queuedCount = await enqueueCandidatesBulk({
    candidateIds: candIds,
    orgId: opts.orgId,
    priority: 0,
    model: modelInfo.id,
  });

  return {
    reindexStarted: true,
    targetModel: toModelDto(modelInfo),
    candidatesQueued: queuedCount,
  };
}

/**
 * Manually promotes a target model to active model for an organization.
 */
export async function switchActiveEmbeddingModel(opts: {
  orgId: string;
  newActiveModel: string;
}): Promise<{
  activeModel: EmbeddingModelDto;
}> {
  const modelInfo = getModelInfo(opts.newActiveModel);
  const sql = await getSql();

  await sql`
    insert into embedding_index_configs (
      org_id, active_model, target_model, reindex_status, reindex_completed_at, updated_at
    ) values (
      ${opts.orgId}, ${modelInfo.id}, null, 'completed', now(), now()
    )
    on conflict (org_id) do update set
      active_model = excluded.active_model,
      target_model = null,
      reindex_status = 'completed',
      reindex_completed_at = now(),
      updated_at = now()`;

  return { activeModel: toModelDto(modelInfo) };
}

/**
 * Cancels an ongoing reindexing process for an organization.
 */
export async function cancelModelReindex(opts: { orgId: string }): Promise<{ cancelled: true }> {
  const sql = await getSql();
  const config = await sql<{ target_model: string | null }>`
    select target_model from embedding_index_configs where org_id = ${opts.orgId} limit 1`;

  const target = config[0]?.target_model;
  if (target) {
    await sql`
      delete from embedding_jobs
      where org_id = ${opts.orgId} and model = ${target} and status in ('queued', 'processing')`;
  }

  await sql`
    update embedding_index_configs set
      target_model = null,
      reindex_status = 'idle',
      updated_at = now()
    where org_id = ${opts.orgId}`;

  return { cancelled: true };
}

/**
 * Triggers a backfill for the active embedding model on any unindexed candidates in the organization.
 */
export async function triggerEmbeddingBackfill(opts: {
  orgId: string;
}): Promise<{ queued: number; activeModel: string }> {
  const activeModel = await getActiveEmbeddingModel(opts.orgId);
  const sql = await getSql();

  const missing = await sql<{ id: string }>`
    select c.id
    from candidates c
    left join candidate_embeddings e on e.candidate_id = c.id and e.model = ${activeModel}
    where (c.org_id = ${opts.orgId} or c.org_id is null)
      and e.candidate_id is null`;

  const candIds = missing.map((c) => c.id);
  const queued = await enqueueCandidatesBulk({
    candidateIds: candIds,
    orgId: opts.orgId,
    priority: 5,
    model: activeModel,
  });

  return { queued, activeModel };
}
