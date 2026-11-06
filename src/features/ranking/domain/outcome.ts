/**
 * Conditional outcome model.
 * Four logistic heads, trained only on people who reached that stage:
 * interview pass, offer, join, stayed 90 days.
 * Weights start at zero. No industry base rates are baked in.
 */

export const OUTCOME_HEADS = ["interview", "offer", "join", "retain90"] as const;
export type OutcomeHead = (typeof OUTCOME_HEADS)[number];

export const OUTCOME_KINDS = [
  "interview_pass",
  "interview_fail",
  "offer_yes",
  "offer_drop",
  "joined",
  "join_no",
  "retained_90",
  "left_90",
] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export const OUTCOME_DIM = 7;
export const MIN_OUTCOME_SAMPLES = 8;

export type HeadWeights = {
  w: Float32Array;
  samples: number;
  positives: number;
  brierEma: number;
};

export type OutcomeForecast = {
  interview: number | null;
  offer: number | null;
  join: number | null;
  retain90: number | null;
  samples: Record<OutcomeHead, number>;
  ready: boolean;
};

export function initHead(): HeadWeights {
  return { w: new Float32Array(OUTCOME_DIM), samples: 0, positives: 0, brierEma: 0.25 };
}

export function outcomeFeatures(input: {
  score: number;
  familyAligned: boolean | null;
  noticeDays: number | null;
  riskCount: number;
  domainScore: number | null;
  screenScore: number | null;
}): Float32Array {
  const x = new Float32Array(OUTCOME_DIM);
  x[0] = 1;
  x[1] = clamp(input.score / 100);
  x[2] = input.familyAligned == null ? 0.5 : input.familyAligned ? 1 : 0;
  x[3] = input.noticeDays == null ? 0.5 : input.noticeDays > 60 ? 1 : 0.3;
  x[4] = clamp(input.riskCount / 4);
  x[5] = input.domainScore == null ? 0.5 : clamp(input.domainScore / 100);
  x[6] = input.screenScore == null ? 0.5 : clamp(input.screenScore / 100);
  return x;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function predictHead(h: HeadWeights, x: Float32Array): number {
  let z = 0;
  for (let i = 0; i < OUTCOME_DIM; i += 1) z += (h.w[i] ?? 0) * (x[i] ?? 0);
  return sigmoid(z);
}

export function trainHead(h: HeadWeights, x: Float32Array, positive: boolean, lr = 0.08): void {
  const p = predictHead(h, x);
  const y = positive ? 1 : 0;
  const err = p - y;
  for (let i = 0; i < OUTCOME_DIM; i += 1) {
    h.w[i] = Math.max(-6, Math.min(6, (h.w[i] ?? 0) - lr * err * (x[i] ?? 0)));
  }
  h.samples += 1;
  if (positive) h.positives += 1;
  h.brierEma = h.brierEma * 0.95 + (p - y) * (p - y) * 0.05;
}

/** Which heads a recorded outcome updates, and the label on each. */
export function headsForKind(kind: OutcomeKind): Array<{ head: OutcomeHead; positive: boolean }> {
  switch (kind) {
    case "interview_pass":
      return [{ head: "interview", positive: true }];
    case "interview_fail":
      return [{ head: "interview", positive: false }];
    case "offer_yes":
      return [
        { head: "interview", positive: true },
        { head: "offer", positive: true },
      ];
    case "offer_drop":
      return [
        { head: "interview", positive: true },
        { head: "offer", positive: false },
      ];
    case "joined":
      return [
        { head: "interview", positive: true },
        { head: "offer", positive: true },
        { head: "join", positive: true },
      ];
    case "join_no":
      return [
        { head: "interview", positive: true },
        { head: "offer", positive: true },
        { head: "join", positive: false },
      ];
    case "retained_90":
      return [
        { head: "interview", positive: true },
        { head: "offer", positive: true },
        { head: "join", positive: true },
        { head: "retain90", positive: true },
      ];
    case "left_90":
      return [
        { head: "interview", positive: true },
        { head: "offer", positive: true },
        { head: "join", positive: true },
        { head: "retain90", positive: false },
      ];
    default:
      return [];
  }
}

export function forecastFromHeads(
  heads: Record<OutcomeHead, HeadWeights>,
  x: Float32Array,
): OutcomeForecast {
  const pct = (head: OutcomeHead): number | null => {
    const h = heads[head];
    if (h.samples < MIN_OUTCOME_SAMPLES) return null;
    return Math.round(predictHead(h, x) * 100);
  };
  const interview = pct("interview");
  const offer = pct("offer");
  const join = pct("join");
  const retain90 = pct("retain90");
  return {
    interview,
    offer,
    join,
    retain90,
    samples: {
      interview: heads.interview.samples,
      offer: heads.offer.samples,
      join: heads.join.samples,
      retain90: heads.retain90.samples,
    },
    ready: interview != null || offer != null || join != null || retain90 != null,
  };
}

export function serializeHead(h: HeadWeights): string {
  return JSON.stringify({
    w: Array.from(h.w),
    samples: h.samples,
    positives: h.positives,
    brierEma: h.brierEma,
  });
}

export function deserializeHead(raw: string): HeadWeights | null {
  try {
    const s = JSON.parse(raw) as {
      w: number[];
      samples: number;
      positives: number;
      brierEma: number;
    };
    if (!s.w || s.w.length !== OUTCOME_DIM) return null;
    return {
      w: Float32Array.from(s.w),
      samples: s.samples || 0,
      positives: s.positives || 0,
      brierEma: s.brierEma ?? 0.25,
    };
  } catch {
    return null;
  }
}
