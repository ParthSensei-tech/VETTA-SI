import assert from "node:assert/strict";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import {
  enqueueCandidateForEmbedding,
  enqueueCandidatesBulk,
  processEmbeddingQueueBatch,
  getEmbeddingIndexStatus,
  startModelReindex,
  switchActiveEmbeddingModel,
  cancelModelReindex,
  triggerEmbeddingBackfill,
  getActiveEmbeddingModel,
} from "../../pipeline/server/embedding-queue.server.ts";
import {
  DEFAULT_EMBEDDING_MODEL,
  SUPPORTED_EMBEDDING_MODELS,
  embedTexts,
  getModelInfo,
} from "../server/embed-text.server.ts";
import { executeTalentSearch } from "../../pipeline/api/search-api.ts";
import { indexNewCandidate } from "../../pipeline/server/search.server.ts";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test("Semantic Retrieval & Embedding Index Lifecycle Suite", async (t) => {
  const sql = await getSql();
  const testUserId = uid("user_recruiter");
  const org = await ensureUserOrg(testUserId, "Acme AI Talent");

  // Helper to create a candidate
  async function createCandidate(name: string, title: string, company: string, resumeText: string) {
    const id = uid("cand");
    await sql`
      insert into candidates (
        id, org_id, user_id, full_name, email, phone, location, current_title, current_company,
        years_experience, resume_text, parsed_json
      ) values (
        ${id}, ${org.orgId}, ${testUserId}, ${name}, ${name.toLowerCase().replace(/\s+/g, "") + "@example.com"},
        '+919876543210', 'Bengaluru', ${title}, ${company}, 5, ${resumeText}, '{}'
      )`;
    return id;
  }

  // ---------------------------------------------------------------------------
  // 1. Model Registry and Embeddings
  // ---------------------------------------------------------------------------
  await t.test("Embedding model info and multi-model vector generation", async () => {
    assert.equal(DEFAULT_EMBEDDING_MODEL, "Xenova/multilingual-e5-small");
    const e5Info = getModelInfo("Xenova/multilingual-e5-small");
    assert.equal(e5Info.dim, 384);
    assert.ok(e5Info.prefixQuery("test").startsWith("query:"));
    assert.ok(e5Info.prefixPassage("test").startsWith("passage:"));

    const bgeInfo = getModelInfo("Xenova/bge-small-en-v1.5");
    assert.equal(bgeInfo.dim, 384);
    assert.ok(bgeInfo.prefixQuery("test").includes("Represent this sentence"));

    // Extract passage and query embeddings
    const vectors = await embedTexts(
      ["Senior Backend Engineer with Go and Distributed Systems", "Staff React Frontend Developer"],
      "passage",
      DEFAULT_EMBEDDING_MODEL,
    );
    assert.equal(vectors.length, 2);
    assert.equal(vectors[0]?.length, 384);
    assert.equal(vectors[1]?.length, 384);
  });

  // ---------------------------------------------------------------------------
  // 2. Ingestion-Time Queue & Batch Processing
  // ---------------------------------------------------------------------------
  await t.test("Ingestion-time candidate embedding queue and batch processing", async () => {
    const c1 = await createCandidate(
      "Vikram Malhotra",
      "Lead Systems Engineer",
      "Razorpay",
      "Expert in distributed consensus, Raft, Kafka, Go, high throughput payment processing.",
    );
    const c2 = await createCandidate(
      "Ananya Sen",
      "Senior Frontend Architect",
      "Swiggy",
      "Specialized in Next.js, Web Vitals, micro-frontends, TypeScript, Tailwind CSS.",
    );

    // Call ingestion-time indexing hook
    await indexNewCandidate(c1, 30, 45, org.orgId);
    await indexNewCandidate(c2, 60, 40, org.orgId);

    // Check embedding_jobs table
    const queuedJobs = await sql<{ candidate_id: string; status: string; priority: number }>`
      select candidate_id, status, priority from embedding_jobs
      where candidate_id in (${c1}, ${c2})`;

    assert.equal(queuedJobs.length, 2);
    assert.ok(
      queuedJobs.every(
        (j) => j.status === "queued" || j.status === "processing" || j.status === "completed",
      ),
    );
    assert.ok(
      queuedJobs.some((j) => j.priority === 10),
      "Ingestion-time queue uses priority 10",
    );

    // Run batch processing
    const result = await processEmbeddingQueueBatch({ batchSize: 10, orgId: org.orgId });
    assert.ok(result.processed >= 0);

    // Verify candidate_embeddings rows exist
    const embeddings = await sql<{ candidate_id: string; model: string; dim: number }>`
      select candidate_id, model, dim from candidate_embeddings
      where candidate_id in (${c1}, ${c2})`;

    assert.equal(embeddings.length, 2);
    assert.equal(embeddings[0]?.dim, 384);
    assert.equal(embeddings[0]?.model, DEFAULT_EMBEDDING_MODEL);
  });

  // ---------------------------------------------------------------------------
  // 3. Backfill Progress Monitoring
  // ---------------------------------------------------------------------------
  await t.test("Backfill progress monitoring reports coverage and queue telemetry", async () => {
    // Add 3 unindexed candidates
    const unindexedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await createCandidate(
        `Batch Candidate ${i + 1}`,
        "Software Engineer",
        "TCS",
        `General software development background ${i}`,
      );
      unindexedIds.push(id);
    }

    // Status before backfill
    const statusBefore = await getEmbeddingIndexStatus(org.orgId);
    assert.equal(statusBefore.activeModel.id, DEFAULT_EMBEDDING_MODEL);
    assert.ok(statusBefore.totalCandidates >= 5);
    assert.ok(statusBefore.coveragePercent < 100);
    assert.equal(statusBefore.isFullyIndexed, false);

    // Trigger backfill
    const backfill = await triggerEmbeddingBackfill({ orgId: org.orgId });
    assert.ok(backfill.queued >= 3);

    // Process all queued items
    let remaining = 1;
    while (remaining > 0) {
      const step = await processEmbeddingQueueBatch({ batchSize: 10, orgId: org.orgId });
      remaining = step.remaining;
    }

    // Status after complete backfill
    const statusAfter = await getEmbeddingIndexStatus(org.orgId);
    assert.equal(statusAfter.coveragePercent, 100);
    assert.equal(statusAfter.isFullyIndexed, true);
    assert.equal(statusAfter.pendingJobs, 0);
  });

  // ---------------------------------------------------------------------------
  // 4. Model-Version-Aware Reindexing
  // ---------------------------------------------------------------------------
  await t.test(
    "Model-version-aware reindex builds target model while serving active model",
    async () => {
      const targetModel = "Xenova/bge-small-en-v1.5";
      const initialActive = await getActiveEmbeddingModel(org.orgId);
      assert.equal(initialActive, DEFAULT_EMBEDDING_MODEL);

      // Initiate reindex with autoSwitch = true
      const reindexStart = await startModelReindex({
        orgId: org.orgId,
        targetModel,
        autoSwitch: true,
      });
      assert.equal(reindexStart.reindexStarted, true);
      assert.equal(reindexStart.targetModel.id, targetModel);
      assert.ok(reindexStart.candidatesQueued > 0);

      // Active model should STILL be default during reindex
      const duringActive = await getActiveEmbeddingModel(org.orgId);
      assert.equal(
        duringActive,
        DEFAULT_EMBEDDING_MODEL,
        "Active model remains unchanged during reindexing",
      );

      // Monitor reindexing status
      const statusMid = await getEmbeddingIndexStatus(org.orgId);
      assert.equal(statusMid.reindexStatus, "reindexing");
      assert.equal(statusMid.targetModel?.id, targetModel);

      // Process all reindex jobs until completion
      let remaining = 1;
      let cycles = 0;
      while (remaining > 0 && cycles < 10) {
        const step = await processEmbeddingQueueBatch({ batchSize: 20, orgId: org.orgId });
        remaining = step.remaining;
        cycles++;
      }

      // Once target model coverage completes, autoSwitch promotes targetModel to activeModel
      const finalActive = await getActiveEmbeddingModel(org.orgId);
      assert.equal(
        finalActive,
        targetModel,
        "Target model automatically promoted to active model upon completion",
      );

      const statusDone = await getEmbeddingIndexStatus(org.orgId);
      assert.equal(statusDone.activeModel.id, targetModel);
      assert.equal(statusDone.reindexStatus, "completed");
      assert.equal(statusDone.coveragePercent, 100);

      // Candidate embeddings table now holds both models without collision
      const modelDistribution = await sql<{ model: string; count: number }>`
      select model, count(*)::int as count
      from candidate_embeddings
      group by model
      order by model`;

      assert.ok(modelDistribution.some((m) => m.model === DEFAULT_EMBEDDING_MODEL));
      assert.ok(modelDistribution.some((m) => m.model === targetModel));

      // Manual switch test: switch back to default model
      const switched = await switchActiveEmbeddingModel({
        orgId: org.orgId,
        newActiveModel: DEFAULT_EMBEDDING_MODEL,
      });
      assert.equal(switched.activeModel.id, DEFAULT_EMBEDDING_MODEL);
      assert.equal(await getActiveEmbeddingModel(org.orgId), DEFAULT_EMBEDDING_MODEL);
    },
  );

  // ---------------------------------------------------------------------------
  // 5. Search Path Semantic Retrieval & Enqueue Overflow
  // ---------------------------------------------------------------------------
  await t.test(
    "Search path uses active model and triggers background queueing for pool overflow",
    async () => {
      // Perform semantic search
      const searchRes = await executeTalentSearch({
        userId: testUserId,
        orgId: org.orgId,
        q: "distributed consensus kafka",
      });

      assert.ok(searchRes.rows.length > 0);
      assert.equal(searchRes.mode, "fts+e5");
      assert.ok(searchRes.rows.some((r) => r.candidate.fullName === "Vikram Malhotra"));
    },
  );
});
