/**
 * The founder's lead inbox — the only place demo requests are read or triaged.
 *
 * These are plain async functions (never `createServerFn`: routes import the
 * api wrapper, and a server fn defined behind that indirection gets mocked on
 * the client). Access is deliberately narrow: the owner of the workspace (the
 * solo founder IS the company here) or an address on the VETTA_ADMIN_EMAILS
 * allowlist. Leads are unowned marketing rows, so they must not become
 * world-readable through some future member-scoped page.
 */
import { env } from "@/platform/env.server";
import { getSql } from "@/platform/db";
import {
  LEAD_STATUSES,
  type FunnelCounts,
  type Lead,
  type LeadStatus,
  type TeaserLead,
} from "../domain/leads";

export type { FunnelCounts, Lead, LeadStatus, TeaserLead } from "../domain/leads";

async function assertLeadsAdmin(userId: string): Promise<void> {
  const sql = await getSql();
  // Two plain reads, joined in JS: an owner row and (for the cross-workspace
  // case) an allowlisted email. `= any(sql.array(...))` would be one query but
  // the PGLite fallback parses SQL text, not driver array literals.
  const memberships = await sql<{ role: string }>`
    select role from organization_members
    where user_id = ${userId} and role = 'owner' and status = 'active'`;
  if (memberships.length > 0) return;
  const allowlist = (env("VETTA_ADMIN_EMAILS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const emails = await sql<{ email: unknown }>`select lower(email) as email from "user" where id = ${userId}`;
  if (allowlist.includes(String(emails[0]?.email ?? ""))) return;
  throw new Error("Forbidden: leads are for the workspace owner (or the admin allowlist)");
}

/**
 * The two lists the founder actually works from.
 *
 * `leads` are demo requests — someone who said "come talk to me". `teasers` are
 * the ones above them: a founder who took a real shortlist we built for someone
 * else, before knowing whether Vetta is for them. They are separate because they
 * are different conversations, and a teaser lead has no status column to triage
 * — the ask was already answered on the page.
 */
export async function readLeadsForAdmin(userId: string): Promise<{
  leads: Lead[];
  teasers: TeaserLead[];
  funnel: FunnelCounts;
}> {
  await assertLeadsAdmin(userId);
  const sql = await getSql();
  const [leadRows, teaserRows, totals, auditRows, orgRows, kindRows] = await Promise.all([
    sql<Record<string, unknown>>`
      select id, email, name, company, status, note, marketing_opt_in,
             marketing_opt_in_at, created_at
      from demo_requests
      order by created_at desc
      limit 500`,
    sql<Record<string, unknown>>`
      select t.id, t.role_id, t.email, t.name, t.company, t.marketing_opt_in, t.created_at,
             r.title as role_title
      from teaser_leads t
      left join roles r on r.id = t.role_id
      order by t.created_at desc
      limit 500`,
    sql<{ count: unknown }>`select count(*)::text as count from teaser_leads`,
    sql<{ count: unknown }>`select count(*)::text as count from teaser_leads where role_id = ''`,
    sql<{ count: unknown }>`select count(*)::text as count from organizations`,
    sql<{ kind: string; count: unknown }>`
      select kind, count(*)::text as count from activation_events group by kind`,
  ]);
  // The funnel counts come from activation_events only — the numbers on this
  // page are written by product code, never typed in.
  const byKind: Record<string, number> = {};
  for (const r of kindRows) byKind[r.kind] = Number(r.count);
  const allTeasers = Number(totals[0]?.count ?? 0);
  const audits = Number(auditRows[0]?.count ?? 0);
  return {
    leads: leadRows.map((r) => ({
      id: String(r.id),
      email: String(r.email),
      name: String(r.name ?? ""),
      company: String(r.company ?? ""),
      status: (LEAD_STATUSES.includes(r.status as LeadStatus) ? r.status : "new") as LeadStatus,
      note: String(r.note ?? ""),
      marketingOptIn: Boolean(r.marketing_opt_in),
      marketingOptInAt: r.marketing_opt_in_at ? String(r.marketing_opt_in_at) : null,
      createdAt: String(r.created_at),
    })),
    teasers: teaserRows.map((r) => ({
      id: String(r.id),
      roleId: String(r.role_id ?? ""),
      // The posting is usually still up; when it is not, the lead still is.
      roleTitle: String(r.role_title ?? (r.role_id ? "Role closed or removed" : "JD audit")),
      email: String(r.email),
      name: String(r.name ?? ""),
      company: String(r.company ?? ""),
      marketingOptIn: Boolean(r.marketing_opt_in),
      createdAt: String(r.created_at),
    })),
    funnel: {
      orgs: Number(orgRows[0]?.count ?? 0),
      signupProfile: byKind.signup_profile ?? 0,
      firstRoleCreated: byKind.first_role_created ?? 0,
      firstShortlistViewed: byKind.first_shortlist_viewed ?? 0,
      teaserShortlists: allTeasers - audits,
      teaserJdAudits: audits,
    },
  };
}

export async function writeLeadStatusForAdmin(
  userId: string,
  input: { leadId: string; status: LeadStatus; note?: string },
): Promise<void> {
  await assertLeadsAdmin(userId);
  const sql = await getSql();
  await sql`
    update demo_requests
    set status = ${input.status}, note = coalesce(${input.note ?? null}, note)
    where id = ${input.leadId}`;
}
