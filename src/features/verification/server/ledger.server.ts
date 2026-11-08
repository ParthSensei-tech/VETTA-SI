import { getSql } from "../../../platform/db.ts";
import {
  claimsSetHash,
  dropUngrounded,
  extractClaims,
  isCheckable,
  type ClaimKind,
  type ExtractedClaim,
} from "../domain/claims.ts";
import {
  adjudicate,
  countVerdicts,
  coverageRatio,
  headlineVerdict,
  isFinding,
  mayRecordVerdict,
  OBSERVATIONS,
  type Adjudication,
  type Observation,
  type Verdict,
  type VerdictCounts,
} from "../domain/adjudicate.ts";
import {
  CHECK_REGISTRY,
  DEFINITIVE_CHECK_IDS,
  VERIFICATION_ENGINE_VERSION,
  runLadder,
} from "../domain/checks/registry.ts";

/**
 * The ledger's write side.
 *
 * Two things are true of every row this file can create, and the second is
 * enforced in code rather than on a review checklist: a verdict only ever comes
 * from `adjudicate()`, which cannot see a model or a network, and a row that
 * accuses is refused unless the check it rests on is registered as definitive.
 * The throw in `insertEvidence()` is the load-bearing part of this file. The
 * rest is bookkeeping a competent engineer could get wrong; the cap on accusing
 * is the one rule a future contributor must not be able to break quietly, so it
 * lives where the write happens instead of where the rule is explained.
 *
 * Nothing here touches `rank_score`, `rank_json`, `rubric_score`, `rubric_json`,
 * `pipeline_status`, `hardGates` or `strictFilter`. The two columns on
 * `applications` are display caches for the verdict chip, and the ranker never
 * reads them — `npm run check:verification` is the version of that sentence the
 * build believes.
 */

/** The check id recorded when a verdict rests on no check at all. */
export const VERDICTLESS_CHECK_ID = "ledger.no_applicable_check";

const VERDICT_SET: readonly Verdict[] = ["verified", "contradicted", "unverifiable", "impossible"];

function isVerdict(value: string | null | undefined): value is Verdict {
  return !!value && (VERDICT_SET as readonly string[]).includes(value);
}

function newId(): string {
  return crypto.randomUUID();
}

/** `YYYY-MM`, the granularity the whole ledger reasons at. */
export function referenceMonth(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Write one verdict, or refuse to.
 *
 * `definitive` is never taken from the caller — it is read out of the registry by
 * check id, so the authority a report carries cannot be negotiated by the code
 * that wanted the verdict. An unregistered check id is refused for the same
 * reason: by definition it is a check nobody reviewed for whether it may accuse.
 * The testable statement of that rule is `mayRecordVerdict()` in the domain; this
 * function is where it is enforced, and the only reason it is in two places is
 * that a caller could otherwise bypass `adjudicate()` and write an accusation.
 *
 * One row per claim, carrying the claim's adjudicated verdict; the individual
 * observations that produced it are kept in `detail_json.outcomes`, because a
 * verdict is a statement about a claim and an observation is a statement about a
 * check, and collapsing those two is how a ledger starts disagreeing with itself.
 */
export async function insertEvidence(args: {
  claimId: string;
  reportId: string;
  orgId: string;
  checkId: string;
  status: Verdict;
  note: string;
  detail: Record<string, unknown>;
  costPaise?: number;
}): Promise<string> {
  if (!mayRecordVerdict(args.checkId, args.status, DEFINITIVE_CHECK_IDS)) {
    throw new Error(
      `[verification] "${args.checkId}" may not write "${args.status}": it is not registered ` +
        "with definitiveWhenMismatch, so its mismatch is an opinion about a person and not evidence " +
        "against one. adjudicate() caps this at unverifiable; a caller that reached here bypassed it.",
    );
  }
  const check = CHECK_REGISTRY.find((c) => c.id === args.checkId);
  const sql = await getSql();
  const id = newId();
  await sql`
    insert into claim_evidence (
      id, claim_id, report_id, org_id, check_id, tier, status, definitive,
      cost_paise, external_dependency, detail_json, note
    ) values (
      ${id}, ${args.claimId}, ${args.reportId}, ${args.orgId}, ${args.checkId},
      ${check?.tier ?? 0}, ${args.status}, ${check?.definitiveWhenMismatch ?? false},
      ${args.costPaise ?? check?.costPaise ?? 0}, ${check?.externalDependency ?? ""},
      ${JSON.stringify(args.detail)}, ${args.note}
    )
    on conflict (claim_id, check_id) do nothing`;
  return id;
}

/**
 * Append the verdict, forever.
 *
 * There is deliberately no update or delete path for this table anywhere in the
 * repo, and `scripts/check-verification.mjs` fails if one appears. A verification
 * product is only auditable if a decision can be re-read after the rules that
 * produced it changed; the alternative is that today's engine is the only
 * evidence about yesterday's verdict.
 */
async function appendVerdictHistory(args: {
  orgId: string;
  reportId: string;
  candidateId: string;
  claimId: string;
  adjudication: Adjudication;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into verification_verdict_history (
      id, org_id, report_id, candidate_id, claim_id, check_id, status, definitive, engine_version
    ) values (
      ${newId()}, ${args.orgId}, ${args.reportId}, ${args.candidateId}, ${args.claimId},
      ${args.adjudication.restsOn || VERDICTLESS_CHECK_ID}, ${args.adjudication.verdict},
      ${args.adjudication.definitive}, ${VERIFICATION_ENGINE_VERSION}
    )`;
}

/**
 * Find the report for exactly this claim set under exactly this engine, or make
 * one.
 *
 * This is the cache, and the key is the thing that actually determines the
 * answer — the claims and the rules, not a timestamp. A re-run after a partial
 * failure therefore costs nothing, and a candidate cannot accumulate two
 * contradictory verdicts for the same document while the engine sits still.
 */
export async function ensureReport(args: {
  orgId: string;
  userId: string;
  candidateId: string;
  applicationId?: string | null;
  roleId?: string | null;
  claims: readonly ExtractedClaim[];
}): Promise<{ reportId: string; isNew: boolean }> {
  const hash = await claimsSetHash(args.claims);
  const sql = await getSql();
  const found = await sql<{ id: string }>`
    select id from verification_reports
    where org_id = ${args.orgId} and candidate_id = ${args.candidateId}
      and engine_version = ${VERIFICATION_ENGINE_VERSION} and claims_set_hash = ${hash}
    limit 1`;
  if (found[0]) return { reportId: found[0].id, isNew: false };

  const reportId = newId();
  await sql`
    insert into verification_reports (
      id, org_id, user_id, candidate_id, application_id, role_id, engine_version, claims_set_hash, status
    ) values (
      ${reportId}, ${args.orgId}, ${args.userId}, ${args.candidateId}, ${args.applicationId ?? null},
      ${args.roleId ?? null}, ${VERIFICATION_ENGINE_VERSION}, ${hash}, 'running'
    )
    on conflict (org_id, candidate_id, engine_version, claims_set_hash) do nothing`;
  return { reportId, isNew: true };
}

export type StoredOutcome = {
  checkId: string;
  observation: Observation;
  note: string;
};

export type VerifiedClaim = {
  claimId: string;
  kind: ClaimKind;
  statement: string;
  quote: string;
  detail: Record<string, unknown>;
  verdict: Verdict;
  definitive: boolean;
  cappedFrom: string;
  note: string;
  restsOn: string;
  outcomes: StoredOutcome[];
};

export type VerificationRun = {
  reportId: string;
  fromCache: boolean;
  engineVersion: string;
  referenceMonth: string;
  claims: VerifiedClaim[];
  counts: VerdictCounts;
  coverage: { ratio: number; checked: number; claims: number };
  headline: "clean" | "flagged" | "partial" | "none";
  costPaise: number;
  /** Claims the grounding gate refused. Counted, never stored, never displayed. */
  droppedUngrounded: number;
};

type ClaimEvidenceRow = {
  claim_id: string;
  claim_kind: string;
  statement: string;
  quote: string;
  status: string | null;
  definitive: boolean | null;
  note: string | null;
  check_id: string | null;
  detail_json: string | null;
  cost_paise: number | null;
};

/**
 * Extract, ground, check, adjudicate, persist — for one candidate.
 *
 * The order is the safety property, and there is only one path through it:
 * extraction can only quote the document, the gate can only delete, the ladder
 * can only observe, adjudication can only choose among four words it was handed,
 * and the read-back of a completed report goes through the same rows a fresh run
 * wrote. A cache hit is not a second implementation of the truth, which is how
 * the two stay incapable of disagreeing.
 */
export async function runVerification(opts: {
  orgId: string;
  userId: string;
  candidateId: string;
  applicationId?: string | null;
  roleId?: string | null;
  resumeText: string;
  hasRawBytes?: boolean;
  availableDependencies?: ReadonlySet<string>;
  allowedCheckIds?: ReadonlySet<string>;
  referenceMonth?: string;
}): Promise<VerificationRun> {
  const now = opts.referenceMonth ?? referenceMonth();
  const kept = dropUngrounded(extractClaims(opts.resumeText), opts.resumeText);
  const { reportId, isNew } = await ensureReport({
    orgId: opts.orgId,
    userId: opts.userId,
    candidateId: opts.candidateId,
    applicationId: opts.applicationId ?? null,
    roleId: opts.roleId ?? null,
    claims: kept.kept,
  });

  if (!isNew) {
    const existing = await loadReport(reportId);
    if (existing) return { ...existing, referenceMonth: now };
  }

  const sql = await getSql();
  for (const claim of kept.kept) {
    await sql`
      insert into candidate_claims (id, report_id, org_id, claim_kind, statement, quote, detail_json)
      values (${newId()}, ${reportId}, ${opts.orgId}, ${claim.kind}, ${claim.statement}, ${claim.quote},
        ${JSON.stringify(claim.detail)})
      on conflict (report_id, claim_kind, quote) do nothing`;
  }

  // The ladder runs over the stored rows, not over the in-memory claims: what
  // the ledger says was checked is then identical to what is in the ledger, and
  // a claim that failed to insert cannot produce a verdict nobody can cite.
  const rows = await sql<{
    id: string;
    claim_kind: string;
    statement: string;
    quote: string;
    detail_json: string;
  }>`
    select id, claim_kind, statement, quote, detail_json from candidate_claims
    where report_id = ${reportId} order by created_at`;
  const revived = rows.map((row) => revive(row));
  const siblingsOf = (id: string) => revived.filter((c) => c.claimId !== id);

  const claims: VerifiedClaim[] = [];
  let totalCost = 0;
  for (const claim of revived) {
    const outcomes = runLadder({
      claim: claim.source,
      siblings: siblingsOf(claim.claimId).map((c) => c.source),
      now,
      hasRawBytes: opts.hasRawBytes ?? false,
      availableDependencies: opts.availableDependencies ?? new Set<string>(),
      allowedCheckIds: opts.allowedCheckIds,
    });
    const adjudication = adjudicate(outcomes, CHECK_REGISTRY);
    totalCost += adjudication.costPaise;
    await insertEvidence({
      claimId: claim.claimId,
      reportId,
      orgId: opts.orgId,
      checkId: adjudication.restsOn || VERDICTLESS_CHECK_ID,
      status: adjudication.verdict,
      note: adjudication.note,
      costPaise: adjudication.costPaise,
      detail: {
        ...adjudication.detail,
        attempted: adjudication.attempted,
        cappedFrom: adjudication.cappedFrom,
        contributingCheckIds: adjudication.contributingCheckIds,
        outcomes: outcomes.map((o) => ({
          checkId: o.checkId,
          observation: o.observation,
          note: o.note ?? "",
        })),
      },
    });
    await appendVerdictHistory({
      orgId: opts.orgId,
      reportId,
      candidateId: opts.candidateId,
      claimId: claim.claimId,
      adjudication,
    });
    claims.push({
      claimId: claim.claimId,
      kind: claim.source.kind,
      statement: claim.source.statement,
      quote: claim.source.quote,
      detail: adjudication.detail,
      verdict: adjudication.verdict,
      definitive: adjudication.definitive,
      cappedFrom: adjudication.cappedFrom,
      note: adjudication.note,
      restsOn: adjudication.restsOn || VERDICTLESS_CHECK_ID,
      outcomes: outcomes.map((o) => ({
        checkId: o.checkId,
        observation: o.observation,
        note: o.note ?? "",
      })),
    });
  }

  const counts = countVerdicts(claims.map((c) => c.verdict));
  const coverage = coverageFor(claims);
  await sql`
    update verification_reports set
      status = 'completed', coverage_ratio = ${Number(coverage.ratio.toFixed(4))},
      counts_json = ${JSON.stringify(counts)}, cost_paise = ${totalCost},
      completed_at = now(), updated_at = now()
    where id = ${reportId}`;
  await writeApplicationSummary(opts.applicationId, counts, coverage, totalCost);

  return {
    reportId,
    fromCache: false,
    engineVersion: VERIFICATION_ENGINE_VERSION,
    referenceMonth: now,
    claims,
    counts,
    coverage,
    headline: headlineVerdict(counts),
    costPaise: totalCost,
    droppedUngrounded: kept.dropped.length,
  };
}

/**
 * How much of a claim set we can honestly speak about.
 *
 * Denominator is *checkable* claims, so a "scaled it to 40M users" line cannot
 * depress coverage as though we failed to look — and numerator is a claim some
 * check actually attempted, so a paid arm that never ran is visible rather than
 * invisible. Both halves are derived from the same stored observations, which is
 * what lets a cache hit report the identical number to the run that produced it.
 */
function coverageFor(claims: readonly VerifiedClaim[]): {
  ratio: number;
  checked: number;
  claims: number;
} {
  const checkable = claims.filter((c) => isCheckable(c.kind));
  const checked = checkable.filter((c) => c.outcomes.some((o) => isFinding(o.observation)));
  return coverageRatio({ claims: checkable.length, checked: checked.length });
}

/** A completed report, read back — the cache hit and the UI's drawer. */
export async function loadReport(reportId: string): Promise<VerificationRun | null> {
  const sql = await getSql();
  const reports = await sql<{
    id: string;
    status: string;
    engine_version: string;
    coverage_ratio: string | number;
    counts_json: string;
    cost_paise: number;
  }>`
    select id, status, engine_version, coverage_ratio, counts_json, cost_paise
    from verification_reports where id = ${reportId} limit 1`;
  const report = reports[0];
  if (!report || report.status !== "completed") return null;

  const rows = await sql<ClaimEvidenceRow>`
    select c.id as claim_id, c.claim_kind, c.statement, c.quote, e.status, e.definitive, e.note,
           e.check_id, e.detail_json, e.cost_paise
    from candidate_claims c
    left join claim_evidence e on e.claim_id = c.id
    where c.report_id = ${reportId}
    order by c.created_at`;

  const claims: VerifiedClaim[] = rows.map((row) => {
    const detail = parseDetail(row.detail_json);
    return {
      claimId: row.claim_id,
      kind: row.claim_kind as ClaimKind,
      statement: row.statement,
      quote: row.quote,
      detail,
      verdict: isVerdict(row.status) ? row.status : "unverifiable",
      definitive: Boolean(row.definitive),
      cappedFrom: String(detail.cappedFrom ?? ""),
      note: row.note ?? "",
      restsOn: row.check_id ?? VERDICTLESS_CHECK_ID,
      outcomes: storedOutcomes(detail),
    };
  });
  const counts = countVerdicts(claims.map((c) => c.verdict));
  return {
    reportId,
    fromCache: true,
    engineVersion: report.engine_version,
    referenceMonth: "",
    claims,
    counts,
    coverage: coverageFor(claims),
    headline: headlineVerdict(counts),
    costPaise: Number(report.cost_paise ?? 0),
    droppedUngrounded: 0,
  };
}

/** The per-claim drawer the UI reads. */
export async function readLedger(reportId: string): Promise<VerifiedClaim[]> {
  const run = await loadReport(reportId);
  return run ? run.claims : [];
}

/**
 * The two columns the slate reads without a join.
 *
 * Written last: a report that failed part-way must not leave a chip showing a
 * verdict the ledger cannot substantiate. `verification_status` is a label for
 * the chip and `verification_summary_json` is what the drawer needs to render
 * without a query per row.
 */
async function writeApplicationSummary(
  applicationId: string | null | undefined,
  counts: VerdictCounts,
  coverage: { ratio: number },
  costPaise: number,
): Promise<void> {
  if (!applicationId) return;
  const sql = await getSql();
  const headline = headlineVerdict(counts);
  await sql`
    update applications set
      verification_status = ${headline},
      verification_summary_json = ${JSON.stringify({
        headline,
        counts,
        coverage: Number(coverage.ratio.toFixed(4)),
        costPaise,
        engineVersion: VERIFICATION_ENGINE_VERSION,
      })},
      updated_at = now()
    where id = ${applicationId}`;
}

type RevivedClaim = { claimId: string; source: ExtractedClaim };

/**
 * Rebuild an extracted claim from its stored row.
 *
 * `detail_json` round-trips the typed fields and `quote` round-trips the
 * grounding, so a revived claim is a first-class input to the ladder — which is
 * what lets the ladder run over storage instead of over a parallel in-memory copy.
 */
function revive(row: {
  id: string;
  claim_kind: string;
  statement: string;
  quote: string;
  detail_json: string;
}): RevivedClaim {
  return {
    claimId: row.id,
    source: {
      kind: row.claim_kind as ClaimKind,
      statement: row.statement,
      quote: row.quote,
      detail: reviveDetail(parseDetail(row.detail_json)),
    },
  };
}

/**
 * `Record<string, unknown>` in, `ClaimDetail` out.
 *
 * Field by field rather than a cast, because the ladder dereferences these and a
 * stray JSON value must not be able to make a date arithmetic return NaN — which
 * is the difference between a verdict and a check that looks like a verdict.
 */
function reviveDetail(detail: Record<string, unknown>): ExtractedClaim["detail"] {
  const months = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    years: typeof detail.years === "number" ? detail.years : undefined,
    startMonth: months(detail.startMonth),
    endMonth: months(detail.endMonth),
    monthPrecision:
      detail.monthPrecision === "month" || detail.monthPrecision === "year"
        ? detail.monthPrecision
        : undefined,
    employer: typeof detail.employer === "string" ? detail.employer : undefined,
    role: typeof detail.role === "string" ? detail.role : undefined,
    institution: typeof detail.institution === "string" ? detail.institution : undefined,
    degree: typeof detail.degree === "string" ? detail.degree : undefined,
    credential: typeof detail.credential === "string" ? detail.credential : undefined,
    credentialId: typeof detail.credentialId === "string" ? detail.credentialId : undefined,
    domain: typeof detail.domain === "string" ? detail.domain : undefined,
    quantity: typeof detail.quantity === "string" ? detail.quantity : undefined,
  };
}

function storedOutcomes(detail: Record<string, unknown>): StoredOutcome[] {
  const outcomes = detail.outcomes;
  if (!Array.isArray(outcomes)) return [];
  return outcomes.flatMap((o) => {
    if (!o || typeof o !== "object") return [];
    const row = o as Record<string, unknown>;
    if (typeof row.checkId !== "string" || typeof row.observation !== "string") return [];
    // Revalidated against the vocabulary rather than cast: a stored observation
    // is what coverage is counted from, and a value that is not one of the six
    // words would silently read as "we checked this".
    const observation = OBSERVATIONS.find((v) => v === row.observation);
    if (!observation) return [];
    return [{ checkId: row.checkId, observation, note: String(row.note ?? "") }];
  });
}

function parseDetail(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
