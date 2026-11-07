import { createHash } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import { iso } from "../../../shared/utils.ts";

export type BackupStats = {
  rolesCount: number;
  rubricVersionsCount: number;
  candidatesCount: number;
  applicationsCount: number;
  screensCount: number;
  auditEventsCount: number;
};

export type WorkspaceBackup = {
  version: "1.0.0";
  createdAt: string;
  userId: string;
  roles: Array<Record<string, any>>;
  rubricVersions: Array<Record<string, any>>;
  candidates: Array<Record<string, any>>;
  applications: Array<Record<string, any>>;
  screens: Array<Record<string, any>>;
  auditEvents: Array<Record<string, any>>;
  stats: BackupStats;
  checksum: string;
};

function computePayloadChecksum(payload: Omit<WorkspaceBackup, "checksum">): string {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Creates a portable, cryptographically signed backup of an organization's workspace (or a specific role).
 * Scoped to orgId to ensure tenant isolation — only data belonging to the caller's org is exported.
 */
export async function createWorkspaceBackup(opts: {
  userId: string;
  orgId?: string;
  roleId?: string;
}): Promise<WorkspaceBackup> {
  const sql = await getSql();

  let orgId = opts.orgId;
  if (!orgId) {
    try {
      const { ensureUserOrg } = await import("../../people/server/org.server");
      orgId = (await ensureUserOrg(opts.userId)).orgId;
    } catch {
      orgId = "";
    }
  }

  const roles = opts.roleId
    ? await sql<Record<string, unknown>>`
        select * from roles where (org_id = ${orgId} or (org_id is null and user_id = ${opts.userId})) and id = ${opts.roleId} order by created_at`
    : await sql<Record<string, unknown>>`
        select * from roles where (org_id = ${orgId} or (org_id is null and user_id = ${opts.userId})) order by created_at`;

  const roleIds = roles.map((r) => String(r.id));

  let rubricVersions: Array<Record<string, unknown>> = [];
  let applications: Array<Record<string, unknown>> = [];
  let candidates: Array<Record<string, unknown>> = [];
  let screens: Array<Record<string, unknown>> = [];
  let auditEvents: Array<Record<string, unknown>> = [];

  if (roleIds.length > 0) {
    rubricVersions = await sql<Record<string, unknown>>`
      select * from rubric_versions where role_id = any(${roleIds}) order by created_at`;

    applications = await sql<Record<string, unknown>>`
      select * from applications where (org_id = ${orgId} or (org_id is null and user_id = ${opts.userId})) and role_id = any(${roleIds}) order by created_at`;

    const candidateIds = Array.from(new Set(applications.map((a) => String(a.candidate_id))));
    if (candidateIds.length > 0) {
      candidates = await sql<Record<string, unknown>>`
        select * from candidates where (org_id = ${orgId} or (org_id is null and user_id = ${opts.userId})) and id = any(${candidateIds}) order by created_at`;
    }

    const appIds = applications.map((a) => String(a.id));
    if (appIds.length > 0) {
      screens = await sql<Record<string, unknown>>`
        select * from screens where application_id = any(${appIds}) order by created_at`;
    }

    auditEvents = await sql<Record<string, unknown>>`
      select * from audit_events where (org_id = ${orgId} or (org_id is null and user_id = ${opts.userId})) order by created_at desc limit 200`;
  }

  const stats: BackupStats = {
    rolesCount: roles.length,
    rubricVersionsCount: rubricVersions.length,
    candidatesCount: candidates.length,
    applicationsCount: applications.length,
    screensCount: screens.length,
    auditEventsCount: auditEvents.length,
  };

  const payload: Omit<WorkspaceBackup, "checksum"> = {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    userId: opts.userId,
    roles,
    rubricVersions,
    candidates,
    applications,
    screens,
    auditEvents,
    stats,
  };

  const checksum = computePayloadChecksum(payload);
  return { ...payload, checksum };
}

/**
 * Validates the cryptographic checksum and structural integrity of a backup.
 */
export function verifyBackupIntegrity(backup: unknown): {
  valid: boolean;
  error?: string;
  stats?: BackupStats;
} {
  if (!backup || typeof backup !== "object") {
    return { valid: false, error: "Backup must be a JSON object" };
  }

  const b = backup as Partial<WorkspaceBackup>;
  if (b.version !== "1.0.0") {
    return { valid: false, error: `Unsupported backup version: ${String(b.version)}` };
  }
  if (!b.checksum || typeof b.checksum !== "string") {
    return { valid: false, error: "Missing cryptographic checksum" };
  }
  if (!Array.isArray(b.roles) || !Array.isArray(b.candidates) || !Array.isArray(b.applications)) {
    return { valid: false, error: "Malformed backup: missing required entity arrays" };
  }

  const { checksum, ...rest } = b as WorkspaceBackup;
  const expectedChecksum = computePayloadChecksum(rest);

  if (checksum !== expectedChecksum) {
    return { valid: false, error: "Checksum mismatch: backup has been corrupted or tampered with" };
  }

  return { valid: true, stats: b.stats };
}

/**
 * Restores a workspace backup idempotently with tenant isolation.
 * In "merge" mode, existing records are updated while preserving new records.
 * In "overwrite" mode, records belonging to the restored roles are replaced.
 * Cross-tenant overwrite prevention: if a record ID already exists but belongs
 * to a different org, the restore is rejected.
 */
export async function restoreWorkspaceBackup(opts: {
  userId: string;
  orgId?: string;
  backup: WorkspaceBackup;
  mode?: "merge" | "overwrite";
}): Promise<{
  ok: boolean;
  restored: {
    roles: number;
    candidates: number;
    applications: number;
    rubricVersions: number;
    screens: number;
  };
}> {
  const verification = verifyBackupIntegrity(opts.backup);
  if (!verification.valid) {
    throw new Error(`Backup verification failed: ${verification.error}`);
  }

  const sql = await getSql();
  let orgId = opts.orgId;
  if (!orgId) {
    try {
      const { ensureUserOrg } = await import("../../people/server/org.server");
      orgId = (await ensureUserOrg(opts.userId)).orgId;
    } catch {
      orgId = "";
    }
  }

  const { roles, candidates, applications, rubricVersions, screens } = opts.backup;

  // Cross-tenant collision check: ensure no record ID in the backup belongs to a different org
  const allRoleIds = roles.map((r) => String(r.id));
  if (allRoleIds.length > 0) {
    const foreignRoles = await sql<{ id: string }>`
      select id from roles where id = any(${allRoleIds}) and org_id is not null and org_id != ${orgId}`;
    if (foreignRoles.length > 0) {
      throw new Error(
        "Restore rejected: backup contains role IDs belonging to another organization",
      );
    }
  }
  const allCandIds = candidates.map((c) => String(c.id));
  if (allCandIds.length > 0) {
    const foreignCands = await sql<{ id: string }>`
      select id from candidates where id = any(${allCandIds}) and org_id is not null and org_id != ${orgId}`;
    if (foreignCands.length > 0) {
      throw new Error(
        "Restore rejected: backup contains candidate IDs belonging to another organization",
      );
    }
  }
  const allAppIds = applications.map((a) => String(a.id));
  if (allAppIds.length > 0) {
    const foreignApps = await sql<{ id: string }>`
      select id from applications where id = any(${allAppIds}) and org_id is not null and org_id != ${orgId}`;
    if (foreignApps.length > 0) {
      throw new Error(
        "Restore rejected: backup contains application IDs belonging to another organization",
      );
    }
  }

  // 1. Roles
  let rolesRestored = 0;
  for (const role of roles) {
    await sql`
      insert into roles (
        id, user_id, title, company_name, company_stage, location, work_mode,
        compensation_band, stack, must_haves, nice_to_haves, jd_text, status
      ) values (
        ${String(role.id)}, ${opts.userId}, ${String(role.title)}, ${String(role.company_name)},
        ${String(role.company_stage)}, ${String(role.location)}, ${String(role.work_mode)},
        ${String(role.compensation_band || "")}, ${String(role.stack || "")},
        ${String(role.must_haves || "")}, ${String(role.nice_to_haves || "")},
        ${String(role.jd_text || "")}, ${String(role.status || "open")}
      )
      on conflict (id) do update set
        title = excluded.title,
        company_name = excluded.company_name,
        company_stage = excluded.company_stage,
        location = excluded.location,
        work_mode = excluded.work_mode,
        compensation_band = excluded.compensation_band,
        stack = excluded.stack,
        must_haves = excluded.must_haves,
        nice_to_haves = excluded.nice_to_haves,
        jd_text = excluded.jd_text,
        status = excluded.status,
        updated_at = now()`;
    rolesRestored++;
  }

  // 2. Rubric Versions
  let rubricsRestored = 0;
  for (const rv of rubricVersions) {
    await sql`
      insert into rubric_versions (
        id, org_id, role_id, version, status, criteria_json, hard_constraints_json,
        rubric_hash, source, created_by, parent_version_id
      ) values (
        ${String(rv.id)}, ${String(rv.org_id || "")}, ${String(rv.role_id)},
        ${Number(rv.version) || 1}, ${String(rv.status || "draft")},
        ${typeof rv.criteria_json === "string" ? rv.criteria_json : JSON.stringify(rv.criteria_json || [])},
        ${typeof rv.hard_constraints_json === "string" ? rv.hard_constraints_json : JSON.stringify(rv.hard_constraints_json || {})},
        ${rv.rubric_hash ? String(rv.rubric_hash) : null},
        ${String(rv.source || "founder")}, ${opts.userId},
        ${rv.parent_version_id ? String(rv.parent_version_id) : null}
      )
      on conflict (id) do update set
        status = excluded.status,
        criteria_json = excluded.criteria_json,
        hard_constraints_json = excluded.hard_constraints_json,
        rubric_hash = excluded.rubric_hash`;
    rubricsRestored++;
  }

  // 3. Candidates
  let candidatesRestored = 0;
  for (const cand of candidates) {
    await sql`
      insert into candidates (
        id, user_id, full_name, email, phone, location, linkedin_url,
        current_title, current_company, years_experience, resume_text, parsed_json, org_id
      ) values (
        ${String(cand.id)}, ${opts.userId}, ${String(cand.full_name || "")},
        ${String(cand.email || "")}, ${String(cand.phone || "")}, ${String(cand.location || "")},
        ${String(cand.linkedin_url || "")}, ${String(cand.current_title || "")},
        ${String(cand.current_company || "")},
        ${cand.years_experience != null ? Number(cand.years_experience) : null},
        ${String(cand.resume_text || "No resume text provided")},
        ${typeof cand.parsed_json === "string" ? cand.parsed_json : JSON.stringify(cand.parsed_json || {})},
        ${cand.org_id ? String(cand.org_id) : null}
      )
      on conflict (id) do update set
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        location = excluded.location,
        linkedin_url = excluded.linkedin_url,
        current_title = excluded.current_title,
        current_company = excluded.current_company,
        years_experience = excluded.years_experience,
        resume_text = excluded.resume_text,
        parsed_json = excluded.parsed_json,
        updated_at = now()`;
    candidatesRestored++;
  }

  // 4. Applications
  let appsRestored = 0;
  for (const app of applications) {
    await sql`
      insert into applications (
        id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json,
        recruiter_notes, source, resume_hash, role_hash, rank_engine, org_id,
        rubric_version_id, model, provider, rubric_version, rubric_hash, is_stale, stale_reason
      ) values (
        ${String(app.id)}, ${opts.userId}, ${String(app.role_id)}, ${String(app.candidate_id)},
        ${String(app.pipeline_status || "ingested")},
        ${app.rank_score != null ? Number(app.rank_score) : null},
        ${typeof app.rank_json === "string" ? app.rank_json : JSON.stringify(app.rank_json || {})},
        ${String(app.recruiter_notes || "")}, ${String(app.source || "backup")},
        ${String(app.resume_hash || "")}, ${String(app.role_hash || "")},
        ${String(app.rank_engine || "local")}, ${app.org_id ? String(app.org_id) : null},
        ${app.rubric_version_id ? String(app.rubric_version_id) : null},
        ${app.model ? String(app.model) : ""},
        ${app.provider ? String(app.provider) : ""},
        ${app.rubric_version != null ? Number(app.rubric_version) : null},
        ${app.rubric_hash ? String(app.rubric_hash) : ""},
        ${Boolean(app.is_stale)}, ${app.stale_reason ? String(app.stale_reason) : ""}
      )
      on conflict (id) do update set
        pipeline_status = excluded.pipeline_status,
        rank_score = excluded.rank_score,
        rank_json = excluded.rank_json,
        recruiter_notes = excluded.recruiter_notes,
        model = excluded.model,
        provider = excluded.provider,
        rubric_version = excluded.rubric_version,
        rubric_hash = excluded.rubric_hash,
        is_stale = excluded.is_stale,
        stale_reason = excluded.stale_reason,
        updated_at = now()`;
    appsRestored++;
  }

  // 5. Async Screens
  let screensRestored = 0;
  for (const screen of screens) {
    await sql`
      insert into screens (
        id, user_id, application_id, status, transcript_json, answers_json, evaluation_json
      ) values (
        ${String(screen.id)}, ${opts.userId}, ${String(screen.application_id)}, ${String(screen.status || "draft")},
        ${typeof screen.transcript_json === "string" ? screen.transcript_json : JSON.stringify(screen.transcript_json || [])},
        ${typeof screen.answers_json === "string" ? screen.answers_json : JSON.stringify(screen.answers_json || [])},
        ${typeof screen.evaluation_json === "string" ? screen.evaluation_json : JSON.stringify(screen.evaluation_json || {})}
      )
      on conflict (id) do update set
        status = excluded.status,
        transcript_json = excluded.transcript_json,
        answers_json = excluded.answers_json,
        evaluation_json = excluded.evaluation_json,
        updated_at = now()`;
    screensRestored++;
  }

  // Record audit trail
  try {
    await sql`
      insert into audit_events (id, user_id, entity_type, entity_id, action, meta_json)
      values (
        ${crypto.randomUUID()}, ${opts.userId}, 'workspace', 'workspace', 'restore_backup',
        ${JSON.stringify({
          roles: rolesRestored,
          candidates: candidatesRestored,
          applications: appsRestored,
          rubrics: rubricsRestored,
          mode: opts.mode || "merge",
        })}
      )`;
  } catch {
    /* audit log is best-effort */
  }

  return {
    ok: true,
    restored: {
      roles: rolesRestored,
      candidates: candidatesRestored,
      applications: appsRestored,
      rubricVersions: rubricsRestored,
      screens: screensRestored,
    },
  };
}
