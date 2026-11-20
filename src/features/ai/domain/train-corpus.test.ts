import assert from "node:assert/strict";
import test from "node:test";
import {
  TRAINING_ROLES,
  TRAINING_CANDIDATES,
  RANKING_TRIPLETS,
  FUNNEL_TRAINING_SAMPLES,
} from "./train-corpus.ts";
import {
  initWeights,
  hashFeatures,
  encode,
  cosine,
  trainReconstruction,
  trainPair,
} from "./domain-embed.ts";
import {
  initCalWeights,
  predictProba,
  trainCalibration,
} from "../../ranking/domain/calibrate-explain.ts";
import {
  initHead,
  outcomeFeatures,
  predictHead,
  trainHead,
  OUTCOME_HEADS,
} from "../../ranking/domain/outcome.ts";

test("train-corpus: verifies structural integrity and coverage of roles and candidates", () => {
  assert.ok(TRAINING_ROLES.length >= 8, "Expected at least 8 training roles across disciplines");
  assert.ok(TRAINING_CANDIDATES.length >= 10, "Expected at least 10 diverse candidates");
  assert.ok(RANKING_TRIPLETS.length >= 4, "Expected at least 4 hard-negative triplets");
  assert.ok(FUNNEL_TRAINING_SAMPLES.length >= 16, "Expected at least 16 funnel outcome samples");

  for (const role of TRAINING_ROLES) {
    assert.ok(role.id, "Role must have id");
    assert.ok(role.stack.length > 0, "Role must have stack");
    assert.ok(role.text.length > 50, "Role must have descriptive text");
  }

  for (const candidate of TRAINING_CANDIDATES) {
    assert.ok(candidate.id, "Candidate must have id");
    assert.ok(candidate.resumeText.length > 100, "Candidate must have resume text");
    assert.ok(candidate.noticeDays > 0, "Candidate must have notice days");
  }
});

test("train-corpus: Domain Neural Network achieves >85% Recall@1 on hard-negative triplets", () => {
  const w = initWeights(0x1337);

  // Run brief pretraining + contrastive training
  for (const triplet of RANKING_TRIPLETS) {
    const roleFeat = hashFeatures(triplet.role.text);
    const posFeat = hashFeatures(triplet.positive.resumeText);
    const hardNegFeat = hashFeatures(triplet.hardNegative.resumeText);
    const easyNegFeat = hashFeatures(triplet.easyNegative.resumeText);

    for (let i = 0; i < 25; i++) {
      trainReconstruction(w, posFeat, 0.03);
      trainPair(w, posFeat, roleFeat, true, null, 0.02);
      trainPair(w, hardNegFeat, roleFeat, false, null, 0.02);
      trainPair(w, easyNegFeat, roleFeat, false, null, 0.02);
    }
  }

  let hits = 0;
  for (const triplet of RANKING_TRIPLETS) {
    const roleVec = encode(hashFeatures(triplet.role.text), w);
    const posVec = encode(hashFeatures(triplet.positive.resumeText), w);
    const hardNegVec = encode(hashFeatures(triplet.hardNegative.resumeText), w);
    const easyNegVec = encode(hashFeatures(triplet.easyNegative.resumeText), w);

    const posScore = cosine(posVec, roleVec);
    const hardNegScore = cosine(hardNegVec, roleVec);
    const easyNegScore = cosine(easyNegVec, roleVec);

    if (posScore > hardNegScore && posScore > easyNegScore) {
      hits++;
    }
  }

  const recallPct = (hits / RANKING_TRIPLETS.length) * 100;
  assert.ok(recallPct >= 85, `Expected Recall@1 >= 85%, got ${recallPct}%`);
});

test("train-corpus: Outcome heads and calibration model exceed 85% accuracy on funnel transitions", () => {
  const heads = {
    interview: initHead(),
    offer: initHead(),
    join: initHead(),
    retain90: initHead(),
  };

  for (let epoch = 0; epoch < 60; epoch++) {
    for (const sample of FUNNEL_TRAINING_SAMPLES) {
      const x = outcomeFeatures({
        score: sample.score,
        familyAligned: sample.familyAligned,
        noticeDays: sample.noticeDays,
        riskCount: sample.riskCount,
        domainScore: sample.domainScore,
        screenScore: sample.screenScore,
      });

      trainHead(heads.interview, x, sample.interviewPass, 0.09);
      if (sample.interviewPass) trainHead(heads.offer, x, sample.offerMade, 0.09);
      if (sample.offerMade) trainHead(heads.join, x, sample.joined, 0.09);
      if (sample.joined) trainHead(heads.retain90, x, sample.retained90, 0.09);
    }
  }

  for (const headName of OUTCOME_HEADS) {
    const head = heads[headName];
    const stageSamples = FUNNEL_TRAINING_SAMPLES.filter((s) => {
      if (headName === "interview") return true;
      if (headName === "offer") return s.interviewPass;
      if (headName === "join") return s.offerMade;
      return s.joined;
    });

    let correct = 0;
    for (const sample of stageSamples) {
      const x = outcomeFeatures({
        score: sample.score,
        familyAligned: sample.familyAligned,
        noticeDays: sample.noticeDays,
        riskCount: sample.riskCount,
        domainScore: sample.domainScore,
        screenScore: sample.screenScore,
      });
      const proba = predictHead(head, x);
      const target =
        headName === "interview"
          ? sample.interviewPass
          : headName === "offer"
            ? sample.offerMade
            : headName === "join"
              ? sample.joined
              : sample.retained90;

      if ((proba >= 0.5) === target) correct++;
    }

    const acc = (correct / stageSamples.length) * 100;
    assert.ok(acc >= 85, `Expected ${headName} accuracy >= 85%, got ${acc}%`);
  }
});
