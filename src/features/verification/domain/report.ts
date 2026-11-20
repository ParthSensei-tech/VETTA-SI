/**
 * The shapes the verification surface renders, and the one rule that decides
 * whether a chip appears at all.
 *
 * This is the read side's deciding core: it lives under `domain/` so that it is
 * pure — the rail at `scripts/check-verification.mjs` forbids these files any
 * reach for the database — and so that "what does a verdict look like when the
 * row is stale, half-written, or names an engine we no longer have?" is a
 * question answerable by a unit test rather than by a running queue.
 *
 * The rule is the same one the ladder runs on: when the stored summary cannot be
 * re-validated, say nothing. A chip that guesses is a chip that lies about a
 * person, and the failure mode of a hiring tool that lies about people is a
 * complaint to a lawyer, not a bad demo.
 */
import type { ClaimKind } from "./claims.ts";
import type { Observation, Verdict, VerdictCounts } from "./adjudicate.ts";
import type { DocumentAuthenticityReport } from "./certificate-authenticity.ts";

export type RawForensicInspectionView = {
  readonly quota: {
    readonly plan: "free" | "paid";
    readonly freeQuota: number;
    readonly usesSpent: number;
    readonly usesLeft: number;
    readonly entitled: boolean;
    readonly reason: string;
  };
  readonly documents: readonly DocumentAuthenticityReport[];
};

export const HEADLINES = ["clean", "flagged", "partial", "none"] as const;
export type Headline = (typeof HEADLINES)[number];

/**
 * The headline one slate row shows.
 *
 * No report id, on purpose: the drawer finds the ledger by the application it
 * was opened for, so a cached pointer cannot be forged, replayed or left behind
 * by an engine bump into somebody else's evidence.
 */
export type SlateVerdict = {
  applicationId: string;
  headline: Headline;
  coverage: number;
  counts: VerdictCounts;
  engineVersion: string;
};

export type ReportOutcome = { checkId: string; observation: Observation; note: string };

export type ReportClaim = {
  claimId: string;
  kind: ClaimKind;
  statement: string;
  quote: string;
  verdict: Verdict;
  definitive: boolean;
  /** Set when a check did accuse but was capped: the word it wanted to say. */
  cappedFrom: string;
  note: string;
  restsOn: string;
  outcomes: ReportOutcome[];
};

export type JobState = { status: string; error: string; attempts: number };

export type Coverage = { ratio: number; checked: number; claims: number };

/** What the ledger holds for one application, after the read side has shaped it. */
export type ReportLedger = {
  claims: ReportClaim[];
  coverage: Coverage;
  counts: VerdictCounts;
  costPaise: number;
  engineVersion: string;
};

export type VerificationReportView = {
  verdict: SlateVerdict | null;
  job: JobState | null;
  claims: ReportClaim[];
  coverage: Coverage;
  counts: VerdictCounts;
  costPaise: number;
  engineVersion: string;
  forensics?: RawForensicInspectionView | null;
};

export const EMPTY_COUNTS: VerdictCounts = {
  verified: 0,
  contradicted: 0,
  unverifiable: 0,
  impossible: 0,
  claims: 0,
};

/** Never throws: the column is `text`, and text written by hand is not JSON. */
export function parseSummaryJson(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The cached two columns on `applications`, re-validated rather than trusted.
 *
 * `verification_status` is written by the ledger and read by a recruiter's
 * screen, and the two can be separated by an engine bump or by a hand-edited
 * row. The headline is taken from the summary and, when the summary predates it
 * or omits it, from the status column — which is the same word the ledger
 * wrote — and anything that is not one of the four known words renders no chip
 * at all.
 */
export function slateVerdict(
  applicationId: string,
  status: string | null | undefined,
  summaryJson: string | null | undefined,
): SlateVerdict | null {
  const summary = parseSummaryJson(summaryJson);
  const headline = String(summary.headline ?? status ?? "");
  if (!(HEADLINES as readonly string[]).includes(headline)) return null;
  return {
    applicationId,
    headline: headline as Headline,
    coverage: typeof summary.coverage === "number" ? summary.coverage : 0,
    counts: { ...EMPTY_COUNTS, ...(summary.counts as Partial<VerdictCounts> | undefined) },
    engineVersion: typeof summary.engineVersion === "string" ? summary.engineVersion : "",
  };
}

/**
 * One application into one report.
 *
 * A ledger is what the reports table holds; a verdict is what the slate cached.
 * When the ledger row is gone — purged, or never written because the job was
 * skipped — the view keeps the cached headline and its counts rather than going
 * blank, because the recruiter already saw that chip, but it shows no claims,
 * because there is nothing left to show them from.
 */
export function reportView(
  verdict: SlateVerdict | null,
  job: JobState | null,
  ledger: ReportLedger | null,
  forensics?: RawForensicInspectionView | null,
): VerificationReportView {
  return {
    verdict,
    job,
    claims: ledger ? ledger.claims : [],
    coverage: ledger
      ? ledger.coverage
      : { ratio: verdict?.coverage ?? 0, checked: 0, claims: verdict?.counts.claims ?? 0 },
    counts: ledger?.counts ?? verdict?.counts ?? EMPTY_COUNTS,
    costPaise: ledger?.costPaise ?? 0,
    engineVersion: ledger?.engineVersion ?? verdict?.engineVersion ?? "",
    forensics: forensics ?? null,
  };
}
