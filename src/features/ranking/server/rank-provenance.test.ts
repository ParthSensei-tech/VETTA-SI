import assert from "node:assert/strict";
import test from "node:test";
import { computeRubricHash, cacheKey } from "../../../lib/recruiting/hash.ts";
import {
  clearRankCache,
  getRankCache,
  setRankCache,
  invalidateRoleRankCache,
} from "./rank-cache.server.ts";
import type { ParsedProfile, RankProvenance, RankResult } from "../../../lib/recruiting/types.ts";

const dummyProfile: ParsedProfile = {
  full_name: "Aarav Patel",
  email: "aarav@example.com",
  phone: "+91 9876543210",
  location: "Bengaluru",
  linkedin_url: "https://linkedin.com/in/aarav",
  current_title: "Senior Backend Engineer",
  current_company: "Razorpay",
  years_experience: 5,
  skills: ["Node.js", "PostgreSQL", "Go", "Distributed Systems"],
  summary: "Experienced backend engineer scaling payment services.",
};

const dummyRank: RankResult = {
  score: 85,
  level: "strong_yes",
  summary: "Strong candidate with core payment gateway and microservices experience.",
  evidence: [
    { claim: "Scales distributed systems", quote: "Built payment gateway handling 10k tps." },
  ],
  gaps: [],
  risks: [],
  india: {
    location_fit: "local",
    notice_period_days: 30,
    current_ctc_lakh: 35,
    expected_ctc_lakh: 42,
    early_stage_fit: "high",
    notes: "Bengaluru local with reasonable notice period.",
  },
  stack_match: [
    { skill: "Go", level: "strong" },
    { skill: "PostgreSQL", level: "strong" },
  ],
  screen_focus: ["Database sharding", "Concurrency control"],
};

test("computeRubricHash produces a deterministic 64-char hex hash", () => {
  const criteria = [
    {
      id: "c1",
      name: "System Design",
      weight: "high",
      kind: "technical",
      strongEvidence: "Distributed architecture",
    },
    {
      id: "c2",
      name: "Culture Fit",
      weight: "medium",
      kind: "soft",
      strongEvidence: "Ownership and startup mindset",
    },
  ];
  const constraints = { noticeMaxDays: 60, strictFilter: false };

  const hash1 = computeRubricHash(criteria, constraints);
  const hash2 = computeRubricHash(criteria, constraints);

  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64);
  assert.equal(hash1, hash2, "Rubric hashes must be identical for identical inputs");
});

test("computeRubricHash is order-independent across criteria list", () => {
  const c1 = {
    id: "c1",
    name: "System Design",
    weight: "high",
    kind: "technical",
    strongEvidence: "Distributed architecture",
  };
  const c2 = {
    id: "c2",
    name: "Culture Fit",
    weight: "medium",
    kind: "soft",
    strongEvidence: "Ownership",
  };

  const hashAsc = computeRubricHash([c1, c2]);
  const hashDesc = computeRubricHash([c2, c1]);

  assert.equal(hashAsc, hashDesc, "Ordering of criteria must not affect hash");
});

test("computeRubricHash changes when weights or constraints change", () => {
  const baseCriteria = [{ id: "c1", name: "System Design", weight: "high", kind: "technical" }];

  const hashBase = computeRubricHash(baseCriteria, { noticeMaxDays: 30 });
  const hashWeightChanged = computeRubricHash(
    [{ id: "c1", name: "System Design", weight: "low", kind: "technical" }],
    { noticeMaxDays: 30 },
  );
  const hashConstraintChanged = computeRubricHash(baseCriteria, { noticeMaxDays: 60 });

  assert.notEqual(hashBase, hashWeightChanged, "Changing weight must alter the rubric hash");
  assert.notEqual(
    hashBase,
    hashConstraintChanged,
    "Changing hard constraints must alter the rubric hash",
  );
});

test("cacheKey is deterministic across role, candidate and mode", () => {
  const key1 = cacheKey({
    userId: "u1",
    resumeHash: "res123",
    roleHash: "role456",
    mode: "full",
  });
  const key2 = cacheKey({
    userId: "u1",
    resumeHash: "res123",
    roleHash: "role456",
    mode: "full",
  });

  assert.equal(key1, "u1:res123:role456:full");
  assert.equal(key1, key2);
});

test("setRankCache stores model, provider, rubric version metadata and getRankCache retrieves it", async () => {
  clearRankCache();
  const userId = "test_user_prov_1";
  const resumeHash = "resume_hash_111";
  const roleHash = "role_hash_222";
  const rubricHash = "rubric_v1_hash";

  await setRankCache({
    userId,
    resumeHash,
    roleHash,
    mode: "full",
    engine: "gemini",
    provider: "google",
    model: "gemini-2.5-flash",
    rubricVersionId: "rubric_uuid_1",
    rubricVersion: 1,
    rubricHash,
    profile: dummyProfile,
    rank: dummyRank,
  });

  const hit = await getRankCache({
    userId,
    resumeHash,
    roleHash,
    mode: "full",
    rubricHash,
  });

  assert.ok(hit, "Cache hit must be found");
  assert.equal(hit.fromCache, true);
  assert.equal(hit.engine, "gemini");
  assert.equal(hit.provider, "google");
  assert.equal(hit.model, "gemini-2.5-flash");
  assert.equal(hit.rubricVersion, 1);
  assert.equal(hit.rubricHash, rubricHash);
});

test("getRankCache invalidates and evicts stale scores when rubricHash mismatches", async () => {
  clearRankCache();
  const userId = "test_user_stale_1";
  const resumeHash = "resume_hash_333";
  const roleHash = "role_hash_444";
  const oldRubricHash = "rubric_v1_hash";
  const newRubricHash = "rubric_v2_hash";

  // Store score calculated with v1 rubric
  await setRankCache({
    userId,
    resumeHash,
    roleHash,
    mode: "full",
    engine: "local",
    provider: "local",
    model: "evidence",
    rubricVersion: 1,
    rubricHash: oldRubricHash,
    profile: dummyProfile,
    rank: dummyRank,
  });

  // Querying with the new rubric hash must invalidate stale cache and return null
  const staleMiss = await getRankCache({
    userId,
    resumeHash,
    roleHash,
    mode: "full",
    rubricHash: newRubricHash,
  });

  assert.equal(
    staleMiss,
    null,
    "Mismatched rubric hash must invalidate cache entry and return null",
  );

  // A subsequent query with old rubric hash should also be gone from memory
  const oldCheck = await getRankCache({
    userId,
    resumeHash,
    roleHash,
    mode: "full",
    rubricHash: oldRubricHash,
  });
  assert.equal(oldCheck, null, "Evicted entry must no longer exist in memory");
});

test("invalidateRoleRankCache evicts in-memory entries for modified roles", async () => {
  clearRankCache();
  const userId = "test_user_role_inval";
  const roleHash = "role_to_invalidate";

  await setRankCache({
    userId,
    resumeHash: "candidate_a",
    roleHash,
    mode: "full",
    engine: "local",
    profile: dummyProfile,
    rank: dummyRank,
    rubricVersionId: "rubric_v1",
  });

  const count = await invalidateRoleRankCache({
    userId,
    roleHash,
    rubricVersionId: "rubric_v2", // different rubric version
  });

  assert.ok(count >= 1, "Must evict at least one cache entry");

  const after = await getRankCache({
    userId,
    resumeHash: "candidate_a",
    roleHash,
    mode: "full",
  });
  assert.equal(after, null, "Invalidated entry must not be returned");
});

test("RankProvenance correctly differentiates Local Rule Engine vs LLM models", () => {
  const localProvenance: RankProvenance = {
    engine: "local",
    isLocal: true,
    provider: "local",
    model: "evidence",
    rubricVersion: 2,
    rubricVersionId: "rubric-v2-id",
    rubricHash: "hash123",
    evaluatedAt: new Date().toISOString(),
    isStale: false,
    staleReason: null,
  };

  const llmProvenance: RankProvenance = {
    engine: "groq",
    isLocal: false,
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    rubricVersion: 2,
    rubricVersionId: "rubric-v2-id",
    rubricHash: "hash123",
    evaluatedAt: new Date().toISOString(),
    isStale: true,
    staleReason: "Rubric updated to v3",
  };

  assert.equal(localProvenance.isLocal, true);
  assert.equal(localProvenance.provider, "local");
  assert.equal(localProvenance.isStale, false);

  assert.equal(llmProvenance.isLocal, false);
  assert.equal(llmProvenance.provider, "groq");
  assert.equal(llmProvenance.model, "llama-3.3-70b-versatile");
  assert.equal(llmProvenance.isStale, true);
  assert.equal(llmProvenance.staleReason, "Rubric updated to v3");
});
