/**
 * Client-callable talent search. The handler stays off the *.server filename
 * so the browser bundle can import the server function without pulling Node.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import { getSql } from "../../../platform/db.ts";
import type { PipelineStatus, TalentRow } from "../../recruiting/domain/types.ts";
import {
  candidateDocument,
  cosine,
  mergeRetrievalScore,
  reciprocalRankFusion,
} from "../../ranking/domain/retrieve.ts";

type Hit = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_url: string;
  current_title: string;
  current_company: string;
  years_experience: number | null;
  resume_text: string;
  created_at: unknown;
  notice_period_days: number | null;
  expected_ctc_lakh: number | null;
  lex: number;
};

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

export async function indexNewCandidate(
  candidateId: string,
  notice: number | null,
  expected: number | null,
): Promise<void> {
  const sql = await getSql();
  await sql`
    update candidates
    set notice_period_days = ${notice}, expected_ctc_lakh = ${expected}
    where id = ${candidateId}`;
  await refreshCandidateSearch(candidateId);
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

export async function executeTalentSearch(opts: {
  userId: string;
  orgId: string;
  q?: string;
  location?: string;
  noticeMaxDays?: number | null;
  ctcMaxLakh?: number | null;
  mode?: "hybrid" | "lexical" | "semantic";
}): Promise<{
  rows: TalentRow[];
  mode: "fts+e5" | "fts";
  model: string | null;
  metrics?: {
    lexicalHits: number;
    semanticHits: number;
    fusionHits: number;
    retrievalMode: "hybrid" | "lexical" | "semantic";
  };
}> {
  const sql = await getSql();
  const q = opts.q?.trim() ?? "";
  const location = opts.location?.trim() ?? "";
  const requestedMode = opts.mode ?? "hybrid";

  await sql`
    update candidates set search_tsv = to_tsvector(
      'simple',
      coalesce(full_name, '') || ' ' || coalesce(current_title, '') || ' ' ||
      coalesce(current_company, '') || ' ' || coalesce(location, '') || ' ' ||
      coalesce(resume_text, '')
    )
    where (org_id = ${opts.orgId} or (org_id is null and user_id = ${opts.userId})) and search_tsv is null`;

  // 1. Lexical Tower: Postgres FTS / BM25-style keyword search
  const lexicalHits = await sql<Hit>`
    select c.id, c.full_name, c.email, c.phone, c.location, c.linkedin_url,
      c.current_title, c.current_company, c.years_experience, c.resume_text,
      c.created_at, c.notice_period_days, c.expected_ctc_lakh,
      case when ${q} = '' then 0
        else ts_rank(c.search_tsv, plainto_tsquery('simple', ${q}))
      end as lex
    from candidates c
    where (c.org_id = ${opts.orgId} or (c.org_id is null and c.user_id = ${opts.userId}))
      and (${location} = '' or c.location ilike ${"%" + location + "%"})
      and (${opts.noticeMaxDays ?? null}::int is null or c.notice_period_days is null or c.notice_period_days <= ${opts.noticeMaxDays ?? null})
      and (${opts.ctcMaxLakh ?? null}::float8 is null or c.expected_ctc_lakh is null or c.expected_ctc_lakh <= ${opts.ctcMaxLakh ?? null})
      and (
        ${q} = ''
        or c.search_tsv @@ plainto_tsquery('simple', ${q})
        or c.full_name ilike ${"%" + q + "%"}
      )
    order by lex desc, c.created_at desc
    limit 80`;

  let pool: Hit[] = lexicalHits;
  let mode: "fts+e5" | "fts" = "fts";
  let model: string | null = null;
  let semanticHitsCount = 0;
  let fusionHitsCount = 0;

  if (q.length >= 2 && requestedMode !== "lexical") {
    try {
      const { embedTexts } = await import("../../ai/server/embed-text.server.ts");
      const { getActiveEmbeddingModel, enqueueCandidatesBulk } =
        await import("../server/embedding-queue.server.ts");
      model = await getActiveEmbeddingModel(opts.orgId);

      // Opportunistically backfill missing embeddings for candidates matching filters
      const missing = await sql<{
        id: string;
        resume_text: string;
        full_name: string;
        current_title: string;
        current_company: string;
        location: string;
      }>`
        select c.id, c.resume_text, c.full_name, c.current_title, c.current_company, c.location
        from candidates c
        left join candidate_embeddings e on e.candidate_id = c.id and e.model = ${model}
        where (c.org_id = ${opts.orgId} or (c.org_id is null and c.user_id = ${opts.userId}))
          and e.candidate_id is null
          and (${location} = '' or c.location ilike ${"%" + location + "%"})
          and (${opts.noticeMaxDays ?? null}::int is null or c.notice_period_days is null or c.notice_period_days <= ${opts.noticeMaxDays ?? null})
          and (${opts.ctcMaxLakh ?? null}::float8 is null or c.expected_ctc_lakh is null or c.expected_ctc_lakh <= ${opts.ctcMaxLakh ?? null})
        limit 50`;

      if (missing.length > 0) {
        const vectors = await embedTexts(
          missing.map((c) =>
            candidateDocument({
              fullName: c.full_name,
              title: c.current_title,
              company: c.current_company,
              location: c.location,
              resumeText: c.resume_text,
            }),
          ),
          "passage",
          model,
        );
        for (let i = 0; i < missing.length; i += 1) {
          const vec = vectors[i];
          if (!vec) continue;
          await sql`
            insert into candidate_embeddings (candidate_id, model, dim, vector_json, org_id, updated_at)
            values (${missing[i]!.id}, ${model}, ${vec.length}, ${JSON.stringify(vec)}, ${opts.orgId}, now())
            on conflict (candidate_id, model) do update set
              dim = excluded.dim,
              vector_json = excluded.vector_json,
              org_id = excluded.org_id,
              updated_at = now()`;
        }
      }

      // Enqueue any background overflow beyond the sync batch
      const remainingMissing = await sql<{ id: string }>`
        select c.id
        from candidates c
        left join candidate_embeddings e on e.candidate_id = c.id and e.model = ${model}
        where (c.org_id = ${opts.orgId} or (c.org_id is null and c.user_id = ${opts.userId}))
          and e.candidate_id is null
        limit 200`;
      if (remainingMissing.length > 0) {
        void enqueueCandidatesBulk({
          candidateIds: remainingMissing.map((r) => r.id),
          orgId: opts.orgId,
          priority: 2,
          model,
        });
      }

      // 2. Semantic Tower: Dense vector cosine similarity across candidate pool
      const [queryVec] = await embedTexts([q], "query", model);
      const emb = await sql<{ candidate_id: string; vector_json: string }>`
        select e.candidate_id, e.vector_json
        from candidate_embeddings e
        join candidates c on c.id = e.candidate_id
        where (c.org_id = ${opts.orgId} or (c.org_id is null and c.user_id = ${opts.userId}))
          and e.model = ${model}
          and (${location} = '' or c.location ilike ${"%" + location + "%"})
          and (${opts.noticeMaxDays ?? null}::int is null or c.notice_period_days is null or c.notice_period_days <= ${opts.noticeMaxDays ?? null})
          and (${opts.ctcMaxLakh ?? null}::float8 is null or c.expected_ctc_lakh is null or c.expected_ctc_lakh <= ${opts.ctcMaxLakh ?? null})`;

      const semanticResults: Array<{ id: string; score: number }> = [];
      if (queryVec) {
        for (const row of emb) {
          let vec: number[] = [];
          try {
            vec = JSON.parse(row.vector_json) as number[];
          } catch {
            continue;
          }
          const sem = cosine(queryVec, vec);
          if (sem > 0.05) {
            semanticResults.push({ id: row.candidate_id, score: sem });
          }
        }
        semanticResults.sort((a, b) => b.score - a.score);
      }
      semanticHitsCount = semanticResults.length;

      const byId = new Map(lexicalHits.map((h) => [h.id, h]));

      if (requestedMode === "semantic") {
        mode = "fts+e5";
        const topSemanticIds = semanticResults.slice(0, 40).map((s) => s.id);
        const missingIds = topSemanticIds.filter((id) => !byId.has(id));
        if (missingIds.length > 0) {
          const extra = await sql<Hit>`
            select c.id, c.full_name, c.email, c.phone, c.location, c.linkedin_url,
              c.current_title, c.current_company, c.years_experience, c.resume_text,
              c.created_at, c.notice_period_days, c.expected_ctc_lakh, 0 as lex
            from candidates c
            where (c.org_id = ${opts.orgId} or (c.org_id is null and c.user_id = ${opts.userId}))
              and c.id = any(${missingIds})`;
          for (const row of extra) byId.set(row.id, row);
        }
        pool = topSemanticIds.map((id) => byId.get(id)).filter((h): h is Hit => Boolean(h));
      } else {
        // requestedMode === "hybrid" -> Reciprocal Rank Fusion
        mode = "fts+e5";
        const lexicalScored = lexicalHits.map((h) => ({ id: h.id, score: Number(h.lex) || 0 }));
        const fused = reciprocalRankFusion(lexicalScored, semanticResults, { k: 60 });
        fusionHitsCount = fused.length;

        const topFusedIds = fused.slice(0, 40).map((f) => f.id);
        const missingIds = topFusedIds.filter((id) => !byId.has(id));
        if (missingIds.length > 0) {
          const extra = await sql<Hit>`
            select c.id, c.full_name, c.email, c.phone, c.location, c.linkedin_url,
              c.current_title, c.current_company, c.years_experience, c.resume_text,
              c.created_at, c.notice_period_days, c.expected_ctc_lakh, 0 as lex
            from candidates c
            where (c.org_id = ${opts.orgId} or (c.org_id is null and c.user_id = ${opts.userId}))
              and c.id = any(${missingIds})`;
          for (const row of extra) byId.set(row.id, row);
        }
        pool = topFusedIds.map((id) => byId.get(id)).filter((h): h is Hit => Boolean(h));
      }
    } catch {
      mode = "fts";
      model = null;
      pool = lexicalHits.slice(0, 40);
    }
  } else {
    pool = lexicalHits.slice(0, 40);
  }

  const apps = await sql<{
    id: string;
    candidate_id: string;
    role_id: string;
    pipeline_status: string;
    rank_score: number | null;
    role_title: string;
    company_name: string;
  }>`
    select a.id, a.candidate_id, a.role_id, a.pipeline_status, a.rank_score,
      r.title as role_title, r.company_name
    from applications a
    join roles r on r.id = a.role_id
    where (a.org_id = ${opts.orgId} or (a.org_id is null and a.user_id = ${opts.userId}))`;

  const rows: TalentRow[] = pool.map((c) => ({
    candidate: {
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      location: c.location,
      linkedinUrl: c.linkedin_url,
      currentTitle: c.current_title,
      currentCompany: c.current_company,
      yearsExperience: c.years_experience,
      resumeText: "",
      parsed: {
        full_name: c.full_name,
        email: c.email,
        phone: c.phone,
        location: c.location,
        linkedin_url: c.linkedin_url,
        current_title: c.current_title,
        current_company: c.current_company,
        years_experience: c.years_experience,
        skills: [],
        summary: "",
      },
      createdAt: iso(c.created_at),
    },
    applications: apps
      .filter((a) => a.candidate_id === c.id)
      .map((a) => ({
        id: a.id,
        roleId: a.role_id,
        roleTitle: a.role_title,
        companyName: a.company_name,
        pipelineStatus: a.pipeline_status as PipelineStatus,
        rankScore: a.rank_score,
      })),
  }));

  return {
    rows,
    mode,
    model,
    metrics: {
      lexicalHits: lexicalHits.length,
      semanticHits: semanticHitsCount,
      fusionHits: fusionHitsCount || pool.length,
      retrievalMode: requestedMode,
    },
  };
}

export const searchTalent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        q: z.string().max(200).optional(),
        location: z.string().max(80).optional(),
        noticeMaxDays: z.number().int().positive().max(365).nullable().optional(),
        ctcMaxLakh: z.number().positive().max(500).nullable().optional(),
        mode: z.enum(["hybrid", "lexical", "semantic"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      rows: TalentRow[];
      mode: "fts+e5" | "fts";
      model: string | null;
      metrics?: {
        lexicalHits: number;
        semanticHits: number;
        fusionHits: number;
        retrievalMode: "hybrid" | "lexical" | "semantic";
      };
    }> => {
      const { ensureUserOrg } = await import("../../people/server/org.server.ts");
      const org = await ensureUserOrg(context.userId);
      return executeTalentSearch({
        userId: context.userId,
        orgId: org.orgId,
        q: data.q,
        location: data.location,
        noticeMaxDays: data.noticeMaxDays,
        ctcMaxLakh: data.ctcMaxLakh,
        mode: data.mode,
      });
    },
  );
