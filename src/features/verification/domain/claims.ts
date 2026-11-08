/**
 * Claim extraction — the only thing between a resume and an accusation.
 *
 * Regex first, always, and for a reason: a regex can only say what the bytes
 * already said, so every claim it emits carries the exact substring it came
 * from and is checkable by eye. The LLM is allowed to fill gaps in prose-heavy
 * resumes, but nothing stops it doing that here — what stops a model's guess
 * becoming evidence is `dropUngrounded()` below, and the rule it enforces is
 * stricter than the AI guard it sits beside.
 *
 * That guard tolerates token overlap, and this one must not. Overlap is the
 * right tolerance for "did the model read the resume", and the wrong one for
 * "did the candidate say this": a claim assembled from three words that each
 * happen to appear somewhere is a claim the candidate never made, and if it then
 * fails a check we have accused an innocent person of a lie we invented. So
 * grounding here means the quote is a contiguous, whitespace-normalised
 * substring of the source text — and an ungrounded claim is DROPPED, never
 * flagged, never stored, never shown.
 *
 * Month granularity for every date, deliberately. Day-level dating on a resume
 * would contradict people for the way they round: "Jun 2019" and "15 Jun 2019"
 * are the same claim here, and a verification product that fails on that is
 * failed, because it will fail on real documents written by real clerks.
 */

export const CLAIM_KINDS = [
  "tenure",
  "employment_period",
  "education",
  "credential",
  "metric",
  "identity",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export type ClaimDetail = {
  /** A stated total, in years, as the candidate wrote it. */
  years?: number;
  /** `YYYY-MM`. Never a day: see the header. */
  startMonth?: string;
  /** `YYYY-MM`, or the literal `present` when the candidate wrote "Present". */
  endMonth?: string;
  /** `year` means the candidate wrote 2019, not Mar 2019 — an ±11-month claim. */
  monthPrecision?: "month" | "year";
  employer?: string;
  role?: string;
  institution?: string;
  degree?: string;
  credential?: string;
  credentialId?: string;
  domain?: string;
  /** The scale sentence's own words, so the UI can show what was claimed. */
  quantity?: string;
};

export type ExtractedClaim = {
  kind: ClaimKind;
  /** Our canonical phrasing of the claim, for the ledger and the UI. */
  statement: string;
  /** The document's own words. Must be grounded — see `claimIsGrounded`. */
  quote: string;
  detail: ClaimDetail;
};

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const YEAR_ONLY = String.raw`(?:19|20)\d{2}(?!\d)`;
// `MONTHS` is an alternation, so it must be re-grouped before anything is
// appended to it. Interpolated bare, `(?:Jan|…|Dec[.\s]*2019|2019)` binds the
// year only to `Dec` — every "Mar 2019" then matched as a monthless `2019`, and
// "Jun 2016 - Feb 2019" matched as `2016 - Feb` and was dropped as unparseable.
// That silently degraded month precision to year precision and lost most of the
// dated history the tenure check depends on.
const MONTH_NAME = String.raw`(?:${MONTHS})`;
// The gap between month and year is a space or a dot, never a newline: `\s` let
// "…Engineering\n2019" read as a date, joining two unrelated lines into one claim.
const DATE_CORE = String.raw`(?:${MONTH_NAME}[. ]*(?:'[ ]*)?${YEAR_ONLY}|${YEAR_ONLY})`;
const SEPARATOR = String.raw`[-–—→]|\b(?:to|through|till|until|up to)\b`;
const PRESENT_TOKEN = String.raw`\b(?:present|current|currently|now|ongoing|till date|upto now)\b`;

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

/**
 * Mailboxes that say nothing about an employer.
 *
 * This is the highest-precision employer signal available — a person who writes
 * `priya@nimbus.example` is almost certainly at Nimbus — and the whole precision
 * of it is this list. Treating `@gmail.com` as an employer would turn a signal
 * into noise and then let a check contradict someone over a domain they share
 * with a billion people.
 */
export const PUBLIC_MAILBOXES = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.in",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "rediffmail.com",
  "zoho.com",
  "aol.com",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "qq.com",
  "163.com",
  "foxmail.com",
];

export function isPublicMailbox(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return PUBLIC_MAILBOXES.some((p) => d === p || d.endsWith(`.${p}`));
}

/** Whitespace-normalised comparison; the resume's own spacing is not evidence. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .trim()
    .toLowerCase();
}

/** The grounding rule, as a predicate — exported so the LLM path can share it. */
export function claimIsGrounded(claim: Pick<ExtractedClaim, "quote">, sourceText: string): boolean {
  const quote = normalizeText(claim.quote);
  if (quote.length < 4) return false;
  return normalizeText(sourceText).includes(quote);
}

/**
 * Split the drafts that survived grounding from the ones that did not.
 *
 * Dropping is the only safe response. A flagged-but-kept hallucinated claim
 * would sit in the ledger looking like something the candidate wrote, and every
 * later check against it would be measuring our own model.
 */
export function dropUngrounded(
  claims: readonly ExtractedClaim[],
  sourceText: string,
): { kept: ExtractedClaim[]; dropped: ExtractedClaim[] } {
  const kept: ExtractedClaim[] = [];
  const dropped: ExtractedClaim[] = [];
  for (const claim of claims) (claimIsGrounded(claim, sourceText) ? kept : dropped).push(claim);
  return { kept, dropped };
}

/* ------------------------------------------------------------------- months */

export function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(value: string | undefined): { year: number; month: number } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

/** Months from the start of `a` to the start of `b`; negative when reversed. */
export function monthsBetween(a: string, b: string): number | null {
  const from = parseMonthKey(a);
  const to = parseMonthKey(b);
  if (!from || !to) return null;
  return (to.year - from.year) * 12 + (to.month - from.month);
}

export function yearsBetween(a: string, b: string): number | null {
  const months = monthsBetween(a, b);
  return months === null ? null : months / 12;
}

/** `Mar 2019` -> month 3; a bare `2019` -> month `null`, which is a finding. */
function parseDateToken(token: string): { year: number; month: number | null } | null {
  // `(${MONTH_NAME})` — the month *name* must stay capture group 1. Grouping the
  // alternation non-capturing shifted the year into group 1 and made every
  // month-name date parse as `MONTH_INDEX["201"]`, i.e. as no date at all, which
  // silently deleted every employment range in the document.
  const withMonth = new RegExp(`^(${MONTH_NAME})[. ]*(?:'[ ]*)?(\\d{4})$`, "i").exec(token.trim());
  if (withMonth) {
    const month = MONTH_INDEX[withMonth[1].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return { year: Number(withMonth[2]), month };
  }
  const yearOnly = /^(\d{4})$/.exec(token.trim());
  if (yearOnly) return { year: Number(yearOnly[1]), month: null };
  return null;
}

/**
 * Widen a year-only date to a month, the way generously as the claim allows.
 *
 * A range written without months is a real claim, so it is checked — but against
 * the widest span consistent with what was written, and the precision is carried
 * in `monthPrecision` so the check can widen its tolerance again rather than
 * quietly pretend the candidate said March.
 */
function widen(parsed: { year: number; month: number | null }, side: "start" | "end"): string {
  if (parsed.month) return monthKey(parsed.year, parsed.month);
  return side === "start" ? monthKey(parsed.year, 1) : monthKey(parsed.year, 12);
}

/* ----------------------------------------------------------------- patterns */

const RANGE_RE = new RegExp(
  String.raw`\b(?<left>${DATE_CORE})\s*(?:${SEPARATOR})\s*(?:(?<right>${DATE_CORE})|(?<present>${PRESENT_TOKEN}))`,
  "gi",
);

const TENURE_RE = new RegExp(
  String.raw`(?:\b(?:around|about|approximately|nearly|over|more than|experienced|having)\s+)?` +
    String.raw`(\d+(?:\.\d+)?|\d+\+|${Object.keys(WORD_NUMBERS).join("|")})\s*\+?\s*` +
    String.raw`(?:years?|yrs?)\b(?:[^.\n]{0,48}?)?` +
    String.raw`(?:experience|expertise|exp\b|in the industry|working experience|professional)?`,
  "gi",
);

/**
 * A tenure number that belongs to other people, not to the candidate.
 *
 * Tested against the words immediately before the number, because that is where
 * the sentence puts them: "I lead a team of engineers with 8 years of
 * experience" reads, to a bare number-and-years pattern, exactly like "with 8
 * years of experience". The difference is who the eight years describe, and the
 * tenure check is definitive — so a line about someone else's career could
 * otherwise accuse the candidate of a lie about their own.
 *
 * Plurals and collectives only. "Backend engineer with 7 years of experience" is
 * the single most common tenure sentence in the corpus, so a pattern that also
 * matched the singular job title — or a bullet that merely opens "Led the
 * platform team for 6 years" — would delete the claim the check exists to test.
 */
const THIRD_PERSON_TENURE_RE =
  /\b(?:teams?|groups?|cohorts?|batches?)\s+of\b[^.\n]{0,30}$|\b(?:engineers|developers|analysts|designers|consultants|scientists|interns|juniors|candidates|teammates|members|leads)\b[^.\n]{0,20}$/i;

// Two capture groups, deliberately numbered: `m[1]` is the degree and `m[2]` the
// graduation year. When the degree body was written as a non-capturing group the
// year landed in `m[1]`, `m[2]` was undefined, and every education claim stored an
// `endMonth` derived from `Number(undefined)`.
const DEGREE_BODY = String.raw`Tech|Eng|E|Sc|Com|CA|CS|ARCH|PhD|Phil|BA|A|S`;
const DEGREE_RE = new RegExp(
  String.raw`\b((?:[BM]\.?\s*(?:${DEGREE_BODY})|MBA|B\.?A\.?LL\.?B|Ph\.?\s?D|Diploma|Postgraduate Diploma|PGDM|Bachelor(?:'?s)?|Master(?:'?s)?))\b[^\n]{0,90}?(\b(?:19|20)\d{2}\b)`,
  "gi",
);

// `{0,7}` and not `{1,7}`: the acronym institutions that dominate Indian resumes
// *are* the suffix, so a required preceding token meant "NIT Trichy" and
// "IIT Madras" produced no institution at all — a silently missing field is the
// kind of bug that only shows up as a V6 registry lookup that never happens.
const INSTITUTION_SOURCE = String.raw`((?:[A-Z][A-Za-z'.&\-]+\s*){0,7}(?:University|Institute|College|School|Academy|Polytechnic|IIT|IIM|NIT|BITS|IIIT|VIT|SRM)(?:\s+[A-Z][A-Za-z'.&\-]+)?)`;

const CREDENTIAL_HINT =
  /\b(AWS|Google Cloud|GCP|Azure|Kubernetes|CKA|CKAD|CKS|Terraform|Docker|PMP|CISSP|CEH|TOGAF|ITIL|Scrum|SAFe|Snowflake|Databricks|NVIDIA)\b[^\n]{0,60}?\b(?:Certified|Certification|Specialty|Professional|Expert|Foundations|Associate|Administrator|Architect|Practitioner)\b/i;

const CREDENTIAL_ID_RE =
  /(?:credential|certificate|certification|license|licence|registration|exam|reg\.?\s*no|serial)\s*(?:id|no\.?|number|#)?\s*[:-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,24})/gi;

// Both finites and gerunds: a résumé bullet is written "processing 2.3 million
// records a day" at least as often as "processed 2.3 million records", and an
// unextracted metric is an unreported line — the coverage number would then claim
// we looked at everything while a scale sentence sat invisible.
const METRIC_VERBS =
  "scaled|serv(?:ed|ing)|handl(?:ed|ing)|process(?:ed|ing)|grew|boost(?:ed|ing)|reduc(?:ed|ing)|improv(?:ed|ing)|cut|sav(?:ed|ing)|generat(?:ed|ing)|manag(?:ed|ing)|l(?:ed|eading)";
const METRIC_RE = new RegExp(
  String.raw`((?:${METRIC_VERBS})\b[^.\n]{0,80}?\b\d[\d,.]*\s*(?:million|billion|thousand|M\b|B\b|K\b|users?|requests?|records?|resumes?|transactions?|₹|Rs\.?|crore|lakh|%|percent)[^.\n]{0,40})`,
  "gi",
);

const EMAIL_RE = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const ROLE_LINE_RE =
  /\b(?:Senior|Lead|Principal|Staff|Junior|Associate)?\s*(?:Backend|Frontend|Full[- ]?Stack|Data|ML|Machine Learning|Platform|DevOps|SRE|Software|Web|Mobile)?\s*(?:Engineer|Developer|Architect|Manager|Scientist|Analyst|Consultant)\b/i;

/** Employer right after a period, in the shapes resumes actually use. */
const EMPLOYER_AFTER_RE = /(?:[,—–\-|:]\s*)([A-Z][A-Za-z0-9.&'\- ]{2,38}?)(?:\s*(?:[,—–\-|]|$))/;

/* ----------------------------------------------------------------- extract */

function tenureYears(token: string): number | null {
  const digits = /^(\d+(?:\.\d+)?)\+?$/.exec(token.replace(/\s+/g, ""));
  if (digits) return Number(digits[1]);
  const word = WORD_NUMBERS[token.toLowerCase().trim()];
  return word === undefined ? null : word;
}

function sentenceAround(text: string, index: number, length: number): string {
  const from = Math.max(0, text.lastIndexOf("\n", index));
  let to = text.indexOf("\n", index + length);
  if (to < 0) to = text.length;
  return text.slice(from, to).trim().replace(/\s+/g, " ") || text.slice(index, index + length);
}

/** A section banner ("EMPLOYMENT", "WORK EXPERIENCE"), not a stint's heading. */
const SECTION_HEADER_RE = /^[^a-z]+$/;
/** Places are what resumes write next to a company, never instead of it. */
const LOCATION_WORDS = new Set([
  "bengaluru",
  "bangalore",
  "mumbai",
  "pune",
  "delhi",
  "new delhi",
  "hyderabad",
  "chennai",
  "gurugram",
  "gurgaon",
  "noida",
  "ghaziabad",
  "kolkata",
  "ahmedabad",
  "jaipur",
  "kochi",
  "indore",
  "surat",
  "nagpur",
  "coimbatore",
  "vadodara",
  "lucknow",
  "bhopal",
  "patna",
  "thiruvananthapuram",
  "mysuru",
  "mysore",
  "remote",
  "india",
  "usa",
  "united states",
  "uk",
  "singapore",
  "dubai",
  "uae",
]);

/**
 * The line a date range sits under.
 *
 * Most Indian resumes put the dates on their own row, under the company and the
 * title, so a range-only line would otherwise produce a claim with no employer —
 * and the employer is what the domain check and the recruiter's sentence need.
 * Walking back past blank rows, other stints' dated rows and all-caps banners is
 * what makes this work on a real page instead of only on the tidy one.
 */
function headingAbove(text: string, index: number): string {
  const lines = text.slice(0, index).split(/\r?\n/);
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/(?:19|20)\d{2}/.test(line)) return "";
    if (SECTION_HEADER_RE.test(line)) return "";
    return line;
  }
  return "";
}

/** The first segment of a heading that is a name rather than a title or a place. */
function employerFromHeading(heading: string): string | undefined {
  const segments = heading.split(/[,;|]|\s[—–-]\s/);
  for (const raw of segments) {
    const s = raw.replace(/^[-–—\s]+|[-–—\s.]+$/g, "").trim();
    if (LOCATION_WORDS.has(s.toLowerCase())) continue;
    if (s.length < 3) continue;
    const roleOnly = ROLE_LINE_RE.exec(s)?.[0];
    if (roleOnly && normalizeText(roleOnly) === normalizeText(s)) continue;
    return s;
  }
  return undefined;
}

/** Role and employer for a range, from its own line first and its heading second. */
function attributionFor(
  line: string,
  range: string,
  heading: string,
): { role?: string; employer?: string } {
  const rest = line.slice(line.toLowerCase().indexOf(range.toLowerCase()) + range.length);
  const inlineRole = ROLE_LINE_RE.exec(rest)?.[0];
  const inlineEmployer = EMPLOYER_AFTER_RE.exec(rest)?.[1]?.trim();
  const role = inlineRole || (ROLE_LINE_RE.exec(heading)?.[0] ?? undefined);
  const employerCandidate =
    inlineEmployer && inlineEmployer.length > 2 && !/^(?:and|the|at|in|of)$/i.test(inlineEmployer)
      ? inlineEmployer
      : employerFromHeading(heading);
  return { role, employer: employerCandidate };
}

/**
 * All claims a document makes, in the order it makes them.
 *
 * Nothing here is a judgement. Extraction says what the candidate wrote; the
 * ladder in `checks/` decides whether it holds. The one editorial act is that a
 * line with no date and no number produces nothing at all — an undated "worked
 * at a company" is not a checkable claim, and inventing one would be the same
 * mistake as a hallucinated quote, just quieter.
 */
export function extractClaims(text: string): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];

  const seen = new Set<string>();
  const push = (claim: ExtractedClaim) => {
    // The same identity function the report hash uses, so "is this the same
    // claim" cannot mean one thing here and another thing in the cache key.
    const key = canonicalClaimKey(claim);
    if (seen.has(key)) return;
    // A claim we cannot point back at the document must not exist. Checked here
    // as well as at the gate, so a future extractor bug fails closed instead of
    // writing an ungroundable row.
    if (!claimIsGrounded(claim, text)) return;
    seen.add(key);
    out.push(claim);
  };

  for (const m of text.matchAll(RANGE_RE)) {
    const groups = m.groups ?? {};
    const left = parseDateToken(groups.left ?? "");
    if (!left) continue;
    const isPresent = Boolean(groups.present);
    const right = isPresent ? null : parseDateToken(groups.right ?? "");
    if (!isPresent && !right) continue;

    const explicitMonth = Boolean(left.month) && (isPresent || Boolean(right?.month));
    const startMonth = widen(left, "start");
    const endMonth = isPresent ? "present" : widen(right!, "end");
    if (!isPresent && monthsBetween(startMonth, endMonth) === null) continue;

    const line = sentenceAround(text, m.index ?? 0, m[0].length);
    const bound = attributionFor(line, m[0], headingAbove(text, m.index ?? 0));
    push({
      kind: "employment_period",
      statement: `${bound.role ?? "Employment"} at ${bound.employer ?? "an unnamed employer"} from ${groups.left} to ${isPresent ? "present" : groups.right}`,
      quote: line,
      detail: {
        startMonth,
        endMonth,
        monthPrecision: explicitMonth ? "month" : "year",
        employer: bound.employer,
        role: bound.role,
      },
    });
  }

  for (const m of text.matchAll(TENURE_RE)) {
    const years = tenureYears(m[1]);
    if (years === null || years <= 0 || years > 60) continue;
    // "2019 to 2023" contains no "years"; a bare year never makes a tenure claim.
    if (/^\s*(?:19|20)\d{2}\s*[-–—]/.test(m[0])) continue;
    const line = sentenceAround(text, m.index ?? 0, m[0].length);
    // "I lead a team of engineers with 8 years of experience" is not a claim
    // about the candidate's own career, and checking it against their own dates
    // would contradict them for someone else's résumé line.
    const before = line.slice(0, Math.max(0, line.toLowerCase().indexOf(m[0].toLowerCase())));
    if (THIRD_PERSON_TENURE_RE.test(before)) continue;
    push({
      kind: "tenure",
      statement: `Claims ${years} years of experience`,
      quote: line,
      detail: { years },
    });
  }

  for (const m of text.matchAll(DEGREE_RE)) {
    const line = sentenceAround(text, m.index ?? 0, m[0].length);
    const institution = new RegExp(INSTITUTION_SOURCE).exec(line);
    push({
      kind: "education",
      statement: `${m[1].trim()} — graduated ${m[2]}`,
      quote: line,
      detail: {
        degree: m[1].replace(/\s+/g, " ").trim(),
        institution: institution ? institution[1].trim() : undefined,
        endMonth: monthKey(Number(m[2]), 12),
        monthPrecision: "year",
      },
    });
  }

  // Line-scoped, because a credential is a line on a resume and not a phrase
  // inside a sentence: "AWS Certified" spanning a wrap is the same claim, and
  // matching the whole line keeps the quote something a recruiter can point at.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!CREDENTIAL_HINT.test(line)) continue;
    // The id is usually on the next row, not the same one. It is looked for in
    // the two lines below, so a certificate number the candidate wrote down is
    // attached to the credential it belongs to instead of being thrown away —
    // and it is still the document's own text, not something we assembled.
    const idSpan = lines.slice(i, i + 3).join("\n");
    const id = new RegExp(CREDENTIAL_ID_RE.source, "i").exec(idSpan);
    push({
      kind: "credential",
      statement: `Holds ${line
        .trim()
        .replace(/^[-*•]\s*/, "")
        .slice(0, 120)}`,
      quote: line.trim(),
      detail: {
        credential: line
          .replace(/^[-*•]\s*/, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120),
        credentialId: id ? id[1] : undefined,
      },
    });
  }

  for (const m of text.matchAll(METRIC_RE)) {
    push({
      kind: "metric",
      statement: `Scale claim with no source: ${(m[1] ?? "").trim()}`,
      quote: (m[1] ?? "").trim(),
      detail: { quantity: (m[1] ?? "").trim() },
    });
  }

  for (const m of text.matchAll(EMAIL_RE)) {
    const domain = m[2].toLowerCase();
    if (isPublicMailbox(domain)) continue;
    const employer = domain.split(".")[0].replace(/[-_]/g, " ");
    push({
      kind: "identity",
      statement: `Employer implied by email domain ${domain}`,
      quote: m[0],
      detail: { domain, employer },
    });
  }

  return out;
}

/**
 * Whether a claim could be checked at all, in principle.
 *
 * A "scaled it to 40M users" line has no authoritative source anywhere, and
 * counting it in the coverage denominator would punish the report for a blind
 * spot that belongs to the world, not to us — while still showing the claim,
 * because hiding the un-checkable lines is how a verification product stops
 * being one.
 */
export const UNCHECKABLE_KINDS: readonly ClaimKind[] = ["metric"];

export function isCheckable(kind: ClaimKind): boolean {
  return !UNCHECKABLE_KINDS.includes(kind);
}

/** The identity of a claim set: same claims, same engine, same report. */
export function canonicalClaimKey(claim: ExtractedClaim): string {
  const d = claim.detail;
  return [
    claim.kind,
    normalizeText(claim.quote),
    d.years ?? "",
    d.startMonth ?? "",
    d.endMonth ?? "",
    d.employer?.toLowerCase() ?? "",
    d.institution?.toLowerCase() ?? "",
    d.credentialId ?? "",
    d.domain ?? "",
  ].join("|");
}

/** Stable for the same claim set whatever order they were found in. */
export async function claimsSetHash(claims: readonly ExtractedClaim[]): Promise<string> {
  const keys = [...new Set(claims.map(canonicalClaimKey))].sort();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keys.join("\n")));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
