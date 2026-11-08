/**
 * Who may have the paid ladder run, in arithmetic.
 *
 * The feature's whole commercial shape is three sentences — four candidate
 * reports free, then the workspace pays, and a retry of work already paid for is
 * not new work — and each of them is a decision that a file with IO could make
 * quietly. So they live here instead: no database, no clock, no session, nothing
 * but the numbers a caller read elsewhere. `runLadder` still cannot see any of
 * this; it is handed a set of check ids and cannot tell whether the workspace
 * that bought them has a plan or a trial or a favour.
 *
 * The invariant that matters for the product is in `entitlementFor`, not in the
 * rupees: a workspace with no entitlement gets `planTier: "tier_a"`, never
 * nothing. The report is still produced, with the free checks and the honest
 * disclosure of what was withheld. Running out of a trial stops the *arms*, and
 * never stops the answer.
 */

/** Every workspace has this ladder, plan or no plan. */
export const PLAN_TIER_FREE = "tier_a";
/** The only plan whose ladder includes the arms that cost — see `checkIdsForPlan`. */
export const PLAN_TIER_PAID = "paid";

/** The allowance a workspace gets before anybody asks it for money. */
export const FREE_USE_ALLOWANCE = 4;

export type VerificationPlan = "free" | "paid";

/**
 * The meter, as read.
 *
 * `usesSpent` counts the reports that fell inside the allowance, not requests:
 * the same document re-read is the same use, which is the entire point of
 * `idempotencyKeyFor` below, and a paid workspace that bought the plan instead of
 * spending the trial did not spend it either.
 */
export type QuotaState = {
  plan: VerificationPlan;
  freeQuota: number;
  usesSpent: number;
};

export type Entitlement = {
  /**
   * Which ladder the next report gets written into. This is the only field the
   * queue reads; everything else is for a human.
   */
  planTier: typeof PLAN_TIER_FREE | typeof PLAN_TIER_PAID;
  /** Whether the arms outside the free tier may be attempted at all. */
  entitled: boolean;
  /** What finishing the next report would be recorded as. `none` charges nothing. */
  charge: VerificationPlan | "none";
  /**
   * Free uses still available. Reported for a paid workspace too, because the
   * allowance it did not use is a fact about the agreement, not a secret.
   */
  usesLeft: number;
  /** In product words, never empty — this is the sentence the disclosure shows. */
  reason: string;
};

/** The state a workspace with no row in the plan table is in — four uses, free. */
export function defaultQuotaState(): QuotaState {
  return { plan: "free", freeQuota: FREE_USE_ALLOWANCE, usesSpent: 0 };
}

function whole(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The three sentences above, as a function.
 *
 * It takes no shortcuts with `plan`: a workspace marked paid but with uses left
 * still gets the paid ladder, because the plan is what was agreed and the
 * allowance is what was granted, and only the charge differs. And a free
 * workspace that has spent its four gets the same `tier_a` it has always had —
 * an exhausted trial is not a disabled feature, and the recruiter who was shown
 * verdicts on Monday must not be shown a blank pane on Tuesday.
 */
export function entitlementFor(state: QuotaState): Entitlement {
  const freeQuota = whole(state.freeQuota);
  const usesSpent = whole(state.usesSpent);
  const usesLeft = Math.max(0, freeQuota - usesSpent);
  const paid = state.plan === "paid";

  if (paid) {
    return {
      planTier: PLAN_TIER_PAID,
      entitled: true,
      charge: "paid",
      usesLeft,
      reason: "This workspace's verification plan is active.",
    };
  }
  if (usesLeft > 0) {
    return {
      planTier: PLAN_TIER_PAID,
      entitled: true,
      charge: "free",
      usesLeft,
      reason: `${usesLeft} of ${freeQuota} free checks left on this workspace.`,
    };
  }
  return {
    planTier: PLAN_TIER_FREE,
    entitled: false,
    charge: "none",
    usesLeft: 0,
    reason: `The free allowance of ${freeQuota} reports is spent, so the checks that need the original file are switched off until this workspace has a plan. The report below is still complete for everything that runs for nothing.`,
  };
}

/**
 * What one charged report is, as a string.
 *
 * The key names the *report* rather than the request, because the report is
 * already the thing the meter charges for: `verification_reports` is unique on
 * org + candidate + engine + claim-set hash, so a retried job, a second tick and
 * a recruiter pressing the button again all land on one row and therefore on one
 * key. What cannot collide is a genuinely different report — new prose, an engine
 * bump, or the same sentences over a different file, which the byte arms would be
 * reading as different evidence.
 *
 * It is a string and not a random id for the same reason the ledger is: a charge
 * that cannot be recomputed from the inputs cannot be explained to a customer.
 */
export function idempotencyKeyFor(args: {
  orgId: string;
  candidateId: string;
  engineVersion: string;
  reportId: string;
}): string {
  return [args.orgId, args.candidateId, args.engineVersion, args.reportId].join(":");
}

export type Preflight = {
  /** Reports whose paid ladder would run. */
  willRunPaid: number;
  /** Reports that would fall back to the free ladder, and are not charged. */
  willFallBack: number;
  /** Whether a human has to agree before any of it is spent. */
  needsConsent: boolean;
  /** What to say to that human. */
  reason: string;
};

/**
 * Ask before a slate spends, rather than explaining afterwards why it did.
 *
 * `maxUses` is the caller's ceiling, not the product's: a 200-resume drop with a
 * cap of 20 verifies 20 and free-ladders the rest, and the number that comes
 * back is what the recruiter was about to commit. The default is deliberately
 * the smaller of "whatever is left" and the slate, because the failure this
 * function exists to prevent is silence at scale, not stinginess.
 */
export function preflightSpend(
  state: QuotaState,
  opts: { reports: number; maxUses?: number },
): Preflight {
  const reports = whole(opts.reports);
  const entitlement = entitlementFor(state);

  if (!entitlement.entitled) {
    return {
      willRunPaid: 0,
      willFallBack: reports,
      needsConsent: false,
      reason: `Nothing is charged: ${entitlement.reason}`,
    };
  }

  // A per-report plan with no cap stated is the one case where the honest answer
  // is "you have to say": 200 reports is a bill the workspace never quoted for,
  // and guessing a ceiling on its behalf is the silence this function exists to
  // prevent. Nothing runs, nothing is charged, the free ladder still reports.
  if (entitlement.charge === "paid" && opts.maxUses === undefined && reports > 0) {
    return {
      willRunPaid: 0,
      willFallBack: reports,
      needsConsent: true,
      reason: `This slate is ${reports} report${reports === 1 ? "" : "s"} against a per-report plan. Say how many to verify and the paid ladder runs for that many; until then every report keeps its free checks.`,
    };
  }

  // The trial is not infinite and the slate is not small: a workspace with three
  // uses left that drops two hundred resumes gets the full ladder on three
  // reports, and the other hundred and ninety-seven get the free one and a
  // number that says so. A cap can only ever reduce the slate's own size, so
  // "verify 20" on a 2-report drop cannot conjure 18 more candidates.
  const affordable = entitlement.charge === "free" ? entitlement.usesLeft : reports;
  const cap = opts.maxUses === undefined ? reports : Math.min(reports, whole(opts.maxUses));
  const willRunPaid = Math.min(cap, affordable);
  const willFallBack = reports - willRunPaid;
  return {
    willRunPaid,
    willFallBack,
    needsConsent: false,
    reason:
      willFallBack === 0
        ? `${reports} report${reports === 1 ? "" : "s"}, charged as ${entitlement.charge}.`
        : `${willRunPaid} report${willRunPaid === 1 ? "" : "s"} with the full ladder, ${willFallBack} with the free one.`,
  };
}
