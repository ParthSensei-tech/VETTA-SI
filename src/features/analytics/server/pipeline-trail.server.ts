/**
 * The pipeline audit trail — the timestamps the Vetta Index is computed from.
 *
 * `pipeline_stage_events` already existed, but only the enterprise analytics
 * entry point wrote it, so in practice the table stayed empty while recruiters
 * moved people through the real pipeline in `applications.pipeline_status`. A
 * published benchmark cannot rest on a table nobody fills, so every workflow
 * that changes a stage now records the change here as well.
 *
 * Why not `recordStageTransition` from `funnel-analytics.server.ts`: that helper
 * is the analytics side's own entry point — it owns `applications.pipeline_status`
 * and speaks the offer-funnel vocabulary (`sourced`, `interview`, `offered`,
 * `joined`). By the time a recruiting action reaches here the row has already
 * moved, and calling it would either rewrite the status a second time or read
 * the new status back as the previous one. All that is genuinely missing is the
 * moment.
 *
 * Failure policy: recorded best-effort, never fatal. A recruiter's Shortlist
 * click must not fail because an analytics insert did, and the Index degrades
 * honestly when an event is missing — a smaller cohort clears no floor, so the
 * number is withheld rather than wrong.
 */
import { getSql } from "../../../platform/db.ts";

export async function recordPipelineTrail(opts: {
  orgId: string | null | undefined;
  applicationId: string;
  candidateId: string;
  roleId: string;
  /** The stage the candidate was in before this action; "" when the row is new. */
  fromStage: string;
  toStage: string;
  actorUserId?: string;
}): Promise<void> {
  // `org_id` is a foreign key, and an application the platform cannot attribute
  // to a company is not evidence about companies — the same fail-closed rule the
  // Index applies when it counts cohorts.
  if (!opts.orgId) return;
  if (!opts.toStage || opts.fromStage === opts.toStage) return;

  try {
    const sql = await getSql();
    await sql`
      insert into pipeline_stage_events (
        id, org_id, application_id, candidate_id, role_id, from_stage, to_stage, actor_user_id
      ) values (
        ${crypto.randomUUID()}, ${opts.orgId}, ${opts.applicationId},
        ${opts.candidateId}, ${opts.roleId}, ${opts.fromStage}, ${opts.toStage},
        ${opts.actorUserId ?? ""}
      )`;
  } catch (err) {
    console.error("[pipeline-trail] stage event not recorded", err);
  }
}
