/**
 * The free job-description audit — the other half of the teaser.
 *
 * A live shortlist proves the ranking; it needs a customer to exist first. This
 * proves the reading, and works on day one with nobody signed up: paste the JD
 * you are hiring for and Vetta tells you what it can actually grade a candidate
 * on from that text, and what the text leaves to your gut.
 *
 * The reason this is a *pure function and not a model call* is the launch rule
 * this whole funnel lives by: an unmeasured number is the one thing that can
 * kill us. A deterministic read cannot invent a benchmark, cannot hallucinate a
 * salary, and gives the same answer to the founder and to the audit page. Every
 * sentence it emits is either a quotation of the founder's own JD or the naming
 * of a thing that is absent from it — both verifiable by scrolling up.
 *
 * Cap everything: this output goes on a public page, so no line is allowed to be
 * long enough to carry a phone number, and no raw JD text is echoed back.
 */

export const MAX_MUST_HAVES = 8;
export const MAX_LINE_CHARS = 160;
export const MAX_JD_CHARS = 12_000;

const SKILL_KEYS = [
  "react", "next.js", "vue", "angular", "svelte", "typescript", "javascript", "node", "express",
  "python", "django", "fastapi", "java", "spring", "kotlin", "swift", "go", "golang", "rust",
  "ruby", "rails", "php", "laravel", "scala", "dart", "flutter", "react native",
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "ansible", "helm", "ci/cd",
  "postgres", "postgresql", "mysql", "mongodb", "redis", "kafka", "rabbitmq", "elasticsearch",
  "snowflake", "databricks", "airflow", "dbt", "spark", "hadoop",
  "graphql", "rest api", "grpc", "microservices", "system design", "distributed systems",
  "machine learning", "deep learning", "llm", "pytorch", "tensorflow", "nlp", "computer vision",
  "solidity", "android", "ios", "figma", "cypress", "playwright", "selenium", "jest",
  "salesforce", "hubspot", "sql", "excel", "tableau", "power bi", "looker",
  "b2b saas", "cold outreach", "seo", "performance marketing", "content marketing",
  "fundraising", "financial modelling", "gaap", "ind-as", "taxation", "audit",
];

/** Phrases that feel like a requirement and grade nothing. Quoted back, not judged. */
const VAGUE_DEMANDS = [
  "fast-paced environment", "fast paced environment", "rockstar", "ninja", "wizard", "guru",
  "wear many hats", "wear multiple hats", "hit the ground running", "self-starter", "self starter",
  "team player", "good communication skills", "excellent communication skills", "strong communication",
  "passionate", "passion for", "go-getter", "hungry", "dynamic professional", "detail oriented",
  "detail-oriented", "multitasking", "work under pressure", "work ethic", "can-do attitude",
  "out of the box", "out-of-the-box", "ownership mindset", "startup hustle",
];

const COMPENSATION_RE = /(₹|rs\.?\s?\d|\blpa\b|lakhs?\b|crore|\bctc\b|salary range|compensation range|\binr\s?\d)/i;
const YEARS_RE = /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:years|yrs)\b|(\d{1,2})\s*(\+|plus)?\s*(?:years|yrs)\b/i;
const NOTICE_RE = /notice period|notice\b|immediately joinable|join.{0,12}(?:days|weeks)|serve.{0,10}notice/i;
const EQUITY_RE = /\besop\b|\besops\b|\bequity\b|employee stock|founder equity|\bphantom\b/i;
const RELOCATION_RE = /\brelocat|\bwork permit\b|\bvisa\b|onsite every|hybrid.?days/i;

const WORK_MODE_KEYS: Array<[RegExp, string]> = [
  [/\bremote\b|work from home|anywhere in india/i, "Remote"],
  [/\bhybrid\b/i, "Hybrid"],
  [/on-?site|in.office/i, "On-site"],
];

function clip(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= MAX_LINE_CHARS ? clean : `${clean.slice(0, MAX_LINE_CHARS).replace(/\s+\S*$/, "")}…`;
}

/** Strip list furniture and label prefixes: "- Must have: 5 yrs React" → "5 yrs React". */
function bareLine(line: string): string {
  return clip(
    line
      .replace(/^\s*(?:[-*•▪◦+]|\d+[.)]|[a-z][.)])\s*/i, "")
      .replace(/^(?:must[- ]haves?|requirements?|mandatory|required|must have|nice[- ]to[- ]haves?|bonus|preferred|what you.?ll bring|we.?re looking for)\s*[:\-–]?\s*/i, ""),
  );
}

function linesOf(jd: string): string[] {
  return jd
    .slice(0, MAX_JD_CHARS)
    .split(/\r?\n|(?<=[.;])\s{1,}(?=[A-Z])/)
    .map((line) => line.trim())
    .filter((line) => line.length > 3);
}

function dedupe(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!value || value.length < 6 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= cap) break;
  }
  return out;
}

export type JdAudit = {
  /** The first plausible heading in the JD, used only to address them. */
  roleTitle: string;
  seniority: string;
  years: string | null;
  /** Skill names quoted exactly as the JD wrote them. */
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  vagueDemands: string[];
  workMode: string | null;
  /** What Vetta would score a resume against — i.e. everything this JD states. */
  gradedOn: string[];
  /** Things this JD does not decide, stated as absences, never as predictions. */
  gaps: string[];
  /** Real counts from the text, so the page can say how much it read. */
  linesRead: number;
};

function titleOf(lines: string[]): string {
  for (const line of lines.slice(0, 12)) {
    const clean = clip(line.replace(/^[#>\s]+/, ""));
    if (clean.length > 2 && clean.length < 80 && !/^we are|about (?:the )?(?:role|job)|job (?:description|title)|position:/i.test(clean)) {
      return clean;
    }
  }
  return "Your role";
}

export function auditJobDescription(jd: string): JdAudit {
  const text = String(jd ?? "").slice(0, MAX_JD_CHARS);
  const lines = linesOf(text);
  const lower = text.toLowerCase();

  /**
   * Skills exactly as this JD wrote them. Quoting the founder's own text back at
   * them is the whole credibility of this page, and printing our lowercase key
   * ("Demonstrated react") would read like a typo instead of a quotation.
   */
  const stack: string[] = [];
  for (const key of SKILL_KEYS) {
    const asWritten = matchAsWritten(text, key);
    if (asWritten && !stack.some((kept) => kept.toLowerCase() === asWritten.toLowerCase())) {
      stack.push(asWritten);
    }
  }

  const mustRe = /(must have|must-?have|required|mandatory|minimum|at least|should have|strong (?:command|experience|understanding|knowledge)|proficien|expert|hands-?on experience|proven (?:track|experience)|you (?:will )?(?:need|bring))/i;
  const niceRe = /(nice to have|nice-to-have|bonus|preferred|plus point|good to have|desirable|would be great|a plus|familiarity)/i;

  const mustHaves = dedupe(lines.filter((l) => mustRe.test(l)).map(bareLine), MAX_MUST_HAVES);
  const niceToHaves = dedupe(
    lines.filter((l) => niceRe.test(l) && !mustRe.test(l)).map(bareLine),
    4,
  );
  const vagueDemands = dedupe(
    VAGUE_DEMANDS.filter((phrase) => lower.includes(phrase)),
    6,
  );
  /** The count in the gap sentence is lines, so it is measured in lines. */
  const vagueLines = lines.filter((l) =>
    VAGUE_DEMANDS.some((phrase) => l.toLowerCase().includes(phrase)),
  ).length;

  const yearsMatch = YEARS_RE.exec(text);
  const years = yearsMatch
    ? yearsMatch[1] && yearsMatch[2]
      ? `${yearsMatch[1]}–${yearsMatch[2]} years`
      : `${yearsMatch[3]}${yearsMatch[4] ? "+" : ""} years`
    : null;

  const seniority = seniorityFrom(text);
  const workMode = WORK_MODE_KEYS.find(([re]) => re.test(text))?.[1] ?? null;
  const compensationStated = COMPENSATION_RE.test(text);
  const noticeAsked = NOTICE_RE.test(text);
  const equityStated = EQUITY_RE.test(text);

  const gradedOn = dedupe(
    [...mustHaves, ...stack.map((skill) => `Demonstrated ${skill}`)].filter(Boolean),
    MAX_MUST_HAVES,
  );

  // Ordered by what a screener cannot recover without it: a JD with no
  // requirement list grades nothing however well the band is stated, so that
  // absence leads and the page never buries it under a cap.
  const gaps: string[] = [];
  if (!mustHaves.length) gaps.push("There is no explicit requirement list in this JD, so every reader — and every screener — invents their own.");
  if (vagueLines) gaps.push(`${vagueLines} line${vagueLines === 1 ? "" : "s"} here describe a temperament rather than a checkable claim. There is no way to fail them on a resume, so they grade nothing.`);
  if (!years) gaps.push("No experience range in this JD, so the first cut is whoever looks plausible. That is still a decision — it is just not yours.");
  if (!compensationStated) gaps.push("No band. Candidates decide whether to apply without telling you, and a quiet pipeline looks identical to a disinterested one.");
  if (!noticeAsked) gaps.push("Nothing asks when they could actually join — which is the question an accepted offer dies on, and the cheapest one to ask in writing.");
  if (!equityStated) gaps.push("No ESOP statement, so on a funded competitor's offer you are negotiating in cash alone.");
  if (!workMode) gaps.push("Remote, hybrid or on-site is not stated — enough for the right person to close the tab before reading the rest.");
  if (stack.length > 7) gaps.push(`${stack.length} technologies are named. Score every one of them equally and the ranking is noise; the real must-haves are a smaller set.`);

  return {
    roleTitle: titleOf(lines),
    seniority,
    years,
    stack,
    mustHaves,
    niceToHaves,
    vagueDemands,
    workMode,
    gradedOn,
    // There are eight possible absences above and seven of them can be true at
    // once; the cap is a page-length rule, not a claim that a JD has few gaps.
    gaps: gaps.slice(0, 7),
    linesRead: lines.length,
  };
}

/** The key as the author typed it, or null when the JD does not name it. */
function matchAsWritten(text: string, key: string): string | null {
  let at = -1;
  let len = 0;
  if (key.includes(" ") || /[.+/]/.test(key)) {
    at = text.toLowerCase().indexOf(key);
    len = key.length;
  } else {
    const hit = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").exec(text);
    if (!hit) return null;
    at = hit.index;
    len = hit[0].length;
  }
  if (at < 0) return null;
  // Widen to the whole token the author wrote: `\bnode\b` matches the "Node"
  // inside "Node.js", and the quotation should be their skill, not our key.
  const run = /^[\w.+#-]*/.exec(text.slice(at))?.[0] ?? "";
  return (run.length >= len ? run : text.slice(at, at + len)).replace(/[.-]+$/, "");
}

function seniorityFrom(text: string): string {  const t = text.toLowerCase();
  const hit = (keys: string[]) => keys.find((k) => new RegExp(`\\b${k}\\b`).test(t));
  if (hit(["intern", "internship", "trainee", "apprentice", "fresher", "campus hire"])) return "Intern / Fresher";
  if (hit(["cto", "vp engineering", "vice president", "head of engineering", "director of engineering", "founder"])) return "Executive / Head";
  if (hit(["principal", "staff engineer", "distinguished", "architect"])) return "Staff / Principal";
  if (hit(["engineering manager", "tech lead", "team lead", "team lead", "lead engineer", "manager"])) return "Lead / Manager";
  if (hit(["senior", "sr."])) return "Senior";
  if (hit(["junior", "associate", "graduate", "entry level"])) return "Junior";
  return "Individual contributor";
}
