import assert from "node:assert/strict";
import test from "node:test";
import {
  forecastFromHeads,
  headsForKind,
  initHead,
  outcomeFeatures,
  OUTCOME_HEADS,
  predictHead,
  trainHead,
} from "./outcome.ts";

test("joined teaches interview, offer, and join — not stay", () => {
  const steps = headsForKind("joined");
  assert.deepEqual(
    steps.map((s) => s.head),
    ["interview", "offer", "join"],
  );
  assert.ok(steps.every((s) => s.positive));
  assert.equal(headsForKind("left_90").find((s) => s.head === "retain90")?.positive, false);
});

test("quality heads separate strong profiles from weak ones after outcomes", () => {
  const heads = {
    interview: initHead(),
    offer: initHead(),
    join: initHead(),
    retain90: initHead(),
  };
  const strong = outcomeFeatures({
    score: 90,
    familyAligned: true,
    noticeDays: 30,
    riskCount: 0,
    domainScore: 80,
    screenScore: 85,
  });
  const weak = outcomeFeatures({
    score: 28,
    familyAligned: false,
    noticeDays: 90,
    riskCount: 4,
    domainScore: 20,
    screenScore: 30,
  });
  for (const head of OUTCOME_HEADS) {
    for (let i = 0; i < 10; i += 1) {
      trainHead(heads[head], strong, true);
      trainHead(heads[head], weak, false);
    }
  }
  const forecast = forecastFromHeads(heads, strong);
  const weakForecast = forecastFromHeads(heads, weak);
  assert.equal(forecast.ready, true);
  assert.ok((forecast.join ?? 0) > (weakForecast.join ?? 100));
  assert.ok((forecast.retain90 ?? 0) > (weakForecast.retain90 ?? 100));
  assert.ok(predictHead(heads.offer, strong) > predictHead(heads.offer, weak));
});

test("forecast stays hidden until a head has enough outcomes", () => {
  const heads = {
    interview: initHead(),
    offer: initHead(),
    join: initHead(),
    retain90: initHead(),
  };
  const x = outcomeFeatures({
    score: 70,
    familyAligned: true,
    noticeDays: 30,
    riskCount: 1,
    domainScore: null,
    screenScore: null,
  });
  const early = forecastFromHeads(heads, x);
  assert.equal(early.ready, false);
  assert.equal(early.interview, null);
});
