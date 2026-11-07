import assert from "node:assert/strict";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import { executeTalentSearch, indexNewCandidate } from "../../pipeline/api/search-api.ts";
import {
  computeRetrievalMetrics,
  reciprocalRankFusion,
  recallAtK,
  meanReciprocalRank,
  ndcgAtK,
  type BenchmarkEvaluationResult,
} from "./retrieve.ts";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test("Two-Tower Hybrid Retrieval & Vocabulary Mismatch Benchmark Suite", async (t) => {
  const sql = await getSql();

  // 1. Setup isolated test organization and user
  const userId = `recruiter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const org = await ensureUserOrg(userId, `Benchmark Talent Org ${Date.now()}`);
  const orgId = org.orgId;

  // ---------------------------------------------------------------------------
  // 2. Candidate Pool Creation: Terminology Mismatch, Exact Controls, Distractors
  // ---------------------------------------------------------------------------
  const candidateDefs = [
    // --- Vocabulary Mismatch Candidates (Strong Candidates with Different Terminology) ---
    {
      key: "cand_k8s_mismatch",
      fullName: "Arjun Nair",
      title: "Principal Infrastructure Lead",
      company: "CloudScale Systems",
      location: "Bengaluru, India",
      resumeText:
        "Container orchestration with EKS, Helm charts, Docker microservices. Managed AWS ECS clusters and Terraform infrastructure automation. SRE and reliability engineering.",
    },
    {
      key: "cand_ml_mismatch",
      fullName: "Dr. Sneha Verma",
      title: "Senior AI Scientist",
      company: "Cortex Labs",
      location: "Hyderabad, India",
      resumeText:
        "Trained large transformer models and neural networks using gradient backpropagation. Neural network inference optimization, GPU CUDA kernels, feature engineering, and LLM fine-tuning.",
    },
    {
      key: "cand_frontend_mismatch",
      fullName: "Rohan Joshi",
      title: "Staff UI Engineer",
      company: "Veloce Web",
      location: "Pune, India",
      resumeText:
        "Optimized client-side rendering, Core Web Vitals, and DOM latency. Next.js bundle splitting, state management with Redux, and Tailwind CSS responsive design.",
    },
    {
      key: "cand_backend_mismatch",
      fullName: "Kavita Rao",
      title: "Systems Architect",
      company: "Distributed Nodes",
      location: "Bengaluru, India",
      resumeText:
        "Designed fault-tolerant microservices using Raft protocol and Paxos state machines. Event streaming via Kafka and gRPC RPCs. Scalable Postgres and Redis storage.",
    },

    // --- Exact Keyword Control Candidates ---
    {
      key: "cand_golang_exact",
      fullName: "Ankit Sharma",
      title: "Senior Golang Developer",
      company: "Apex Fintech",
      location: "Gurugram, India",
      resumeText:
        "Senior Golang microservices developer building high throughput gRPC services with Postgres and Redis caching.",
    },

    // --- Negative Control Distractors ---
    {
      key: "cand_distractor_chef",
      fullName: "Chef Antonio Rossi",
      title: "Executive Pastry Chef",
      company: "Bella Milano Bakery",
      location: "Mumbai, India",
      resumeText:
        "Artisan sourdough breads, viennoiserie, French pastry, croissant lamination, patisserie and kitchen management.",
    },
    {
      key: "cand_distractor_nurse",
      fullName: "Meera Patel",
      title: "Senior Pediatric Nurse",
      company: "Apex Care Hospital",
      location: "Ahmedabad, India",
      resumeText:
        "Clinical pediatric nursing, patient vitals, emergency triage, healthcare ward administration and medical protocols.",
    },
    {
      key: "cand_distractor_realtor",
      fullName: "Suresh Menon",
      title: "Commercial Real Estate Broker",
      company: "Metropolis Realty",
      location: "Chennai, India",
      resumeText:
        "Commercial property leasing, residential mortgages, real estate brokerage, tenant negotiations and title transfers.",
    },
  ];

  const candidateIds: Record<string, string> = {};
  for (const c of candidateDefs) {
    const candId = uid("cand");
    await sql`
      insert into candidates (
        id, user_id, org_id, full_name, email, phone, location,
        current_title, current_company, resume_text, created_at
      )
      values (
        ${candId}, ${userId}, ${orgId}, ${c.fullName}, ${`${c.key}@test.com`}, '+91-9876543210', ${c.location},
        ${c.title}, ${c.company}, ${c.resumeText}, now()
      )`;
    candidateIds[c.key] = candId;
    await indexNewCandidate(candId, 30, 25);
  }

  // ---------------------------------------------------------------------------
  // 3. Unit Tests for Reciprocal Rank Fusion & Metrics Functions
  // ---------------------------------------------------------------------------
  await t.test("Reciprocal Rank Fusion correctly merges distinct ranks", () => {
    const lexicalList = [
      { id: "cand_A", score: 0.8 },
      { id: "cand_B", score: 0.5 },
      { id: "cand_C", score: 0.1 },
    ];
    const semanticList = [
      { id: "cand_D", score: 0.95 }, // zero lexical match
      { id: "cand_B", score: 0.85 }, // match in both
      { id: "cand_A", score: 0.7 },
    ];

    const fused = reciprocalRankFusion(lexicalList, semanticList, { k: 60 });
    assert.equal(fused.length, 4);

    // cand_B is rank 2 in lexical (1/(60+2)) and rank 2 in semantic (1/(60+2))
    // rrf = 2/62 = 0.032258
    // cand_A is rank 1 in lexical (1/61) and rank 3 in semantic (1/63)
    // rrf = 1/61 + 1/63 = 0.01639 + 0.01587 = 0.032266 -> cand_A rank 1
    assert.equal(fused[0]!.id, "cand_A");
    assert.equal(fused[1]!.id, "cand_B");

    // cand_D (zero lexical match) should still achieve a high score from semantic rank 1
    const candD = fused.find((f) => f.id === "cand_D");
    assert.ok(candD);
    assert.equal(candD.lexicalRank, null);
    assert.equal(candD.semanticRank, 1);
    assert.ok(candD.rrfScore > 0);
  });

  await t.test("Metric calculation functions (Recall@K, MRR, NDCG@K)", () => {
    const relevant = ["cand_1", "cand_2"];
    const retrieved = ["cand_x", "cand_1", "cand_y", "cand_2", "cand_z"];

    const r1 = recallAtK(relevant, retrieved, 1);
    const r2 = recallAtK(relevant, retrieved, 2);
    const r4 = recallAtK(relevant, retrieved, 4);
    assert.equal(r1, 0.0);
    assert.equal(r2, 0.5);
    assert.equal(r4, 1.0);

    const mrr = meanReciprocalRank([{ relevantIds: relevant, retrievedIds: retrieved }]);
    assert.equal(mrr, 0.5); // First hit at rank 2 -> 1/2

    const ndcg = ndcgAtK({ cand_1: 2, cand_2: 1 }, retrieved, 5);
    assert.ok(ndcg > 0.6 && ndcg <= 1.0);
  });

  // ---------------------------------------------------------------------------
  // 4. Benchmark Execution: Compare Lexical-Only, Semantic-Only, and Hybrid
  // ---------------------------------------------------------------------------
  await t.test("Benchmark: Lexical-Only vs Semantic-Only vs Hybrid Retrieval", async () => {
    const benchmarkQueries = [
      {
        query: "Kubernetes Cloud Architect",
        relevantKey: "cand_k8s_mismatch",
        isVocabularyMismatch: true,
      },
      {
        query: "Deep Learning PyTorch",
        relevantKey: "cand_ml_mismatch",
        isVocabularyMismatch: true,
      },
      {
        query: "Frontend Web Performance",
        relevantKey: "cand_frontend_mismatch",
        isVocabularyMismatch: true,
      },
      {
        query: "Distributed Consensus Backend",
        relevantKey: "cand_backend_mismatch",
        isVocabularyMismatch: true,
      },
      {
        query: "Senior Golang Microservices Developer",
        relevantKey: "cand_golang_exact",
        isVocabularyMismatch: false,
      },
    ];

    // Evaluate Baseline 1: Lexical-Only
    const lexicalTestCases: Array<{
      query: string;
      relevantIds: string[];
      isVocabularyMismatch: boolean;
      retrievedIds: string[];
    }> = [];

    for (const bq of benchmarkQueries) {
      const searchRes = await executeTalentSearch({
        userId,
        orgId,
        q: bq.query,
        mode: "lexical",
      });
      lexicalTestCases.push({
        query: bq.query,
        relevantIds: [candidateIds[bq.relevantKey]!],
        isVocabularyMismatch: bq.isVocabularyMismatch,
        retrievedIds: searchRes.rows.map((r) => r.candidate.id),
      });
    }
    const lexicalMetrics: BenchmarkEvaluationResult = computeRetrievalMetrics(lexicalTestCases);

    // Evaluate Baseline 2: Semantic-Only
    const semanticTestCases: Array<{
      query: string;
      relevantIds: string[];
      isVocabularyMismatch: boolean;
      retrievedIds: string[];
    }> = [];

    for (const bq of benchmarkQueries) {
      const searchRes = await executeTalentSearch({
        userId,
        orgId,
        q: bq.query,
        mode: "semantic",
      });
      semanticTestCases.push({
        query: bq.query,
        relevantIds: [candidateIds[bq.relevantKey]!],
        isVocabularyMismatch: bq.isVocabularyMismatch,
        retrievedIds: searchRes.rows.map((r) => r.candidate.id),
      });
    }
    const semanticMetrics: BenchmarkEvaluationResult = computeRetrievalMetrics(semanticTestCases);

    // Evaluate Proposed Solution: Two-Tower Hybrid Retrieval with RRF
    const hybridTestCases: Array<{
      query: string;
      relevantIds: string[];
      isVocabularyMismatch: boolean;
      retrievedIds: string[];
    }> = [];

    for (const bq of benchmarkQueries) {
      const searchRes = await executeTalentSearch({
        userId,
        orgId,
        q: bq.query,
        mode: "hybrid",
      });
      hybridTestCases.push({
        query: bq.query,
        relevantIds: [candidateIds[bq.relevantKey]!],
        isVocabularyMismatch: bq.isVocabularyMismatch,
        retrievedIds: searchRes.rows.map((r) => r.candidate.id),
      });
    }
    const hybridMetrics: BenchmarkEvaluationResult = computeRetrievalMetrics(hybridTestCases);

    // -------------------------------------------------------------------------
    // Log Formatted Benchmark Results Table
    // -------------------------------------------------------------------------
    console.log("\n==========================================================================");
    console.log("   RETRIEVAL PIPELINE BENCHMARK: VOCABULARY MISMATCH & HYBRID FUSION     ");
    console.log("==========================================================================");
    console.log(
      `| ${"Metric".padEnd(32)} | ${"Lexical-Only".padEnd(12)} | ${"Semantic-Only".padEnd(14)} | ${"Hybrid (RRF)".padEnd(12)} |`,
    );
    console.log(
      "|----------------------------------|--------------|----------------|--------------|",
    );
    console.log(
      `| ${"Recall@1".padEnd(32)} | ${(lexicalMetrics.recallAt1 * 100).toFixed(1).padStart(11)}% | ${(semanticMetrics.recallAt1 * 100).toFixed(1).padStart(13)}% | ${(hybridMetrics.recallAt1 * 100).toFixed(1).padStart(11)}% |`,
    );
    console.log(
      `| ${"Recall@5".padEnd(32)} | ${(lexicalMetrics.recallAt5 * 100).toFixed(1).padStart(11)}% | ${(semanticMetrics.recallAt5 * 100).toFixed(1).padStart(13)}% | ${(hybridMetrics.recallAt5 * 100).toFixed(1).padStart(11)}% |`,
    );
    console.log(
      `| ${"Mean Reciprocal Rank (MRR)".padEnd(32)} | ${lexicalMetrics.mrr.toFixed(4).padStart(12)} | ${semanticMetrics.mrr.toFixed(4).padStart(14)} | ${hybridMetrics.mrr.toFixed(4).padStart(12)} |`,
    );
    console.log(
      `| ${"NDCG@5".padEnd(32)} | ${lexicalMetrics.ndcgAt5.toFixed(4).padStart(12)} | ${semanticMetrics.ndcgAt5.toFixed(4).padStart(14)} | ${hybridMetrics.ndcgAt5.toFixed(4).padStart(12)} |`,
    );
    console.log(
      `| ${"Vocab Mismatch Recovery Rate".padEnd(32)} | ${(lexicalMetrics.vocabularyMismatchRecoveryRate * 100).toFixed(1).padStart(11)}% | ${(semanticMetrics.vocabularyMismatchRecoveryRate * 100).toFixed(1).padStart(13)}% | ${(hybridMetrics.vocabularyMismatchRecoveryRate * 100).toFixed(1).padStart(11)}% |`,
    );
    console.log("==========================================================================\n");

    // -------------------------------------------------------------------------
    // Quantitative Empirical Assertions Proving the Prompt's Hypothesis:
    // 1. Full-text search alone misses strong candidates who use different terminology.
    // 2. Semantic retrieval recovers these candidates.
    // 3. Hybrid retrieval (RRF) maintains high recall across both exact & mismatch queries.
    // -------------------------------------------------------------------------

    // Lexical search misses all 4 terminology mismatch candidates:
    assert.equal(
      lexicalMetrics.vocabularyMismatchRecoveryRate,
      0.0,
      "Full-text search alone MUST miss candidates with zero lexical keyword overlap",
    );
    assert.ok(
      lexicalMetrics.recallAt5 <= 0.25,
      "Lexical recall on the combined suite must be low due to vocabulary mismatch",
    );

    // Semantic retrieval successfully surfaces the candidates:
    assert.ok(
      semanticMetrics.vocabularyMismatchRecoveryRate >= 0.75,
      "Semantic retrieval must recover >= 75% of vocabulary mismatch candidates",
    );

    // Hybrid retrieval with Reciprocal Rank Fusion dominates the overall score:
    assert.ok(
      hybridMetrics.recallAt5 >= 0.8,
      `Hybrid Recall@5 (${hybridMetrics.recallAt5}) must be >= 0.8 across the combined suite`,
    );
    assert.ok(
      hybridMetrics.mrr > lexicalMetrics.mrr,
      `Hybrid MRR (${hybridMetrics.mrr}) must exceed Lexical MRR (${lexicalMetrics.mrr})`,
    );
    assert.ok(
      hybridMetrics.vocabularyMismatchRecoveryRate >= 0.75,
      "Hybrid retrieval must preserve high vocabulary mismatch recovery",
    );

    // Negative controls (Pastry chef, nurse, realtor) should NEVER outrank relevant technical candidates
    for (const bq of benchmarkQueries) {
      const hybridRes = await executeTalentSearch({
        userId,
        orgId,
        q: bq.query,
        mode: "hybrid",
      });
      assert.ok(hybridRes.rows.length > 0, `Expected results for "${bq.query}"`);
      // Rank 1 must be the relevant candidate
      assert.equal(
        hybridRes.rows[0]?.candidate.id,
        candidateIds[bq.relevantKey],
        `Relevant candidate must be ranked #1 for query "${bq.query}"`,
      );

      // Neither chef nor nurse should be ranked #1
      assert.notEqual(
        hybridRes.rows[0]?.candidate.id,
        candidateIds.cand_distractor_chef,
        `Pastry chef should never be ranked #1 for "${bq.query}"`,
      );
      assert.notEqual(
        hybridRes.rows[0]?.candidate.id,
        candidateIds.cand_distractor_nurse,
        `Nurse should never be ranked #1 for "${bq.query}"`,
      );
    }
  });
});
