/**
 * Versioned rubrics: LLM drafts from JD → founder confirms.
 * Edits after scoring create a new version; lock when shortlist is stamped.
 */

import { getSql } from "../../../platform/db.ts";
import { iso, parseJson } from "../../../shared/utils.ts";
import {
  DEFAULT_HARD_CONSTRAINTS,
  type CriterionKind,
  type CriterionWeight,
  type HardConstraints,
  type RubricCriterion,
  type RubricStatus,
  type RubricVersion,
} from "../domain/rubric-types";
import { validateCriteria } from "../domain/rubric-guardrails";
import { computeRubricHash } from "../../../lib/recruiting/hash";
import { routeTelemetry } from "../../ai/domain/model-router.ts";

function newId(): string {
  return crypto.randomUUID();
}

function mapVersion(row: {
  id: string;
  org_id: string;
  role_id: string;
  version: number;
  status: string;
  criteria_json: string;
  hard_constraints_json: string;
  rubric_hash?: string | null;
  source: string;
  created_by: string;
  parent_version_id: string | null;
  locked_at: unknown;
  created_at: unknown;
}): RubricVersion {
  return {
    id: row.id,
    orgId: row.org_id,
    roleId: row.role_id,
    version: row.version,
    status: row.status as RubricStatus,
    criteria: parseJson<RubricCriterion[]>(row.criteria_json, []),
    hardConstraints: {
      ...DEFAULT_HARD_CONSTRAINTS,
      ...parseJson<Partial<HardConstraints>>(row.hard_constraints_json, {}),
    },
    rubricHash: row.rubric_hash || null,
    source: row.source,
    createdBy: row.created_by,
    parentVersionId: row.parent_version_id,
    lockedAt: row.locked_at ? iso(row.locked_at) : null,
    createdAt: iso(row.created_at),
  };
}

async function loadRoleOwned(userId: string, roleId: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    user_id: string;
    org_id: string | null;
    title: string;
    company_name: string;
    company_stage: string;
    location: string;
    compensation_band: string;
    stack: string;
    must_haves: string;
    nice_to_haves: string;
    jd_text: string;
  }>`
    select id, user_id, org_id, title, company_name, company_stage, location,
           compensation_band, stack, must_haves, nice_to_haves, jd_text
    from roles where id = ${roleId} limit 1`;
  if (!rows[0]) throw new Error("Role not found");
  const role = rows[0];
  if (role.org_id) {
    const isMember = await sql<{ n: number }>`
      select count(*)::int as n from organization_members
      where user_id = ${userId} and org_id = ${role.org_id}`;
    if (!isMember[0] || Number(isMember[0].n) < 1) {
      throw new Error("Role not found");
    }
  } else if (role.user_id !== userId) {
    throw new Error("Role not found");
  }
  return role;
}

/** Deterministic draft when LLM unavailable — from JD fields only, no demo names. */
export function draftRubricFromRoleFields(role: {
  title: string;
  companyStage: string;
  location: string;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
}): { criteria: RubricCriterion[]; hardConstraints: HardConstraints } {
  const criteria: RubricCriterion[] = [];
  const push = (
    name: string,
    weight: CriterionWeight,
    kind: CriterionKind,
    strongEvidence: string,
  ) => {
    if (criteria.length >= 8) return;
    criteria.push({ id: newId(), name, weight, kind, strongEvidence });
  };

  push(
    "Role-relevant ownership",
    "high",
    "must",
    `Clear ownership of work similar to ${role.title}: shipped outcomes, not only support tickets.`,
  );

  for (const m of role.mustHaves.slice(0, 3)) {
    push(
      m.slice(0, 80),
      "high",
      "must",
      `Resume shows concrete evidence of: ${m}. Prefer projects, metrics, or on-call ownership over buzzwords.`,
    );
  }

  for (const s of role.stack.slice(0, 2)) {
    push(
      `${s} proficiency`,
      "medium",
      "must",
      `Hands-on use of ${s} in production or a shipped product — tools listed alone are not enough.`,
    );
  }

  for (const n of role.niceToHaves.slice(0, 2)) {
    push(n.slice(0, 80), "low", "nice", `Nice-to-have: ${n}. Treat as a plus, not a hard filter.`);
  }

  if (role.companyStage === "seed" || role.companyStage === "series_a") {
    push(
      "Early-stage operating style",
      "medium",
      "nice",
      "Evidence of wearing multiple hats, 0→1 delivery, or comfort in small teams — not only large-org process.",
    );
  }

  // Ensure 5–8
  while (criteria.length < 5) {
    push(
      "Written communication",
      "low",
      "nice",
      "Clear written communication in the resume or linked writing — important for remote-heavy teams.",
    );
  }

  const bandNums = [...role.compensationBand.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const hardConstraints: HardConstraints = {
    city: role.location.includes("Remote") ? "" : role.location,
    noticeMaxDays: 60,
    compMinLpa: bandNums.length ? Math.min(...bandNums) : null,
    compMaxLpa: bandNums.length ? Math.max(...bandNums) : null,
    strictFilter: false,
  };

  return { criteria: criteria.slice(0, 8), hardConstraints };
}

export async function generateRubricDraft(opts: {
  userId: string;
  roleId: string;
  /** Skip LLM — seed 5–8 criteria from the JD immediately. */
  heuristicOnly?: boolean;
}): Promise<RubricVersion> {
  const role = await loadRoleOwned(opts.userId, opts.roleId);
  const { ensureUserOrg } = await import("../../people/server/org.server");
  const org = await ensureUserOrg(opts.userId, role.company_name);
  const orgId = role.org_id || org.orgId;

  const fields = {
    title: role.title,
    companyStage: role.company_stage,
    location: role.location,
    compensationBand: role.compensation_band,
    stack: parseJson<string[]>(role.stack, []),
    mustHaves: parseJson<string[]>(role.must_haves, []),
    niceToHaves: parseJson<string[]>(role.nice_to_haves, []),
    jdText: role.jd_text,
  };

  let criteria: RubricCriterion[];
  let hardConstraints: HardConstraints;
  let source = "heuristic";

  const heuristic = draftRubricFromRoleFields(fields);
  criteria = heuristic.criteria;
  hardConstraints = heuristic.hardConstraints;

  if (!opts.heuristicOnly) {
    try {
      const { completeWithRouter } = await import("../../ai/server/providers.server");
      const result = await completeWithRouter({
        task: "rubric_draft",
        orgId,
        system: `You draft hiring rubrics for Seed–Series B roles in India.
Return JSON only: { "criteria": [{ "name", "weight": "high"|"medium"|"low", "kind": "must"|"nice", "strongEvidence" }], "hardConstraints": { "city", "noticeMaxDays", "compMinLpa", "compMaxLpa", "strictFilter" } }.
Rules: 5–8 criteria from the JD. No protected attributes (gender, age, caste, religion, marital status). No pedigree-only bars (IIT-only, FAANG-only). strongEvidence must be plain language a founder can check on a resume. Hard constraints are city, notice ceiling, comp band only — they filter/flag, they are not score dimensions.`,
        maxTokens: 1800,
        // Worth waiting for, but only up to a point: `heuristic` above is already a usable draft, so
        // an arm that cannot fit this budget is refused rather than left spinning.
        context: "bulk",
        deadlineMs: 60_000,
        maxAttemptsPerProvider: 2,
        user: `Draft a rubric for:
Title: ${fields.title}
Stage: ${fields.companyStage}
Location: ${fields.location}
Comp: ${fields.compensationBand}
Stack: ${fields.stack.join(", ")}
Must-haves: ${fields.mustHaves.join("; ")}
Nice-to-haves: ${fields.niceToHaves.join("; ")}
JD:
${fields.jdText.slice(0, 6000)}`,
      });
      if (result.ok && !result.routedLocal) {
        const text = result.text;
        // A rubric draft really spent tokens, so it belongs in the cost ledger — before the
        // parse is known to be usable, since the spend already happened either way.
        void (async () => {
          try {
            const { recordModelCost } = await import("../../../platform/observability/observability.server.ts");
            await recordModelCost({
              userId: opts.userId ?? null,
              taskType: "rubric_draft",
              provider: result.provider,
              model: result.model,
              promptText: fields.jdText.slice(0, 6000),
              completionText: text,
              durationMs: result.durationMs,
              success: true,
              roleId: opts.roleId,
              orgId,
              meta: { router: routeTelemetry(result.route, result.attempts) },
            });
          } catch {
            /* best-effort telemetry — never block the draft */
          }
        })();
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        const raw = start >= 0 && end > start ? text.slice(start, end + 1) : text;
        const parsed = parseJson<{
          criteria?: Array<{
            name?: string;
            weight?: string;
            kind?: string;
            strongEvidence?: string;
          }>;
          hardConstraints?: Partial<HardConstraints>;
        }>(raw, {});
        if (parsed.criteria && parsed.criteria.length >= 4) {
          criteria = parsed.criteria.slice(0, 8).map((c) => ({
            id: newId(),
            name: String(c.name || "Criterion").slice(0, 120),
            weight: (["high", "medium", "low"].includes(String(c.weight))
              ? c.weight
              : "medium") as CriterionWeight,
            kind: (c.kind === "nice" ? "nice" : "must") as CriterionKind,
            strongEvidence: String(c.strongEvidence || "Evidence on the resume").slice(0, 400),
          }));
          hardConstraints = {
            ...DEFAULT_HARD_CONSTRAINTS,
            ...parsed.hardConstraints,
            city: parsed.hardConstraints?.city ?? fields.location,
          };
          source = "llm";
        } else {
          const d = draftRubricFromRoleFields(fields);
          criteria = d.criteria;
          hardConstraints = d.hardConstraints;
        }
      } else {
        const d = draftRubricFromRoleFields(fields);
        criteria = d.criteria;
        hardConstraints = d.hardConstraints;
      }
    } catch {
      const d = draftRubricFromRoleFields(fields);
      criteria = d.criteria;
      hardConstraints = d.hardConstraints;
    }
  } // end if !heuristicOnly

  // Guardrails: drop blocked criteria
  criteria = criteria.filter((c) => {
    const v = validateCriteria([c]);
    return v.ok;
  });
  if (criteria.length < 5) {
    const d = draftRubricFromRoleFields(fields);
    criteria = d.criteria;
    hardConstraints = hardConstraints.city ? hardConstraints : d.hardConstraints;
  }

  const sql = await getSql();
  const verRows = await sql<{ v: number }>`
    select coalesce(max(version), 0)::int as v from rubric_versions where role_id = ${opts.roleId}`;
  const nextVer = Number(verRows[0]?.v ?? 0) + 1;

  // Supersede previous active drafts
  await sql`
    update rubric_versions set status = 'superseded'
    where role_id = ${opts.roleId} and status in ('draft', 'active')`;

  const id = newId();
  const rubricHash = computeRubricHash(criteria, hardConstraints as Record<string, unknown>);
  await sql`
    insert into rubric_versions (
      id, org_id, role_id, version, status, criteria_json, hard_constraints_json, rubric_hash, source, created_by
    ) values (
      ${id}, ${orgId}, ${opts.roleId}, ${nextVer}, ${"draft"},
      ${JSON.stringify(criteria)}, ${JSON.stringify(hardConstraints)}, ${rubricHash}, ${source}, ${opts.userId}
    )`;

  const rows = await sql`select * from rubric_versions where id = ${id} limit 1`;
  return mapVersion(rows[0] as Parameters<typeof mapVersion>[0]);
}

export async function loadEditableRubric(
  userId: string,
  roleId: string,
): Promise<RubricVersion | null> {
  await loadRoleOwned(userId, roleId);
  const sql = await getSql();
  const rows = await sql`
    select * from rubric_versions
    where role_id = ${roleId} and status in ('active', 'draft', 'locked')
    order by
      case status when 'active' then 0 when 'locked' then 1 when 'draft' then 2 else 3 end,
      version desc
    limit 1`;
  if (!rows[0]) return null;
  return mapVersion(rows[0] as Parameters<typeof mapVersion>[0]);
}

export async function persistRubricEdits(opts: {
  userId: string;
  roleId: string;
  criteria: Array<{
    id?: string;
    name: string;
    weight: CriterionWeight;
    kind: CriterionKind;
    strongEvidence: string;
  }>;
  hardConstraints: HardConstraints;
  activate: boolean;
}): Promise<{ rubric: RubricVersion; rerankTriggered: boolean }> {
  const role = await loadRoleOwned(opts.userId, opts.roleId);
  const { ensureUserOrg } = await import("../../people/server/org.server");
  const org = await ensureUserOrg(opts.userId, role.company_name);
  const orgId = role.org_id || org.orgId;

  const criteria: RubricCriterion[] = opts.criteria.map((c) => ({
    id: c.id || newId(),
    name: c.name,
    weight: c.weight,
    kind: c.kind,
    strongEvidence: c.strongEvidence,
  }));

  const guard = validateCriteria(criteria);
  if (!guard.ok) {
    throw new Error(
      `Rubric blocked: ${guard.blocks[0]?.reason ?? "Protected attribute in criteria"}`,
    );
  }

  const sql = await getSql();
  const current = await sql<{ id: string; status: string; version: number }>`
    select id, status, version from rubric_versions
    where role_id = ${opts.roleId}
    order by version desc limit 1`;

  const hasScored = await sql<{ n: number }>`
    select count(*)::int as n from applications
    where role_id = ${opts.roleId} and (org_id = ${orgId} or org_id is null) and rank_score is not null`;
  const scored = Number(hasScored[0]?.n ?? 0) > 0;
  const cur = current[0];
  const mustNewVersion =
    !cur ||
    cur.status === "locked" ||
    cur.status === "active" ||
    scored ||
    cur.status === "superseded";

  let rubricId: string;
  let version: number;
  const rubricHash = computeRubricHash(criteria, opts.hardConstraints as Record<string, unknown>);

  if (mustNewVersion) {
    if (cur && (cur.status === "active" || cur.status === "draft")) {
      await sql`update rubric_versions set status = 'superseded' where id = ${cur.id}`;
    }
    version = (cur?.version ?? 0) + 1;
    rubricId = newId();
    await sql`
      insert into rubric_versions (
        id, org_id, role_id, version, status, criteria_json, hard_constraints_json,
        rubric_hash, source, created_by, parent_version_id
      ) values (
        ${rubricId}, ${orgId}, ${opts.roleId}, ${version},
        ${opts.activate ? "active" : "draft"},
        ${JSON.stringify(criteria)}, ${JSON.stringify(opts.hardConstraints)},
        ${rubricHash}, ${"founder_edit"}, ${opts.userId}, ${cur?.id ?? null}
      )`;
  } else {
    rubricId = cur!.id;
    version = cur!.version;
    await sql`
      update rubric_versions set
        criteria_json = ${JSON.stringify(criteria)},
        hard_constraints_json = ${JSON.stringify(opts.hardConstraints)},
        rubric_hash = ${rubricHash},
        status = ${opts.activate ? "active" : "draft"},
        source = ${"founder_edit"}
      where id = ${rubricId}`;
  }

  // When activated, invalidate stale cache entries and flag stale application scores
  if (opts.activate) {
    try {
      const { invalidateRoleRankCache } = await import("./rank-cache.server");
      await invalidateRoleRankCache({ userId: opts.userId, rubricVersionId: rubricId });

      await sql`
        update applications set
          is_stale = true,
          stale_reason = ${`Rubric updated to v${version} (criteria or weights changed)`}
        where role_id = ${opts.roleId}
          and (org_id = ${orgId} or org_id is null)
          and (rubric_version_id is null or rubric_version_id != ${rubricId})`;
    } catch (err) {
      console.error("[rubric-cache-invalidation-error]", err);
    }
  }

  let rerankTriggered = false;
  if (opts.activate && scored) {
    rerankTriggered = true;
    void (async () => {
      try {
        const { deepenRoleTopN } = await import("./deepen.server");
        await deepenRoleTopN({
          userId: opts.userId,
          roleId: opts.roleId,
          topN: 25,
          forceStale: true,
        });
      } catch (e) {
        console.error("[rubric-rerank]", e);
      }
    })();
  }

  const rows = await sql`select * from rubric_versions where id = ${rubricId} limit 1`;
  return {
    rubric: mapVersion(rows[0] as Parameters<typeof mapVersion>[0]),
    rerankTriggered,
  };
}

/** Lock active rubric when a client shortlist is stamped (approved/sent). */
export async function lockRubricForRole(opts: { userId: string; roleId: string }): Promise<void> {
  const sql = await getSql();
  await sql`
    update rubric_versions set status = 'locked', locked_at = now()
    where role_id = ${opts.roleId} and status = 'active'`;
}

export async function loadActiveRubricForRole(roleId: string): Promise<RubricVersion | null> {
  const sql = await getSql();
  const rows = await sql`
    select * from rubric_versions
    where role_id = ${roleId} and status in ('active', 'locked')
    order by case status when 'active' then 0 else 1 end, version desc
    limit 1`;
  if (!rows[0]) return null;
  return mapVersion(rows[0] as Parameters<typeof mapVersion>[0]);
}
