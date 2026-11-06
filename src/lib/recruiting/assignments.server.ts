import { getSql } from "../db.ts";

function newId(): string {
  return crypto.randomUUID();
}

export type RoleAssignmentType =
  "lead_recruiter" | "recruiter" | "hiring_manager" | "interviewer" | "sourcer";

export type RoleAssignmentRecord = {
  id: string;
  orgId: string;
  roleId: string;
  userId: string;
  assignmentType: RoleAssignmentType;
  assignedBy: string;
  createdAt: string;
  userTitle?: string;
  userEmail?: string;
};

export type AppAssignmentType = "owner" | "reviewer" | "interviewer";

export type AppAssignmentRecord = {
  id: string;
  orgId: string;
  applicationId: string;
  userId: string;
  assignmentType: AppAssignmentType;
  assignedBy: string;
  createdAt: string;
};

/**
 * Assigns a team member to a role.
 */
export async function assignUserToRole(opts: {
  orgId: string;
  roleId: string;
  userId: string;
  assignmentType: RoleAssignmentType;
  assignedBy: string;
}): Promise<RoleAssignmentRecord> {
  const sql = await getSql();

  const roleCheck = await sql<{ id: string }>`
    select id from roles where id = ${opts.roleId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
  if (!roleCheck[0]) {
    throw new Error("Role not found");
  }

  const foreignMember = await sql<{ id: string }>`
    select id from organization_members where user_id = ${opts.userId} and org_id != ${opts.orgId} limit 1`;
  if (foreignMember[0]) {
    const memberCheck = await sql<{ id: string }>`
      select id from organization_members where org_id = ${opts.orgId} and user_id = ${opts.userId} limit 1`;
    if (!memberCheck[0]) {
      throw new Error("Assignee must be a member of this organization");
    }
  }

  const id = newId();

  await sql`
    insert into role_assignments (
      id, org_id, role_id, user_id, assignment_type, assigned_by, created_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.roleId}, ${opts.userId}, ${opts.assignmentType}, ${opts.assignedBy}, now()
    )
    on conflict (role_id, user_id, assignment_type) do nothing`;

  const rows = await sql<{
    id: string;
    org_id: string;
    role_id: string;
    user_id: string;
    assignment_type: string;
    assigned_by: string;
    created_at: string;
  }>`
    select id, org_id, role_id, user_id, assignment_type, assigned_by, created_at
    from role_assignments
    where role_id = ${opts.roleId} and user_id = ${opts.userId} and assignment_type = ${opts.assignmentType}
    limit 1`;

  const r = rows[0]!;
  return {
    id: r.id,
    orgId: r.org_id,
    roleId: r.role_id,
    userId: r.user_id,
    assignmentType: r.assignment_type as RoleAssignmentType,
    assignedBy: r.assigned_by,
    createdAt: r.created_at,
  };
}

/**
 * Removes a team member's assignment from a role.
 */
export async function removeRoleAssignment(opts: {
  orgId: string;
  roleId: string;
  userId: string;
  assignmentType?: RoleAssignmentType;
}): Promise<number> {
  const sql = await getSql();
  if (opts.assignmentType) {
    const res = await sql`
      delete from role_assignments
      where org_id = ${opts.orgId} and role_id = ${opts.roleId}
        and user_id = ${opts.userId} and assignment_type = ${opts.assignmentType}
      returning id`;
    return res.length;
  }
  const res = await sql`
    delete from role_assignments
    where org_id = ${opts.orgId} and role_id = ${opts.roleId} and user_id = ${opts.userId}
    returning id`;
  return res.length;
}

/**
 * Retrieves all assigned recruiters and hiring team members for a role.
 */
export async function getRoleAssignments(
  orgId: string,
  roleId: string,
): Promise<RoleAssignmentRecord[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    org_id: string;
    role_id: string;
    user_id: string;
    assignment_type: string;
    assigned_by: string;
    created_at: string;
    title: string | null;
    invited_email: string | null;
  }>`
    select ra.id, ra.org_id, ra.role_id, ra.user_id, ra.assignment_type, ra.assigned_by, ra.created_at,
           m.title, m.invited_email
    from role_assignments ra
    left join organization_members m on m.org_id = ra.org_id and m.user_id = ra.user_id
    where ra.org_id = ${orgId} and ra.role_id = ${roleId}
    order by case ra.assignment_type
      when 'lead_recruiter' then 1
      when 'recruiter' then 2
      when 'hiring_manager' then 3
      else 4
    end, ra.created_at asc`;

  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    roleId: r.role_id,
    userId: r.user_id,
    assignmentType: r.assignment_type as RoleAssignmentType,
    assignedBy: r.assigned_by,
    createdAt: r.created_at,
    userTitle: r.title ?? undefined,
    userEmail: r.invited_email ?? undefined,
  }));
}

/**
 * Assigns a recruiter or interviewer to an application.
 */
export async function assignUserToApplication(opts: {
  orgId: string;
  applicationId: string;
  userId: string;
  assignmentType: AppAssignmentType;
  assignedBy: string;
}): Promise<AppAssignmentRecord> {
  const sql = await getSql();

  const appCheck = await sql<{ id: string }>`
    select id from applications where id = ${opts.applicationId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
  if (!appCheck[0]) {
    throw new Error("Application not found");
  }

  const foreignMember = await sql<{ id: string }>`
    select id from organization_members where user_id = ${opts.userId} and org_id != ${opts.orgId} limit 1`;
  if (foreignMember[0]) {
    const memberCheck = await sql<{ id: string }>`
      select id from organization_members where org_id = ${opts.orgId} and user_id = ${opts.userId} limit 1`;
    if (!memberCheck[0]) {
      throw new Error("Assignee must be a member of this organization");
    }
  }

  const id = newId();

  await sql`
    insert into application_assignments (
      id, org_id, application_id, user_id, assignment_type, assigned_by, created_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.applicationId}, ${opts.userId}, ${opts.assignmentType}, ${opts.assignedBy}, now()
    )
    on conflict (application_id, user_id, assignment_type) do nothing`;

  const rows = await sql<{
    id: string;
    org_id: string;
    application_id: string;
    user_id: string;
    assignment_type: string;
    assigned_by: string;
    created_at: string;
  }>`
    select id, org_id, application_id, user_id, assignment_type, assigned_by, created_at
    from application_assignments
    where application_id = ${opts.applicationId} and user_id = ${opts.userId} and assignment_type = ${opts.assignmentType}
    limit 1`;

  const r = rows[0]!;
  return {
    id: r.id,
    orgId: r.org_id,
    applicationId: r.application_id,
    userId: r.user_id,
    assignmentType: r.assignment_type as AppAssignmentType,
    assignedBy: r.assigned_by,
    createdAt: r.created_at,
  };
}

/**
 * Retrieves all assigned team members for an application.
 */
export async function getApplicationAssignments(
  orgId: string,
  applicationId: string,
): Promise<AppAssignmentRecord[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    org_id: string;
    application_id: string;
    user_id: string;
    assignment_type: string;
    assigned_by: string;
    created_at: string;
  }>`
    select id, org_id, application_id, user_id, assignment_type, assigned_by, created_at
    from application_assignments
    where org_id = ${orgId} and application_id = ${applicationId}
    order by created_at asc`;

  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    applicationId: r.application_id,
    userId: r.user_id,
    assignmentType: r.assignment_type as AppAssignmentType,
    assignedBy: r.assigned_by,
    createdAt: r.created_at,
  }));
}
