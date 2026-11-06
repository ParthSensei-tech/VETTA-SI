import assert from "node:assert/strict";
import test from "node:test";
import { cosine, mergeRetrievalScore } from "./retrieve.ts";

test("cross-lingual meaning can outrank a weak word match", () => {
  const lexicalOnly = mergeRetrievalScore(0.05, null);
  const hindiQueryEnglishResume = mergeRetrievalScore(0, 0.82);
  assert.ok(hindiQueryEnglishResume > lexicalOnly);
});

test("cosine is 1 for the same vector", () => {
  assert.ok(Math.abs(cosine([0.2, 0.4, 0.8], [0.2, 0.4, 0.8]) - 1) < 1e-6);
});
