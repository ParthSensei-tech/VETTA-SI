import { getSql } from "../../platform/db.ts";
import { type OrgPermission, type OrgRole, hasPermission } from "./rbac.ts";

function newId(): string {
  return crypto.randomUUID();
}

export type OrgMemberRecord = {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  status: "active" | "invited" | "suspended";
  title: string;
  invitedEmail: string;
  invitedBy: string | null;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Retrieves the user's membership and role in an organization.
 */
export async function getOrgMembership(
  userId: string,
  orgId: string,
): Promise<OrgMemberRecord | null> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    org_id: string;
    user_id: string;
    role: string;
    status: string;
    title: string;
    invited_email: string;
    invited_by: string | null;
    joined_at: string | null;
    created_at: string;
    updated_at: string;
  }>`
    select id, org_id, user_id, role, status, title, invited_email,
           invited_by, joined_at, created_at, updated_at
    from organization_members
    where user_id = ${userId} and org_id = ${orgId}
    limit 1`;

  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    role: r.role as OrgRole,
    status: r.status as "active" | "invited" | "suspended",
    title: r.title ?? "",
    invitedEmail: r.invited_email ?? "",
    invitedBy: r.invited_by,
    joinedAt: r.joined_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Asserts that the user is an active member with the requested permission.
 * Throws an authorization error if permission is denied.
 */
export async function assertOrgPermission(
  userId: string,
  orgId: string,
  permission: OrgPermission,
): Promise<OrgMemberRecord> {
  const member = await getOrgMembership(userId, orgId);
  if (!member) {
    throw new Error(`Unauthorized: User ${userId} is not a member of organization ${orgId}`);
  }
  if (member.status !== "active") {
    throw new Error(`Forbidden: Membership status is '${member.status}'`);
  }
  if (!hasPermission(member.role, permission)) {
    throw new Error(
      `Forbidden: Role '${member.role}' lacks '${permission}' permission in organization ${orgId}`,
    );
  }
  return member;
}

/**
 * Lists all members of an organization with their assigned roles and titles.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMemberRecord[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    org_id: string;
    user_id: string;
    role: string;
    status: string;
    title: string;
    invited_email: string;
    invited_by: string | null;
    joined_at: string | null;
    created_at: string;
    updated_at: string;
  }>`
    select id, org_id, user_id, role, status, title, invited_email,
           invited_by, joined_at, created_at, updated_at
    from organization_members
    where org_id = ${orgId}
    order by case role
      when 'owner' then 1
      when 'admin' then 2
      when 'lead_recruiter' then 3
      when 'recruiter' then 4
      when 'hiring_manager' then 5
      when 'interviewer' then 6
      else 7
    end, created_at asc`;

  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    role: r.role as OrgRole,
    status: r.status as "active" | "invited" | "suspended",
    title: r.title ?? "",
    invitedEmail: r.invited_email ?? "",
    invitedBy: r.invited_by,
    joinedAt: r.joined_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Adds or invites a new member to the organization with a specified role.
 */
export async function addOrgMember(opts: {
  orgId: string;
  userId: string;
  role: OrgRole;
  actorUserId: string;
  title?: string;
  invitedEmail?: string;
  status?: "active" | "invited";
}): Promise<OrgMemberRecord> {
  await assertOrgPermission(opts.actorUserId, opts.orgId, "members:manage");

  const sql = await getSql();
  const id = newId();
  const status = opts.status ?? "active";
  const title = opts.title?.trim() ?? "";
  const invitedEmail = opts.invitedEmail?.trim() ?? "";

  const joinedAt: string | null = status === "active" ? new Date().toISOString() : null;

  await sql`
    insert into organization_members (
      id, org_id, user_id, role, status, title, invited_email, invited_by, joined_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.userId}, ${opts.role}, ${status}, ${title},
      ${invitedEmail}, ${opts.actorUserId}, ${joinedAt}, now()
    )
    on conflict (org_id, user_id) do update set
      role = excluded.role,
      status = excluded.status,
      title = case when excluded.title <> '' then excluded.title else organization_members.title end,
      updated_at = now()`;

  const member = await getOrgMembership(opts.userId, opts.orgId);
  if (!member) throw new Error("Failed to load saved organization member");
  return member;
}

/**
 * Updates an organization member's role or status.
 */
export async function updateOrgMember(opts: {
  orgId: string;
  targetUserId: string;
  actorUserId: string;
  role?: OrgRole;
  status?: "active" | "invited" | "suspended";
  title?: string;
}): Promise<OrgMemberRecord> {
  const actor = await assertOrgPermission(opts.actorUserId, opts.orgId, "members:manage");

  const current = await getOrgMembership(opts.targetUserId, opts.orgId);
  if (!current) throw new Error("Member not found in organization");

  if (current.role === "owner" && actor.role !== "owner") {
    throw new Error("Only organization owners can modify another owner's membership");
  }

  const sql = await getSql();
  await sql`
    update organization_members set
      role = coalesce(${opts.role ?? null}, role),
      status = coalesce(${opts.status ?? null}, status),
      title = coalesce(${opts.title ?? null}, title),
      updated_at = now()
    where org_id = ${opts.orgId} and user_id = ${opts.targetUserId}`;

  const updated = await getOrgMembership(opts.targetUserId, opts.orgId);
  if (!updated) throw new Error("Failed to retrieve updated member");
  return updated;
}

/**
 * Checks whether a user is an authorized platform operator with global system privileges.
 */
export async function isAuthorizedOperator(userId: string): Promise<boolean> {
  if (!userId) return false;

  // 1. Check built-in operator identities
  const builtInOperators = new Set(["system", "operator", "system_admin"]);
  if (builtInOperators.has(userId)) return true;

  // 2. Check environment-configured operator user IDs
  const operatorIds = (process.env.OPERATOR_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (operatorIds.includes(userId)) return true;

  if (process.env.PLATFORM_ADMIN_USER_ID && process.env.PLATFORM_ADMIN_USER_ID.trim() === userId) {
    return true;
  }

  // 3. Check database for active owner/admin role in a system/platform organization
  try {
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      select om.id
      from organization_members om
      join organizations o on om.org_id = o.id
      where om.user_id = ${userId}
        and om.status = 'active'
        and om.role in ('owner', 'admin')
        and (
          o.slug like 'system%'
          or o.slug like 'platform%'
          or o.slug like 'admin%'
          or o.slug = 'root'
        )
      limit 1`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Asserts that the calling user is an authorized platform operator.
 * Throws a Forbidden error if authorization fails.
 */
export async function assertAuthorizedOperator(userId: string): Promise<void> {
  const allowed = await isAuthorizedOperator(userId);
  if (!allowed) {
    throw new Error(`Forbidden: User '${userId}' is not an authorized system operator`);
  }
}
