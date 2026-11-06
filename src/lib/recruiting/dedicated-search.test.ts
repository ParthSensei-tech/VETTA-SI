import assert from "node:assert/strict";
import test from "node:test";
import { getSql } from "../../platform/db.ts";
import { ensureUserOrg } from "./org.server.ts";
import {
  extractCandidateProfile,
  extractJobRequirements,
  PgVectorSearchEngine,
  executeDedicatedHybridSearch,
  reviewAndAdvanceCandidate,
  getSearchInfrastructureTelemetry,
} from "./dedicated-search.server.ts";
import { indexNewCandidate } from "./search-api.ts";
import { embedTexts } from "./embed-text.server.ts";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test("Dedicated pgvector + PostgreSQL Search Infrastructure Suite", async (t) => {
  const sql = await getSql();

  // Setup isolated tenant organization and recruiter
  const testUserId = uid("recruiter");
  const org = await ensureUserOrg(testUserId, "Vetta Enterprise Search Tenant");
  const orgId = org.orgId;

  // ---------------------------------------------------------------------------
  // Stage 1 & 2: Candidate CV & Job Description Extraction
  // ---------------------------------------------------------------------------
  await t.test("Stage 1 & 2: Resume Extraction & Job Requirement Extraction", () => {
    const rawResume = `
      Priya Sharma
      Senior Full Stack Cloud Engineer
      Bengaluru, India | priya.sharma@example.com | +91-9876543210
      8 years experience building high-scale cloud platforms.
      Technical Skills: TypeScript, React, Next.js, Node.js, Go, Kubernetes, Docker, AWS, Postgres, Kafka.
      Experience: Led microservices architecture at FinScale; optimized container orchestration on EKS.
    `;

    const profile = extractCandidateProfile({
      candidateId: "cand_test_priya",
      fullName: "Priya Sharma",
      email: "priya.sharma@example.com",
      phone: "+91-9876543210",
      location: "Bengaluru, India",
      currentTitle: "Senior Full Stack Cloud Engineer",
      currentCompany: "FinScale",
      yearsExperience: 8,
      resumeText: rawResume,
    });

    assert.equal(profile.fullName, "Priya Sharma");
    assert.equal(profile.yearsExperience, 8);
    assert.ok(profile.skills.includes("kubernetes"));
    assert.ok(profile.skills.includes("typescript"));
    assert.ok(profile.skills.includes("postgres"));
    assert.ok(profile.searchDoc.includes("Priya Sharma"));

    const rawJob = {
      id: "role_lead_cloud",
      title: "Lead Cloud Platform Architect",
      companyName: "HyperGrowth Fintech",
      location: "Bengaluru, India",
      workMode: "hybrid",
      compensationBand: "₹45–60 LPA",
      stack: ["Kubernetes", "AWS", "Go", "Postgres", "Kafka"],
      mustHaves: ["5+ years distributed systems", "Production Kubernetes / EKS"],
      niceToHaves: ["Fintech domain experience", "Terraform automation"],
      jdText: "We are seeking a Lead Cloud Architect to scale our core payment infrastructure.",
    };

    const requirements = extractJobRequirements(rawJob);
    assert.equal(requirements.title, "Lead Cloud Platform Architect");
    assert.equal(requirements.stack.length, 5);
    assert.ok(requirements.searchDoc.includes("Required Stack: Kubernetes, AWS"));
  });

  // ---------------------------------------------------------------------------
  // Stage 3 & 4: PostgreSQL Persistence & pgvector Embeddings Indexing
  // ---------------------------------------------------------------------------
  let candPriyaId = "";
  let candDevopsId = "";
  let candDistractorId = "";
  let roleId = "";

  await t.test("Stage 3 & 4: PostgreSQL Persistence & Dedicated pgvector Embeddings", async () => {
    // Insert candidates into PostgreSQL
    candPriyaId = uid("cand_priya");
    candDevopsId = uid("cand_devops");
    candDistractorId = uid("cand_chef");

    await sql`
      insert into candidates (
        id, user_id, org_id, full_name, email, phone, location,
        current_title, current_company, years_experience, notice_period_days, expected_ctc_lakh,
        resume_text, created_at
      )
      values
        (${candPriyaId}, ${testUserId}, ${orgId}, 'Priya Sharma', 'priya@vetta.test', '+91-9876543210', 'Bengaluru, India',
         'Senior Cloud Platform Engineer', 'FinScale', 8, 30, 45,
         '8+ years distributed systems architecture. Production Kubernetes and EKS orchestration. Go microservices, Kafka streaming, AWS infrastructure and Postgres database design.', now()),
        (${candDevopsId}, ${testUserId}, ${orgId}, 'Vikram Rao', 'vikram@vetta.test', '+91-9876543211', 'Bengaluru, India',
         'DevOps & Infrastructure Lead', 'ScaleOps', 6, 15, 40,
         'Container orchestration with Docker and Helm. Terraform infrastructure automation, CI/CD pipelines on AWS ECS.', now()),
        (${candDistractorId}, ${testUserId}, ${orgId}, 'Marco Bellini', 'marco@vetta.test', '+91-9876543212', 'Mumbai, India',
         'Head Baker & Pastry Chef', 'Bella Milano', 10, 60, 20,
         'Artisan sourdough bread fermentation, viennoiserie, French pastry laminations, kitchen management and restaurant hospitality.', now())`;

    await indexNewCandidate(candPriyaId, 30, 45);
    await indexNewCandidate(candDevopsId, 15, 40);
    await indexNewCandidate(candDistractorId, 60, 20);

    // Insert Job Requisition
    roleId = uid("role_cloud");
    await sql`
      insert into roles (
        id, org_id, user_id, title, company_name, company_stage, location, work_mode,
        employment_type, compensation_band, stack, must_haves, nice_to_haves, jd_text, created_at
      )
      values (
        ${roleId}, ${orgId}, ${testUserId}, 'Lead Cloud Platform Architect', 'HyperGrowth Fintech', 'growth',
        'Bengaluru, India', 'hybrid', 'full_time', '45-60 LPA',
        '{"Kubernetes", "AWS", "Go", "Postgres", "Kafka"}',
        '{"Production Kubernetes / EKS", "Distributed systems"}',
        '{"Terraform", "Fintech"}',
        'Lead cloud architect to orchestrate high-throughput payment clusters.', now()
      )`;

    // Vectorize candidates using active model
    const [vecPriya, vecDevops, vecChef] = await embedTexts(
      [
        "Kubernetes EKS orchestration Go microservices Kafka streaming AWS infrastructure",
        "Container orchestration with Docker and Helm Terraform infrastructure automation AWS ECS",
        "Artisan sourdough bread fermentation viennoiserie French pastry restaurant kitchen",
      ],
      "passage",
    );

    assert.ok(vecPriya && vecPriya.length === 384);
    assert.ok(vecDevops && vecDevops.length === 384);
    assert.ok(vecChef && vecChef.length === 384);

    // Store in dedicated pgvector table
    await PgVectorSearchEngine.storeCandidateVector({
      candidateId: candPriyaId,
      orgId,
      model: "Xenova/multilingual-e5-small",
      vector: vecPriya,
    });
    await PgVectorSearchEngine.storeCandidateVector({
      candidateId: candDevopsId,
      orgId,
      model: "Xenova/multilingual-e5-small",
      vector: vecDevops,
    });
    await PgVectorSearchEngine.storeCandidateVector({
      candidateId: candDistractorId,
      orgId,
      model: "Xenova/multilingual-e5-small",
      vector: vecChef,
    });

    const [vecJob] = await embedTexts(
      ["Lead Cloud Platform Architect Kubernetes AWS Go Postgres Kafka payment cluster"],
      "query",
    );
    await PgVectorSearchEngine.storeJobVector({
      roleId,
      orgId,
      model: "Xenova/multilingual-e5-small",
      vector: vecJob,
    });

    const isAvailable = await PgVectorSearchEngine.isNativePgVectorAvailable();
    assert.equal(typeof isAvailable, "boolean");
  });

  // ---------------------------------------------------------------------------
  // Stage 5 & 6: Hybrid Retrieval (FTS + pgvector + RRF) & Cross-Encoder Reranking
  // ---------------------------------------------------------------------------
  await t.test(
    "Stage 5 & 6: Two-Tower Hybrid Retrieval & Cross-Encoder Evidence Scoring",
    async () => {
      const searchRes = await executeDedicatedHybridSearch({
        userId: testUserId,
        orgId,
        roleId,
        enableCrossEncoderRerank: true,
        limit: 10,
      });

      assert.ok(searchRes.items.length >= 2, "Must retrieve candidates");
      assert.equal(searchRes.metadata.engine, "pgvector+postgres");
      assert.equal(searchRes.metadata.fusionMethod, "reciprocal_rank_fusion_k60");
      assert.equal(searchRes.metadata.crossEncoderReranked, true);

      // Candidate Priya Sharma should be the top match
      const topItem = searchRes.items[0]!;
      assert.equal(topItem.candidateId, candPriyaId);
      assert.equal(topItem.profile.fullName, "Priya Sharma");
      assert.ok(topItem.rrfScore > 0);

      // Verify Evidence-Based Match Scoring details
      assert.ok(topItem.evidence, "Top candidate must have evidence-based match scoring");
      assert.ok(
        topItem.crossEncoderScore! >= 60,
        `Score (${topItem.crossEncoderScore}) must reflect strong match`,
      );
      assert.ok(
        topItem.evidence.fitLevel === "strong_yes" ||
          topItem.evidence.fitLevel === "yes" ||
          topItem.evidence.fitLevel === "maybe",
        `Fit level must be acceptable, got ${topItem.evidence.fitLevel}`,
      );
      assert.ok(
        topItem.evidence.categoryScores.skills >= 60,
        "Skills category score should be high",
      );

      // Negative control (Pastry chef) should not outrank tech candidates
      const chefItem = searchRes.items.find((i) => i.candidateId === candDistractorId);
      if (chefItem && chefItem.crossEncoderScore) {
        assert.ok(
          topItem.crossEncoderScore! > chefItem.crossEncoderScore,
          "Priya must outrank pastry chef",
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Stage 7 & 8: Recruiter Review, Shortlist Approval, & Outcome Tracking Loop
  // ---------------------------------------------------------------------------
  await t.test("Stage 7 & 8: Recruiter Review, Approval Pipeline & Outcome Feedback", async () => {
    // 1. Recruiter reviews and moves candidate to 'shortlisted'
    const shortlistRes = await reviewAndAdvanceCandidate({
      candidateId: candPriyaId,
      roleId,
      orgId,
      nextStatus: "shortlisted",
      recruiterNotes:
        "Excellent Kubernetes and distributed systems background. Approved for client review.",
      recruiterUserId: testUserId,
    });

    assert.equal(shortlistRes.status, "shortlisted");
    assert.ok(shortlistRes.applicationId);

    // 2. Client conducts interview and candidate progresses to 'screening'
    const interviewRes = await reviewAndAdvanceCandidate({
      candidateId: candPriyaId,
      roleId,
      orgId,
      nextStatus: "screening",
      recruiterNotes: "Client technical screen passed with 5/5 architecture rating.",
      recruiterUserId: testUserId,
    });
    assert.equal(interviewRes.status, "screening");

    // 3. Candidate approved / ready for offer
    const approvedRes = await reviewAndAdvanceCandidate({
      candidateId: candPriyaId,
      roleId,
      orgId,
      nextStatus: "approved",
      recruiterNotes: "Offer accepted. Joining date scheduled.",
      recruiterUserId: testUserId,
    });
    assert.equal(approvedRes.status, "approved");

    // 4. Verify outcome feedback tracking and search infrastructure telemetry
    const telemetry = await getSearchInfrastructureTelemetry(orgId);
    assert.ok(telemetry.indexedProfilesCount >= 3, "Indexed profiles count");
    assert.ok(telemetry.indexedJobsCount >= 1, "Indexed jobs count");
    assert.ok(telemetry.outcomeFeedbackCount >= 3, "Outcome feedback events recorded");
    assert.equal(telemetry.engineStatus, "operational");
  });
});
