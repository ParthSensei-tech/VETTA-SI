import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBaselineHazard,
  evaluateLatentState,
  classifyRiskTier,
  getPrescriptivePlaybooks,
  calculateFullHazardAssessment,
  getTutorialBubbles,
} from "./offer-guard-hazard.ts";
import type { BaselineHazardParams, TelemetrySnapshot } from "./types.ts";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeBaseline(overrides: Partial<BaselineHazardParams> = {}): BaselineHazardParams {
  return {
    totalNoticeDays: 60,
    hikePercentage: 25,
    currentEmployerType: "midmarket_services",
    requiresRelocation: false,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    daysSinceAcceptance: 5,
    totalNoticeDays: 60,
    resignationSubmitted: false,
    daysSinceAcceptanceToResignation: null,
    averageResponseLatencyHours: 4,
    responseLatencyTrend: 1.0,
    preboardingPortalVisits: 2,
    bgvDocumentsSubmitted: false,
    dojDelayRequested: false,
    evasionSignalCount: 0,
    counterofferHintCount: 0,
    ...overrides,
  };
}

// ── Baseline Hazard ─────────────────────────────────────────────────────

describe("computeBaselineHazard", () => {
  it("produces higher hazard for longer notice periods", () => {
    const h30 = computeBaselineHazard(makeBaseline({ totalNoticeDays: 30 }));
    const h60 = computeBaselineHazard(makeBaseline({ totalNoticeDays: 60 }));
    const h90 = computeBaselineHazard(makeBaseline({ totalNoticeDays: 90 }));
    assert.ok(h30 < h60, `30d (${h30}) should be < 60d (${h60})`);
    assert.ok(h60 < h90, `60d (${h60}) should be < 90d (${h90})`);
  });

  it("produces higher hazard for low hike percentages (counteroffer vulnerability)", () => {
    const hLow = computeBaselineHazard(makeBaseline({ hikePercentage: 10 }));
    const hSweet = computeBaselineHazard(makeBaseline({ hikePercentage: 25 }));
    assert.ok(
      hLow > hSweet,
      `10% hike (${hLow}) should have higher hazard than 25% sweet spot (${hSweet})`,
    );
  });

  it("produces higher hazard for high hike percentages (shopping risk)", () => {
    const hSweet = computeBaselineHazard(makeBaseline({ hikePercentage: 30 }));
    const hHigh = computeBaselineHazard(makeBaseline({ hikePercentage: 55 }));
    assert.ok(
      hHigh > hSweet,
      `55% hike (${hHigh}) should have higher hazard than 30% (${hSweet})`,
    );
  });

  it("GCC/Product employers have highest counteroffer retention elasticity", () => {
    const gcc = computeBaselineHazard(makeBaseline({ currentEmployerType: "gcc_product" }));
    const it = computeBaselineHazard(makeBaseline({ currentEmployerType: "tier1_it_services" }));
    assert.ok(
      gcc > it,
      `GCC (${gcc}) should have higher hazard than Tier-1 IT (${it}) due to retention counteroffer rate`,
    );
  });

  it("relocation adds friction", () => {
    const noReloc = computeBaselineHazard(makeBaseline({ requiresRelocation: false }));
    const reloc = computeBaselineHazard(makeBaseline({ requiresRelocation: true }));
    assert.ok(reloc > noReloc, `Relocation (${reloc}) should add to hazard (${noReloc})`);
  });

  it("never returns below 5 or above 95", () => {
    const low = computeBaselineHazard(
      makeBaseline({ totalNoticeDays: 10, hikePercentage: 30, currentEmployerType: "tier1_it_services" }),
    );
    assert.ok(low >= 5, `Minimum hazard must be >= 5, got ${low}`);
    const high = computeBaselineHazard(
      makeBaseline({ totalNoticeDays: 120, hikePercentage: 0, currentEmployerType: "gcc_product", requiresRelocation: true }),
    );
    assert.ok(high <= 95, `Maximum hazard must be <= 95, got ${high}`);
  });
});

// ── Dynamic State-Space Evaluation ──────────────────────────────────────

describe("evaluateLatentState", () => {
  it("response latency drift 2.5x escalates hazard significantly", () => {
    const base = 25;
    const { hazardScore } = evaluateLatentState(base, "committed", makeSnapshot({
      responseLatencyTrend: 2.5,
    }));
    assert.ok(
      hazardScore > base * 1.5,
      `2.5x latency drift should escalate hazard from ${base} to at least ${base * 1.5}, got ${hazardScore}`,
    );
  });

  it("resignation submitted reduces hazard", () => {
    const base = 40;
    const { hazardScore: without } = evaluateLatentState(base, "wavering", makeSnapshot({
      daysSinceAcceptance: 12,
      resignationSubmitted: false,
    }));
    const { hazardScore: with_ } = evaluateLatentState(base, "wavering", makeSnapshot({
      daysSinceAcceptance: 12,
      resignationSubmitted: true,
    }));
    assert.ok(
      with_ < without,
      `Resignation submitted (${with_}) should be lower risk than not submitted (${without})`,
    );
  });

  it("DOJ delay request is the strongest single escalation signal", () => {
    const base = 30;
    const { hazardScore } = evaluateLatentState(base, "committed", makeSnapshot({
      dojDelayRequested: true,
    }));
    assert.ok(
      hazardScore > base * 2.5,
      `DOJ delay should massively escalate hazard from ${base}, got ${hazardScore}`,
    );
  });

  it("multiple evasion signals compound risk", () => {
    const base = 30;
    const { hazardScore: one } = evaluateLatentState(base, "wavering", makeSnapshot({
      evasionSignalCount: 1,
    }));
    const { hazardScore: three } = evaluateLatentState(base, "wavering", makeSnapshot({
      evasionSignalCount: 3,
    }));
    assert.ok(three > one, `3 evasion signals (${three}) should be > 1 signal (${one})`);
  });

  it("terminal states are idempotent", () => {
    const { intentState: joined, hazardScore: jh } = evaluateLatentState(50, "joined", makeSnapshot());
    assert.equal(joined, "joined");
    assert.equal(jh, 0);

    const { intentState: reneged, hazardScore: rh } = evaluateLatentState(50, "reneged", makeSnapshot());
    assert.equal(reneged, "reneged");
    assert.equal(rh, 100);
  });

  it("high hazard transitions to imminent_renege state", () => {
    const { intentState } = evaluateLatentState(60, "counteroffered", makeSnapshot({
      responseLatencyTrend: 3.5,
      dojDelayRequested: true,
      evasionSignalCount: 2,
    }));
    assert.equal(intentState, "imminent_renege");
  });
});

// ── Risk Tier Classification ────────────────────────────────────────────

describe("classifyRiskTier", () => {
  it("correctly classifies tiers", () => {
    assert.equal(classifyRiskTier(10), "low");
    assert.equal(classifyRiskTier(25), "low");
    assert.equal(classifyRiskTier(26), "moderate");
    assert.equal(classifyRiskTier(55), "moderate");
    assert.equal(classifyRiskTier(56), "high");
    assert.equal(classifyRiskTier(79), "high");
    assert.equal(classifyRiskTier(80), "critical");
    assert.equal(classifyRiskTier(98), "critical");
  });
});

// ── Prescriptive Playbooks ──────────────────────────────────────────────

describe("getPrescriptivePlaybooks", () => {
  it("recommends resignation escalation when proof is delayed", () => {
    const playbooks = getPrescriptivePlaybooks(30, "committed", makeSnapshot({
      daysSinceAcceptance: 12,
      resignationSubmitted: false,
    }));
    const keys = playbooks.map((p) => p.key);
    assert.ok(
      keys.includes("resignation_escalation"),
      `Should include resignation_escalation, got: ${keys.join(", ")}`,
    );
  });

  it("recommends counteroffer defense when counteroffered", () => {
    const playbooks = getPrescriptivePlaybooks(60, "counteroffered", makeSnapshot({
      counterofferHintCount: 1,
    }));
    const keys = playbooks.map((p) => p.key);
    assert.ok(keys.includes("counteroffer_defense"), `Should include counteroffer_defense`);
  });

  it("recommends DOJ delay counter strategy", () => {
    const playbooks = getPrescriptivePlaybooks(50, "wavering", makeSnapshot({
      dojDelayRequested: true,
    }));
    const keys = playbooks.map((p) => p.key);
    assert.ok(keys.includes("doj_delay_counter"), `Should include doj_delay_counter`);
    const doj = playbooks.find((p) => p.key === "doj_delay_counter")!;
    assert.equal(doj.urgency, "critical");
  });

  it("recommends silver medalist standby at critical risk", () => {
    const playbooks = getPrescriptivePlaybooks(80, "imminent_renege", makeSnapshot({
      daysSinceAcceptance: 50,
      totalNoticeDays: 60,
    }));
    const keys = playbooks.map((p) => p.key);
    assert.ok(keys.includes("silver_medalist_warm"), `Should include silver_medalist_warm`);
  });

  it("recommends preboarding engagement in mid-notice window", () => {
    const playbooks = getPrescriptivePlaybooks(35, "wavering", makeSnapshot({
      daysSinceAcceptance: 30,
      totalNoticeDays: 60,
      preboardingPortalVisits: 1,
    }));
    const keys = playbooks.map((p) => p.key);
    assert.ok(keys.includes("preboarding_engagement"), `Should include preboarding_engagement`);
  });

  it("produces no playbooks for terminal states", () => {
    assert.equal(getPrescriptivePlaybooks(0, "joined", makeSnapshot()).length, 0);
    assert.equal(getPrescriptivePlaybooks(100, "reneged", makeSnapshot()).length, 0);
  });

  it("sorts playbooks by urgency: critical first", () => {
    const playbooks = getPrescriptivePlaybooks(85, "imminent_renege", makeSnapshot({
      daysSinceAcceptance: 45,
      totalNoticeDays: 60,
      dojDelayRequested: true,
      resignationSubmitted: false,
      preboardingPortalVisits: 0,
    }));
    assert.ok(playbooks.length >= 2, `Should have multiple playbooks, got ${playbooks.length}`);
    assert.equal(playbooks[0].urgency, "critical", "First playbook should be critical urgency");
  });
});

// ── Full Hazard Assessment ──────────────────────────────────────────────

describe("calculateFullHazardAssessment", () => {
  it("produces a complete assessment with drivers and playbooks", () => {
    const assessment = calculateFullHazardAssessment(
      makeBaseline({ totalNoticeDays: 75, hikePercentage: 15, currentEmployerType: "gcc_product" }),
      15, // default hazard
      "committed",
      makeSnapshot({
        daysSinceAcceptance: 20,
        totalNoticeDays: 75,
        resignationSubmitted: false,
        responseLatencyTrend: 2.0,
      }),
    );
    assert.ok(typeof assessment.hazardScore === "number");
    assert.ok(["low", "moderate", "high", "critical"].includes(assessment.riskTier));
    assert.ok(Array.isArray(assessment.primaryDrivers));
    assert.ok(Array.isArray(assessment.playbooks));
    // With 75d notice, 15% hike, GCC employer, and no resignation at day 20: should be elevated
    assert.ok(assessment.hazardScore > 30, `GCC + long notice + low hike should elevate beyond 30, got ${assessment.hazardScore}`);
  });
});

// ── Tutorial Bubbles ────────────────────────────────────────────────────

describe("getTutorialBubbles", () => {
  it("returns setup bubbles for empty state", () => {
    const bubbles = getTutorialBubbles("empty_state");
    assert.ok(bubbles.length >= 1);
    assert.equal(bubbles[0].stage, "setup");
  });

  it("returns monitoring bubbles for new offers", () => {
    const bubbles = getTutorialBubbles("new_offer");
    assert.ok(bubbles.length >= 1);
    assert.ok(bubbles.some((b) => b.stage === "monitoring" || b.stage === "setup"));
  });

  it("returns intervention bubbles for amber and red alerts", () => {
    const amber = getTutorialBubbles("amber_alert");
    assert.ok(amber.every((b) => b.stage === "intervention"));
    const red = getTutorialBubbles("red_alert");
    assert.ok(red.every((b) => b.stage === "intervention"));
  });

  it("returns resolution bubbles for resolved state", () => {
    const bubbles = getTutorialBubbles("resolved");
    assert.ok(bubbles.length >= 1);
    assert.equal(bubbles[0].stage, "resolution");
  });
});
