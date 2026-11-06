import { getSql } from "../db.ts";

function newId(): string {
  return crypto.randomUUID();
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${newId().slice(0, 8)}`;
}

/**
 * Ensure the user has a personal organization and membership.
 * Enterprise multi-tenant root — all recruiting data attaches to org_id.
 */
export async function ensureUserOrg(userId: string, displayName?: string): Promise<{
  orgId: string;
  name: string;
  retentionDays: number;
}> {
  const sql = await getSql();
  const existing = await sql<{ org_id: string; name: string; retention_days: number }>`
    select o.id as org_id, o.name, o.retention_days
    from organization_members m
    join organizations o on o.id = m.org_id
    where m.user_id = ${userId}
    order by m.created_at asc
    limit 1`;
  if (existing[0]) {
    return {
      orgId: existing[0].org_id,
      name: existing[0].name,
      retentionDays: existing[0].retention_days,
    };
  }

  const orgId = newId();
  const name = displayName?.trim() || "My workspace";
  const slug = slugify(name);
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, ${name}, ${slug}, ${userId}, ${365})`;
  await sql`
    insert into organization_members (id, org_id, user_id, role)
    values (${newId()}, ${orgId}, ${userId}, ${"owner"})`;

  // Default system rubric for the org
  const { DEFAULT_RUBRIC_WEIGHTS } = await import("./rubric.server.ts");
  await sql`
    insert into match_rubrics (id, org_id, role_id, name, weights_json, source)
    values (
      ${newId()}, ${orgId}, ${null}, ${"default"},
      ${JSON.stringify(DEFAULT_RUBRIC_WEIGHTS)}, ${"system"}
    )`;

  return { orgId, name, retentionDays: 365 };
}

export async function assertOrgMember(userId: string, orgId: string): Promise<void> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from organization_members
    where user_id = ${userId} and org_id = ${orgId}`;
  if (!rows[0] || Number(rows[0].n) < 1) {
    throw new Error("Not a member of this organization");
  }
}
