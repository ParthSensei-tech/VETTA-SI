import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { analyzeJobIntake } from "./intake-playbook.ts";
import {
  handleCtcFixedObjection,
  handleNoticePeriodObjection,
} from "./objection-playbook.ts";
import { generateCounterOfferDefense } from "./counter-offer-defense-playbook.ts";

describe("Codified Recruiter Playbooks", () => {
  test("analyzeJobIntake identifies startup velocity and hard must-haves", () => {
    const transcript = `
      We are a Series A startup shipping fast.
      Must have 4+ years in Go / Golang microservices.
      Dealbreaker: No IT service firms, we need someone who owned production systems.
      Max budget cap is 45 LPA.
    `;
    const res = analyzeJobIntake(transcript);

    assert.equal(res.unwrittenCulturePace, "high_velocity_startup");
    assert.equal(res.compCeilingFixedLpa, 45);
    assert.ok(res.dealbreakers.length > 0);
    assert.ok(res.dealbreakers.some((d) => d.includes("product engineering")));
  });

  test("handleCtcFixedObjection proves true fixed raise over variable bonus", () => {
    const res = handleCtcFixedObjection({
      currentFixedLpa: 22,
      currentVariableLpa: 8,
      offeredFixedLpa: 33,
      offeredVariableLpa: 2,
    });

    assert.equal(res.category, "ctc_fixed_vs_variable");
    assert.ok(res.headline.includes("+50%")); // 22 -> 33 is 50% fixed hike
    assert.ok(res.mathExplanation.includes("pure fixed pay"));
    assert.ok(res.recommendedCounselingScript.includes("guaranteed component"));
  });

  test("handleNoticePeriodObjection generates buyout advice when over 45 days", () => {
    const res = handleNoticePeriodObjection({
      candidateNoticeDays: 90,
      clientMaxAllowedDays: 45,
      currentFixedLpa: 24,
    });

    assert.equal(res.category, "notice_period_buyout");
    assert.ok(res.headline.includes("Buyout Strategy"));
    assert.ok(res.recommendedCounselingScript.includes("release you early"));
  });

  test("generateCounterOfferDefense triggers critical tier when counter-offer received", () => {
    const res = generateCounterOfferDefense({
      hikePercentage: 35,
      currentTenureYears: 2.5,
      relationshipWithManager: "close",
      hasReceivedCounterOffer: true,
      counterOfferAmountLpa: 38,
    });

    assert.equal(res.riskTier, "critical");
    assert.ok(res.defenseHeadline.includes("Active Retention Hazard"));
    assert.ok(res.psychologicalTalkingPoints.some((p) => p.includes("Over 80%")));
    assert.ok(res.counterOfferRefusalScript.includes("my decision is final"));
  });
});
