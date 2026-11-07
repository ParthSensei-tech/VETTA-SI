/**
 * Enterprise Funnel & Commercial Analytics Types and Calculation Engine.
 * Industry-grade metrics for high-volume corporate TA teams (e.g. Jio/Reliance) and staffing agencies.
 */

export const FUNNEL_STAGES = [
  "sourced",
  "shortlisted",
  "interview",
  "offered",
  "offer_accepted",
  "joined",
  "retained_90d",
  "rejected",
  "offer_declined",
  "reneged",
  "attrited_early",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export type JoiningStatus = "pending" | "joined" | "reneged" | "no_show";
export type RetentionStatus =
  "pending" | "retained_30d" | "retained_60d" | "retained_90d" | "attrited_early";
export type InvoiceStatus = "draft" | "billed" | "collected" | "clawed_back";

export type CycleTimeMetric = {
  medianDays: number;
  meanDays: number;
  p90Days: number;
  sampleCount: number;
};

export type StageConversionMetrics = {
  applicationToShortlistRate: number; // % of applied that reach shortlist
  shortlistToInterviewRate: number; // % of shortlisted that interview
  interviewToOfferRate: number; // % of interviewed that get an offer
  offerAcceptanceRate: number; // % of offered that accept
  joiningRatio: number; // % of accepted offers that actually join
  postOfferRenegeRate: number; // % of accepted offers that renege/backout before or on DOJ
  retention90dRate: number; // % of joined candidates retained past 90 days
  overallPipelineYield: number; // % of initial applications that successfully join
};

export type FunnelStageCounts = {
  totalApplied: number;
  totalShortlisted: number;
  totalInterviewed: number;
  totalOffered: number;
  totalAccepted: number;
  totalJoined: number;
  totalRetained30d: number;
  totalRetained60d: number;
  totalRetained90d: number;
  totalReneged: number;
  totalEarlyAttrition: number;
  totalRejected: number;
};

export type CycleTimesSummary = {
  timeToShortlist: CycleTimeMetric; // Ingest/apply -> Shortlist
  shortlistToInterview: CycleTimeMetric; // Shortlist -> First interview
  interviewToOffer: CycleTimeMetric; // Interview -> Offer extended
  offerToAcceptance: CycleTimeMetric; // Offer extended -> Offer accepted
  acceptanceToJoining: CycleTimeMetric; // Offer accepted -> Day 1 joining
  totalTimeToHire: CycleTimeMetric; // Apply -> Offer accepted / joined
};

export type ClientMandateMetric = {
  clientId: string;
  clientName: string;
  totalMandates: number;
  repeatMandates: number;
  isRepeatClient: boolean;
  totalPlacements: number;
  totalBilledInr: number;
  totalBilledUsd: number;
  averageTimeToHireDays: number;
};

export type RepeatMandatesSummary = {
  totalMandates: number;
  repeatMandates: number;
  newClientMandates: number;
  repeatMandateRate: number; // percentage (0-100)
  activeClientsCount: number;
  repeatClientsCount: number;
  clientBreakdown: ClientMandateMetric[];
};

export type RoleMarginMetric = {
  roleId: string;
  roleTitle: string;
  companyName: string;
  currency: string;
  placementsCount: number;
  grossFee: number;
  directCost: number;
  recruiterCommission: number;
  netMarginAmount: number;
  marginPercentage: number;
};

export type GrossMarginSummary = {
  totalPlacements: number;
  totalGrossPlacementFeeInr: number;
  totalGrossPlacementFeeUsd: number;
  totalDirectCostInr: number;
  totalDirectCostUsd: number;
  totalRecruiterCommissionInr: number;
  totalRecruiterCommissionUsd: number;
  netGrossMarginAmountInr: number;
  netGrossMarginAmountUsd: number;
  overallGrossMarginPercentage: number;
  averageMarginPerPlacementInr: number;
  averageMarginPerPlacementUsd: number;
  totalClawbackLossInr: number;
  totalClawbackLossUsd: number;
  roleBreakdown: RoleMarginMetric[];
};

export type FunnelAnalyticsReport = {
  orgId: string;
  timeRange: string;
  generatedAt: string;
  stageCounts: FunnelStageCounts;
  conversionRates: StageConversionMetrics;
  cycleTimes: CycleTimesSummary;
  repeatMandates: RepeatMandatesSummary;
  grossMargin: GrossMarginSummary;
};

export type AnalyticsFilter = {
  orgId: string;
  roleId?: string;
  clientId?: string;
  recruiterId?: string;
  startDate?: string;
  endDate?: string;
  currency?: "INR" | "USD" | "ALL";
};

// ---------------------------------------------------------------------------
// Statistical & Financial Formulas
// ---------------------------------------------------------------------------

/**
 * Computes arithmetic mean of a numbers array.
 */
export function computeMean(arr: number[]): number {
  if (!arr.length) return 0;
  const sum = arr.reduce((acc, val) => acc + val, 0);
  return Math.round((sum / arr.length) * 10) / 10;
}

/**
 * Computes median (P50) of a numbers array.
 */
export function computeMedian(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return Math.round(sorted[mid] * 10) / 10;
  }
  return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

/**
 * Computes 90th percentile (P90) of a numbers array.
 */
export function computeP90(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.9) - 1);
  return Math.round(sorted[idx] * 10) / 10;
}

/**
 * Builds a CycleTimeMetric from an array of durations in days.
 */
export function calculateCycleTime(durationsInDays: number[]): CycleTimeMetric {
  return {
    medianDays: computeMedian(durationsInDays),
    meanDays: computeMean(durationsInDays),
    p90Days: computeP90(durationsInDays),
    sampleCount: durationsInDays.length,
  };
}

/**
 * Calculates commercial placement fee and gross margin metrics.
 */
export function calculateGrossMargin(opts: {
  offeredCtc: number;
  feePercentage: number;
  directCost?: number;
  recruiterCommission?: number;
}): {
  grossFee: number;
  marginAmount: number;
  marginPercentage: number;
} {
  const directCost = opts.directCost ?? 0;
  const recruiterCommission = opts.recruiterCommission ?? 0;
  const grossFee = Math.round(opts.offeredCtc * (opts.feePercentage / 100) * 100) / 100;
  const marginAmount = Math.round((grossFee - directCost - recruiterCommission) * 100) / 100;
  const marginPercentage = grossFee > 0 ? Math.round((marginAmount / grossFee) * 1000) / 10 : 0;

  return {
    grossFee,
    marginAmount,
    marginPercentage,
  };
}

// ---------------------------------------------------------------------------
// Currency and Formatting Helpers
// ---------------------------------------------------------------------------

/**
 * Formats Rupee amounts with Indian numbering (e.g. ₹15,50,000 or ₹1.5L)
 */
export function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formats USD amounts (e.g. $25,000)
 */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formats a duration in days into a human-friendly string.
 */
export function formatDays(days: number): string {
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} hr${hours !== 1 ? "s" : ""}`;
  }
  return `${days.toFixed(1)} days`;
}

/**
 * Formats percentage with 1 decimal place.
 */
export function formatPercentage(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
