import type { FitLevel } from "../types";

export const FIT_ORDER: Record<FitLevel, number> = {
  no: 0,
  maybe: 1,
  yes: 2,
  strong_yes: 3,
};

export function isShortlist(level: FitLevel): boolean {
  return level === "yes" || level === "strong_yes";
}

export type CaseScore = {
  agree: boolean;
  adjacent: boolean;
  falseShortlist: boolean;
  falseReject: boolean;
};

export function scoreCase(predicted: FitLevel, human: FitLevel): CaseScore {
  const agree = predicted === human;
  const adjacent = Math.abs(FIT_ORDER[predicted] - FIT_ORDER[human]) <= 1;
  const falseShortlist = isShortlist(predicted) && human === "no";
  const falseReject = predicted === "no" && isShortlist(human);
  return { agree, adjacent, falseShortlist, falseReject };
}

export type RunTotals = {
  labeled: number;
  agree: number;
  adjacent: number;
  falseShortlist: number;
  falseReject: number;
  agreementPct: number;
  adjacentPct: number;
  falseShortlistRate: number;
  falseRejectRate: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

export function summarizeRun(
  rows: Array<{
    agree: boolean;
    adjacent: boolean;
    falseShortlist: boolean;
    falseReject: boolean;
    latencyMs: number | null;
  }>,
): RunTotals {
  const labeled = rows.length;
  const agree = rows.filter((r) => r.agree).length;
  const adjacent = rows.filter((r) => r.adjacent).length;
  const falseShortlist = rows.filter((r) => r.falseShortlist).length;
  const falseReject = rows.filter((r) => r.falseReject).length;
  const latencies = rows
    .map((r) => r.latencyMs)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .sort((a, b) => a - b);
  const pct = (n: number) => (labeled ? Math.round((n / labeled) * 100) : 0);
  return {
    labeled,
    agree,
    adjacent,
    falseShortlist,
    falseReject,
    agreementPct: pct(agree),
    adjacentPct: pct(adjacent),
    falseShortlistRate: pct(falseShortlist),
    falseRejectRate: pct(falseReject),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export type GateResult = {
  passed: boolean;
  reason: string;
};

export function regressionGate(opts: {
  agreementPct: number;
  falseShortlistRate: number;
  minAgreementPct: number;
  maxFalseShortlistPct: number;
  baselineAgreementPct: number | null;
}): GateResult {
  if (opts.agreementPct < opts.minAgreementPct) {
    return {
      passed: false,
      reason: `Agreement ${opts.agreementPct}% is below the ${opts.minAgreementPct}% floor. This cannot ship.`,
    };
  }
  if (opts.falseShortlistRate > opts.maxFalseShortlistPct) {
    return {
      passed: false,
      reason: `False-shortlist ${opts.falseShortlistRate}% exceeds the ${opts.maxFalseShortlistPct}% cap. This cannot ship.`,
    };
  }
  if (opts.baselineAgreementPct != null && opts.agreementPct < opts.baselineAgreementPct - 2) {
    return {
      passed: false,
      reason: `Agreement dropped from ${opts.baselineAgreementPct}% to ${opts.agreementPct}%. Regression gate holds the production prompt.`,
    };
  }
  return { passed: true, reason: "Gate clear — agreement holds and false-shortlist is in bound." };
}
