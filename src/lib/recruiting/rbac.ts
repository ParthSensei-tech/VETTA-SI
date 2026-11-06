/**
 * Enterprise Role-Based Access Control (RBAC) for Recruiting Teams.
 * Built for high-volume enterprise organizations (e.g. Jio / Reliance) and agile boutique agencies.
 */

export type OrgRole =
  | "owner"
  | "admin"
  | "lead_recruiter"
  | "recruiter"
  | "hiring_manager"
  | "interviewer"
  | "sourcer";

export type OrgPermission =
  | "org:manage"
  | "members:manage"
  | "members:view"
  | "roles:create"
  | "roles:edit"
  | "roles:delete"
  | "roles:assign"
  | "candidates:create"
  | "candidates:edit"
  | "candidates:merge"
  | "candidates:delete"
  | "candidates:view_sensitive"
  | "applications:review"
  | "applications:move_stage"
  | "applications:assign"
  | "notes:create"
  | "notes:view_private"
  | "tasks:create"
  | "tasks:assign"
  | "tasks:complete"
  | "analytics:view"
  | "placements:manage"
  | "observability:view"
  | "observability:manage";

export const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<OrgPermission>> = {
  owner: new Set<OrgPermission>([
    "org:manage",
    "members:manage",
    "members:view",
    "roles:create",
    "roles:edit",
    "roles:delete",
    "roles:assign",
    "candidates:create",
    "candidates:edit",
    "candidates:merge",
    "candidates:delete",
    "candidates:view_sensitive",
    "applications:review",
    "applications:move_stage",
    "applications:assign",
    "notes:create",
    "notes:view_private",
    "tasks:create",
    "tasks:assign",
    "tasks:complete",
    "analytics:view",
    "placements:manage",
    "observability:view",
    "observability:manage",
  ]),
  admin: new Set<OrgPermission>([
    "members:manage",
    "members:view",
    "roles:create",
    "roles:edit",
    "roles:delete",
    "roles:assign",
    "candidates:create",
    "candidates:edit",
    "candidates:merge",
    "candidates:delete",
    "candidates:view_sensitive",
    "applications:review",
    "applications:move_stage",
    "applications:assign",
    "notes:create",
    "notes:view_private",
    "tasks:create",
    "tasks:assign",
    "tasks:complete",
    "analytics:view",
    "placements:manage",
    "observability:view",
    "observability:manage",
  ]),
  lead_recruiter: new Set<OrgPermission>([
    "members:view",
    "roles:create",
    "roles:edit",
    "roles:assign",
    "candidates:create",
    "candidates:edit",
    "candidates:merge",
    "candidates:view_sensitive",
    "applications:review",
    "applications:move_stage",
    "applications:assign",
    "notes:create",
    "notes:view_private",
    "tasks:create",
    "tasks:assign",
    "tasks:complete",
    "analytics:view",
    "placements:manage",
  ]),
  recruiter: new Set<OrgPermission>([
    "members:view",
    "roles:create",
    "roles:edit",
    "candidates:create",
    "candidates:edit",
    "candidates:merge",
    "candidates:view_sensitive",
    "applications:review",
    "applications:move_stage",
    "notes:create",
    "tasks:create",
    "tasks:assign",
    "tasks:complete",
    "analytics:view",
  ]),
  hiring_manager: new Set<OrgPermission>([
    "members:view",
    "roles:edit",
    "candidates:view_sensitive",
    "applications:review",
    "applications:move_stage",
    "notes:create",
    "tasks:create",
    "tasks:assign",
    "tasks:complete",
    "analytics:view",
  ]),
  interviewer: new Set<OrgPermission>([
    "members:view",
    "applications:review",
    "notes:create",
    "tasks:create",
    "tasks:complete",
  ]),
  sourcer: new Set<OrgPermission>([
    "members:view",
    "candidates:create",
    "candidates:edit",
    "notes:create",
    "tasks:create",
    "tasks:complete",
  ]),
};

export function hasPermission(role: OrgRole | string, permission: OrgPermission): boolean {
  const allowed = ROLE_PERMISSIONS[role as OrgRole];
  if (!allowed) return false;
  return allowed.has(permission);
}
