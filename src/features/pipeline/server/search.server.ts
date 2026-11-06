/**
 * Talent retrieval: structured filters + Postgres full-text, and ingestion-time
 * background embedding queueing.
 */

import { getSql } from "../../../platform/db.ts";

export async function indexNewCandidate(
  candidateId: string,
  notice: number | null,
  expected: number | null,
  orgId?: string | null,
): Promise<void> {
  const sql = await getSql();
  await sql`
    update candidates
    set notice_period_days = ${notice}, expected_ctc_lakh = ${expected}
    where id = ${candidateId}`;
  await refreshCandidateSearch(candidateId);

  // Ingestion-time semantic embedding queue
  try {
    let resolvedOrgId = orgId;
    if (!resolvedOrgId) {
      const rows = await sql<{ org_id: string | null }>`
        select org_id from candidates where id = ${candidateId} limit 1`;
      resolvedOrgId = rows[0]?.org_id ?? null;
    }
    const { enqueueCandidateForEmbedding } = await import("./embedding-queue.server.ts");
    await enqueueCandidateForEmbedding({
      candidateId,
      orgId: resolvedOrgId,
      priority: 10,
    });
  } catch {
    /* embedding queue is resilient and will be picked up on backfill */
  }
}

export async function refreshCandidateSearch(candidateId: string): Promise<void> {
  const sql = await getSql();
  await sql`
    update candidates set search_tsv = to_tsvector(
      'simple',
      coalesce(full_name, '') || ' ' ||
      coalesce(current_title, '') || ' ' ||
      coalesce(current_company, '') || ' ' ||
      coalesce(location, '') || ' ' ||
      coalesce(resume_text, '')
    )
    where id = ${candidateId}`;
}
