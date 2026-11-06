/**
 * Local evidence ranker — delegates core matching to the enterprise match engine.
 * Also provides offline screen / evaluate / client-card fallbacks (no demo data).
 */

import {
  matchCandidateToRole,
  type MatchCriterion,
  type MatchHardConstraints,
  type MatchWeights,
} from "./match-engine.ts";
import type {
  ClientCard,
  FitLevel,
  KnowledgeKind,
  ParsedProfile,
  RankResult,
  ScreenEvaluation,
  ScreenQuestion,
} from "./types";

export type RankCalibration = "production" | "strict";

export function calibrationFromPrompt(prompt: string): RankCalibration {
  if (/conservative|strict|high bar|false[- ]shortlist|never shortlist without|prefer maybe/i.test(prompt)) {
    return "strict";
  }
  return "production";
}

export function calibrateRank(rank: RankResult, calibration: RankCalibration): RankResult {
  if (calibration !== "strict") return rank;
  const score = Math.max(0, Math.min(100, rank.score - 10));
  const level: FitLevel =
    score >= 85 ? "strong_yes" : score >= 75 ? "yes" : score >= 55 ? "maybe" : "no";
  return {
    ...rank,
    score,
    level,
    summary: `${rank.summary} Strict calibration: bar raised to cut false shortlists.`,
  };
}

export function rankLocally(input: {
  resumeText: string;
  role: {
    companyName: string;
    companyStage: string;
    title: string;
    location: string;
    workMode: string;
    compensationBand: string;
    stack: string[];
    mustHaves: string[];
    niceToHaves: string[];
    jdText: string;
  };
  weights?: Partial<MatchWeights> | null;
  hardConstraints?: MatchHardConstraints | null;
  criteria?: MatchCriterion[] | null;
}): { profile: ParsedProfile; rank: RankResult } {
  return matchCandidateToRole(input);
}

function q(
  id: string,
  kind: KnowledgeKind,
  prompt: string,
  intent: string,
  time: number,
  follow: Array<{ id: string; prompt: string; intent: string }>,
): ScreenQuestion {
  return { id, kind, prompt, intent, time_minutes: time, follow_ups: follow };
}

export function localScreen(input: {
  roleTitle: string;
  companyName: string;
  stack: string[];
  candidateName: string;
  screenFocus: string[];
}): ScreenQuestion[] {
  const stack = input.stack.slice(0, 3).join(", ") || "the core skills for this role";
  const gap = input.screenFocus[0] || "the weakest skill match";
  const first = input.candidateName.split(" ")[0] || "you";
  return [
    q(
      "q1",
      "practical",
      `${first}, walk through one piece of work that maps closest to ${input.roleTitle} at ${input.companyName}. What did you own end-to-end?`,
      "Ownership and relevance to this seat",
      8,
      [
        {
          id: "q1f1",
          prompt: "What would you do differently with half the time or headcount?",
          intent: "Judgement under constraint",
        },
      ],
    ),
    q(
      "q2",
      "basic",
      `In your own words, how have you used ${stack}? Skip buzzwords — concrete examples only.`,
      "Skill depth vs resume claims",
      6,
      [],
    ),
    q(
      "q3",
      "common",
      `The resume is thinner on: ${gap}. How would you close that gap in the first 90 days here?`,
      "Gap awareness and learning plan",
      5,
      [],
    ),
  ];
}

export function localEvaluate(input: {
  roleTitle: string;
  answers: Array<{ question: string; answer: string }>;
}): ScreenEvaluation {
  const joined = input.answers.map((a) => a.answer).join(" ").trim();
  const thin = joined.length < 120;
  const score = thin ? 42 : Math.min(78, 52 + Math.floor(joined.length / 80));
  return {
    score,
    verdict: thin ? "thin" : score >= 70 ? "advance" : score >= 50 ? "review" : "reject",
    strengths: thin ? [] : ["Responded with concrete detail in places"],
    concerns: thin ? ["Very short answers"] : ["Validate claims in a live conversation"],
    notes: thin
      ? "Answers are thin — not enough signal to advance on screen alone."
      : `Written screen shows moderate signal for ${input.roleTitle}. Probe ownership live.`,
  };
}

export function localClientCard(input: {
  candidateName: string;
  roleTitle: string;
  companyName: string;
  rank: RankResult;
}): ClientCard {
  const indiaBits = [
    input.rank.india.location_fit !== "unknown" ? `Location: ${input.rank.india.location_fit}` : "",
    input.rank.india.notice_period_days != null
      ? `Notice: ${input.rank.india.notice_period_days} days`
      : "",
    input.rank.india.expected_ctc_lakh != null
      ? `Expected: ~${input.rank.india.expected_ctc_lakh} LPA`
      : "",
  ].filter(Boolean);

  return {
    candidate_name: input.candidateName,
    headline: `${input.candidateName} · ${input.roleTitle}`,
    fit_label: input.rank.level.replace("_", " "),
    summary: input.rank.summary,
    highlights: input.rank.evidence.slice(0, 4).map((e) => e.claim),
    watchouts: input.rank.risks.slice(0, 4),
    interview_probes: input.rank.screen_focus.slice(0, 4),
    location: input.rank.india.location_fit.replace(/_/g, " "),
    availability: indiaBits.join(" · ") || "See resume",
  };
}

