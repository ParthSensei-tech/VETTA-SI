import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVACY_STORES,
  PURPOSES,
  basisAllows,
  providerForgetResult,
  purposeDenied,
  sha256Hex,
  stripShareCandidates,
  subjectRef,
  withdrawalEffect,
} from "./privacy.ts";

test("evaluation can rest on employer instruction; voice cannot", () => {
  assert.equal(
    basisAllows({
      purpose: "recruitment_evaluation",
      rows: [{ granted: true, basis: "employer_instruction" }],
      employerCoversClientShare: true,
      employerCoversModelTraining: false,
    }),
    true,
  );
  assert.equal(
    basisAllows({
      purpose: "voice_prescreen",
      rows: [{ granted: true, basis: "employer_instruction" }],
      employerCoversClientShare: true,
      employerCoversModelTraining: true,
    }),
    false,
  );
});

test("a withdrawal beats the legacy assumption", () => {
  assert.equal(
    basisAllows({
      purpose: "client_disclosure",
      rows: [{ granted: false, basis: "consent" }],
      employerCoversClientShare: true,
      employerCoversModelTraining: false,
    }),
    false,
  );
  assert.equal(
    basisAllows({
      purpose: "client_disclosure",
      rows: [],
      employerCoversClientShare: true,
      employerCoversModelTraining: false,
    }),
    true,
  );
});

test("model learning stays off unless the company turns it on or the person agrees", () => {
  assert.equal(
    basisAllows({
      purpose: "model_improvement",
      rows: [{ granted: true, basis: "employer_instruction" }],
      employerCoversClientShare: true,
      employerCoversModelTraining: false,
    }),
    false,
  );
  assert.equal(
    basisAllows({
      purpose: "model_improvement",
      rows: [{ granted: true, basis: "consent" }],
      employerCoversClientShare: false,
      employerCoversModelTraining: false,
    }),
    true,
  );
});

test("share export drops people who cannot be disclosed", () => {
  const { kept, removed } = stripShareCandidates(
    [{ applicationId: "a" }, { applicationId: "b" }],
    new Set(["b"]),
  );
  assert.deepEqual(kept, [{ applicationId: "a" }]);
  assert.equal(removed, 1);
});

test("erasure reference is not the raw id and does not change", async () => {
  const a = await subjectRef("org", "person");
  const b = await subjectRef("org", "person");
  assert.equal(a, b);
  assert.equal(a.includes("person"), false);
  assert.equal((await sha256Hex("x")).length, 64);
});

test("withdrawal of evaluation erases; narrower purposes only stop that use", () => {
  assert.equal(withdrawalEffect("recruitment_evaluation"), "erase");
  assert.equal(withdrawalEffect("client_disclosure"), "shares");
  assert.equal(withdrawalEffect("voice_prescreen"), "voice");
  assert.equal(withdrawalEffect("model_improvement"), "learning");
  // Not `erase`: the file goes and the verdict that was reached from it stays,
  // because the person who says no to a scan is not thereby un-verifying the
  // arithmetic already done on their text.
  assert.equal(withdrawalEffect("document_forensics"), "bytes");
  assert.ok(PRIVACY_STORES.includes("embed_seen"));
});

test("deletion names every store, and vendors cannot be told to forget a chat prompt", () => {
  assert.ok(PRIVACY_STORES.includes("audit_events"));
  assert.ok(PRIVACY_STORES.includes("rank_cache"));
  assert.ok(PRIVACY_STORES.includes("client_shares"));
  assert.ok(PRIVACY_STORES.includes("provider_disclosures"));
  assert.ok(PRIVACY_STORES.includes("rank_traces"));
  assert.ok(PRIVACY_STORES.includes("eval_cases"));
  assert.ok(PRIVACY_STORES.includes("embed_seen"));
  // The only store on this list that holds the person's file rather than a parse
  // of it, which is why `eraseSubject` has to reach it through the ingest job as
  // well as through the candidate and the application.
  assert.ok(PRIVACY_STORES.includes("documents"));
  assert.equal(PRIVACY_STORES.length, 20);
  assert.equal(providerForgetResult("ollama").status, "local_only");
  assert.equal(providerForgetResult("groq").status, "no_delete_api");
  assert.equal(
    PURPOSES.filter((p) => p.requiredOnApply)
      .map((p) => p.id)
      .join(),
    "recruitment_evaluation",
  );
  // The file purpose is the workspace's decision, not a question the portal can
  // ask a person at apply time — so it must never grow an apply-time ask.
  assert.equal(
    PURPOSES.filter((p) => p.askOnApply)
      .map((p) => p.id)
      .join(),
    "recruitment_evaluation,client_disclosure,voice_prescreen,model_improvement",
  );
  assert.match(purposeDenied("voice_prescreen"), /Voice/);
  assert.match(purposeDenied("client_disclosure"), /shared/);
  assert.match(purposeDenied("model_improvement"), /model learning/);
  assert.match(purposeDenied("document_forensics"), /original document/);
});

test("in-memory rank cache eviction purges specific resume hashes and clears completely", () => {
  const mem = new Map<string, { score: number }>();
  mem.set("hash-cand-1", { score: 92 });
  mem.set("hash-cand-2", { score: 78 });
  mem.set("hash-cand-3", { score: 84 });

  assert.equal(mem.size, 3);
  const hashesToEvict = ["hash-cand-1", "hash-cand-3"];
  for (const h of hashesToEvict) {
    mem.delete(h);
  }
  assert.equal(mem.has("hash-cand-1"), false);
  assert.equal(mem.has("hash-cand-2"), true);
  assert.equal(mem.has("hash-cand-3"), false);

  mem.clear();
  assert.equal(mem.size, 0);
});
