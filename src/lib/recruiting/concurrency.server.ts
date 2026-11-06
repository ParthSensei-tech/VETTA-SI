import { getSql } from "../../platform/db.ts";
import { ConcurrencyConflictError } from "./concurrency.ts";

export type OptimisticTable = "roles" | "candidates" | "applications" | "candidate_notes";

/**
 * Updates a record with optimistic concurrency check.
 * If expectedVersion matches, increments version and applies updates atomically.
 * If expectedVersion does not match, throws ConcurrencyConflictError with current record state.
 */
export async function updateWithOptimisticLock<
  T extends Record<string, any> = Record<string, any>,
>(opts: {
  table: OptimisticTable;
  id: string;
  expectedVersion: number;
  userId: string;
  orgId?: string;
  setClauses: Record<string, unknown>;
}): Promise<{ updated: true; newVersion: number; row: T }> {
  const sql = await getSql();

  // First fetch current record to verify existence and check current version
  let currentRows: Array<Record<string, unknown>> = [];
  if (opts.table === "roles") {
    currentRows = await sql`select * from roles where id = ${opts.id} limit 1`;
  } else if (opts.table === "candidates") {
    currentRows = await sql`select * from candidates where id = ${opts.id} limit 1`;
  } else if (opts.table === "applications") {
    currentRows = await sql`select * from applications where id = ${opts.id} limit 1`;
  } else if (opts.table === "candidate_notes") {
    currentRows = await sql`select * from candidate_notes where id = ${opts.id} limit 1`;
  }

  const current = currentRows[0];
  if (!current) {
    throw new Error(`Record not found in ${opts.table} with id ${opts.id}`);
  }
  if (opts.orgId && current.org_id && current.org_id !== opts.orgId) {
    throw new Error(`Record not found in ${opts.table} with id ${opts.id}`);
  }

  const currentVersion = Number(current.version ?? 1);
  if (currentVersion !== opts.expectedVersion) {
    throw new ConcurrencyConflictError({
      entityType: opts.table,
      entityId: opts.id,
      expectedVersion: opts.expectedVersion,
      currentVersion,
      currentSnapshot: current,
    });
  }

  const nextVersion = currentVersion + 1;

  // Execute update targeted directly at id AND version
  let updatedRows: Array<Record<string, unknown>> = [];
  if (opts.table === "roles") {
    const s = opts.setClauses;
    updatedRows = await sql`
      update roles set
        title = coalesce(${s.title !== undefined ? (s.title as string) : null}, title),
        company_name = coalesce(${s.company_name !== undefined ? (s.company_name as string) : null}, company_name),
        location = coalesce(${s.location !== undefined ? (s.location as string) : null}, location),
        work_mode = coalesce(${s.work_mode !== undefined ? (s.work_mode as string) : null}, work_mode),
        status = coalesce(${s.status !== undefined ? (s.status as string) : null}, status),
        compensation_band = coalesce(${s.compensation_band !== undefined ? (s.compensation_band as string) : null}, compensation_band),
        version = ${nextVersion},
        updated_at = now()
      where id = ${opts.id} and version = ${opts.expectedVersion}
      returning *`;
  } else if (opts.table === "candidates") {
    const s = opts.setClauses;
    updatedRows = await sql`
      update candidates set
        full_name = coalesce(${s.full_name !== undefined ? (s.full_name as string) : null}, full_name),
        email = coalesce(${s.email !== undefined ? (s.email as string) : null}, email),
        phone = coalesce(${s.phone !== undefined ? (s.phone as string) : null}, phone),
        location = coalesce(${s.location !== undefined ? (s.location as string) : null}, location),
        linkedin_url = coalesce(${s.linkedin_url !== undefined ? (s.linkedin_url as string) : null}, linkedin_url),
        current_title = coalesce(${s.current_title !== undefined ? (s.current_title as string) : null}, current_title),
        current_company = coalesce(${s.current_company !== undefined ? (s.current_company as string) : null}, current_company),
        status = coalesce(${s.status !== undefined ? (s.status as string) : null}, status),
        version = ${nextVersion},
        updated_at = now()
      where id = ${opts.id} and version = ${opts.expectedVersion}
      returning *`;
  } else if (opts.table === "applications") {
    const s = opts.setClauses;
    updatedRows = await sql`
      update applications set
        pipeline_status = coalesce(${s.pipeline_status !== undefined ? (s.pipeline_status as string) : null}, pipeline_status),
        recruiter_notes = coalesce(${s.recruiter_notes !== undefined ? (s.recruiter_notes as string) : null}, recruiter_notes),
        version = ${nextVersion},
        updated_at = now()
      where id = ${opts.id} and version = ${opts.expectedVersion}
      returning *`;
  } else if (opts.table === "candidate_notes") {
    const s = opts.setClauses;
    updatedRows = await sql`
      update candidate_notes set
        content = coalesce(${s.content !== undefined ? (s.content as string) : null}, content),
        visibility = coalesce(${s.visibility !== undefined ? (s.visibility as string) : null}, visibility),
        pinned = coalesce(${s.pinned !== undefined ? (s.pinned as boolean) : null}, pinned),
        version = ${nextVersion},
        updated_at = now()
      where id = ${opts.id} and version = ${opts.expectedVersion}
      returning *`;
  }

  if (updatedRows.length === 0) {
    // A concurrent write raced and updated between the select and update
    let latestRows: Array<Record<string, unknown>> = [];
    if (opts.table === "roles")
      latestRows = await sql`select * from roles where id = ${opts.id} limit 1`;
    else if (opts.table === "candidates")
      latestRows = await sql`select * from candidates where id = ${opts.id} limit 1`;
    else if (opts.table === "applications")
      latestRows = await sql`select * from applications where id = ${opts.id} limit 1`;
    else if (opts.table === "candidate_notes")
      latestRows = await sql`select * from candidate_notes where id = ${opts.id} limit 1`;

    const latest = latestRows[0] || {};
    throw new ConcurrencyConflictError({
      entityType: opts.table,
      entityId: opts.id,
      expectedVersion: opts.expectedVersion,
      currentVersion: Number(latest.version ?? currentVersion + 1),
      currentSnapshot: latest,
    });
  }

  return {
    updated: true,
    newVersion: nextVersion,
    row: updatedRows[0] as T,
  };
}
