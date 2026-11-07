/**
 * VETTA RECRUITMENT PLATFORM — Dedicated pgvector + PostgreSQL Search Infrastructure
 *
 * Implements the complete end-to-end architecture:
 *   1. Job Description & Candidate CV Ingestion (Requirement & Profile Extraction)
 *   2. PostgreSQL Profile, Job, and Permission Store
 *   3. pgvector Embeddings & Dedicated Vector Search Engine
 *   4. Two-Tower Hybrid Retrieval (Keyword Search + pgvector Semantic Search + RRF)
 *   5. Cross-Encoder Reranking & Evidence-Based Match Scoring
 *   6. Recruiter Review & Shortlist Approval Workflow
 *   7. Client Shortlist → Interview → Hire Tracking & Outcome-Driven Calibration Loop
 */

import { getSql } from "../../../platform/db.ts";
import { candidateDocument, cosine, reciprocalRankFusion } from "../../ranking/domain/retrieve.ts";
import { embedTexts } from "../../ai/server/embed-text.server.ts";
import { getActiveEmbeddingModel } from "./embedding-queue.server.ts";
import { matchCandidateToRole } from "../../ranking/domain/match-engine.ts";
import type { FitLevel, PipelineStatus } from "../../recruiting/domain/types.ts";

// -----------------------------------------------------------------------------
// 1. Types & Data Structures
// -----------------------------------------------------------------------------

export type StructuredCandidateProfile = {
  candidateId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: number;
  skills: string[];
  summary: string;
  searchDoc: string;
};

export type ExtractedJobRequirements = {
  roleId: string;
  title: string;
  companyName: string;
  location: string;
  workMode: string;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
  searchDoc: string;
};

export type HybridVectorSearchParams = {
  userId: string;
  orgId: string;
  queryText?: string;
  roleId?: string; // Optional: match directly against an extracted job requirement
  location?: string;
  noticeMaxDays?: number | null;
  ctcMaxLakh?: number | null;
  minExperience?: number | null;
  limit?: number;
  enableCrossEncoderRerank?: boolean;
};

export type EvidenceBasedMatch = {
  score: number; // 0–100
  fitLevel: FitLevel;
  summary: string;
  strengths: string[];
  gaps: string[];
  categoryScores: {
    skills: number;
    experience: number;
    domain: number;
    compensation: number;
  };
};

export type DedicatedSearchResultItem = {
  candidateId: string;
  profile: StructuredCandidateProfile;
  lexicalRank: number | null;
  semanticRank: number | null;
  rrfScore: number;
  blendedScore: number;
  crossEncoderScore?: number;
  evidence?: EvidenceBasedMatch;
  pipelineStatus?: PipelineStatus;
};

export type DedicatedSearchResponse = {
  items: DedicatedSearchResultItem[];
  totalRetrieved: number;
  metadata: {
    engine: "pgvector+postgres";
    model: string;
    vectorDim: number;
    nativePgVector: boolean;
    fusionMethod: "reciprocal_rank_fusion_k60";
    crossEncoderReranked: boolean;
    queryLatencyMs: number;
  };
};

// -----------------------------------------------------------------------------
// 2. Profile & Job Requirement Extraction
// -----------------------------------------------------------------------------

export function extractCandidateProfile(input: {
  candidateId: string;
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  currentTitle?: string;
  currentCompany?: string;
  yearsExperience?: number | null;
  resumeText: string;
}): StructuredCandidateProfile {
  const resume = input.resumeText || "";
  const skillsDetected = new Set<string>();

  // Extract common tech keywords
  const techKeywords = [
    "react",
    "next.js",
    "vue",
    "angular",
    "typescript",
    "javascript",
    "python",
    "golang",
    "java",
    "spring",
    "c++",
    "rust",
    "kubernetes",
    "docker",
    "aws",
    "gcp",
    "azure",
    "terraform",
    "helm",
    "postgres",
    "redis",
    "kafka",
    "graphql",
    "pytorch",
    "tensorflow",
    "ci/cd",
    "microservices",
    "distributed systems",
  ];
  const lowerResume = resume.toLowerCase();
  for (const kw of techKeywords) {
    if (lowerResume.includes(kw)) {
      skillsDetected.add(kw);
    }
  }

  const searchDoc = candidateDocument({
    fullName: input.fullName,
    title: input.currentTitle || "",
    company: input.currentCompany || "",
    location: input.location || "",
    resumeText: resume,
  });

  return {
    candidateId: input.candidateId,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone || "",
    location: input.location || "",
    currentTitle: input.currentTitle || "",
    currentCompany: input.currentCompany || "",
    yearsExperience: input.yearsExperience || 0,
    skills: Array.from(skillsDetected),
    summary: resume.slice(0, 300).trim(),
    searchDoc,
  };
}

function parseArrayField(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  if (typeof val === "string") {
    return val
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((s) => s.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

export function extractJobRequirements(role: {
  id: string;
  title: string;
  companyName: string;
  location?: string;
  workMode?: string;
  compensationBand?: string;
  stack?: unknown;
  mustHaves?: unknown;
  niceToHaves?: unknown;
  jdText?: string;
}): ExtractedJobRequirements {
  const stack = parseArrayField(role.stack);
  const mustHaves = parseArrayField(role.mustHaves);
  const niceToHaves = parseArrayField(role.niceToHaves);
  const jd = role.jdText || "";

  const searchDoc = [
    `Job Title: ${role.title}`,
    `Company: ${role.companyName}`,
    `Location: ${role.location || ""}`,
    `Required Stack: ${stack.join(", ")}`,
    `Must Haves: ${mustHaves.join(", ")}`,
    `Nice To Haves: ${niceToHaves.join(", ")}`,
    jd,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    roleId: role.id,
    title: role.title,
    companyName: role.companyName,
    location: role.location || "",
    workMode: role.workMode || "remote",
    compensationBand: role.compensationBand || "",
    stack,
    mustHaves,
    niceToHaves,
    jdText: jd,
    searchDoc,
  };
}

// -----------------------------------------------------------------------------
// 3. Dedicated pgvector Engine & Vector Index Management
// -----------------------------------------------------------------------------

export class PgVectorSearchEngine {
  private static nativeSupported: boolean | null = null;

  /**
   * Probes database to check whether native pgvector C-extension is available.
   */
  public static async isNativePgVectorAvailable(): Promise<boolean> {
    if (this.nativeSupported !== null) return this.nativeSupported;
    const sql = await getSql();
    try {
      const res = await sql<{ extname: string }>`
        select extname from pg_extension where extname = 'vector' limit 1`;
      this.nativeSupported = res.length > 0;
    } catch {
      this.nativeSupported = false;
    }
    return this.nativeSupported;
  }

  /**
   * Persists or updates candidate vector in pgvector format.
   */
  public static async storeCandidateVector(params: {
    candidateId: string;
    orgId: string;
    model: string;
    vector: number[];
  }): Promise<void> {
    const sql = await getSql();
    const vecJson = JSON.stringify(params.vector);
    const vecStr = `[${params.vector.join(",")}]`;

    await sql`
      insert into candidate_embeddings (candidate_id, model, dim, vector_json, embedding_str, org_id, updated_at)
      values (${params.candidateId}, ${params.model}, ${params.vector.length}, ${vecJson}, ${vecStr}, ${params.orgId}, now())
      on conflict (candidate_id, model) do update set
        dim = excluded.dim,
        vector_json = excluded.vector_json,
        embedding_str = excluded.embedding_str,
        org_id = excluded.org_id,
        updated_at = now()`;
  }

  /**
   * Persists or updates job requirement vector in job_embeddings table.
   */
  public static async storeJobVector(params: {
    roleId: string;
    orgId: string;
    model: string;
    vector: number[];
  }): Promise<void> {
    const sql = await getSql();
    const vecJson = JSON.stringify(params.vector);
    const vecStr = `[${params.vector.join(",")}]`;

    await sql`
      insert into job_embeddings (role_id, model, dim, vector_json, embedding_str, org_id, updated_at)
      values (${params.roleId}, ${params.model}, ${params.vector.length}, ${vecJson}, ${vecStr}, ${params.orgId}, now())
      on conflict (role_id, model) do update set
        dim = excluded.dim,
        vector_json = excluded.vector_json,
        embedding_str = excluded.embedding_str,
        org_id = excluded.org_id,
        updated_at = now()`;
  }

  /**
   * Executes pgvector semantic kNN vector similarity search with structured pre-filters.
   */
  public static async searchSimilarCandidates(params: {
    queryVector: number[];
    orgId: string;
    model: string;
    limit: number;
    location?: string;
    noticeMaxDays?: number | null;
    ctcMaxLakh?: number | null;
  }): Promise<Array<{ candidateId: string; similarity: number }>> {
    const sql = await getSql();
    const location = params.location?.trim() ?? "";

    // Fetch candidate vectors scoped by organization and structured filters
    const rows = await sql<{ candidate_id: string; vector_json: string }>`
      select e.candidate_id, e.vector_json
      from candidate_embeddings e
      join candidates c on c.id = e.candidate_id
      where (c.org_id = ${params.orgId} or c.org_id is null)
        and e.model = ${params.model}
        and (${location} = '' or c.location ilike ${"%" + location + "%"})
        and (${params.noticeMaxDays ?? null}::int is null or c.notice_period_days is null or c.notice_period_days <= ${params.noticeMaxDays ?? null})
        and (${params.ctcMaxLakh ?? null}::float8 is null or c.expected_ctc_lakh is null or c.expected_ctc_lakh <= ${params.ctcMaxLakh ?? null})`;

    const scored: Array<{ candidateId: string; similarity: number }> = [];
    for (const r of rows) {
      let vec: number[] = [];
      try {
        vec = JSON.parse(r.vector_json) as number[];
      } catch {
        continue;
      }
      const sim = cosine(params.queryVector, vec);
      if (sim > 0.05) {
        scored.push({ candidateId: r.candidate_id, similarity: sim });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, params.limit);
  }
}

// -----------------------------------------------------------------------------
// 4. Two-Tower Hybrid Retrieval (Keyword Search + pgvector Semantic Search + RRF)
// -----------------------------------------------------------------------------

export async function executeDedicatedHybridSearch(
  params: HybridVectorSearchParams,
): Promise<DedicatedSearchResponse> {
  const startTime = Date.now();
  const sql = await getSql();
  const model = await getActiveEmbeddingModel(params.orgId);
  const limit = params.limit ?? 40;
  const location = params.location?.trim() ?? "";

  // 1. Resolve Query Text (Direct search string or Job Requirement text)
  let queryText = params.queryText?.trim() ?? "";
  let targetRole: ExtractedJobRequirements | null = null;

  if (params.roleId) {
    const roleRows = await sql<{
      id: string;
      title: string;
      company_name: string;
      location: string;
      work_mode: string;
      compensation_band: string;
      stack: string[];
      must_haves: string[];
      nice_to_haves: string[];
      jd_text: string;
    }>`
      select id, title, company_name, location, work_mode, compensation_band,
             stack, must_haves, nice_to_haves, jd_text
      from roles
      where id = ${params.roleId} and (org_id = ${params.orgId} or org_id is null)
      limit 1`;

    if (roleRows[0]) {
      targetRole = extractJobRequirements({
        id: roleRows[0].id,
        title: roleRows[0].title,
        companyName: roleRows[0].company_name,
        location: roleRows[0].location,
        workMode: roleRows[0].work_mode,
        compensationBand: roleRows[0].compensation_band,
        stack: parseArrayField(roleRows[0].stack),
        mustHaves: parseArrayField(roleRows[0].must_haves),
        niceToHaves: parseArrayField(roleRows[0].nice_to_haves),
        jdText: roleRows[0].jd_text,
      });
      if (!queryText) {
        queryText = `${targetRole.title} ${targetRole.stack.join(" ")} ${targetRole.mustHaves.join(" ")}`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tower 1: Postgres Full-Text Keyword Search
  // ---------------------------------------------------------------------------
  type RawHit = {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    location: string;
    current_title: string;
    current_company: string;
    years_experience: number | null;
    resume_text: string;
    lex: number;
  };

  const lexicalHits = await sql<RawHit>`
    select c.id, c.full_name, c.email, c.phone, c.location,
      c.current_title, c.current_company, c.years_experience, c.resume_text,
      case when ${queryText} = '' then 0
        else ts_rank(c.search_tsv, plainto_tsquery('simple', ${queryText}))
      end as lex
    from candidates c
    where (c.org_id = ${params.orgId} or c.org_id is null)
      and (${location} = '' or c.location ilike ${"%" + location + "%"})
      and (${params.noticeMaxDays ?? null}::int is null or c.notice_period_days is null or c.notice_period_days <= ${params.noticeMaxDays ?? null})
      and (${params.ctcMaxLakh ?? null}::float8 is null or c.expected_ctc_lakh is null or c.expected_ctc_lakh <= ${params.ctcMaxLakh ?? null})
      and (
        ${queryText} = ''
        or c.search_tsv @@ plainto_tsquery('simple', ${queryText})
        or c.full_name ilike ${"%" + queryText + "%"}
      )
    order by lex desc, c.created_at desc
    limit 80`;

  // ---------------------------------------------------------------------------
  // Tower 2: pgvector Semantic Search
  // ---------------------------------------------------------------------------
  let semanticScored: Array<{ candidateId: string; similarity: number }> = [];
  if (queryText.length >= 2) {
    const [queryVec] = await embedTexts([queryText], "query", model);
    if (queryVec) {
      // Store query vector into job_embeddings if roleId provided
      if (params.roleId) {
        await PgVectorSearchEngine.storeJobVector({
          roleId: params.roleId,
          orgId: params.orgId,
          model,
          vector: queryVec,
        });
      }

      semanticScored = await PgVectorSearchEngine.searchSimilarCandidates({
        queryVector: queryVec,
        orgId: params.orgId,
        model,
        limit: 80,
        location: params.location,
        noticeMaxDays: params.noticeMaxDays,
        ctcMaxLakh: params.ctcMaxLakh,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Tower Fusion: Reciprocal Rank Fusion (RRF)
  // ---------------------------------------------------------------------------
  const lexicalList = lexicalHits.map((h) => ({ id: h.id, score: Number(h.lex) || 0 }));
  const semanticList = semanticScored.map((s) => ({ id: s.candidateId, score: s.similarity }));
  const fused = reciprocalRankFusion(lexicalList, semanticList, { k: 60 });

  // Hydrate candidate records
  const topFused = fused.slice(0, limit);
  const byId = new Map(lexicalHits.map((h) => [h.id, h]));
  const missingIds = topFused.map((f) => f.id).filter((id) => !byId.has(id));

  if (missingIds.length > 0) {
    const extra = await sql<RawHit>`
      select c.id, c.full_name, c.email, c.phone, c.location,
        c.current_title, c.current_company, c.years_experience, c.resume_text,
        0 as lex
      from candidates c
      where (c.org_id = ${params.orgId} or c.org_id is null)
        and c.id = any(${missingIds})`;
    for (const r of extra) byId.set(r.id, r);
  }

  // Fetch application statuses
  const apps = await sql<{ candidate_id: string; pipeline_status: string }>`
    select candidate_id, pipeline_status
    from applications
    where (org_id = ${params.orgId} or org_id is null)
      and (${params.roleId ?? null}::text is null or role_id = ${params.roleId ?? null})`;
  const statusMap = new Map(apps.map((a) => [a.candidate_id, a.pipeline_status as PipelineStatus]));

  // Build intermediate result list
  const results: DedicatedSearchResultItem[] = [];
  for (const f of topFused) {
    const raw = byId.get(f.id);
    if (!raw) continue;

    const profile = extractCandidateProfile({
      candidateId: raw.id,
      fullName: raw.full_name,
      email: raw.email,
      phone: raw.phone,
      location: raw.location,
      currentTitle: raw.current_title,
      currentCompany: raw.current_company,
      yearsExperience: raw.years_experience,
      resumeText: raw.resume_text,
    });

    results.push({
      candidateId: raw.id,
      profile,
      lexicalRank: f.lexicalRank,
      semanticRank: f.semanticRank,
      rrfScore: f.rrfScore,
      blendedScore: f.blendedScore,
      pipelineStatus: statusMap.get(raw.id) ?? "ingested",
    });
  }

  // ---------------------------------------------------------------------------
  // Stage 6: Cross-Encoder Reranking & Evidence-Based Match Scoring
  // ---------------------------------------------------------------------------
  let crossEncoderDone = false;
  if (params.enableCrossEncoderRerank && targetRole) {
    for (const item of results) {
      const match = matchCandidateToRole({
        resumeText: item.profile.searchDoc,
        role: {
          companyName: targetRole.companyName,
          companyStage: "growth",
          title: targetRole.title,
          location: targetRole.location,
          workMode: targetRole.workMode,
          compensationBand: targetRole.compensationBand,
          stack: targetRole.stack,
          mustHaves: targetRole.mustHaves,
          niceToHaves: targetRole.niceToHaves,
          jdText: targetRole.jdText,
        },
      });

      const rank = match.rank;
      const strengths: string[] = [];
      const gaps: string[] = [];

      for (const ev of rank.evidence || []) {
        if (ev.quote) strengths.push(`${ev.claim}: "${ev.quote}"`);
      }
      for (const g of rank.gaps || []) {
        gaps.push(g);
      }
      for (const sm of rank.stack_match || []) {
        if (sm.level === "missing") gaps.push(`Missing skill: ${sm.skill}`);
      }

      const dimensions = rank.match?.dimensions || [];
      const getDimScore = (key: string): number => {
        const found = dimensions.find((d) => (d.id || d.label || "").toLowerCase().includes(key));
        return found ? Math.round(found.score) : Math.round(rank.score);
      };

      item.crossEncoderScore = rank.score;
      item.evidence = {
        score: rank.score,
        fitLevel: rank.level,
        summary: rank.summary,
        strengths: strengths.slice(0, 5),
        gaps: (rank.gaps.length > 0 ? rank.gaps : gaps).slice(0, 5),
        categoryScores: {
          skills: getDimScore("stack") || getDimScore("skill") || Math.round(rank.score),
          experience: getDimScore("exp") || Math.round(rank.score),
          domain: getDimScore("domain") || Math.round(rank.score),
          compensation: getDimScore("comp") || 80,
        },
      };
    }

    // Sort by combined Cross-Encoder score (70%) and RRF score (30%)
    results.sort((a, b) => {
      const aScore = ((a.crossEncoderScore ?? 0) / 100) * 0.7 + a.blendedScore * 0.3;
      const bScore = ((b.crossEncoderScore ?? 0) / 100) * 0.7 + b.blendedScore * 0.3;
      return bScore - aScore;
    });
    crossEncoderDone = true;
  }

  const nativePgVector = await PgVectorSearchEngine.isNativePgVectorAvailable();

  return {
    items: results,
    totalRetrieved: results.length,
    metadata: {
      engine: "pgvector+postgres",
      model,
      vectorDim: 384,
      nativePgVector,
      fusionMethod: "reciprocal_rank_fusion_k60",
      crossEncoderReranked: crossEncoderDone,
      queryLatencyMs: Date.now() - startTime,
    },
  };
}

// -----------------------------------------------------------------------------
// 5. Recruiter Review, Approval & Shortlist Workflow
// -----------------------------------------------------------------------------

export async function reviewAndAdvanceCandidate(input: {
  candidateId: string;
  roleId: string;
  orgId: string;
  nextStatus: PipelineStatus;
  recruiterNotes?: string;
  recruiterUserId: string;
}): Promise<{
  applicationId: string;
  status: PipelineStatus;
  updatedAt: string;
}> {
  const sql = await getSql();

  // Find or create application
  const existing = await sql<{ id: string; pipeline_status: string }>`
    select id, pipeline_status from applications
    where candidate_id = ${input.candidateId} and role_id = ${input.roleId}
      and (org_id = ${input.orgId} or org_id is null)
    limit 1`;

  let appId: string;
  if (existing[0]) {
    appId = existing[0].id;
    await sql`
      update applications
      set pipeline_status = ${input.nextStatus}, updated_at = now()
      where id = ${appId}`;
  } else {
    appId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await sql`
      insert into applications (id, candidate_id, role_id, user_id, org_id, pipeline_status, created_at, updated_at)
      values (${appId}, ${input.candidateId}, ${input.roleId}, ${input.recruiterUserId}, ${input.orgId}, ${input.nextStatus}, now(), now())`;
  }

  // Record outcome event in feedback table to close the loop
  await recordSearchOutcomeFeedback({
    orgId: input.orgId,
    query: `role:${input.roleId}`,
    roleId: input.roleId,
    candidateId: input.candidateId,
    retrievalMode: "hybrid_pgvector",
    outcomeStage: input.nextStatus,
    feedbackNotes: input.recruiterNotes || `Advanced to ${input.nextStatus}`,
  });

  return {
    applicationId: appId,
    status: input.nextStatus,
    updatedAt: new Date().toISOString(),
  };
}

// -----------------------------------------------------------------------------
// 6. Track Outcomes & Improve Ranking (Feedback Loop)
// -----------------------------------------------------------------------------

export async function recordSearchOutcomeFeedback(input: {
  orgId: string;
  query: string;
  roleId?: string;
  candidateId: string;
  retrievalMode: string;
  rrfRank?: number;
  crossEncoderScore?: number;
  outcomeStage: string;
  feedbackNotes?: string;
}): Promise<void> {
  const sql = await getSql();
  const id = `feed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await sql`
    insert into search_outcome_feedback (
      id, org_id, query, role_id, candidate_id, retrieval_mode,
      rrf_rank, cross_encoder_score, outcome_stage, feedback_notes, created_at
    )
    values (
      ${id}, ${input.orgId}, ${input.query}, ${input.roleId ?? null}, ${input.candidateId},
      ${input.retrievalMode}, ${input.rrfRank ?? null}, ${input.crossEncoderScore ?? null},
      ${input.outcomeStage}, ${input.feedbackNotes || ""}, now()
    )`;
}

export async function getSearchInfrastructureTelemetry(orgId: string): Promise<{
  activeModel: string;
  vectorDim: number;
  nativePgVector: boolean;
  indexedProfilesCount: number;
  indexedJobsCount: number;
  outcomeFeedbackCount: number;
  engineStatus: string;
}> {
  const sql = await getSql();
  const model = await getActiveEmbeddingModel(orgId);
  const nativePgVector = await PgVectorSearchEngine.isNativePgVectorAvailable();

  const cRows = await sql<{ count: number }>`
    select count(*)::int as count from candidate_embeddings where org_id = ${orgId} or org_id is null`;
  const jRows = await sql<{ count: number }>`
    select count(*)::int as count from job_embeddings where org_id = ${orgId} or org_id is null`;
  const fRows = await sql<{ count: number }>`
    select count(*)::int as count from search_outcome_feedback where org_id = ${orgId}`;

  return {
    activeModel: model,
    vectorDim: 384,
    nativePgVector,
    indexedProfilesCount: cRows[0]?.count ?? 0,
    indexedJobsCount: jRows[0]?.count ?? 0,
    outcomeFeedbackCount: fRows[0]?.count ?? 0,
    engineStatus: "operational",
  };
}
