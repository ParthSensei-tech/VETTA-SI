/**
 * Shortlist masking for the public teaser — the piece of Vetta that puts real
 * hiring output on the internet without putting a real person on it.
 *
 * The teaser is the reciprocity move: a founder sees a shortlist Vetta actually
 * built, before we ask for anything. That only survives contact with DPDP if the
 * page is a *demonstration of judgement*, not a directory. So the rule this
 * module enforces is that a row may carry what Vetta concluded about a person,
 * and nothing about who the person is:
 *
 *   - no name — only initials, which the resume gave us and which we keep
 *   - no free-text title — only a seniority bucket read off it
 *   - no city — only a metro bucket, because "Kochi" plus "8 yrs" plus "React"
 *     is a person in a five-candidate cohort
 *   - no employer — ever, in either direction: the cohort's companies are the
 *     blocklist that model-written prose is checked against
 *   - no verbatim resume quote — the evidence engine's `claim` is Vetta's own
 *     sentence; its `quote` is the candidate's, and a distinctive sentence is
 *     searchable. The server never passes quotes in here.
 *
 * Prose is scrubbed then *denied*: if a blocked entity or a phone/email/URL
 * shape still appears after scrubbing, the bullet is dropped, and a row with no
 * surviving bullets is dropped with it. We would rather show a shorter teaser
 * than a leaky one.
 *
 * And the floor: a masked row in a cohort of two is still identifiable, so
 * anything under MIN_PUBLISHABLE_COHORT renders as nothing at all.
 *
 * Pure by construction — one type-only import, no DB, no clock, no env — so the
 * unit test can assert the leaks directly.
 */
import type { FitLevel } from "../../recruiting/domain/types";

/** Below this many publishable rows, a masked candidate is still a person. */
export const MIN_PUBLISHABLE_COHORT = 5;
/** Rows on the free preview — enough to feel the quality, not the whole list. */
export const PREVIEW_ROWS = 3;
/** Rows once a teaser is unlocked. */
export const FULL_ROWS = 12;
export const PREVIEW_BULLETS = 1;
export const FULL_BULLETS = 3;
/** Model-written prose is quoted back at strangers; it does not get to be long. */
export const MAX_BULLET_CHARS = 170;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const URL_RE = /(?:https?:\/\/|www\.|linkedin\.com\/|github\.com\/|gitlab\.com\/|portfolio\.)\S+/i;
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{9}/;
const LONG_DIGITS_RE = /\d{7,}/;
const FILE_RE = /\b[\w-]+\.(?:pdf|docx?|xlsx?|txt|png|jpe?g)\b/i;

/**
 * Words that appear in hundreds of company names and would deny every bullet.
 *
 * Two kinds, and they earn their place the same way: naming a sector tells a
 * stranger nothing about a person, while removing it from the blocklist is what
 * keeps the teaser publishing at all. A cohort of six backend candidates very
 * likely contains a "— Payments" or a "— Commerce", and "built the payments
 * ledger" is not a clue to who wrote it — the distinctive half of that employer
 * name is still blocked, and still denies the bullet if it appears.
 *
 * The residual risk is an employer whose *whole* identity is a sector word
 * ("Retail Pvt Ltd"). It is real but small, and it cuts against publishing, not
 * for it: the cost of over-deny is a shorter teaser, the cost of under-deny is a
 * person.
 */
const ORG_STOPWORDS = new Set([
  // Corporate suffixes and boilerplate.
  "technologies",
  "technology",
  "tech",
  "solutions",
  "services",
  "service",
  "systems",
  "software",
  "digital",
  "information",
  "info",
  "labs",
  "lab",
  "group",
  "holdings",
  "consulting",
  "consultants",
  "ventures",
  "capital",
  "india",
  "pvt",
  "ltd",
  "limited",
  "inc",
  "llp",
  "the",
  "and",
  // Sectors — a category of work, not a name.
  "payments",
  "payment",
  "banking",
  "finance",
  "fintech",
  "insurance",
  "insurtech",
  "wealth",
  "commerce",
  "retail",
  "wholesale",
  "marketplace",
  "analytics",
  "data",
  "health",
  "healthcare",
  "healthtech",
  "pharma",
  "education",
  "edtech",
  "logistics",
  "supply",
  "media",
  "entertainment",
  "gaming",
  "energy",
  "climate",
  "agtech",
  "saas",
  "cloud",
  "security",
  "platform",
  "networks",
  "telecom",
  "mobile",
  "hardware",
  "automation",
  "marketing",
  "sales",
  "growth",
  "operations",
  "staffing",
  "recruiting",
  "talent",
  "travel",
  "hospitality",
  "food",
  "delivery",
  "mobility",
  "transport",
]);

const METROS: { name: string; keys: string[] }[] = [
  {
    name: "Bengaluru",
    keys: ["bengaluru", "bangalore", "blr", "whitefield", "koramangala", "indiranagar", "hsr layout", "electronic city", "yelahanka"],
  },
  { name: "Mumbai", keys: ["mumbai", "bombay", "navi mumbai", "andheri", "bandra", "worli", "thane", "navi-mumbai"] },
  { name: "Delhi NCR", keys: ["delhi", "ncr", "gurgaon", "gurugram", "noida", "greater noida", "faridabad", "ghaziabad"] },
  { name: "Hyderabad", keys: ["hyderabad", "gachibowli", "HITEC city", "secunderabad"] },
  { name: "Pune", keys: ["pune", "hinjewadi", "kharadi", "wakad"] },
  { name: "Chennai", keys: ["chennai", "madras", "omr", "porur"] },
  { name: "Kolkata", keys: ["kolkata", "calcutta", "salt lake"] },
  { name: "Ahmedabad", keys: ["ahmedabad", "gandhinagar"] },
];

const ABROAD_KEYS = [
  "dubai", "abu dhabi", "singapore", "london", "uk", "united kingdom", "new york", "san francisco",
  "seattle", "austin", "toronto", "canada", "sydney", "australia", "berlin", "germany", "dallas",
  "japan", "dubai/", "united states", "usa", "europe", "remote - us", "remote - eu", "nz", "new zealand",
];

const REMOTE_KEYS = ["remote", "work from home", "wfh", "anywhere", "distributed"];

export type MaskInput = {
  fullName: string;
  location: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: number | null;
  rankScore: number | null;
  level: FitLevel | null;
  /** Vetta's own sentences about this person. Never resume quotes. */
  evidenceClaims: string[];
  /** Vetta's own "what to probe next" lines — weaker, so they fill out depth only. */
  probeLines: string[];
};

export type MaskedRow = {
  handle: string;
  seniority: string;
  region: string;
  experience: string;
  score: number | null;
  level: FitLevel | null;
  /** Why Vetta put this person here — its own sentences, scrubbed. */
  bullets: string[];
  /** What the screen still has to answer. Revealed only once the teaser is unlocked. */
  probe: string | null;
};

export type MaskedShortlist = {
  rows: MaskedRow[];
  publishable: boolean;
  /** Consented, ranked applicants whose prose could not be made safe to show. */
  suppressed: number;
};

export type Scrub = { text: string; safe: boolean };

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordsOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+.#]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function containsToken(lowerHaystack: string, needle: string): boolean {
  if (!needle) return false;
  if (needle.length <= 4) return new RegExp(`\\b${escapeRe(needle)}\\b`).test(lowerHaystack);
  return lowerHaystack.includes(needle);
}

/**
 * Everything that must never appear in public prose for this cohort: every
 * candidate's name parts, every candidate's employer, and the hiring company.
 * Employer names only contribute their distinctive word — "Technologies" is not
 * an entity, and blocking it would blank every bullet Vetta has ever written.
 */
export function entityBlocklist(opts: {
  applicants: Pick<MaskInput, "fullName" | "currentCompany">[];
  roleCompany: string;
}): string[] {
  const blocked = new Set<string>();
  for (const applicant of opts.applicants) {
    for (const word of wordsOf(applicant.fullName)) {
      if (word.length >= 3 && !/^\d+$/.test(word)) blocked.add(word);
    }
    for (const word of wordsOf(applicant.currentCompany)) {
      if (word.length >= 4 && !ORG_STOPWORDS.has(word) && !/^\d+$/.test(word)) blocked.add(word);
    }
  }
  for (const word of wordsOf(opts.roleCompany)) {
    if (word.length >= 4 && !ORG_STOPWORDS.has(word) && !/^\d+$/.test(word)) blocked.add(word);
  }
  return [...blocked].sort((a, b) => b.length - a.length);
}

/** Cut to a whole word, so a truncated sentence does not read like a leak. */
function clamp(text: string): string {
  if (text.length <= MAX_BULLET_CHARS) return text;
  const window = text.slice(0, MAX_BULLET_CHARS);
  const at = window.lastIndexOf(" ");
  return `${(at > 60 ? window.slice(0, at) : window).replace(/[,;:\-\s]+$/, "")}…`;
}

/**
 * Deny first, then cut. Checking the *original* sentence matters: if we clamped
 * to length first, a cohort employer's name straddling the cut would survive as
 * "Zettabyt…" — still distinctive, and the reader has a search box.
 *
 * Redaction is therefore not the mechanism, only evidence in the log. A bullet
 * that contains raw PII is dropped rather than published with holes in it,
 * because "[redacted]" in a public verdict teaches the reader that our prose
 * carries contact details.
 */
export function scrubProse(text: string, blocked: string[]): Scrub {
  const original = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!original) return { text: "", safe: false };

  const lower = original.toLowerCase();
  const unsafe =
    EMAIL_RE.test(original) ||
    URL_RE.test(original) ||
    FILE_RE.test(original) ||
    PHONE_RE.test(original) ||
    LONG_DIGITS_RE.test(original) ||
    blocked.some((word) => containsToken(lower, word));

  if (unsafe) return { text: "", safe: false };
  return { text: clamp(original), safe: true };
}

/** Initials only. A single-token name keeps its single initial. */
export function initialsOf(fullName: string): string {
  const parts = wordsOf(fullName).filter((w) => !/^\d+$/.test(w));
  if (!parts.length) return "Candidate";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const cap = (w: string) => w.charAt(0).toUpperCase();
  return last ? `${cap(first)}. ${cap(last)}.` : `${cap(first)}.`;
}

/**
 * Seniority instead of the title on the resume, because a verbatim title
 * ("Founding Engineer #3") narrows a cohort to one person faster than anything.
 */
export function seniorityOf(currentTitle: string): string {
  const t = currentTitle.toLowerCase();
  if (!t.trim()) return "Seniority not stated";
  const has = (...keys: string[]) => keys.some((k) => containsToken(t, k));
  if (has("intern", "fresher", "trainee", "apprentice", "campus")) return "Intern / Fresher";
  if (has("cto", "ceo", "coo", "vp", "vice president", "president", "founder", "chief")) return "Executive";
  if (has("director", "head of", "general manager")) return "Director / Head";
  if (has("principal", "distinguished", "staff", "senior staff")) return "Staff / Principal";
  if (has("lead", "architect", "manager", "engineering manager", "em", "scrum")) return "Lead / Manager";
  if (has("senior", "sr.", "sr", "itc", "specialist")) return "Senior";
  if (has("junior", "jr", "associate", "graduate", "entry")) return "Junior";
  return "Individual contributor";
}

export function regionOf(location: string, workMode = ""): string {
  const l = `${location} ${workMode}`.toLowerCase();
  if (!location.trim()) return containsToken(l, "remote") ? "Remote" : "Not stated";
  for (const metro of METROS) {
    if (metro.keys.some((key) => containsToken(l, key.toLowerCase()))) return metro.name;
  }
  if (ABROAD_KEYS.some((key) => containsToken(l, key))) return "Outside India";
  if (REMOTE_KEYS.some((key) => containsToken(l, key))) return "Remote";
  return "Rest of India";
}

export function experienceBand(years: number | null): string {
  if (years === null || !Number.isFinite(years)) return "Experience not stated";
  if (years < 2) return "Under 2 yrs";
  if (years < 5) return "2–5 yrs";
  if (years < 8) return "5–8 yrs";
  if (years < 12) return "8–12 yrs";
  return "12+ yrs";
}

function rowFor(applicant: MaskInput, blocked: string[], workMode: string): MaskedRow | null {
  if (applicant.rankScore === null || !applicant.level) return null;

  const claims = applicant.evidenceClaims
    .map((claim) => scrubProse(claim, blocked))
    .filter((scrub) => scrub.safe)
    .map((scrub) => scrub.text);
  const probes = applicant.probeLines
    .map((line) => scrubProse(line, blocked))
    .filter((scrub) => scrub.safe)
    .map((scrub) => scrub.text);

  // Evidence is the whole point of the teaser. A row whose every sentence had to
  // be thrown away is a row we cannot explain, so it does not get shown.
  if (!claims.length) return null;

  return {
    handle: initialsOf(applicant.fullName),
    seniority: seniorityOf(applicant.currentTitle),
    region: regionOf(applicant.location, workMode),
    experience: experienceBand(applicant.yearsExperience),
    score: Math.round(applicant.rankScore),
    level: applicant.level,
    bullets: claims,
    probe: probes[0] ?? null,
  };
}

/**
 * Mask a whole shortlist and enforce the cohort floor. Callers pass applicants
 * already ordered best-first and already consent-filtered; ordering is not
 * re-derived here so that the teaser and the workspace agree on who is #1.
 */
export function maskShortlist(opts: {
  applicants: MaskInput[];
  roleCompany: string;
  workMode?: string;
  depth: "preview" | "full";
  minCohort?: number;
}): MaskedShortlist {
  const blocked = entityBlocklist({ applicants: opts.applicants, roleCompany: opts.roleCompany });
  const min = opts.minCohort ?? MIN_PUBLISHABLE_COHORT;
  const masked = opts.applicants
    .map((applicant) => rowFor(applicant, blocked, opts.workMode ?? ""))
    .filter((row): row is MaskedRow => row !== null);

  if (masked.length < min) {
    return { rows: [], publishable: false, suppressed: opts.applicants.length - masked.length };
  }

  const isPreview = opts.depth === "preview";
  return {
    rows: masked.slice(0, isPreview ? PREVIEW_ROWS : FULL_ROWS).map((row) => ({
      ...row,
      bullets: row.bullets.slice(0, isPreview ? PREVIEW_BULLETS : FULL_BULLETS),
      probe: isPreview ? null : row.probe,
    })),
    publishable: true,
    suppressed: opts.applicants.length - masked.length,
  };
}
