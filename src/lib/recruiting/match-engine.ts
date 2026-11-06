/**
 * Enterprise candidate–role matching (no demo data).
 *
 * Pure functions: given resume text + role definition → profile + scored match.
 * Dimensions are weighted; hard gates can cap score (function mismatch, etc.).
 * Used by the local fast path; LLM deepen re-scores the same schema.
 */

import type {
  FitLevel,
  IndiaContext,
  MatchBreakdown,
  MatchDimension,
  ParsedProfile,
  RankEvidence,
  RankResult,
  RequirementEvaluation,
  RequirementStatus,
  StackMatch,
} from "./types";

// ——— Role / resume family (function alignment) ———

export type RoleFamilyId =
  | "engineering"
  | "product"
  | "design"
  | "gtm"
  | "success"
  | "people"
  | "finance"
  | "ops"
  | "generalist"
  | "unknown";

const FAMILY_PATTERNS: Array<{ id: RoleFamilyId; title: RegExp; body: RegExp }> = [
  {
    id: "engineering",
    title:
      /\b(engineer|engineering|sde|developer|devops|sre|platform|backend|frontend|fullstack|full[- ]stack|architect|data eng|ml eng|infra)\b/i,
    body: /\b(typescript|python|golang|kubernetes|postgres|api|microservices|on-call|code review|ci\/cd)\b/i,
  },
  {
    id: "product",
    title: /\b(product manager|product lead|head of product|\bpm\b|group pm|principal pm)\b/i,
    body: /\b(roadmap|prd|user research|prioriti[sz]ation|product sense|discovery)\b/i,
  },
  {
    id: "design",
    title: /\b(designer|design lead|product design|ux|ui\/ux|brand design)\b/i,
    body: /\b(figma|design system|user research|prototype|usability|visual design)\b/i,
  },
  {
    id: "gtm",
    title:
      /\b(account executive|\bae\b|sdr|bdr|sales|revenue|gtm|growth|business development|partnerships)\b/i,
    body: /\b(quota|pipeline|outbound|inbound|crm|salesforce|hubspot|closed[- ]won)\b/i,
  },
  {
    id: "success",
    title: /\b(customer success|csm|account manager|solutions consultant|implementation)\b/i,
    body: /\b(nrr|churn|onboarding|retention|customer health|qbr)\b/i,
  },
  {
    id: "people",
    title: /\b(people|hrbp|talent|recruiter|recruiting|people ops|chief of staff)\b/i,
    body: /\b(hiring|onboarding|performance cycle|org design|compensation band)\b/i,
  },
  {
    id: "finance",
    title: /\b(finance|cfo|controller|fp&a|accountant|treasury)\b/i,
    body: /\b(p&l|forecast|budget|gaap|ind as|audit|cash flow)\b/i,
  },
  {
    id: "ops",
    title: /\b(operations|ops lead|bizops|strategy ops|coo)\b/i,
    body: /\b(process|vendor|sla|ops metric|cross[- ]functional)\b/i,
  },
  {
    id: "generalist",
    title: /\b(founder|co[- ]founder|generalist|0→1|0-1|jack of)\b/i,
    body: /\b(wore many hats|0→1|0-1|founding team|first hire)\b/i,
  },
];

export function inferFamily(text: string, preferTitle = true): RoleFamilyId {
  const t = text.trim();
  if (!t) return "unknown";
  if (preferTitle) {
    const firstLines = t.split(/\r?\n/).slice(0, 8).join(" ");
    for (const f of FAMILY_PATTERNS) {
      if (f.title.test(firstLines)) return f.id;
    }
  }
  for (const f of FAMILY_PATTERNS) {
    if (f.title.test(t) || f.body.test(t)) return f.id;
  }
  return "unknown";
}

/** Families that are compatible enough not to hard-reject. */
const FAMILY_COMPAT: Record<RoleFamilyId, RoleFamilyId[]> = {
  engineering: ["engineering", "generalist"],
  product: ["product", "generalist", "ops"],
  design: ["design", "product", "generalist"],
  gtm: ["gtm", "success", "generalist"],
  success: ["success", "gtm", "generalist"],
  people: ["people", "ops", "generalist"],
  finance: ["finance", "ops", "generalist"],
  ops: ["ops", "product", "finance", "generalist"],
  generalist: [
    "generalist",
    "engineering",
    "product",
    "design",
    "gtm",
    "success",
    "people",
    "finance",
    "ops",
  ],
  unknown: [
    "unknown",
    "engineering",
    "product",
    "design",
    "gtm",
    "success",
    "people",
    "finance",
    "ops",
    "generalist",
  ],
};

function familiesAligned(roleF: RoleFamilyId, resumeF: RoleFamilyId): boolean {
  if (roleF === "unknown" || resumeF === "unknown") return true;
  return FAMILY_COMPAT[roleF]?.includes(resumeF) ?? false;
}

// ——— Text helpers ———

const INDIA_CITIES = [
  "bengaluru",
  "bangalore",
  "mumbai",
  "pune",
  "hyderabad",
  "delhi",
  "gurgaon",
  "gurugram",
  "noida",
  "chennai",
  "remote",
];

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function firstMatch(text: string, re: RegExp): string {
  return text.match(re)?.[0] ?? "";
}

function numMatch(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True only if skill appears as a positive mention (not "no X" / "without X"). */
export function positiveMention(haystack: string, skill: string): boolean {
  const s = skill.trim();
  if (!s) return false;
  const re = new RegExp(
    `(?<![\\w])(?:no|not|without|lack(?:s|ing)?|never)\\s+${escapeRe(s)}(?![\\w])`,
    "i",
  );
  if (re.test(haystack)) return false;
  return new RegExp(`(?<![\\w])${escapeRe(s)}(?![\\w])`, "i").test(haystack);
}

function tokenOverlap(phrase: string, lowerResume: string): boolean {
  const tokens = phrase
    .toLowerCase()
    .split(/[^a-z0-9+.#]+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => lowerResume.includes(t));
  return hits.length >= Math.min(2, tokens.length) || (tokens.length === 1 && hits.length === 1);
}

function levelFromScore(score: number): FitLevel {
  if (score >= 85) return "strong_yes";
  if (score >= 70) return "yes";
  if (score >= 50) return "maybe";
  return "no";
}

function parseBandLakh(band?: string): { min: number | null; max: number | null } {
  if (!band) return { min: null, max: null };
  const nums = [...band.matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n < 500);
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length === 1) return { min: nums[0]! * 0.85, max: nums[0]! * 1.15 };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// ——— Core match ———

export type MatchRoleInput = {
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

export type MatchWeights = {
  function: number;
  skills: number;
  must_haves: number;
  seniority: number;
  location: number;
  compensation: number;
  notice: number;
  early_stage: number;
};

const DEFAULT_WEIGHTS: MatchWeights = {
  function: 0.22,
  skills: 0.18,
  must_haves: 0.16,
  seniority: 0.1,
  location: 0.08,
  compensation: 0.1,
  notice: 0.09,
  early_stage: 0.07,
};

function resolveWeights(w?: Partial<MatchWeights> | null): MatchWeights {
  const base = { ...DEFAULT_WEIGHTS };
  if (w) {
    for (const k of Object.keys(base) as (keyof MatchWeights)[]) {
      const v = w[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) base[k] = v;
    }
  }
  const sum = (Object.keys(base) as (keyof MatchWeights)[]).reduce((s, k) => s + base[k], 0) || 1;
  for (const k of Object.keys(base) as (keyof MatchWeights)[]) base[k] = base[k] / sum;
  return base;
}

export type MatchHardConstraints = {
  city?: string;
  noticeMaxDays?: number | null;
  compMinLpa?: number | null;
  compMaxLpa?: number | null;
  strictFilter?: boolean;
};

export type MatchCriterion = {
  id: string;
  name: string;
  weight: "high" | "medium" | "low";
  kind: "must" | "nice";
  strongEvidence: string;
};

function criterionWeightNum(w: MatchCriterion["weight"]): number {
  if (w === "high") return 3;
  if (w === "medium") return 2;
  return 1;
}

/** Score one founder criterion against resume text (token evidence, no invented facts). */
function scoreCriterion(
  resumeLower: string,
  criterion: MatchCriterion,
): { score: number; note: string } {
  const blob = `${criterion.name} ${criterion.strongEvidence}`.toLowerCase();
  const tokens = [
    ...new Set(blob.split(/[^a-z0-9+.#]+/).filter((t) => t.length > 3 && !STOP.has(t))),
  ].slice(0, 14);
  if (tokens.length === 0) return { score: 45, note: "No checkable tokens" };
  const hits = tokens.filter((t) => resumeLower.includes(t));
  const ratio = hits.length / tokens.length;
  const score = Math.round(Math.max(8, Math.min(96, ratio * 125)));
  return {
    score,
    note: hits.length
      ? `Evidence: ${hits.slice(0, 4).join(", ")}`
      : "No resume evidence for this bar",
  };
}

const STOP = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "will",
  "your",
  "they",
  "them",
  "their",
  "into",
  "about",
  "would",
  "could",
  "should",
  "resume",
  "evidence",
  "strong",
  "looks",
  "like",
  "only",
  "also",
  "than",
  "over",
  "more",
  "what",
  "when",
  "where",
]);

export function evaluateRoleRequirements(input: {
  resumeText: string;
  role: MatchRoleInput;
  stackMatch: StackMatch[];
  hardConstraints?: MatchHardConstraints | null;
  familyOk: boolean;
  resumeFamily: string;
  roleFamily: string;
  locationFit: IndiaContext["location_fit"];
  noticePeriodDays: number | null;
  expectedCtcLakh: number | null;
}): RequirementEvaluation[] {
  const reqs: RequirementEvaluation[] = [];
  const resume = input.resumeText;
  const lower = resume.toLowerCase();
  const lines = linesOf(resume);

  // 1. Must-Haves: distinguish satisfied vs missing_info vs explicit failed
  for (const must of input.role.mustHaves) {
    if (!must.trim()) continue;
    const hits = tokenOverlap(must, lower);
    if (hits) {
      const line = lines.find((l) => tokenOverlap(must, l.toLowerCase())) || "";
      reqs.push({
        requirement: must,
        category: "must_have",
        status: "satisfied",
        evidenceQuote: line.slice(0, 220) || null,
        explanation: "Evidenced in candidate resume.",
      });
    } else {
      // Check for explicit contradiction or negative declaration
      const negativePattern = new RegExp(
        `\\b(?:no|never|not|cannot|lacking|unfamiliar with)\\b[\\w\\s]{0,25}\\b${must.slice(0, 8)}\\b`,
        "i",
      );
      if (negativePattern.test(resume)) {
        reqs.push({
          requirement: must,
          category: "must_have",
          status: "failed",
          explanation: `Explicit contradictory evidence against requirement: ${must}`,
        });
      } else {
        reqs.push({
          requirement: must,
          category: "must_have",
          status: "missing_info",
          explanation: `Not evidenced in resume. Missing information to probe during screening.`,
        });
      }
    }
  }

  // 2. Stack skills
  for (const sm of input.stackMatch) {
    if (sm.level === "strong") {
      const line = lines.find((l) => positiveMention(l, sm.skill)) || "";
      reqs.push({
        requirement: `Skill: ${sm.skill}`,
        category: "skill",
        status: "satisfied",
        evidenceQuote: line.slice(0, 220) || null,
        explanation: `Demonstrated strong experience with ${sm.skill}.`,
      });
    } else if (sm.level === "partial") {
      reqs.push({
        requirement: `Skill: ${sm.skill}`,
        category: "skill",
        status: "satisfied",
        explanation: `Partial match / related keywords found for ${sm.skill}.`,
      });
    } else {
      reqs.push({
        requirement: `Skill: ${sm.skill}`,
        category: "skill",
        status: "missing_info",
        explanation: `${sm.skill} not mentioned in resume. To be evaluated during technical screen.`,
      });
    }
  }

  // 3. Nice-to-haves
  for (const nice of input.role.niceToHaves) {
    if (!nice.trim()) continue;
    if (tokenOverlap(nice, lower)) {
      const line = lines.find((l) => tokenOverlap(nice, l.toLowerCase())) || "";
      reqs.push({
        requirement: nice,
        category: "nice_to_have",
        status: "satisfied",
        evidenceQuote: line.slice(0, 220) || null,
        explanation: "Evidenced in resume.",
      });
    } else {
      reqs.push({
        requirement: nice,
        category: "nice_to_have",
        status: "missing_info",
        explanation: "Optional nice-to-have not mentioned in resume.",
      });
    }
  }

  // 4. Function alignment hard constraint
  if (!input.familyOk) {
    reqs.push({
      requirement: `Function alignment (${input.roleFamily})`,
      category: "hard_constraint",
      status: "failed",
      explanation: `Structural mismatch: Resume indicates ${input.resumeFamily} background while role requires ${input.roleFamily}.`,
    });
  } else {
    reqs.push({
      requirement: `Function alignment (${input.roleFamily})`,
      category: "hard_constraint",
      status: "satisfied",
      explanation: `Candidate function (${input.resumeFamily}) is compatible with target role (${input.roleFamily}).`,
    });
  }

  // 5. Hard constraints (location, notice, comp)
  const hc = input.hardConstraints;
  if (hc?.city && hc.city.trim()) {
    if (input.locationFit === "local" || input.locationFit === "remote_india") {
      reqs.push({
        requirement: `Location: ${hc.city}`,
        category: "hard_constraint",
        status: "satisfied",
        explanation: `Location aligned (${input.locationFit}).`,
      });
    } else if (input.locationFit === "unknown") {
      reqs.push({
        requirement: `Location: ${hc.city}`,
        category: "hard_constraint",
        status: "missing_info",
        explanation: `Location not stated on resume. Confirm city alignment during initial screen.`,
      });
    } else {
      if (hc.strictFilter) {
        reqs.push({
          requirement: `Location: ${hc.city}`,
          category: "hard_constraint",
          status: "failed",
          explanation: `Strict location constraint violated: Candidate location does not match ${hc.city}.`,
        });
      } else {
        reqs.push({
          requirement: `Location: ${hc.city}`,
          category: "hard_constraint",
          status: "missing_info",
          explanation: `Candidate requires relocation; verify willingness during screen.`,
        });
      }
    }
  }

  if (hc?.noticeMaxDays != null) {
    if (input.noticePeriodDays == null) {
      reqs.push({
        requirement: `Notice period <= ${hc.noticeMaxDays} days`,
        category: "hard_constraint",
        status: "missing_info",
        explanation: `Notice period not explicitly stated on resume. Validate in screen.`,
      });
    } else if (input.noticePeriodDays <= hc.noticeMaxDays) {
      reqs.push({
        requirement: `Notice period <= ${hc.noticeMaxDays} days`,
        category: "hard_constraint",
        status: "satisfied",
        explanation: `Candidate notice period (${input.noticePeriodDays}d) satisfies requirement ceiling (${hc.noticeMaxDays}d).`,
      });
    } else {
      reqs.push({
        requirement: `Notice period <= ${hc.noticeMaxDays} days`,
        category: "hard_constraint",
        status: "failed",
        explanation: `Notice period (${input.noticePeriodDays}d) exceeds strict ceiling of ${hc.noticeMaxDays} days.`,
      });
    }
  }

  if (hc?.compMaxLpa != null) {
    if (input.expectedCtcLakh == null) {
      reqs.push({
        requirement: `Compensation <= ${hc.compMaxLpa} LPA`,
        category: "hard_constraint",
        status: "missing_info",
        explanation: `Expected compensation not stated on resume. Confirm expectations in screen.`,
      });
    } else if (input.expectedCtcLakh <= hc.compMaxLpa * 1.15) {
      reqs.push({
        requirement: `Compensation <= ${hc.compMaxLpa} LPA`,
        category: "hard_constraint",
        status: "satisfied",
        explanation: `Expected compensation (~${input.expectedCtcLakh} LPA) aligns with budget (${hc.compMaxLpa} LPA).`,
      });
    } else {
      reqs.push({
        requirement: `Compensation <= ${hc.compMaxLpa} LPA`,
        category: "hard_constraint",
        status: "failed",
        explanation: `Expected compensation (~${input.expectedCtcLakh} LPA) exceeds budget ceiling (${hc.compMaxLpa} LPA).`,
      });
    }
  }

  return reqs;
}

export function matchCandidateToRole(input: {
  resumeText: string;
  role: MatchRoleInput;
  weights?: Partial<MatchWeights> | null;
  /** Hard constraints: filter/flag only — not blended into weighted score */
  hardConstraints?: MatchHardConstraints | null;
  /** Founder-confirmed rubric criteria (High/Med/Low) — primary score when present */
  criteria?: MatchCriterion[] | null;
}): { profile: ParsedProfile; rank: RankResult } {
  const weights = resolveWeights(input.weights);
  const resume = input.resumeText;
  const lower = resume.toLowerCase();
  const lines = linesOf(resume);
  const roleBlob = `${input.role.title}\n${input.role.jdText}\n${input.role.mustHaves.join("\n")}`;

  // Profile extraction (from resume only — never invented)
  const email = firstMatch(resume, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phone = firstMatch(resume, /(?:\+91[\s-]?)?[6-9]\d{9}/);
  const linkedin =
    firstMatch(resume, /https?:\/\/\S*linkedin\.com\/\S+/i) ||
    firstMatch(resume, /linkedin\.com\/in\/\S+/i);
  const name =
    lines.find(
      (l) => !l.includes("@") && !/https?:/i.test(l) && /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(l),
    ) ?? "Candidate";

  const cityHit = INDIA_CITIES.find((c) => lower.includes(c));
  const location = cityHit
    ? cityHit === "bangalore"
      ? "Bengaluru"
      : cityHit[0]!.toUpperCase() + cityHit.slice(1)
    : "";

  const titleLine =
    lines.find((l) =>
      /\b(engineer|manager|lead|director|head|founder|designer|analyst|consultant|architect|sde|developer|executive|success|recruiter|ops)\b/i.test(
        l,
      ),
    ) ?? "";
  const current_title = titleLine.replace(/\s+[—–-]\s+.+$/, "").slice(0, 100);
  const companyFromTitle =
    titleLine
      .split(/\s+[—–@]| at |,\s*/)[1]
      ?.trim()
      .slice(0, 80) ?? "";
  const years = numMatch(resume, /(\d+(?:\.\d+)?)\s*\+?\s*years?/i);

  const stack = input.role.stack.filter(Boolean);
  const stack_match: StackMatch[] = stack.map((skill) => {
    if (positiveMention(resume, skill)) {
      return {
        skill,
        level: "strong" as const,
        status: "satisfied" as const,
        note: "Positive evidence in resume",
      };
    }
    const partial = lower.includes(skill.toLowerCase().slice(0, Math.max(3, skill.length - 1)));
    if (partial) {
      return {
        skill,
        level: "partial" as const,
        status: "satisfied" as const,
        note: "Partial keyword match in resume",
      };
    }
    return {
      skill,
      level: "missing" as const,
      status: "missing_info" as const,
      note: "Not mentioned in CV (probe during screening)",
    };
  });

  const mustHits = input.role.mustHaves.filter((m) => tokenOverlap(m, lower));
  const niceHits = input.role.niceToHaves.filter((m) => tokenOverlap(m, lower));

  const notice_period_days =
    numMatch(resume, /notice[^.\n]{0,40}?(\d+)\s*days?/i) ??
    numMatch(resume, /(\d+)\s*days?\s*notice/i);
  const current_ctc_lakh =
    numMatch(resume, /current[^.\n]{0,40}?(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/i) ??
    numMatch(resume, /(\d+(?:\.\d+)?)\s*(?:lpa|lakh)[^.\n]{0,20}?current/i);
  const expected_ctc_lakh =
    numMatch(resume, /expected[^.\n]{0,40}?(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/i) ??
    numMatch(resume, /(\d+(?:\.\d+)?)\s*(?:lpa|lakh)[^.\n]{0,20}?expected/i);

  const roleCity = input.role.location.toLowerCase();
  const location_fit: IndiaContext["location_fit"] =
    cityHit &&
    (roleCity.includes(cityHit) ||
      (cityHit === "bengaluru" && roleCity.includes("bangalore")) ||
      (cityHit === "bangalore" && roleCity.includes("bengaluru")))
      ? "local"
      : cityHit === "remote" || roleCity.includes("remote")
        ? "remote_india"
        : cityHit
          ? "relocation"
          : "unknown";

  const earlySignals =
    /first hire|founding|0\s*→\s*1|0-1|seed stage|wore (many|multiple) hats|on-call|tiny team|startup/i.test(
      resume,
    );
  const early_stage_fit: IndiaContext["early_stage_fit"] = earlySignals
    ? "high"
    : /startup|series [ab]|early stage/i.test(resume)
      ? "medium"
      : /faang|mnc|enterprise only|20\s*\+\s*years at/i.test(resume)
        ? "low"
        : "unknown";

  // Families
  const roleFamily = inferFamily(roleBlob, true);
  const resumeFamily = inferFamily(`${current_title}\n${resume.slice(0, 2000)}`, true);
  const familyOk = familiesAligned(roleFamily, resumeFamily);

  // Dimension scores 0–100
  const strongStack = stack_match.filter((s) => s.level === "strong").length;
  const partialStack = stack_match.filter((s) => s.level === "partial").length;
  const missingStack = stack_match.filter((s) => s.level === "missing").length;

  const skillScore =
    stack.length === 0
      ? 55
      : Math.round(((strongStack * 1 + partialStack * 0.45) / stack.length) * 100);

  const mustScore =
    input.role.mustHaves.length === 0
      ? 60
      : Math.round((mustHits.length / input.role.mustHaves.length) * 100);

  const niceScore =
    input.role.niceToHaves.length === 0
      ? 50
      : Math.min(100, Math.round((niceHits.length / input.role.niceToHaves.length) * 100));

  const titleScore = familyOk ? (resumeFamily === roleFamily ? 88 : 72) : 22;

  // Seniority: rough years vs stage
  let seniorityScore = 55;
  if (years != null) {
    const stage = input.role.companyStage;
    if (stage === "seed") {
      seniorityScore = years >= 3 && years <= 12 ? 80 : years < 2 ? 40 : 65;
    } else if (stage === "series_a") {
      seniorityScore = years >= 4 && years <= 14 ? 82 : years < 3 ? 45 : 68;
    } else {
      seniorityScore = years >= 5 && years <= 18 ? 80 : years < 4 ? 48 : 70;
    }
  }

  const locationScore =
    location_fit === "local"
      ? 90
      : location_fit === "remote_india"
        ? 75
        : location_fit === "relocation"
          ? 55
          : 45;

  const band = parseBandLakh(input.role.compensationBand);
  let compScore = 60;
  if (expected_ctc_lakh != null && band.max != null) {
    if (expected_ctc_lakh <= band.max * 1.1) compScore = 85;
    else if (expected_ctc_lakh <= band.max * 1.35) compScore = 55;
    else compScore = 28;
  } else if (current_ctc_lakh != null && band.min != null) {
    if (current_ctc_lakh <= band.max! * 1.2) compScore = 70;
  }

  let noticeScore = 60;
  if (notice_period_days != null) {
    if (notice_period_days <= 30) noticeScore = 90;
    else if (notice_period_days <= 60) noticeScore = 72;
    else if (notice_period_days <= 90) noticeScore = 48;
    else noticeScore = 30;
  }

  const stage = input.role.companyStage;
  const earlyScore =
    stage === "seed"
      ? early_stage_fit === "high"
        ? 90
        : early_stage_fit === "medium"
          ? 70
          : early_stage_fit === "low"
            ? 35
            : 55
      : stage === "series_a"
        ? early_stage_fit === "high" || early_stage_fit === "medium"
          ? 80
          : early_stage_fit === "low"
            ? 50
            : 60
        : 65;

  const founderCriteria = (input.criteria ?? []).filter((c) => c.name.trim().length > 1);
  const useFounderRubric = founderCriteria.length >= 3;

  let dimensions: MatchDimension[];
  if (useFounderRubric) {
    const critDims: MatchDimension[] = founderCriteria.map((c) => {
      const scored = scoreCriterion(lower, c);
      const w = criterionWeightNum(c.weight);
      return {
        id: c.id || c.name,
        label: c.name,
        score: scored.score,
        weight: w,
        note: `${c.kind === "must" ? "Must" : "Nice"} · ${c.weight} · ${scored.note}`,
      };
    });
    const wSum = critDims.reduce((s, d) => s + d.weight, 0) || 1;
    dimensions = critDims.map((d) => ({ ...d, weight: d.weight / wSum }));
  } else {
    dimensions = [
      {
        id: "function",
        label: "Function / title fit",
        score: titleScore,
        weight: weights.function,
        note: `${resumeFamily} → ${roleFamily}`,
      },
      {
        id: "skills",
        label: "Skills / stack",
        score: skillScore,
        weight: weights.skills,
        note: `${strongStack} strong, ${missingStack} missing`,
      },
      {
        id: "must_haves",
        label: "Must-haves",
        score: mustScore,
        weight: weights.must_haves,
        note: `${mustHits.length}/${input.role.mustHaves.length || 0} evidenced`,
      },
      {
        id: "seniority",
        label: "Seniority vs stage",
        score: seniorityScore,
        weight: weights.seniority,
        note: years != null ? `${years}y` : "years unknown",
      },
      {
        id: "location",
        label: "Location",
        score: locationScore,
        weight: weights.location,
        note: location_fit,
      },
      {
        id: "compensation",
        label: "Comp feasibility",
        score: compScore,
        weight: weights.compensation,
        note: expected_ctc_lakh != null ? `exp ${expected_ctc_lakh} LPA` : "not stated",
      },
      {
        id: "notice",
        label: "Notice risk",
        score: noticeScore,
        weight: weights.notice,
        note: notice_period_days != null ? `${notice_period_days}d` : "not stated",
      },
      {
        id: "early_stage",
        label: "Early-stage DNA",
        score: earlyScore,
        weight: weights.early_stage,
        note: early_stage_fit,
      },
    ];
  }

  const niceBoost = useFounderRubric
    ? 0
    : input.role.niceToHaves.length
      ? Math.round((niceScore / 100) * 3)
      : 0;

  let composite = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) + niceBoost;
  composite = Math.round(Math.max(0, Math.min(100, composite)));

  const hardGates: string[] = [];
  if (!familyOk) {
    hardGates.push(`Function mismatch: resume reads as ${resumeFamily}, role is ${roleFamily}`);
    composite = Math.min(composite, 42);
  }
  if (useFounderRubric) {
    const musts = founderCriteria.filter((c) => c.kind === "must");
    const failedMusts = musts.filter((c) => {
      const dim = dimensions.find((d) => d.id === (c.id || c.name));
      return (dim?.score ?? 0) < 32;
    });
    if (musts.length >= 2 && failedMusts.length === musts.length) {
      hardGates.push("No must-have criteria evidenced on the resume");
      composite = Math.min(composite, 48);
    } else if (failedMusts.length) {
      hardGates.push(
        `Weak on must-haves: ${failedMusts
          .map((c) => c.name)
          .slice(0, 3)
          .join("; ")}`,
      );
    }
  } else if (input.role.mustHaves.length >= 2 && mustHits.length === 0) {
    hardGates.push("No must-have evidenced on the resume");
    composite = Math.min(composite, 48);
  }
  if (expected_ctc_lakh != null && band.max != null && expected_ctc_lakh > band.max * 1.5) {
    hardGates.push(`Expected CTC (~${expected_ctc_lakh} LPA) far above band`);
    composite = Math.min(composite, 45);
  }

  // Junior applying to founding-heavy title with no evidence
  if (
    /founding|first engineer|head of|director/i.test(input.role.title) &&
    years != null &&
    years < 2 &&
    !earlySignals
  ) {
    hardGates.push("Too junior for founding / leadership framing of the role");
    composite = Math.min(composite, 40);
  }

  // Hard constraints: never blended into dimension weights — flag or strict-cap only.
  const risks: string[] = [...hardGates];
  const hc = input.hardConstraints;
  if (hc) {
    if (hc.city && hc.city.trim()) {
      const want = hc.city.toLowerCase();
      const got = (location || "").toLowerCase();
      const ok =
        !got ||
        got.includes(want) ||
        want.includes(got) ||
        (want.includes("bengaluru") && got.includes("bangalore")) ||
        (want.includes("bangalore") && got.includes("bengaluru"));
      if (!ok && location_fit !== "remote_india") {
        const msg = `Location constraint: prefer ${hc.city}`;
        risks.push(msg);
        if (hc.strictFilter) {
          hardGates.push(msg);
          composite = Math.min(composite, 40);
        }
      }
    }
    if (
      hc.noticeMaxDays != null &&
      notice_period_days != null &&
      notice_period_days > hc.noticeMaxDays
    ) {
      const msg = `Notice ${notice_period_days}d exceeds ceiling ${hc.noticeMaxDays}d`;
      risks.push(msg);
      if (hc.strictFilter) {
        hardGates.push(msg);
        composite = Math.min(composite, 42);
      }
    }
    if (
      expected_ctc_lakh != null &&
      hc.compMaxLpa != null &&
      expected_ctc_lakh > hc.compMaxLpa * 1.15
    ) {
      const msg = `Expected CTC above constraint (~${hc.compMaxLpa} LPA)`;
      risks.push(msg);
      if (hc.strictFilter) {
        hardGates.push(msg);
        composite = Math.min(composite, 42);
      }
    }
    if (
      expected_ctc_lakh != null &&
      hc.compMinLpa != null &&
      expected_ctc_lakh < hc.compMinLpa * 0.7
    ) {
      risks.push(`Expected CTC well below band floor (~${hc.compMinLpa} LPA) — verify interest`);
    }
  }

  if (notice_period_days != null && notice_period_days > 60) {
    risks.push(`Notice period ${notice_period_days} days — plan overlap`);
  }
  if (location_fit === "relocation") risks.push("Relocation required unless remote is acceptable");
  if (expected_ctc_lakh != null && band.max != null && expected_ctc_lakh > band.max) {
    risks.push("Expected CTC above stated band");
  }

  const level = hardGates.some((g) => g.startsWith("Function mismatch"))
    ? ("no" as FitLevel)
    : levelFromScore(composite);

  // Evidence quotes from resume lines that mention matched skills or must tokens
  const evidence: RankEvidence[] = [];
  for (const sm of stack_match.filter((s) => s.level === "strong").slice(0, 3)) {
    const line = lines.find((l) => positiveMention(l, sm.skill));
    if (line) evidence.push({ claim: `Evidence of ${sm.skill}`, quote: line.slice(0, 220) });
  }
  if (evidence.length === 0) {
    const quote = lines.find((l) => l.length > 28 && l.length < 200);
    if (quote)
      evidence.push({ claim: "Representative line from resume", quote: quote.slice(0, 220) });
  }

  const gaps: string[] = [];
  if (missingStack > 0) {
    gaps.push(
      `Missing stack evidence: ${stack_match
        .filter((s) => s.level === "missing")
        .map((s) => s.skill)
        .join(", ")}`,
    );
  }
  if (mustHits.length < input.role.mustHaves.length) {
    const missed = input.role.mustHaves.filter((m) => !mustHits.includes(m));
    if (missed.length)
      gaps.push(`Must-haves not clearly evidenced: ${missed.slice(0, 3).join("; ")}`);
  }
  if (years == null) gaps.push("Years of experience not explicit on the resume");

  const match: MatchBreakdown = {
    dimensions,
    hardGates,
    roleFamily,
    resumeFamily,
    familyAligned: familyOk,
  };

  const summaryParts = [
    `${name}: ${level.replace("_", " ")} for ${input.role.title} at ${input.role.companyName} (score ${composite}).`,
    familyOk
      ? `Function aligned (${resumeFamily}).`
      : `Function mismatch (${resumeFamily} vs ${roleFamily}) — capped.`,
    `Skills ${strongStack}/${stack.length || 0} strong; must-haves ${mustHits.length}/${input.role.mustHaves.length || 0}.`,
    location_fit !== "unknown" ? `Location: ${location_fit}.` : "",
  ];

  const requirements = evaluateRoleRequirements({
    resumeText: resume,
    role: input.role,
    stackMatch: stack_match,
    hardConstraints: input.hardConstraints,
    familyOk,
    resumeFamily,
    roleFamily,
    locationFit: location_fit,
    noticePeriodDays: notice_period_days,
    expectedCtcLakh: expected_ctc_lakh,
  });

  const rank: RankResult = {
    score: composite,
    level,
    summary: summaryParts.filter(Boolean).join(" "),
    evidence,
    gaps,
    risks: risks.filter(Boolean),
    requirements,
    india: {
      location_fit,
      notice_period_days,
      current_ctc_lakh,
      expected_ctc_lakh,
      early_stage_fit,
      notes: companyFromTitle ? `Current company signal: ${companyFromTitle}` : "",
    },
    stack_match,
    screen_focus: [
      ...stack_match.filter((s) => s.level !== "strong").map((s) => s.skill),
      ...input.role.mustHaves.filter((m) => !mustHits.includes(m)).slice(0, 2),
      ...hardGates.slice(0, 1),
    ]
      .filter(Boolean)
      .slice(0, 6),
    match,
  };

  const profile: ParsedProfile = {
    full_name: name,
    email,
    phone,
    location,
    linkedin_url: linkedin,
    current_title,
    current_company: companyFromTitle,
    years_experience: years,
    skills: [
      ...new Set(
        stack_match
          .filter((s) => s.level !== "missing")
          .map((s) => s.skill.trim())
          .filter(Boolean),
      ),
    ],
    summary: lines.slice(0, 5).join(" ").slice(0, 400),
  };

  return { profile, rank };
}
