/**
 * Reading a verdict back, for the workspace that owns it.
 *
 * Two reads, because the two surfaces need two different things. The slate wants
 * one label per row and must not pay a join per candidate, so it gets the two
 * cached columns on `applications`. The drawer wants the ledger itself, so it
 * asks for one application and gets the claims, the evidence and the arms that
 * could not run.
 *
 * Both are scoped by the `user_id` on the rows that own the chain, not by an id
 * the browser sent — which is the difference between a scoping rule and a
 * suggestion. The drawer reaches the ledger through the application it was
 * opened for rather than through a stored pointer, so there is nothing to forge,
 * replay or leave stale: the report it can read is always this document's own
 * newest completed one, or none.
 *
 * There is deliberately no write path here. Verification is produced by the
 * ingest handoff, not by a page; a button that re-ran the ladder would be a way
 * for a client to spend money the workspace never agreed to.
 */
import { getSql } from "../../../platform/db.ts";
import { loadReport, type VerificationRun } from "./ledger.server.ts";
import {
  reportView,
  slateVerdict,
  type JobState,
  type ReportLedger,
  type SlateVerdict,
  type VerificationReportView,
} from "../domain/report.ts";

function reportLedger(run: VerificationRun): ReportLedger {
  return {
    claims: run.claims.map((claim) => ({
      claimId: claim.claimId,
      kind: claim.kind,
      statement: claim.statement,
      quote: claim.quote,
      verdict: claim.verdict,
      definitive: claim.definitive,
      cappedFrom: claim.cappedFrom,
      note: claim.note,
      restsOn: claim.restsOn,
      outcomes: claim.outcomes.map((o) => ({
        checkId: o.checkId,
        observation: o.observation,
        note: o.note,
      })),
    })),
    coverage: run.coverage,
    counts: run.counts,
    costPaise: run.costPaise,
    engineVersion: run.engineVersion,
  };
}

/**
 * One read for the whole slate.
 *
 * The application is the row that carries the verdict — not the candidate, who
 * can appear in several roles — so the result is keyed by application id and the
 * caller never has to guess which of a person's rows a chip belongs to.
 */
export async function slateVerdictsFor(userId: string, roleId: string): Promise<SlateVerdict[]> {
  const sql = await getSql();
  const rows = await sql<{ id: string; verification_status: string; summary: string | null }>`
    select id, verification_status, verification_summary_json as summary
    from applications
    where role_id = ${roleId} and user_id = ${userId}`;
  return rows
    .map((row) => slateVerdict(row.id, row.verification_status, row.summary))
    .filter((v): v is SlateVerdict => v !== null && v.headline !== "none");
}

/** The newest job for this application, so the drawer can say "checking…" honestly. */
async function latestJob(applicationId: string): Promise<JobState | null> {
  const sql = await getSql();
  const rows = await sql<{ status: string; error: string | null; attempts: number | string }>`
    select status, error, attempts from verification_jobs
    where application_id = ${applicationId}
    order by updated_at desc
    limit 1`;
  const row = rows[0];
  return row
    ? { status: row.status, error: row.error ?? "", attempts: Number(row.attempts) || 0 }
    : null;
}

/**
 * The whole ledger behind one slate row, or an empty view.
 *
 * An application the caller does not own and an application that does not exist
 * return the same thing, because which of the two it was is itself a fact about
 * somebody else's pipeline.
 */
export async function reportForUser(
  userId: string,
  applicationId: string,
): Promise<VerificationReportView> {
  const sql = await getSql();
  const apps = await sql<{ verification_status: string; summary: string | null }>`
    select verification_status, verification_summary_json as summary
    from applications
    where id = ${applicationId} and user_id = ${userId}
    limit 1`;
  const app = apps[0];
  if (!app) return reportView(null, null, null);

  const reportId = await newestReportId(applicationId, userId);
  const run = reportId ? await loadReport(reportId) : null;
  return reportView(
    slateVerdict(applicationId, app.verification_status, app.summary),
    await latestJob(applicationId),
    run ? reportLedger(run) : null,
  );
}

async function newestReportId(applicationId: string, userId: string): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select id from verification_reports
    where application_id = ${applicationId} and user_id = ${userId} and status = 'completed'
    order by created_at desc
    limit 1`;
  return rows[0] ? rows[0].id : null;
}
