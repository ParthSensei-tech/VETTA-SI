import { getSql } from "../../../platform/db.ts";
import { parseJson } from "../../../shared/utils.ts";
import type { CompanyStage, WorkMode } from "../../../lib/recruiting/types.ts";

/**
 * Background deepen: re-rank top N with provider ladder.
 * No UI required — called when a batch finishes or on a schedule.
 */
export async function deepenRoleTopN(opts: {
  userId: string;
  roleId: string;
  orgId?: string;
  topN?: number;
  forceStale?: boolean;
  /** `bulk` when a recruiter asked for it, `background` when the batch completion triggered it. */
  context?: import("../../ai/domain/model-registry.ts").CallContext;
  /** Tolerance for one rank. A slow local arm is only offered the task when it fits this. */
  deadlineMs?: number;
  /** Tolerance for the whole loop, so N long calls cannot outlive the request that started them. */
  totalBudgetMs?: number;
}): Promise<{ deepened: number; engines: string[] }> {
  const topN = Math.max(1, Math.min(opts.topN ?? 12, 50));
  const context = opts.context ?? "bulk";
  const perRankDeadlineMs = opts.deadlineMs ?? 45_000;
  const loopDeadline =
    Date.now() +
    Math.max(
      perRankDeadlineMs,
      opts.totalBudgetMs ?? (context === "background" ? 600_000 : 180_000),
    );
  const sql = await getSql();
  const roles = await sql<{
    id: string;
    org_id: string | null;
    user_id: string;
    company_name: string;
    company_stage: string;
    title: string;
    location: string;
    work_mode: string;
    compensation_band: string;
    stack: string;
    must_haves: string;
    nice_to_haves: string;
    jd_text: string;
  }>`
    select id, org_id, user_id, company_name, company_stage, title, location, work_mode, compensation_band,
           stack, must_haves, nice_to_haves, jd_text
    from roles where id = ${opts.roleId} limit 1`;
  const role = roles[0];
  if (!role) return { deepened: 0, engines: [] };

  const { ensureUserOrg, assertOrgMember } = await import("../../people/server/org.server.ts");
  let targetOrgId = role.org_id;
  if (role.org_id) {
    try {
      await assertOrgMember(opts.userId, role.org_id);
    } catch {
      return { deepened: 0, engines: [] };
    }
  } else if (role.user_id !== opts.userId) {
    return { deepened: 0, engines: [] };
  } else {
    targetOrgId = (await ensureUserOrg(opts.userId)).orgId;
  }

  const roleInput = {
    companyName: role.company_name,
    companyStage: role.company_stage as CompanyStage,
    title: role.title,
    location: role.location,
    workMode: role.work_mode as WorkMode,
    compensationBand: role.compensation_band,
    stack: parseJson<string[]>(role.stack, []),
    mustHaves: parseJson<string[]>(role.must_haves, []),
    niceToHaves: parseJson<string[]>(role.nice_to_haves, []),
    jdText: role.jd_text,
  };

  const rows = await sql<{
    id: string;
    candidate_id: string;
    resume_text: string;
    rank_engine: string;
    is_stale: boolean;
  }>`
    select a.id, a.candidate_id, c.resume_text, coalesce(a.rank_engine, '') as rank_engine,
           coalesce(a.is_stale, false) as is_stale
    from applications a
    join candidates c on c.id = a.candidate_id
    where a.role_id = ${opts.roleId} and (a.org_id = ${targetOrgId} or (a.org_id is null and a.user_id = ${opts.userId}))
    order by coalesce(a.is_stale, false) desc, a.rank_score desc nulls last, a.updated_at desc
    limit ${topN}`;

  const org = { orgId: targetOrgId! };

  const { parseAndRank } = await import("../../ai/server/ai.server.ts");
  const engines: string[] = [];
  let deepened = 0;

  for (const row of rows) {
    const isStale = Boolean(row.is_stale);
    // Skip if already deepened with a non-local engine unless forceStale or candidate is flagged stale
    if (
      !opts.forceStale &&
      !isStale &&
      row.rank_engine &&
      row.rank_engine !== "local" &&
      !row.rank_engine.includes("cache")
    ) {
      engines.push(`${row.rank_engine}:skip`);
      continue;
    }
    const remainingMs = loopDeadline - Date.now();
    if (remainingMs < 4_000) {
      // Better a short list ranked properly than a long list abandoned halfway by a request the
      // caller has already stopped waiting for.
      engines.push("clock:loop-budget-spent");
      break;
    }
    const ranked = await parseAndRank({
      resumeText: row.resume_text,
      role: roleInput,
      mode: "full",
      userId: opts.userId,
      candidateId: row.candidate_id,
      applicationId: row.id,
      orgId: org.orgId,
      roleId: opts.roleId,
      bypassCache: opts.forceStale || isStale,
      context,
      deadlineMs: Math.min(perRankDeadlineMs, remainingMs),
    });
    if (!ranked.ok) continue;
    const p = ranked.profile;
    await sql`
      update candidates set
        full_name = ${p.full_name},
        email = ${p.email},
        phone = ${p.phone},
        location = ${p.location},
        linkedin_url = ${p.linkedin_url},
        current_title = ${p.current_title},
        current_company = ${p.current_company},
        years_experience = ${p.years_experience},
        parsed_json = ${JSON.stringify(p)},
        updated_at = now()
      where id = ${row.candidate_id} and (org_id = ${targetOrgId} or (org_id is null and user_id = ${opts.userId}))`;
    await sql`
      update applications set
        rank_score = ${ranked.rank.score},
        rank_json = ${JSON.stringify(ranked.rank)},
        pipeline_status = case when pipeline_status = 'ingested' then 'ranked' else pipeline_status end,
        resume_hash = ${ranked.resumeHash},
        role_hash = ${ranked.roleHash},
        rank_engine = ${ranked.engine},
        model = ${ranked.model || ""},
        provider = ${ranked.provider || ""},
        rubric_version_id = ${ranked.rubricVersionId || null},
        rubric_version = ${ranked.rubricVersion || null},
        rubric_hash = ${ranked.rubricHash || ""},
        is_stale = false,
        stale_reason = '',
        updated_at = now()
      where id = ${row.id} and (org_id = ${targetOrgId} or (org_id is null and user_id = ${opts.userId}))`;
    engines.push(ranked.fromCache ? `${ranked.engine}:cache` : ranked.engine);
    deepened += 1;
  }

  return { deepened, engines };
}
