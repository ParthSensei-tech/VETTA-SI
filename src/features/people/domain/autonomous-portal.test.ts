import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTechTrie,
  generateInteractiveProbes,
  CLIENT_HELPING_STEPS,
  ensureAutonomousPortal,
  createHitlCheckpoint,
  loadHitlCheckpoints,
  decideHitlCheckpoint,
  processAtsWebhookIngestion,
  generateAtsWebhookSignature,
  verifyAtsWebhookSignature,
  checkWebhookRateLimit,
  clearWebhookRateLimits,
} from "../server/autonomous-portal.server.ts";
import { getSql } from "../../../platform/db.ts";
import { randomUUID } from "node:crypto";
import type { RequirementEvaluation, AtsWebhookPayload } from "../../recruiting/domain/types.ts";

test("Algorithm: SkillTrie provides fast multi-pattern text scanning", () => {
  const trie = buildTechTrie(["Kubernetes", "Apache Kafka", "PostgreSQL", "Next.js"]);

  const sampleResume = `
    Senior Backend Architect
    Over 6 years of experience building microservices with Go, PostgreSQL, and Apache Kafka.
    Deployed multi-region workloads onto Kubernetes clusters with Helm.
    Familiar with Next.js frontend interfaces and React Native.
  `;

  const hits = trie.search(sampleResume);

  assert.ok(hits.has("postgresql"), "Must match postgresql in resume");
  assert.ok(hits.has("apache kafka"), "Must match multi-word phrase apache kafka");
  assert.ok(hits.has("kubernetes"), "Must match kubernetes");
  assert.ok(hits.has("next.js"), "Must match next.js with punctuation");
  assert.ok(hits.has("go"), "Must match go token at word boundary");
  assert.ok(!hits.has("rust"), "Must not match unmentioned technology");
});

test("Client Connection Wizard: Comprehensive helping steps for all connection channels", () => {
  const channels = [
    "career_portal",
    "embed_widget",
    "ats_webhook",
    "company_website_portal",
    "direct_drop",
  ] as const;

  for (const ch of channels) {
    const guide = CLIENT_HELPING_STEPS[ch];
    assert.ok(guide, `Guide must exist for ${ch}`);
    assert.ok(guide.title.length > 0, `Title must be present for ${ch}`);
    assert.ok(guide.steps.length >= 3, `Must provide at least 3 helping steps for ${ch}`);
    assert.ok(guide.tradeOffs.pros.length > 0, `Pros must be explained for ${ch}`);
    assert.ok(guide.tradeOffs.cons.length > 0, `Cons must be explained for ${ch}`);
  }

  // Verify embed widget has copyable snippet
  assert.ok(CLIENT_HELPING_STEPS.embed_widget.copySnippet?.code.includes("iframe"));
  // Verify ATS webhook has copyable payload URL placeholder
  assert.ok(CLIENT_HELPING_STEPS.ats_webhook.copySnippet?.code.includes("WEBHOOK_RELAY_URL"));
});

test("Autonomous Intake Generator: Crafts targeted probes for unstated requirements", () => {
  const requirements: RequirementEvaluation[] = [
    {
      requirement: "5+ years backend systems",
      category: "must_have",
      status: "satisfied",
      evidenceQuote: "6 years backend engineering with Go",
      explanation: "Evidenced in resume",
    },
    {
      requirement: "Notice period <= 30 days",
      category: "hard_constraint",
      status: "missing_info",
      explanation: "Notice period not stated on resume",
    },
    {
      requirement: "Compensation <= 45 LPA",
      category: "hard_constraint",
      status: "missing_info",
      explanation: "Expected CTC not stated on resume",
    },
    {
      requirement: "Kafka streaming experience",
      category: "skill",
      status: "missing_info",
      explanation: "Kafka not mentioned in CV",
    },
  ];

  const probes = generateInteractiveProbes(requirements);
  assert.equal(probes.length, 3, "Should generate probes for all 3 missing info items");

  const noticeProbe = probes.find((p) => p.field === "notice_period_days");
  assert.ok(noticeProbe, "Notice period probe must be generated");
  assert.equal(noticeProbe.required, true);

  const ctcProbe = probes.find((p) => p.field === "expected_ctc_lakh");
  assert.ok(ctcProbe, "Expected CTC probe must be generated");

  const techProbe = probes.find((p) => p.field === "technical_depth");
  assert.ok(techProbe, "Technical depth probe must be generated for unstated skill");
});

test("Strict Human-in-the-Loop: Checkpoint creation, review queue, and decision execution", async () => {
  const sql = await getSql();
  const testOrgId = `org_hitl_${randomUUID().slice(0, 8)}`;
  const testUserId = `user_hitl_${randomUUID().slice(0, 8)}`;
  const testRoleId = `role_hitl_${randomUUID().slice(0, 8)}`;

  // Seed test org and role
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${testOrgId}, 'Acme Labs', ${`acme-${randomUUID().slice(0, 6)}`}, ${testUserId}, 365)
  `;
  await sql`
    insert into roles (id, user_id, org_id, company_name, company_stage, title, status)
    values (${testRoleId}, ${testUserId}, ${testOrgId}, 'Acme Labs', 'series_a', 'Staff Backend Lead', 'open')
  `;

  // 1. Create a Shortlist Interview Checkpoint
  const cpId = await createHitlCheckpoint({
    orgId: testOrgId,
    roleId: testRoleId,
    checkpointType: "shortlist_interview",
    candidateName: "Deepak Patel",
    roleTitle: "Staff Backend Lead",
    aiRecommendation: "advance",
    aiScore: 84,
    aiFitLevel: "strong_yes",
    evidenceSummary: "Exceeds backend scaling bar with verified PostgreSQL and Kafka citations.",
    missingRequirements: ["Notice period unverified"],
  });

  assert.ok(cpId, "Checkpoint ID must be returned");

  // 2. Query pending queue
  const queue = await loadHitlCheckpoints({ orgId: testOrgId, status: "pending" });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].candidateName, "Deepak Patel");
  assert.equal(queue[0].status, "pending");
  assert.equal(queue[0].checkpointType, "shortlist_interview");

  // 3. Human decision: Approve candidate for interview
  const decisionResult = await decideHitlCheckpoint({
    checkpointId: cpId,
    reviewerId: testUserId,
    decision: "approved",
    reviewerNotes: "Approved by VP Eng. Schedule Round 1 technical loop.",
    calibrationDelta: { scoreConfidence: 1.0 },
  });

  assert.equal(decisionResult.ok, true);
  assert.equal(decisionResult.status, "approved");

  // Verify status updated in database
  const history = await loadHitlCheckpoints({ orgId: testOrgId, status: "approved" });
  assert.equal(history.length, 1);
  assert.equal(history[0].reviewerDecision, "approved");
  assert.equal(history[0].reviewerNotes, "Approved by VP Eng. Schedule Round 1 technical loop.");
  assert.ok(history[0].decidedAt, "Decided timestamp must be recorded");
});

test("ATS Webhook Relay: Ingests Workday/Taleo applicant, runs multi-stage retrieval, and routes to HITL gate", async () => {
  const sql = await getSql();
  const testOrgId = `org_ats_${randomUUID().slice(0, 8)}`;
  const testUserId = `user_ats_${randomUUID().slice(0, 8)}`;
  const testRoleId = `role_ats_${randomUUID().slice(0, 8)}`;

  // Seed test org, portal, and role
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${testOrgId}, 'Fintech Global', ${`fintech-${randomUUID().slice(0, 6)}`}, ${testUserId}, 365)
  `;
  const portal = await ensureAutonomousPortal({
    orgId: testOrgId,
    defaultSlug: `fintech-${randomUUID().slice(0, 6)}`,
    defaultName: "Fintech Global",
  });

  await sql`
    insert into roles (
      id, user_id, org_id, company_name, company_stage, title, location,
      work_mode, stack, must_haves, status, jd_text
    ) values (
      ${testRoleId}, ${testUserId}, ${testOrgId}, 'Fintech Global', 'series_b',
      'Lead Distributed Systems Engineer', 'Bengaluru', 'hybrid',
      '["Go", "PostgreSQL", "Kafka"]', '["5+ years distributed systems"]',
      'open', 'Looking for lead distributed systems engineer in Bengaluru with high-throughput Go and Kafka experience.'
    )
  `;

  // Incoming webhook payload from Workday
  const workdayPayload: AtsWebhookPayload = {
    ats: "workday",
    event: "candidate.created",
    candidate: {
      name: "Sanjay Singhania",
      email: "sanjay.singh@example.com",
      phone: "+91 9900112233",
      location: "Bengaluru",
      resumeText: `
        Sanjay Singhania
        Senior Systems Engineer | Bengaluru | sanjay.singh@example.com
        
        Summary:
        Over 6 years of backend experience building high-throughput payment pipelines.
        
        Experience:
        Fintech Corp (2020 - Present):
        - Led migration of ledger services to Go and PostgreSQL processing 30M daily requests.
        - Architected event-driven streaming with Apache Kafka reducing batch latency by 85%.
      `,
    },
    job: {
      externalJobId: "WD-REQ-9872",
      roleId: testRoleId,
      title: "Lead Distributed Systems Engineer",
    },
  };

  const ingestion = await processAtsWebhookIngestion({
    portalId: portal.id,
    payload: workdayPayload,
  });

  assert.equal(ingestion.ok, true);
  assert.equal(ingestion.candidateName, "Sanjay Singhania");
  assert.ok(
    ingestion.score >= 70,
    `Score (${ingestion.score}) should reflect strong Go and Kafka match`,
  );
  assert.equal(
    ingestion.checkpointCreated,
    true,
    "Should automatically create HITL gate checkpoint",
  );

  // Verify that application exists in database with source = 'ats_workday'
  const [appRow] = await sql`
    select * from applications where id = ${ingestion.applicationId} limit 1
  `;
  assert.ok(appRow, "Application record must exist");
  assert.equal(appRow.source, "ats_workday");

  // Verify HITL checkpoint exists for recruiter review
  const checkpoints = await loadHitlCheckpoints({ orgId: testOrgId });
  assert.ok(checkpoints.length >= 1, "HITL checkpoint must be recorded");
  assert.equal(checkpoints[0].candidateName, "Sanjay Singhania");
});

test("Security: Webhook HMAC signature, replay protection & rate limiting", async () => {
  const secret = "whsec_test_secret_key_123456789";
  const now = 1762700000000;
  const rawPayload = JSON.stringify({ event: "candidate.created", test: true });

  // 1. Valid signature & timestamp within window passes
  const validSig = generateAtsWebhookSignature({
    payloadString: rawPayload,
    secret,
    timestamp: now,
  });

  const verified = verifyAtsWebhookSignature({
    payloadString: rawPayload,
    signatureHeader: `sha256=${validSig}`,
    timestampHeader: now,
    secret,
    nowMs: now + 5000, // 5s later
  });
  assert.equal(verified.valid, true, "Valid signature must pass");

  // 2. Expired timestamp (> 300s) rejected with replay attack protection
  const expiredVerification = verifyAtsWebhookSignature({
    payloadString: rawPayload,
    signatureHeader: `sha256=${validSig}`,
    timestampHeader: now - 350_000, // 350s ago
    secret,
    nowMs: now,
  });
  assert.equal(expiredVerification.valid, false);
  assert.ok(
    expiredVerification.reason?.includes("replay attack rejected"),
    "Must explicitly flag replay attack drift",
  );

  // 3. Missing timestamp rejected
  const missingTimestamp = verifyAtsWebhookSignature({
    payloadString: rawPayload,
    signatureHeader: `sha256=${validSig}`,
    timestampHeader: null,
    secret,
    nowMs: now,
  });
  assert.equal(missingTimestamp.valid, false);
  assert.ok(missingTimestamp.reason?.includes("Missing timestamp"));

  // 4. Tampered payload rejected
  const tampered = verifyAtsWebhookSignature({
    payloadString: JSON.stringify({ event: "candidate.created", test: "tampered" }),
    signatureHeader: `sha256=${validSig}`,
    timestampHeader: now,
    secret,
    nowMs: now,
  });
  assert.equal(tampered.valid, false);
  assert.ok(tampered.reason?.includes("mismatch"));

  // 5. Sliding-window rate-limiter: 60 req/min
  clearWebhookRateLimits();
  const testKey = "portal_ratelimit_test";
  for (let i = 0; i < 60; i++) {
    const res = checkWebhookRateLimit({ key: testKey, limit: 60, nowMs: now });
    assert.equal(res.allowed, true, `Request ${i + 1} should be allowed`);
  }
  // 61st request in same minute must be blocked
  const blocked = checkWebhookRateLimit({ key: testKey, limit: 60, nowMs: now });
  assert.equal(blocked.allowed, false, "61st request in same minute must be blocked");
  assert.equal(blocked.remaining, 0);

  // 61st request 61 seconds later must be allowed (sliding window reset)
  const allowedLater = checkWebhookRateLimit({ key: testKey, limit: 60, nowMs: now + 61_000 });
  assert.equal(allowedLater.allowed, true, "Request in subsequent minute window must be allowed");
});
