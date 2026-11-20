import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  createZeroVector,
  normalizeVector,
  cosineSimilarity,
  extractCandidateFeatureVector,
  computeTasteAdjustedScore,
} from "./taste-engine.server.ts";

describe("Client Taste Memory & Calibration Engine", () => {
  test("createZeroVector creates a 32-d zero vector", () => {
    const v = createZeroVector(32);
    assert.equal(v.length, 32);
    assert.ok(v.every((x) => x === 0));
  });

  test("normalizeVector calculates unit vector length", () => {
    const v = [3, 4, 0, 0];
    const normalized = normalizeVector(v);
    const sumSq = normalized.reduce((acc, x) => acc + x * x, 0);
    assert.ok(Math.abs(sumSq - 1.0) < 1e-5);
  });

  test("cosineSimilarity calculates identical vectors as 1.0", () => {
    const a = normalizeVector([1, 2, 3, 4]);
    const sim = cosineSimilarity(a, a);
    assert.ok(Math.abs(sim - 1.0) < 1e-5);
  });

  test("cosineSimilarity calculates orthogonal vectors as 0.0", () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    const sim = cosineSimilarity(a, b);
    assert.equal(sim, 0);
  });

  test("extractCandidateFeatureVector converts text to 32-d normalized vector", () => {
    const v = extractCandidateFeatureVector("Senior Distributed Systems Engineer Golang Kafka Kubernetes");
    assert.equal(v.length, 32);
    const sumSq = v.reduce((acc, x) => acc + x * x, 0);
    assert.ok(Math.abs(sumSq - 1.0) < 1e-4);
  });

  test("computeTasteAdjustedScore leaves score unchanged when 0 samples exist", () => {
    const zero = createZeroVector(32);
    const res = computeTasteAdjustedScore(80, zero, "Golang engineer", 0);
    assert.equal(res.finalScore, 80);
    assert.equal(res.tasteDelta, 0);
  });

  test("computeTasteAdjustedScore boosts candidate that matches client taste vector", () => {
    const preferredText = "High velocity product startup Go microservices Kafka";
    const tasteVector = extractCandidateFeatureVector(preferredText);
    const res = computeTasteAdjustedScore(75, tasteVector, preferredText, 10);
    assert.ok(res.finalScore >= 75);
    assert.ok(res.similarity > 0.8);
  });

  test("computeTasteAdjustedScore penalizes candidate that clashes with client taste vector", () => {
    const preferredText = "High velocity product startup Go microservices Kafka";
    const clashingText = "Academic research paper manual tester legacy mainframe";
    const tasteVector = extractCandidateFeatureVector(preferredText);
    const res = computeTasteAdjustedScore(85, tasteVector, clashingText, 15);
    assert.ok(res.tasteDelta <= 0);
  });
});
