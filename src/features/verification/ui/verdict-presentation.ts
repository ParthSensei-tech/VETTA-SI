/**
 * The words and colours the verification surface uses.
 *
 * Pure and separate from the components for one reason: this is where a verdict
 * becomes a sentence a recruiter repeats to a hiring manager, and that mapping
 * has to be testable without a DOM. It is also where the feature's honesty lives
 * — a capped accusation still has to be described as a suspicion, and an arm
 * that never ran still has to appear.
 *
 * Nothing here may soften those two rules. `flagged` is the only headline that
 * colours itself as danger, it appears only when a definitive check contradicted
 * something, and `unverifiable` is never rendered as a warning about the
 * candidate: it is a statement about what we could reach.
 */
import type { Verdict } from "../domain/adjudicate.ts";
import type { ClaimKind } from "../domain/claims.ts";
import { CHECK_REGISTRY } from "../domain/checks/registry.ts";
import type { Headline, ReportClaim, ReportOutcome } from "../domain/report.ts";

export type BadgeTone = "success" | "warn" | "danger" | "outline" | "default";

/** The chip's colour, or `null` for "show nothing" — an unverified slate row. */
export function headlineTone(headline: Headline): BadgeTone | null {
  if (headline === "none") return null;
  if (headline === "clean") return "success";
  if (headline === "flagged") return "danger";
  return "warn";
}

export function headlineLabel(headline: Headline): string {
  if (headline === "clean") return "Claims verified";
  if (headline === "flagged") return "Claims flagged";
  if (headline === "partial") return "Partly checked";
  return "";
}

export function verdictTone(verdict: Verdict): BadgeTone {
  if (verdict === "verified") return "success";
  // Danger is reserved for what a definitive check contradicted. An
  // `unverifiable` row is our reach, not the candidate's character.
  if (verdict === "impossible") return "danger";
  if (verdict === "contradicted") return "danger";
  return "outline";
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === "verified") return "Verified";
  if (verdict === "contradicted") return "Contradicted";
  if (verdict === "impossible") return "Impossible";
  return "Unverifiable";
}

/** How a claim is described in the drawer's group heading. */
export function kindLabel(kind: ClaimKind): string {
  if (kind === "tenure") return "Experience length";
  if (kind === "employment_period") return "Employment dates";
  if (kind === "education") return "Education";
  if (kind === "credential") return "Certifications";
  if (kind === "metric") return "Stated scale";
  return "Identity";
}

/** "12 of 19 claims checked" — the denominator is what makes the number honest. */
export function coverageSentence(coverage: {
  checked: number;
  claims: number;
  ratio: number;
}): string {
  if (coverage.claims === 0) return "No checkable claims in this document.";
  const pct = Math.round(coverage.ratio * 100);
  return `${coverage.checked} of ${coverage.claims} claims checked (${pct}%)`;
}

export type UndisclosedArm = { id: string; label: string; reason: string };

/**
 * Why each arm did not speak, in the order the candidate can act on it.
 *
 * Derived from the outcomes the ladder actually returned and labelled from the
 * registry, so a new check appears in this list the day it is registered and
 * cannot be left out of the disclosure by forgetting a second list. The reason
 * is the part the recruiter reads: "waiting on the issuer" is a decision to buy
 * it, "needs the original document" is a consent question, and "not built yet"
 * is us being straight about the engine.
 */
export function undisclosedArms(claims: readonly ReportClaim[]): UndisclosedArm[] {
  const byId = new Map<string, UndisclosedArm>();
  for (const claim of claims) {
    for (const outcome of claim.outcomes) {
      if (outcome.observation !== "skipped" && outcome.observation !== "error") continue;
      if (byId.has(outcome.checkId)) continue;
      byId.set(outcome.checkId, {
        id: outcome.checkId,
        label: CHECK_REGISTRY.find((c) => c.id === outcome.checkId)?.label ?? outcome.checkId,
        reason: skipReason(outcome),
      });
    }
  }
  return [...byId.values()];
}

function skipReason(outcome: ReportOutcome): string {
  const note = outcome.note ?? "";
  if (/verification plan/i.test(note)) return "Not included in this plan";
  if (/original document bytes|not retained/i.test(note)) return "Needs the original file";
  if (/waiting on/i.test(note)) return note.replace(/^Waiting on\s+([\w-]+).*/i, "Needs $1");
  if (/not enabled/i.test(note)) return "Not in this engine version";
  return note || "Did not run";
}

/**
 * The sentence under one claim: what the checks that ran actually said.
 *
 * The stored note is the audit trail, and it deliberately keeps the reasons the
 * arms that never ran gave — that is what makes a ledger reconstructable. A
 * recruiter reading four claims should not have to read the same plan sentence
 * six times to find the one arithmetic finding underneath it, and the arms are
 * already disclosed once, in their own section, with their labels. So the row
 * rebuilds the sentence from the outcomes instead: findings first, then what the
 * checks that declined said, then nothing at all.
 *
 * The order is the ledger's own, and the empty case is the part that has to be
 * exact. A claim that was checked and found clean has no sentence to show — and
 * it must not be described as unreachable, which would turn a verified row into
 * an admission we never made.
 */
export function claimNarrative(claim: ReportClaim): string {
  if (claim.outcomes.length === 0) return claim.note;
  const spoke = (observations: string[]) => [
    ...new Set(
      claim.outcomes
        .filter((o) => observations.includes(o.observation))
        .map((o) => (o.note ?? "").trim())
        .filter((note) => note.length > 0),
    ),
  ];
  const findings = spoke(["supported", "inconsistent", "impossible"]);
  if (findings.length > 0) return findings.join(" ");
  const declines = spoke(["silent"]);
  if (declines.length > 0) return declines.join(" ");
  const reached = claim.outcomes.some(
    (o) => o.observation !== "skipped" && o.observation !== "error",
  );
  return reached ? "" : "No check in this plan reached this claim.";
}

/** The claims that accuse, first — the drawer leads with what matters. */
export function claimsInReportOrder(claims: readonly ReportClaim[]): ReportClaim[] {
  const rank = (v: Verdict) =>
    v === "impossible" ? 0 : v === "contradicted" ? 1 : v === "unverifiable" ? 2 : 3;
  return [...claims].sort(
    (a, b) => rank(a.verdict) - rank(b.verdict) || a.kind.localeCompare(b.kind),
  );
}
