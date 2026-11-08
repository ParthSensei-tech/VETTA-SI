/**
 * Tier A: the checks that cost nothing, run inline, and accuse only when the
 * arithmetic leaves no room for an honest explanation.
 *
 * These are ₹0, need no raw document bytes, and call no external service, which
 * is what lets them run inside ranking's own request path for a 200-resume slate.
 * Pure is a property of the code, not a policy: nothing in this folder may reach
 * the filesystem, DNS or `fetch` — `npm run check:verification` fails the build
 * if it does, because a check that can go out to the world is a check whose
 * output is only as reproducible as the world was on the day it ran.
 *
 * The discipline that matters most here is the one about absence. A resume that
 * omits dates, or lists three stints out of an eight-year career, is incomplete,
 * not false — and a product that treats incomplete as false will contradict
 * precisely the candidates whose documents are messiest, which in India means the
 * ones written by people with the least access to a resume writer. So every check
 * below returns `silent` rather than `inconsistent` when it is missing input, and
 * the two checks allowed to accuse say so only on numbers that came out of the
 * candidate's own document.
 */

import { monthsBetween, parseMonthKey, type ExtractedClaim } from "../claims.ts";
import type { CheckOutcome } from "../adjudicate.ts";
import type { DocumentForensics } from "../forensics.ts";

/**
 * Everything a check is allowed to know.
 *
 * `now` is a parameter and not a call to `Date.now()` for the same reason the
 * checks are pure: a verdict that depends on the wall clock is not reproducible,
 * and a future-dating check run in December would contradict a document that ran
 * clean in January. The runner resolves the reference month once per report and
 * every date in that report agrees with it.
 */
export type CheckContext = {
  /** Reference month as `YYYY-MM`, resolved by the runner. */
  now: string;
  /** The claim under check. */
  claim: ExtractedClaim;
  /** Every claim extracted from the same subject, for cross-claim arithmetic. */
  siblings: readonly ExtractedClaim[];
  /**
   * What the candidate's files say about their own making, already read.
   *
   * Absent (or empty) whenever there were no bytes to read, which is why every
   * arm that uses it is registered `requiresRawBytes` and is skipped by the ladder
   * before this field is ever consulted. The analysis is passed in rather than
   * computed here because the ladder runs one analysis per application and many
   * claims per analysis: a check that re-parsed the file would multiply the cost
   * of a 200-resume slate by the number of claims on it, and the pure core may
   * not do IO to do so in the first place.
   */
  documents?: readonly DocumentForensics[];
};

export type PureCheck = (ctx: CheckContext) => CheckOutcome;

/** `present` resolves to the reference month; anything else must parse. */
function endMonthOf(claim: ExtractedClaim, now: string): string | null {
  const end = claim.detail.endMonth;
  if (!end) return null;
  if (end === "present") return now;
  return parseMonthKey(end) ? end : null;
}

function dated(claim: ExtractedClaim): boolean {
  return Boolean(claim.detail.startMonth && claim.detail.endMonth);
}

/**
 * Work that is dated as already started, in the future.
 *
 * Definitive, and the only date claim that can be: the candidate wrote that a
 * stint began after this month, and a job cannot have been done before it
 * started. No interpretation, no missing input, nothing about the person's
 * writing habits.
 *
 * The current month is tolerated — a resume written in the month it reports is
 * not a lie, and neither is one that rounds up to a month boundary.
 */
export const checkStartInFuture: PureCheck = ({ claim, now }) => {
  if (claim.kind !== "employment_period") return skipped();
  const nowKey = parseMonthKey(now);
  const start = claim.detail.startMonth;
  if (!nowKey || !start) return silent("no start date to compare");
  const parsed = parseMonthKey(start);
  if (!parsed) return silent("start date unparseable");
  const ahead = (parsed.year - nowKey.year) * 12 + (parsed.month - nowKey.month);
  if (ahead > 1) {
    return {
      checkId: "dates.dated_in_future",
      observation: "impossible",
      note: `Its own start date, ${start}, is ${ahead} months after the reference month ${now}.`,
      detail: { startMonth: start, monthsAhead: ahead, referenceMonth: now },
    };
  }
  return {
    checkId: "dates.dated_in_future",
    observation: "supported",
    detail: { referenceMonth: now },
  };
};

/**
 * A range that reaches past today.
 *
 * Not definitive, and this is the one that would have produced our most
 * expensive false positive if it were. A fresher who writes "B.Tech, expected
 * 2027", a contractor whose term runs to 2028, a candidate who filled in the
 * month they think they will leave — all ordinary, all honest, and all
 * indistinguishable from a date typed wrong. The end date being in the future is
 * worth surfacing; it is not worth accusing anyone of.
 */
export const checkEndInFuture: PureCheck = ({ claim, now }) => {
  if (claim.kind !== "employment_period" && claim.kind !== "education") return skipped();
  const nowKey = parseMonthKey(now);
  if (!nowKey) return silent("reference month unparseable");
  const end = endMonthOf(claim, now);
  if (!end) return silent("no end date to compare");
  const parsed = parseMonthKey(end);
  if (!parsed) return silent("end date unparseable");
  const ahead = (parsed.year - nowKey.year) * 12 + (parsed.month - nowKey.month);
  if (ahead > 1) {
    return {
      checkId: "dates.range_reaches_future",
      observation: "inconsistent",
      note: `It is dated to ${end}, ${ahead} months after ${now} — an ongoing stint, a notice period, or a typo, and nothing here can tell them apart.`,
      detail: { endMonth: end, monthsAhead: ahead, referenceMonth: now },
    };
  }
  return {
    checkId: "dates.range_reaches_future",
    observation: "supported",
    detail: { referenceMonth: now },
  };
};

/**
 * An end date before the start date.
 *
 * Also definitive, and also arithmetic — with one judgement call that has to be
 * documented because it decides real verdicts: a year-only range whose years are
 * equal ("2019 - 2019") is *not* reversed, since widening puts it at Jan–Dec of
 * the same year. The reversal we are willing to accuse on is a reversed pair of
 * years or a reversed pair of months, which is a transcription the candidate
 * controlled, not a rounding we introduced.
 */
export const checkRangeReversed: PureCheck = ({ claim }) => {
  if (claim.kind !== "employment_period") return skipped();
  const start = claim.detail.startMonth;
  const end = claim.detail.endMonth;
  if (!start || !end || end === "present") return silent("range is not closed");
  const span = monthsBetween(start, end);
  if (span === null) return silent("range is not parseable");
  if (span >= 0) return { checkId: "dates.range_reversed", observation: "supported" };
  return {
    checkId: "dates.range_reversed",
    observation: "impossible",
    note: `Its own dates run backwards: ${start} to ${end} is ${-span} months negative.`,
    detail: { startMonth: start, endMonth: end, months: span },
  };
};

/**
 * "N years of experience", tested against the document's own dated history.
 *
 * The question is not "did they round up" — everybody rounds. It is whether the
 * claim is *possible* given the ranges the same document contains, so the test
 * is on the widest span their own dates allow, from the earliest start to the
 * latest end, and it fires only when the stated total clears that span by both a
 * full year and a sixth of itself.
 *
 * The contiguity guard is what makes this defensible rather than clever. If the
 * dated history has a gap longer than a quarter, the candidate may simply have
 * left older or unglamorous work off the page; the span is then not a bound on
 * their career at all, and the honest answer is `unverifiable`, not
 * `contradicted`. Silently dropping the guard here would produce a check that
 * contradicts honest people with short resumes, which is the failure mode this
 * whole feature was designed to avoid.
 *
 * It is registered NON-definitive, which departs from the plan's illustrative
 * table ("8 years claimed against 5.4 dated → contradicted") and the departure
 * is deliberate. The guard above only catches gaps *inside* the dated history;
 * the far more common shape in this market is a fourteen-year veteran whose
 * résumé dates only the last two roles — no internal gap, and a shortfall that
 * truncation explains completely. In an HR-format Indian résumé, dropping
 * pre-2015 roles is the default, not the exception, so an accusation here would
 * land hardest on the seniorest honest candidates. The observation still fires,
 * still shows in the drawer with the unaccounted years spelled out, and still
 * demotes the report to `unverifiable`; what it no longer has is the power to
 * call a person a liar without a document or a registry in front of it. The
 * definitive arms are the two date-arithmetic checks and, later, the byte-level
 * and registry arms — the ones where no innocent reading of the same text exists.
 */
export const TENURE_SLACK_MONTHS = 12;
export const TENURE_SLACK_FRACTION = 1 / 6;
export const GAP_UNACCOUNTED_MONTHS = 3;
export const STALE_HISTORY_MONTHS = 12;

/** The widest span the document's own dates can mean, or the reason they can't. */
type HistoryBound =
  | { ok: true; earliest: string; latest: string; spanMonths: number; periods: number }
  | { ok: false; reason: string; detail: Record<string, unknown> };

function monthsToKey(total: number): string {
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Month index 0-based inside the total, so `monthsToKey` is its exact inverse. */
function monthsFromKey(key: string): number | null {
  const parsed = parseMonthKey(key);
  return parsed ? parsed.year * 12 + (parsed.month - 1) : null;
}

function historyBound(periods: readonly ExtractedClaim[], now: string): HistoryBound {
  const spans: Array<{ start: number; end: number; current: boolean }> = [];
  for (const p of periods) {
    const start = monthsFromKey(p.detail.startMonth ?? "");
    const endKey = endMonthOf(p, now);
    const end = start === null || endKey === null ? null : monthsFromKey(endKey);
    if (start === null || end === null) continue;
    spans.push({ start, end: Math.max(start, end), current: p.detail.endMonth === "present" });
  }
  if (spans.length === 0)
    return { ok: false, reason: "no dated range could be parsed", detail: {} };
  spans.sort((a, b) => a.start - b.start);

  const earliest = spans[0].start;
  let frontier = spans[0].end;
  let largestGap = 0;
  for (const span of spans.slice(1)) {
    if (span.start > frontier) largestGap = Math.max(largestGap, span.start - frontier);
    frontier = Math.max(frontier, span.end);
  }
  const detail = {
    periods: spans.length,
    largestGapMonths: largestGap,
    reachesPresent: spans.some((s) => s.current),
  };
  if (largestGap > GAP_UNACCOUNTED_MONTHS) {
    return {
      ok: false,
      reason: `a ${largestGap}-month gap inside their own dated history means it bounds nothing`,
      detail,
    };
  }
  const sinceEnd = monthsBetween(monthsToKey(frontier), now);
  if (!spans.some((s) => s.current) && sinceEnd !== null && sinceEnd > STALE_HISTORY_MONTHS) {
    return {
      ok: false,
      reason: `the dated history stops ${sinceEnd} months before ${now}, so work after it cannot be excluded`,
      detail,
    };
  }
  return {
    ok: true,
    earliest: monthsToKey(earliest),
    latest: monthsToKey(Math.max(frontier, monthsFromKey(now) ?? frontier)),
    spanMonths: Math.max(0, Math.max(frontier, monthsFromKey(now) ?? frontier) - earliest),
    periods: spans.length,
  };
}

export const checkTenureArithmetic: PureCheck = ({ claim, siblings, now }) => {
  if (claim.kind !== "tenure") return skipped();
  const stated = claim.detail.years;
  if (!stated) return silent("no stated total");
  const periods = siblings.filter((s) => s.kind === "employment_period" && dated(s));
  if (periods.length === 0) {
    return silent("the document dates no employment, so its own history bounds nothing");
  }

  const bound = historyBound(periods, now);
  const base = { statedYears: stated, referenceMonth: now };
  if (!bound.ok) {
    // Not a clean bound, so not an accusation — but the reason is worth saying
    // out loud, because it is exactly why the number could not be settled.
    return {
      checkId: "experience.tenure_arithmetic",
      observation: "silent",
      note: bound.reason,
      detail: { ...base, ...bound.detail },
    };
  }

  const ownHistoryYears = Math.round((bound.spanMonths / 12) * 10) / 10;
  const excess = stated * 12 - bound.spanMonths;
  const detail = {
    ...base,
    ownHistoryFrom: bound.earliest,
    ownHistoryTo: bound.latest,
    ownHistoryYears,
    excessMonths: excess,
    periodsChecked: bound.periods,
  };

  if (excess >= TENURE_SLACK_MONTHS && excess >= stated * 12 * TENURE_SLACK_FRACTION) {
    return {
      checkId: "experience.tenure_arithmetic",
      observation: "inconsistent",
      note: `Claims ${stated} years; the dates in the same document span ${ownHistoryYears} years (${bound.earliest} to ${bound.latest}), leaving ${Math.round((excess / 12) * 10) / 10} years unaccounted for.`,
      detail,
    };
  }
  return { checkId: "experience.tenure_arithmetic", observation: "supported", detail };
};

/**
 * Whether two stints the candidate says are current really are.
 *
 * Registered as non-definitive and it stays that way: a person holding a
 * full-time role and a retainer, an interim and a permanent, a startup and a
 * contract, is ordinary, and no self-contained check can tell those from a
 * fabrication. So it reports the inconsistency and lets `adjudicate()` cap the
 * verdict — which is the honest output ("we noticed, we cannot prove") and the
 * one the UI is supposed to give *more* weight to than a green tick.
 */
export const checkOverlappingCurrent: PureCheck = ({ claim, siblings, now }) => {
  if (claim.kind !== "employment_period") return skipped();
  if (claim.detail.endMonth !== "present")
    return { checkId: "dates.overlapping_current", observation: "silent" };
  const others = siblings.filter(
    (s) => s.kind === "employment_period" && s !== claim && s.detail.endMonth === "present",
  );
  const start = claim.detail.startMonth;
  if (!start) return silent("no start date");
  const clashes = others.filter((o) => {
    const oStart = o.detail.startMonth;
    if (!oStart) return false;
    const a = monthsBetween(oStart, now);
    const b = monthsBetween(start, now);
    return a !== null && b !== null && Math.min(a, b) >= 1;
  });
  if (clashes.length === 0) return { checkId: "dates.overlapping_current", observation: "silent" };
  return {
    checkId: "dates.overlapping_current",
    observation: "inconsistent",
    note: `Both this and ${clashes.length} other stint${clashes.length > 1 ? "s are" : " is"} dated to the present, overlapping since ${clashes.map((c) => c.detail.startMonth).join(", ")}.`,
    detail: { overlapsSince: clashes.map((c) => c.detail.startMonth), referenceMonth: now },
  };
};

/**
 * A degree dated before the earliest dated work, or after the reference month.
 *
 * Non-definitive on purpose. Internships, part-time study, a gap year, a
 * postgraduate diploma taken before the first engineering role, and a
 * re-typed graduation year are all indistinguishable from a fabricated degree by
 * a check with no document in front of it — and the population where they are
 * most common is the population Vetta's pool is made of.
 */
export const checkEducationTimeline: PureCheck = ({ claim, siblings }) => {
  if (claim.kind !== "education") return skipped();
  const grad = claim.detail.endMonth;
  if (!grad) return silent("degree carries no year");
  const starts = siblings
    .filter((s) => s.kind === "employment_period" && s.detail.startMonth)
    .map((s) => s.detail.startMonth as string)
    .sort();
  const earliest = starts[0];
  if (!earliest) return silent("no dated employment to compare against");
  const before = monthsBetween(earliest, grad);
  if (before === null) return silent("dates unparseable");
  if (before < -1) {
    return {
      checkId: "education.timeline_order",
      observation: "inconsistent",
      note: `The degree is dated ${grad} but the document dates work from ${earliest}, ${-before} months earlier.`,
      detail: { graduationMonth: grad, earliestWorkMonth: earliest },
    };
  }
  return { checkId: "education.timeline_order", observation: "supported" };
};

/**
 * The employer implied by the email domain against the employers written down.
 *
 * The domain is the *most* precise employer signal available — hence its use in
 * extraction — and still this check is non-definitive, because the mismatch cases
 * are overwhelmingly innocent: personal email on a job board profile, a parent
 * company's domain, a rebrand, a client-secondment, a consultancy that bills
 * through its own name. Treating any of that as a contradiction would be the
 * single most common false positive in the feature, and it would fall hardest on
 * candidates who used the only address they had.
 */
export const checkEmailDomainEmployer: PureCheck = ({ claim, siblings }) => {
  if (claim.kind !== "identity") return skipped();
  const domain = claim.detail.domain;
  if (!domain) return silent("no domain");
  const stated = siblings
    .filter((s) => s.kind === "employment_period" && s.detail.employer)
    .map((s) => (s.detail.employer as string).toLowerCase());
  if (stated.length === 0)
    return { checkId: "identity.email_domain_employer", observation: "silent" };
  const stem = domain.split(".")[0];
  const agrees = stated.some((name) =>
    name.replace(/[^a-z0-9]/g, "").includes(stem.replace(/[^a-z0-9]/g, "")),
  );
  if (agrees) {
    return {
      checkId: "identity.email_domain_employer",
      observation: "supported",
      note: `The ${domain} address matches an employer named in the document.`,
      detail: { domain, matched: true },
    };
  }
  return {
    checkId: "identity.email_domain_employer",
    observation: "inconsistent",
    note: `The ${domain} address does not match any employer named in the document (${stated.join(", ")}).`,
    detail: { domain, namedEmployers: stated, matched: false },
  };
};

/**
 * The scale sentence, checked by nothing.
 *
 * Emitted as a check so that the *absence of a source* becomes a recorded,
 * explainable reason instead of an empty cell: "no authoritative source for a
 * user-count claim" is a truer ledger entry than silence, and it is what makes
 * the coverage number honest. It is also the claim class that C2PA, a registry
 * or an issuer lookup would eventually settle — which is why it is registered at
 * tier 0 with no external dependency rather than left out of the ladder.
 */
export const checkMetricHasNoSource: PureCheck = ({ claim }) => {
  if (claim.kind !== "metric") return skipped();
  return {
    checkId: "metric.no_authoritative_source",
    observation: "silent",
    note: `“${claim.detail.quantity ?? claim.quote}” has no authoritative source to check against.`,
    detail: { quantity: claim.detail.quantity },
  };
};

function silent(note: string): CheckOutcome {
  return { checkId: "", observation: "silent", note };
}

function skipped(): CheckOutcome {
  // Not the claim's kind: the runner only calls a check it registered for that
  // kind, so this is a programming-error guard, not a product state. It returns
  // `silent` rather than `skipped` so it can never count as coverage either way.
  return { checkId: "", observation: "silent" };
}
