import assert from "node:assert/strict";
import test from "node:test";
import type { RankResult } from "./types.ts";
import {
  explainRank,
  initCalWeights,
  parseHrPage,
  predictProba,
  rankFeatures,
  trainCalibration,
} from "./calibrate-explain.ts";

function rank(score: number, notice: number | null): RankResult {
  return {
    score,
    level: "maybe",
    summary: "Backend engineer with startup delivery and a 60 day notice.",
    evidence: [
      {
        claim: "Shipped billing",
        quote: "Owned billing service from zero to one at a seed startup.",
      },
    ],
    gaps: ["No on-call evidence"],
    risks: ["Notice period 60 days — plan overlap"],
    india: {
      location_fit: "local",
      notice_period_days: notice,
      current_ctc_lakh: 24,
      expected_ctc_lakh: 32,
      early_stage_fit: "high",
      notes: "",
    },
    stack_match: [],
    screen_focus: [],
    match: {
      dimensions: [],
      hardGates: [],
      roleFamily: "engineering",
      resumeFamily: "engineering",
      familyAligned: true,
    },
  };
}

test("calibration moves with labels and stays withheld until enough samples", () => {
  const w = initCalWeights();
  const high = rankFeatures(rank(88, 30));
  const low = rankFeatures(rank(30, 90));
  for (let i = 0; i < 20; i += 1) {
    trainCalibration(w, high, true);
    trainCalibration(w, low, false);
  }
  assert.ok(predictProba(w, high) > predictProba(w, low));
  assert.equal(w.samples, 40);
  const early = explainRank(rank(80, 30), initCalWeights(), []);
  assert.equal(early.pShortlist, null);
  assert.match(early.hi, /कैलिब्रेशन/);
  const ready = explainRank(rank(80, 90), w, []);
  assert.ok(ready.pShortlist != null);
  assert.match(ready.en, /Notice is 90 days/);
  assert.match(ready.hi, /नोटिस पीरियड 90 दिन/);
  assert.match(ready.en, /Owned billing/);
});

test("HR page parser keeps English glossary lines and Hindi sentences", () => {
  const html = `<p>Notice Period is commonly 30, 60 or 90 days in Delhi NCR companies and buyout may be refused.</p>
    <p>CTC means the full cost to company including PF and gratuity for the employee.</p>
    <p>सर, मीटिंग शुरू करें और ऑफर लेटर में CTC और नोटिस पीरियड साफ लिखें वरना जॉइनिंग अटक जाएगी।</p>
    <p>Cookies and weather are unrelated.</p>`;
  const chunks = parseHrPage(html, "https://example.test/hr");
  assert.ok(chunks.some((c) => c.lang === "en" && /notice/i.test(c.text)));
  assert.ok(chunks.some((c) => c.lang === "hi" && /नोटिस/.test(c.text)));
  assert.ok(!chunks.some((c) => /weather/i.test(c.text)));
});
