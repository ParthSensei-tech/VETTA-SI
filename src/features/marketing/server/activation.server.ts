/**
 * The activation trail.
 *
 * Three moments decide whether the funnel works — profile set, first role
 * pasted, first shortlist seen — and the financial model is built on their
 * counts. Each kind is recorded once per workspace, because the funnel counts
 * companies, not clicks: an org that regenerates its shortlist forty times has
 * still activated exactly once.
 */
import { getSql } from "../../../platform/db.ts";

export type ActivationKind = "signup_profile" | "first_role_created" | "first_shortlist_viewed";

export async function recordActivation(opts: {
  orgId: string;
  userId: string;
  kind: ActivationKind;
  roleId?: string;
}): Promise<void> {
  if (!opts.orgId) return;
  const sql = await getSql();
  const [seen] = await sql<{ id: string }>`
    select id from activation_events
    where org_id = ${opts.orgId} and kind = ${opts.kind}
    limit 1`;
  if (seen) return;
  await sql`
    insert into activation_events (id, org_id, user_id, kind, role_id)
    values (${crypto.randomUUID()}, ${opts.orgId}, ${opts.userId}, ${opts.kind}, ${opts.roleId ?? ""})`;
}
