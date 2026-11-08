/**
 * The adjudication rule, as a pure function.
 *
 * This is the only place a verdict is decided, and it is deliberately incapable
 * of finding anything out: no IO, no provider, no LLM, no file reads — inputs
 * are observations that other code already paid for, and the output is one of
 * four words. That restriction is the feature. A verification product is worth
 * nothing if the same component that guesses can also accuse, so the accusation
 * path is made structurally narrow here — a non-definitive check *cannot* produce
 * `contradicted` or `impossible` — and the same cap is re-enforced at the write
 * boundary in `insertEvidence()`, so neither a bug in this function nor a check
 * written next month can slip an opinion past the two of them together.
 *
 * Why the cap downgrades to `unverifiable` rather than to `verified`: the honest
 * answer to "a weak signal said this looks wrong but nothing can prove it" is
 * "we do not know", and the UI gives that word more weight than `verified`.
 * Capping upward would turn a soft signal into a certificate of good conduct.
 */

export const VERDICTS = ["verified", "contradicted", "unverifiable", "impossible"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * What a check observed, before anyone decided what it means.
 *
 * `inconsistent` rather than `contradicted` on purpose: a check reports what it
 * saw, and only the registry entry decides whether that sighting is an
 * accusation. A check that cannot say `definitiveWhenMismatch` reports an
 * inconsistency and gets a `unverifiable` out of it.
 */
export const OBSERVATIONS = [
  "supported",
  "inconsistent",
  "impossible",
  "silent",
  "skipped",
  "error",
] as const;
export type Observation = (typeof OBSERVATIONS)[number];

export type CheckOutcome = {
  checkId: string;
  observation: Observation;
  /** What the check saw, in its own words — shown verbatim in the evidence drawer. */
  note?: string;
  detail?: Record<string, unknown>;
  /** Passed through to the ledger; the check, not the adjudicator, knows its price. */
  costPaise?: number;
};

/** A verdict, plus the audit trail of how it was reached. */
export type Adjudication = {
  verdict: Verdict;
  /** Whether the verdict rests on a check that is allowed to accuse. */
  definitive: boolean;
  /** The check the verdict rests on — `''` when no check spoke. */
  restsOn: string;
  /** All check ids whose observation contributed to this verdict. */
  contributingCheckIds: string[];
  /**
   * Set when a check wanted to say `contradicted`/`impossible` and the registry
   * would not allow it. The claim is then `unverifiable`, and this field records
   * what was suppressed so the reason can be shown rather than lost.
   */
  cappedFrom: "" | Verdict;
  note: string;
  detail: Record<string, unknown>;
  costPaise: number;
  /**
   * False when nothing was actually observed about the claim: every check
   * declined to run (unsupported file, no raw bytes, external service
   * unconfigured), or every check ran and found no comparable data. Such a
   * claim is `unverifiable` and is not counted in coverage — coverage answers
   * "how much of this could we honestly speak about", and a shrug is not speech.
   */
  attempted: boolean;
};

/** Where a check sits in the ladder. See `checks/registry.ts` for the entries. */
export type CheckTier = {
  id: string;
  label: string;
  /** 0 = ₹0 and inline; 1 = ₹0 but slow; 2 = paid provider; 3 = human/issuer checkout. */
  tier: number;
  costPaise: number;
  /** Needs the raw document bytes, so it waits on the store and its consent purpose. */
  requiresRawBytes: boolean;
  /** `''` for a self-contained check; otherwise the provider it must wait for. */
  externalDependency: string;
  /**
   * The single most important flag in the feature: whether a mismatch from this
   * check is evidence of a falsehood rather than an opinion about one. Only
   * checks with this true may ever produce `contradicted` or `impossible`.
   */
  definitiveWhenMismatch: boolean;
  /** Claim kinds this check can say anything about. Empty means "all". */
  kinds: string[];
};

/**
 * Checks that are allowed to accuse. Derived from the registry rather than a
 * second hand-maintained list, so a check cannot be added with
 * `definitiveWhenMismatch: true` and still be missing here — and `DEFINITIVE`
 * is what `insertEvidence()` throws against.
 */
export function definitiveCheckIds(checks: readonly CheckTier[]): ReadonlySet<string> {
  return new Set(checks.filter((c) => c.definitiveWhenMismatch).map((c) => c.id));
}

/** The two words that accuse a person, as opposed to recording what could not be settled. */
export const ACCUSING_VERDICTS: readonly Verdict[] = ["contradicted", "impossible"];

export function isAccusingVerdict(verdict: Verdict): boolean {
  return ACCUSING_VERDICTS.includes(verdict);
}

/**
 * Whether a check is allowed to have this verdict written against a claim.
 *
 * A pure predicate, so the rule the write boundary enforces can be tested
 * without a database — and so the boundary can call it rather than restate it.
 * An unregistered check id is not in `definitive`, so it may report but never
 * accuse: a check nobody reviewed for accusation power cannot acquire it by
 * being forgotten about.
 */
export function mayRecordVerdict(
  checkId: string,
  verdict: Verdict,
  definitive: ReadonlySet<string>,
): boolean {
  if (!isAccusingVerdict(verdict)) return true;
  return definitive.has(checkId);
}

const VERDICT_RANK: Record<Verdict, number> = {
  impossible: 3,
  contradicted: 2,
  verified: 1,
  unverifiable: 0,
};

/**
 * Whether an observation says something *about the claim*, as opposed to saying
 * nothing (`silent`), nothing was available to say (`skipped`) or the check broke
 * (`error`). Coverage is counted from this, and only from this, so the number a
 * recruiter reads and the verdict they trust come from one definition.
 */
export function isFinding(observation: Observation): boolean {
  return (
    observation === "supported" || observation === "inconsistent" || observation === "impossible"
  );
}

/** The strongest word any of these observations could justify, cap aside. */
function strongest(obs: Observation): Verdict {
  if (obs === "impossible") return "impossible";
  if (obs === "inconsistent") return "contradicted";
  if (obs === "supported") return "verified";
  return "unverifiable";
}

/**
 * Turn the ladder's observations into one verdict for one claim.
 *
 * Precedence, strongest first, each rule present for a reason:
 *
 *  1. A definitive `impossible` wins outright. Arithmetic and a registry date
 *     are not negotiable against a cheaper check's `supported` — "the employer
 *     existed and the credential verified" cannot make 2019–2023 at a company
 *     incorporated in 2021 merely doubtful.
 *  2. Otherwise a definitive `inconsistent` gives `contradicted`.
 *  3. Otherwise `supported` with *nothing* accusing gives `verified` — and an
 *     inconsistent observation from a non-definitive check still counts as
 *     accusing here, which is what stops a soft signal from being laundered
 *     into a clean bill of health.
 *  4. `silent` is not `supported`. A check that ran and could find nothing to
 *     compare — no start date, an open range, no dated history — has said
 *     nothing about the claim, and only an observation that carries a finding
 *     can move the verdict. Treating silence as agreement would print `verified`
 *     on every undated line in the corpus, which is the exact opposite of what
 *     the coverage number is for.
 *  5. Everything else is `unverifiable`, with the note saying what would settle
 *     it. A check that errored or skipped is never reported as a finding.
 *
 * A non-definitive check that claims `impossible` is capped the same way as one
 * that claims `inconsistent`: the cap is about who is allowed to accuse, not
 * about which of the two accusation words they reached for.
 */
export function adjudicate(
  outcomes: readonly CheckOutcome[],
  registry: readonly CheckTier[],
): Adjudication {
  const byId = new Map(registry.map((c) => [c.id, c] as const));
  const definitive = definitiveCheckIds(registry);

  let verdict: Verdict = "unverifiable";
  let restsOn = "";
  let cappedFrom: "" | Verdict = "";
  let cappedNote = "";
  let definitiveUsed = false;
  let anyAccusation = false;
  let attempted = false;
  let costPaise = 0;
  const contributing: string[] = [];
  const detail: Record<string, unknown> = {};
  const notes: string[] = [];
  const silences: string[] = [];

  for (const outcome of outcomes) {
    const check = byId.get(outcome.checkId);
    // An unknown check id is treated as non-definitive, not as a pass: a check
    // added without registering it can warn, but it cannot accuse.
    const canAccuse = Boolean(check && definitive.has(outcome.checkId));
    const notRun = outcome.observation === "skipped";
    // A skipped arm was never bought, so it is free — this number is what the
    // quota gate spends and what the invoice says, and billing a 200-resume
    // slate for ₹50,000 of registry lookups it never made is the kind of bug
    // that only shows up as an angry customer. An arm that *threw* is charged
    // what it declared: a provider call that timed out was usually still billed.
    if (!notRun) {
      if (outcome.costPaise) costPaise += outcome.costPaise;
      else if (check) costPaise += check.costPaise;
    }
    if (notRun || outcome.observation === "error") {
      if (outcome.note) notes.push(outcome.note);
      continue;
    }
    if (outcome.detail) Object.assign(detail, outcome.detail);
    if (outcome.observation === "silent") {
      // Kept apart from `notes` so a clean verdict is not narrated by the checks
      // that had nothing to say, and available to explain an `unverifiable` one.
      if (outcome.note) silences.push(outcome.note);
      continue;
    }
    attempted = true;
    // Every finding is part of the audit trail, including the ones that did not
    // decide the verdict. Recording only the decisive checks would make the
    // trail depend on the order the ladder happened to run in, and the drawer
    // would then show different evidence for the same claim set.
    contributing.push(outcome.checkId);
    const wanted = strongest(outcome.observation);
    const accusing = wanted === "contradicted" || wanted === "impossible";

    if (accusing && canAccuse) {
      if (VERDICT_RANK[wanted] > VERDICT_RANK[verdict] || !definitiveUsed) {
        verdict = wanted;
        definitiveUsed = true;
        restsOn = outcome.checkId;
      }
      if (outcome.note) notes.push(outcome.note);
      anyAccusation = true;
      continue;
    }

    if (accusing) {
      // Capped, and the cap is recorded instead of discarded: the recruiter sees
      // "unverifiable", and the drawer says *why* it could not be escalated.
      if (VERDICT_RANK[wanted] > VERDICT_RANK[cappedFrom || "unverifiable"]) {
        cappedFrom = wanted;
        cappedNote = outcome.note ?? "";
      }
      anyAccusation = true;
      continue;
    }

    // `supported`: enough to say verified only while nothing has accused.
    if (!anyAccusation && verdict !== "contradicted" && verdict !== "impossible") {
      verdict = "verified";
      restsOn = restsOn || outcome.checkId;
      if (outcome.note) notes.push(outcome.note);
    }
  }

  if (verdict === "verified" && anyAccusation) verdict = "unverifiable";

  // A cap is the most informative sentence available; a clean verdict takes its
  // own observations; an `unverifiable` with nothing accusing explains itself
  // with the reasons the checks gave for declining.
  const note =
    cappedNote ||
    notes.join(" ").trim() ||
    silences.join(" ").trim() ||
    (attempted ? "" : "No check could run against this claim.");

  return {
    verdict,
    definitive: definitiveUsed,
    restsOn,
    contributingCheckIds: [...new Set(contributing)],
    cappedFrom,
    note,
    detail,
    costPaise,
    attempted,
  };
}

/**
 * How much of a slate we can honestly speak about.
 *
 * Reported beside every verdict, always, because a verification product that
 * hides its own blind spots is the thing it claims to protect against. The
 * denominator is *checkable* claims, not claims: a "scaled it to 40M users" line
 * has no authoritative source to check against and must not be able to push
 * coverage down as though we failed to look.
 */
export function coverageRatio(args: {
  claims: number;
  checked: number;
  skippedForWantOfBytes?: number;
}): { ratio: number; checked: number; claims: number } {
  const claims = Math.max(0, args.claims);
  const checked = Math.min(claims, Math.max(0, args.checked));
  return { claims, checked, ratio: claims === 0 ? 0 : checked / claims };
}

/** Aggregate counts for one report, in the order the UI prints them. */
export type VerdictCounts = {
  verified: number;
  contradicted: number;
  unverifiable: number;
  impossible: number;
  claims: number;
};

export function countVerdicts(verdicts: readonly Verdict[]): VerdictCounts {
  const counts: VerdictCounts = {
    verified: 0,
    contradicted: 0,
    unverifiable: 0,
    impossible: 0,
    claims: verdicts.length,
  };
  for (const v of verdicts) counts[v] += 1;
  return counts;
}

/**
 * The single word a slate chip shows.
 *
 * Ordering is not a style choice: a candidate is only `clear` when every claim
 * that could be checked was checked and came back supported, because the whole
 * point of the ledger is that absence of evidence is not evidence of honesty.
 */
export function headlineVerdict(counts: VerdictCounts): "clean" | "flagged" | "partial" | "none" {
  if (counts.claims === 0) return "none";
  if (counts.contradicted + counts.impossible > 0) return "flagged";
  if (counts.verified < counts.claims) return "partial";
  return "clean";
}
