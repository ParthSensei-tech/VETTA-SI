/** Founder-facing rubric: criteria + hard constraints (not a blank-canvas builder). */

export const CRITERION_WEIGHTS = ["high", "medium", "low"] as const;
export type CriterionWeight = (typeof CRITERION_WEIGHTS)[number];

export const CRITERION_KINDS = ["must", "nice"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export const RUBRIC_STATUSES = ["draft", "active", "locked", "superseded"] as const;
export type RubricStatus = (typeof RUBRIC_STATUSES)[number];

export type RubricCriterion = {
  id: string;
  name: string;
  weight: CriterionWeight;
  kind: CriterionKind;
  /** Plain-language definition of strong evidence on a resume or screen */
  strongEvidence: string;
};

export type HardConstraints = {
  /** Required city / metro; empty = no city filter */
  city: string;
  /** Max notice period in days; null = no ceiling */
  noticeMaxDays: number | null;
  /** Comp band floor/ceiling in LPA; null = use role band only as flag */
  compMinLpa: number | null;
  compMaxLpa: number | null;
  /** If true, city/notice/comp failures filter out; else only flag in risks */
  strictFilter: boolean;
};

export type RubricVersion = {
  id: string;
  orgId: string;
  roleId: string;
  version: number;
  status: RubricStatus;
  criteria: RubricCriterion[];
  hardConstraints: HardConstraints;
  rubricHash?: string | null;
  source: string;
  createdBy: string;
  parentVersionId: string | null;
  lockedAt: string | null;
  createdAt: string;
};

export const DEFAULT_HARD_CONSTRAINTS: HardConstraints = {
  city: "",
  noticeMaxDays: 60,
  compMinLpa: null,
  compMaxLpa: null,
  strictFilter: false,
};
