import assert from "node:assert/strict";
import test from "node:test";
import {
  alignmentScore,
  cosine,
  embedText,
  hashFeatures,
  initWeights,
  metricsToDocument,
  parseMarketPage,
  trainPair,
  trainReconstruction,
} from "./domain-embed.ts";

test("parser reads percents and index from a page, not from constants", () => {
  const html = `<html><body>
    White-collar hiring grew 2% YOY. AI/ML roles rose 20%.
    Education declined 18%. The JobSpeak index reached 3053.
    14,934,097 live postings in the dataset.
  </body></html>`;
  const metrics = parseMarketPage(html, "https://example.test/report");
  assert.ok(metrics.some((m) => m.unit === "percent" && m.value === 20));
  assert.ok(
    metrics.some((m) => m.unit === "percent" && m.value === -18) ||
      metrics.some((m) => m.value === 18),
  );
  assert.ok(metrics.some((m) => m.unit === "index" && m.value === 3053));
  assert.ok(metrics.some((m) => m.unit === "count" && m.value === 14934097));
  const doc = metricsToDocument(metrics);
  assert.match(doc, /3053/);
  assert.match(doc, /20/);
  assert.doesNotMatch(doc, /hardcoded/);
});

test("encoder reconstructs and separates labeled pairs", () => {
  const w = initWeights(7);
  const startup = "founding backend engineer seed bengaluru python postgres notice 30 days 28 lpa";
  const sales = "enterprise account executive mumbai quota president club fmcg distribution";
  for (let i = 0; i < 12; i += 1) {
    trainReconstruction(w, hashFeatures(startup + " shipped billing " + i));
    trainReconstruction(w, hashFeatures(sales + " closed logos " + i));
  }
  const role = "founding backend engineer bengaluru seed python";
  for (let i = 0; i < 25; i += 1) {
    trainPair(w, hashFeatures(startup), hashFeatures(role), true, null, 0.05);
    trainPair(w, hashFeatures(sales), hashFeatures(role), false, null, 0.05);
  }
  const pos = cosine(embedText(startup, w), embedText(role, w));
  const neg = cosine(embedText(sales, w), embedText(role, w));
  assert.ok(pos > neg, `expected startup closer than sales, got ${pos} vs ${neg}`);
  assert.ok(alignmentScore(pos) >= 0 && alignmentScore(pos) <= 100);
  assert.ok(w.steps >= 12);
  assert.ok(w.rankSteps >= 25);
});
