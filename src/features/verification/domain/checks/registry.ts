/**
 * The check ladder.
 *
 * One table decides four things about every check: what it costs, whether it
 * needs the original bytes, whether it needs somebody else's service, and
 * whether a mismatch from it is allowed to become an accusation. The rest of the
 * feature reads this table instead of restating it — the runner uses the first
 * three to decide what to skip, `adjudicate()` uses the fourth, `insertEvidence()`
 * throws against it, and the UI's paid-arm disclosure list is generated from the
 * rows marked costly rather than from a second list somebody has to remember to
 * update.
 *
 * Why checks that are not built yet are registered here anyway: `skipped` with a
 * reason is the product. A report that silently omits the registry check reads
 * the same as one that ran it and found nothing, and the difference is the whole
 * value of the feature. Registering the future arms now, with their cost and
 * dependency declared, is what makes "we could not check this, here is what it
 * would take" the default answer instead of an afterthought.
 */

import type { ClaimKind, ExtractedClaim } from "../claims.ts";
import type { CheckOutcome, CheckTier } from "../adjudicate.ts";
import {
  checkEducationTimeline,
  checkEmailDomainEmployer,
  checkEndInFuture,
  checkMetricHasNoSource,
  checkOverlappingCurrent,
  checkRangeReversed,
  checkStartInFuture,
  checkTenureArithmetic,
  type PureCheck,
  type CheckContext,
} from "./tier-a.ts";

/**
 * Bump when extraction or a check's logic changes. It is part of the report's
 * cache key, so an old verdict can never be served against new rules — and an
 * engine bump therefore re-grades every candidate, which is the intended cost.
 */
export const VERIFICATION_ENGINE_VERSION = "vetta-verify-1";

export type RegisteredCheck = CheckTier & {
  /** Absent means registered and not implemented: the runner skips it, visibly. */
  run?: PureCheck;
  /**
   * Free-tier visibility. `false` does not hide the row — partial disclosure is
   * the product decision — it withholds the evidence detail and any verdict that
   * only a paid arm could reach.
   */
  includedInFreeTier: boolean;
};

const ALL_KINDS: ClaimKind[] = [
  "tenure",
  "employment_period",
  "education",
  "credential",
  "metric",
  "identity",
];

const TIER_A: RegisteredCheck[] = [
  {
    id: "dates.dated_in_future",
    label: "Work dated as already started, in the future",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: true,
    kinds: ["employment_period"],
    run: checkStartInFuture,
    includedInFreeTier: true,
  },
  {
    id: "dates.range_reaches_future",
    label: "Range dated past today",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    // Deliberately not definitive: "expected 2027" is what every final-year
    // candidate in our pool writes, and it is indistinguishable from a typo.
    definitiveWhenMismatch: false,
    kinds: ["employment_period", "education"],
    run: checkEndInFuture,
    includedInFreeTier: true,
  },
  {
    id: "dates.range_reversed",
    label: "Dates run backwards",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: true,
    kinds: ["employment_period"],
    run: checkRangeReversed,
    includedInFreeTier: true,
  },
  {
    id: "experience.tenure_arithmetic",
    label: "Stated experience against its own dated history",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    // Not definitive: a truncated career history looks, to this check, exactly
    // like an inflated one, and truncation is the norm. See the check's header.
    definitiveWhenMismatch: false,
    kinds: ["tenure"],
    run: checkTenureArithmetic,
    includedInFreeTier: true,
  },
  {
    id: "dates.overlapping_current",
    label: "More than one current employer",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ["employment_period"],
    run: checkOverlappingCurrent,
    includedInFreeTier: true,
  },
  {
    id: "education.timeline_order",
    label: "Degree against the work timeline",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ["education"],
    run: checkEducationTimeline,
    includedInFreeTier: true,
  },
  {
    id: "identity.email_domain_employer",
    label: "Email domain against the named employer",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ["identity"],
    run: checkEmailDomainEmployer,
    includedInFreeTier: true,
  },
  {
    id: "metric.no_authoritative_source",
    label: "Scale claim with no source",
    tier: 0,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ["metric"],
    run: checkMetricHasNoSource,
    includedInFreeTier: true,
  },
];

/**
 * Registered, declared, not yet runnable — V4's document forensics and V6's
 * external arms. Each is a `skipped` row with its reason until `run` exists, and
 * the definitive flags are already what they will be, so the cap on accusing is
 * set by the same table a future check has to be added to.
 */
const FORENSIC: RegisteredCheck[] = [
  {
    id: "document.orphaned_text",
    label: "Recovered text the current page does not show",
    tier: 2,
    costPaise: 0,
    requiresRawBytes: true,
    externalDependency: "",
    definitiveWhenMismatch: true,
    kinds: ALL_KINDS,
    includedInFreeTier: false,
  },
  {
    id: "document.incremental_update",
    label: "Saved more than once over the same original",
    tier: 1,
    costPaise: 0,
    requiresRawBytes: true,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ALL_KINDS,
    includedInFreeTier: false,
  },
  {
    id: "document.anachronism",
    label: "Toolchain or font that post-dates the document",
    tier: 1,
    costPaise: 0,
    requiresRawBytes: true,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ALL_KINDS,
    includedInFreeTier: false,
  },
  {
    id: "document.docx_edit_history",
    label: "Editing history the document wrote about itself",
    tier: 1,
    costPaise: 0,
    requiresRawBytes: true,
    externalDependency: "",
    definitiveWhenMismatch: false,
    kinds: ALL_KINDS,
    includedInFreeTier: false,
  },
  {
    id: "education.cgpa_document_mismatch",
    label: "Grade against the certificate's own bytes",
    tier: 2,
    costPaise: 0,
    requiresRawBytes: true,
    externalDependency: "",
    definitiveWhenMismatch: true,
    kinds: ["education"],
    includedInFreeTier: false,
  },
  {
    id: "registry.employer_incorporation",
    label: "Employer incorporation date",
    tier: 2,
    costPaise: 50_000,
    requiresRawBytes: false,
    externalDependency: "registry",
    definitiveWhenMismatch: true,
    kinds: ["employment_period", "identity"],
    includedInFreeTier: false,
  },
  {
    id: "credential.issuer_lookup",
    label: "Credential resolves at the issuer",
    tier: 2,
    costPaise: 30_000,
    requiresRawBytes: false,
    externalDependency: "issuer",
    definitiveWhenMismatch: true,
    kinds: ["credential"],
    includedInFreeTier: false,
  },
  {
    id: "identity.dns_mx",
    label: "Employer domain accepts mail",
    tier: 2,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "dns",
    definitiveWhenMismatch: false,
    kinds: ["identity"],
    includedInFreeTier: false,
  },
  {
    id: "template.slate_duplicate",
    label: "Same authored skeleton as another applicant",
    tier: 2,
    costPaise: 0,
    requiresRawBytes: false,
    externalDependency: "slate",
    definitiveWhenMismatch: false,
    kinds: ALL_KINDS,
    includedInFreeTier: false,
  },
];

export const CHECK_REGISTRY: readonly RegisteredCheck[] = [...TIER_A, ...FORENSIC];

export function checkById(id: string): RegisteredCheck | undefined {
  return CHECK_REGISTRY.find((c) => c.id === id);
}

/** The ids allowed to accuse, derived once so nothing can maintain a rival list. */
export const DEFINITIVE_CHECK_IDS: ReadonlySet<string> = new Set(
  CHECK_REGISTRY.filter((c) => c.definitiveWhenMismatch).map((c) => c.id),
);

export function checksForKind(kind: ClaimKind): RegisteredCheck[] {
  return CHECK_REGISTRY.filter((c) => c.kinds.length === 0 || c.kinds.includes(kind));
}

export type LadderInput = {
  claim: ExtractedClaim;
  siblings: readonly ExtractedClaim[];
  now: string;
  /** The document store holds original bytes for this candidate, consented and unexpired. */
  hasRawBytes: boolean;
  /** Dependencies actually configured and permitted for this run, e.g. `new Set(["dns"])`. */
  availableDependencies: ReadonlySet<string>;
  /** Only these check ids may run; anything else is skipped as out of entitlement. */
  allowedCheckIds?: ReadonlySet<string>;
};

/**
 * Run every applicable check over one claim.
 *
 * The order is deliberate and is what partial disclosure is made of: each gate
 * that stops a check produces a `skipped` row naming the reason — bytes not
 * retained, service not configured, outside the plan — so the ledger records the
 * shape of the blind spot instead of leaving a blank. A check that threw is
 * recorded as `error` and never as a finding; a broken check must not be able to
 * look like evidence about a person.
 */
export function runLadder(input: LadderInput): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];
  for (const check of checksForKind(input.claim.kind)) {
    if (input.allowedCheckIds && !input.allowedCheckIds.has(check.id)) {
      outcomes.push({
        checkId: check.id,
        observation: "skipped",
        note: `Outside this workspace's verification plan (${check.tier > 1 ? "paid arm" : "not enabled"}).`,
        costPaise: 0,
      });
      continue;
    }
    if (!check.run) {
      outcomes.push({
        checkId: check.id,
        observation: "skipped",
        note: `Not enabled in engine ${VERIFICATION_ENGINE_VERSION}.`,
      });
      continue;
    }
    if (check.requiresRawBytes && !input.hasRawBytes) {
      outcomes.push({
        checkId: check.id,
        observation: "skipped",
        note: "Needs the original document bytes, which are not retained for this candidate.",
      });
      continue;
    }
    if (check.externalDependency && !input.availableDependencies.has(check.externalDependency)) {
      outcomes.push({
        checkId: check.id,
        observation: "skipped",
        note: `Waiting on ${check.externalDependency}, which is not configured for this run.`,
      });
      continue;
    }
    const ctx: CheckContext = { now: input.now, claim: input.claim, siblings: input.siblings };
    let outcome: CheckOutcome;
    try {
      outcome = check.run(ctx);
    } catch (err) {
      outcomes.push({
        checkId: check.id,
        observation: "error",
        note: err instanceof Error ? err.message : "check threw",
      });
      continue;
    }
    // The registry owns the id. A check's own label is a development aid and a
    // mismatch would attribute evidence to a check that never ran, so the id is
    // stamped here rather than trusted.
    outcomes.push({
      ...outcome,
      checkId: check.id,
      costPaise: outcome.costPaise ?? check.costPaise,
    });
  }
  return outcomes;
}
