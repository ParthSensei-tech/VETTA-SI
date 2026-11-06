import { randomUUID } from "node:crypto";
import type { AccessLog } from "./types.ts";

const MAX_RING_BUFFER = 100;

const g = globalThis as typeof globalThis & {
  __vettaAccessLogsRing__?: AccessLog[];
};

function getRingBuffer(): AccessLog[] {
  g.__vettaAccessLogsRing__ ??= [];
  return g.__vettaAccessLogsRing__;
}

/**
 * Pushes an access log entry to the in-memory ring buffer.
 */
function pushToRing(log: AccessLog) {
  const ring = getRingBuffer();
  ring.unshift(log);
  if (ring.length > MAX_RING_BUFFER) {
    ring.pop();
  }
}

/**
 * Record an HTTP access log entry in both in-memory ring buffer and persistent database.
 */
export async function recordAccessLog(entry: {
  userId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip?: string;
  userAgent?: string;
  errorMessage?: string;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const log: AccessLog = {
    id,
    user_id: entry.userId ?? null,
    method: entry.method.toUpperCase(),
    path: entry.path,
    status_code: entry.statusCode,
    duration_ms: Math.max(0, Math.round(entry.durationMs)),
    ip: entry.ip || "",
    user_agent: entry.userAgent || "",
    error_message: entry.errorMessage || "",
    meta_json: JSON.stringify(entry.meta ?? {}),
    created_at: createdAt,
  };

  pushToRing(log);

  // Non-blocking write to database
  void (async () => {
    try {
      const { getSql } = await import("../db.ts");
      const sql = await getSql();
      await sql`
        insert into access_logs (
          id, user_id, method, path, status_code, duration_ms,
          ip, user_agent, error_message, meta_json, created_at
        ) values (
          ${log.id}, ${log.user_id}, ${log.method}, ${log.path}, ${log.status_code}, ${log.duration_ms},
          ${log.ip}, ${log.user_agent}, ${log.error_message}, ${log.meta_json}, ${log.created_at}
        )`;
    } catch (err) {
      // In-memory log still retained; DB insert error is logged silently
      console.error("[access-log-write-error]", err);
    }
  })();

  return id;
}

/**
 * Retrieves the most recent access logs (combining ring buffer and DB fallback).
 * Scoped to organization when orgId is provided.
 */
export async function getRecentAccessLogs(
  limit: number = 50,
  onlyErrors: boolean = false,
  orgId?: string,
): Promise<AccessLog[]> {
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    if (orgId) {
      if (onlyErrors) {
        return await sql<AccessLog>`
          select * from access_logs
          where status_code >= 400
            and user_id in (select user_id from organization_members where org_id = ${orgId})
          order by created_at desc
          limit ${limit}`;
      }
      return await sql<AccessLog>`
        select * from access_logs
        where user_id in (select user_id from organization_members where org_id = ${orgId})
        order by created_at desc
        limit ${limit}`;
    }

    if (onlyErrors) {
      const rows = await sql<AccessLog>`
        select * from access_logs
        where status_code >= 400
        order by created_at desc
        limit ${limit}`;
      return rows;
    }
    const rows = await sql<AccessLog>`
      select * from access_logs
      order by created_at desc
      limit ${limit}`;
    if (rows.length > 0) return rows;
  } catch {
    /* fallback to ring buffer if db is not ready */
  }

  const ring = getRingBuffer();
  if (onlyErrors) {
    return ring.filter((l) => l.status_code >= 400).slice(0, limit);
  }
  return ring.slice(0, limit);
}
