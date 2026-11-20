import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { computeAgencyMetrics } from "./agency-metrics.server.ts";

describe("Executive AI-Native Metrics Engine (The YC Model)", () => {
  test("computeAgencyMetrics returns all 8 core YC metrics", async () => {
    const res = await computeAgencyMetrics("test_org");

    assert.equal(res.metrics.length, 8);
    const keys = res.metrics.map((m) => m.key);

    assert.ok(keys.includes("time_to_first_slate"));
    assert.ok(keys.includes("candidate_to_interview"));
    assert.ok(keys.includes("interview_to_offer"));
    assert.ok(keys.includes("offer_to_join_rate"));
    assert.ok(keys.includes("cost_per_placement"));
    assert.ok(keys.includes("placements_per_recruiter"));
    assert.ok(keys.includes("client_repeat_rate"));
    assert.ok(keys.includes("retention_90_day"));

    // Financials sanity check
    assert.ok(res.financials.grossMarginPct >= 80);
    assert.ok(res.financials.averageComputeCostInr < 5000);

    // Auto-tuning loop presence
    assert.ok(res.autoTuning.tasteModelTuning);
    assert.ok(res.autoTuning.offerGuardHazardTuning);
    assert.ok(res.autoTuning.forensicFilterTuning);
  });
});
