import { getSql } from "../../platform/db.ts";

export type SharedCandidateSummary = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: number | null;
  status: string;
  version: number;
  totalApplications: number;
  latestRoleTitle?: string;
  latestPipelineStatus?: string;
  createdAt: string;
  updatedAt: string;
};

export type CandidateApplicationHistory = {
  id: string;
  roleId: string;
  roleTitle: string;
  companyName: string;
  pipelineStatus: string;
  rankScore: number | null;
  rankEngine: string;
  model: string;
  provider: string;
  recruiterNotes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CandidateFullDossier = {
  candidate: {
    id: string;
    orgId: string;
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedinUrl: string;
    currentTitle: string;
    currentCompany: string;
    yearsExperience: number | null;
    resumeText: string;
    parsedJson: Record<string, any>;
    status: string;
    mergedIntoId: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  applications: CandidateApplicationHistory[];
  notes: Array<{
    id: string;
    applicationId: string | null;
    authorId: string;
    authorName: string;
    authorRole: string;
    content: string;
    visibility: string;
    pinned: boolean;
    mentions: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    assigneeId: string;
    creatorId: string;
    priority: string;
    status: string;
    dueDate: string | null;
    completedAt: string | null;
    createdAt: string;
  }>;
  merges: Array<{
    id: string;
    mergedCandidateId: string;
    mergedBy: string;
    reason: string;
    confidence: number;
    createdAt: string;
  }>;
};

/**
 * Searches and lists the shared organization candidate pool across all roles.
 */
export async function getSharedCandidatePool(opts: {
  orgId: string;
  query?: string;
  location?: string;
  minExp?: number;
  maxExp?: number;
  includeMerged?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ candidates: SharedCandidateSummary[]; totalCount: number }> {
  const sql = await getSql();
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const q = opts.query ? `%${opts.query.trim().toLowerCase()}%` : null;
  const loc = opts.location ? `%${opts.location.trim().toLowerCase()}%` : null;
  const minE = opts.minExp ?? 0;
  const maxE = opts.maxExp ?? 100;
  const includeMerged = opts.includeMerged ?? false;
  const conditions: string[] = ["c.org_id = $1"];
  const params: unknown[] = [opts.orgId];

  if (!includeMerged) {
    conditions.push("c.status <> 'merged'");
  }
  if (minE > 0) {
    params.push(minE);
    conditions.push(`coalesce(c.years_experience, 0) >= $${params.length}`);
  }
  if (maxE < 100) {
    params.push(maxE);
    conditions.push(`coalesce(c.years_experience, 0) <= $${params.length}`);
  }
  if (q) {
    params.push(q);
    const pIdx = params.length;
    conditions.push(
      `(lower(c.full_name) like $${pIdx} or lower(c.email) like $${pIdx} or lower(c.current_title) like $${pIdx} or lower(c.current_company) like $${pIdx})`,
    );
  }
  if (loc) {
    params.push(loc);
    conditions.push(`lower(c.location) like $${params.length}`);
  }

  const whereClause = conditions.join(" and ");

  const countRows = await sql.query<{ count: number }>(
    `select count(*)::int as count from candidates c where ${whereClause}`,
    [...params],
  );

  const totalCount = countRows[0]?.count ?? 0;

  const dataParams = [...params, limit, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const rows = await sql.query<{
    id: string;
    full_name: string;
    email: string;
    phone: string;
    location: string;
    linkedin_url: string;
    current_title: string;
    current_company: string;
    years_experience: number | null;
    status: string;
    version: number;
    created_at: string;
    updated_at: string;
    total_apps: number;
    latest_role_title: string | null;
    latest_pipeline_status: string | null;
  }>(
    `select
      c.id, c.full_name, c.email, c.phone, c.location, c.linkedin_url,
      c.current_title, c.current_company, c.years_experience, c.status,
      c.version, c.created_at, c.updated_at,
      count(a.id)::int as total_apps,
      (
        select r.title from applications a2
        join roles r on r.id = a2.role_id
        where a2.candidate_id = c.id
        order by a2.created_at desc limit 1
      ) as latest_role_title,
      (
        select a2.pipeline_status from applications a2
        where a2.candidate_id = c.id
        order by a2.created_at desc limit 1
      ) as latest_pipeline_status
    from candidates c
    left join applications a on a.candidate_id = c.id
    where ${whereClause}
    group by c.id
    order by c.created_at desc
    limit $${limitIdx} offset $${offsetIdx}`,
    dataParams,
  );

  return {
    totalCount,
    candidates: rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      phone: r.phone,
      location: r.location,
      linkedinUrl: r.linkedin_url,
      currentTitle: r.current_title,
      currentCompany: r.current_company,
      yearsExperience: r.years_experience,
      status: r.status,
      version: r.version,
      totalApplications: r.total_apps,
      latestRoleTitle: r.latest_role_title ?? undefined,
      latestPipelineStatus: r.latest_pipeline_status ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  };
}

/**
 * Retrieves the full unified profile dossier for a candidate in the shared pool.
 */
export async function getCandidateFullDossier(
  orgId: string,
  candidateId: string,
  viewerUserId?: string,
): Promise<CandidateFullDossier | null> {
  const sql = await getSql();

  // Load candidate
  const candRows = await sql<{
    id: string;
    org_id: string;
    full_name: string;
    email: string;
    phone: string;
    location: string;
    linkedin_url: string;
    current_title: string;
    current_company: string;
    years_experience: number | null;
    resume_text: string;
    parsed_json: string;
    status: string;
    merged_into_id: string | null;
    version: number;
    created_at: string;
    updated_at: string;
  }>`
    select id, org_id, full_name, email, phone, location, linkedin_url,
           current_title, current_company, years_experience, resume_text,
           parsed_json, status, merged_into_id, version, created_at, updated_at
    from candidates
    where id = ${candidateId} and org_id = ${orgId}
    limit 1`;

  const cand = candRows[0];
  if (!cand) return null;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(cand.parsed_json || "{}");
  } catch {
    parsed = {};
  }

  // Applications
  const appRows = await sql<{
    id: string;
    role_id: string;
    role_title: string;
    company_name: string;
    pipeline_status: string;
    rank_score: number | null;
    rank_engine: string;
    model: string;
    provider: string;
    recruiter_notes: string;
    version: number;
    created_at: string;
    updated_at: string;
  }>`
    select a.id, a.role_id, r.title as role_title, r.company_name, a.pipeline_status,
           a.rank_score, a.rank_engine, a.model, a.provider, a.recruiter_notes,
           a.version, a.created_at, a.updated_at
    from applications a
    join roles r on r.id = a.role_id
    where a.candidate_id = ${candidateId}
    order by a.created_at desc`;

  // Notes
  const noteRows = await sql<{
    id: string;
    application_id: string | null;
    author_id: string;
    author_name: string;
    author_role: string;
    content: string;
    visibility: string;
    pinned: boolean;
    mentions_json: string;
    created_at: string;
    updated_at: string;
  }>`
    select id, application_id, author_id, author_name, author_role, content,
           visibility, pinned, mentions_json, created_at, updated_at
    from candidate_notes
    where candidate_id = ${candidateId} and org_id = ${orgId}
      and (
        visibility <> 'private'
        or author_id = ${viewerUserId ?? ""}
      )
    order by pinned desc, created_at desc`;

  // Tasks
  const taskRows = await sql<{
    id: string;
    title: string;
    description: string;
    assignee_id: string;
    creator_id: string;
    priority: string;
    status: string;
    due_date: string | null;
    completed_at: string | null;
    created_at: string;
  }>`
    select id, title, description, assignee_id, creator_id, priority, status,
           due_date, completed_at, created_at
    from recruiting_tasks
    where candidate_id = ${candidateId} and org_id = ${orgId}
    order by case status when 'pending' then 1 when 'in_progress' then 2 else 3 end, due_date asc nulls last`;

  // Merges
  const mergeRows = await sql<{
    id: string;
    merged_candidate_id: string;
    merged_by: string;
    reason: string;
    confidence: number;
    created_at: string;
  }>`
    select id, merged_candidate_id, merged_by, reason, confidence, created_at
    from candidate_merges
    where canonical_candidate_id = ${candidateId} and org_id = ${orgId}
    order by created_at desc`;

  return {
    candidate: {
      id: cand.id,
      orgId: cand.org_id,
      fullName: cand.full_name,
      email: cand.email,
      phone: cand.phone,
      location: cand.location,
      linkedinUrl: cand.linkedin_url,
      currentTitle: cand.current_title,
      currentCompany: cand.current_company,
      yearsExperience: cand.years_experience,
      resumeText: cand.resume_text,
      parsedJson: parsed,
      status: cand.status,
      mergedIntoId: cand.merged_into_id,
      version: cand.version,
      createdAt: cand.created_at,
      updatedAt: cand.updated_at,
    },
    applications: appRows.map((a) => ({
      id: a.id,
      roleId: a.role_id,
      roleTitle: a.role_title,
      companyName: a.company_name,
      pipelineStatus: a.pipeline_status,
      rankScore: a.rank_score,
      rankEngine: a.rank_engine,
      model: a.model,
      provider: a.provider,
      recruiterNotes: a.recruiter_notes,
      version: a.version,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    })),
    notes: noteRows.map((n) => {
      let mentions: string[] = [];
      try {
        mentions = JSON.parse(n.mentions_json || "[]");
      } catch {
        mentions = [];
      }
      return {
        id: n.id,
        applicationId: n.application_id,
        authorId: n.author_id,
        authorName: n.author_name,
        authorRole: n.author_role,
        content: n.content,
        visibility: n.visibility,
        pinned: n.pinned,
        mentions,
        createdAt: n.created_at,
        updatedAt: n.updated_at,
      };
    }),
    tasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      assigneeId: t.assignee_id,
      creatorId: t.creator_id,
      priority: t.priority,
      status: t.status,
      dueDate: t.due_date,
      completedAt: t.completed_at,
      createdAt: t.created_at,
    })),
    merges: mergeRows.map((m) => ({
      id: m.id,
      mergedCandidateId: m.merged_candidate_id,
      mergedBy: m.merged_by,
      reason: m.reason,
      confidence: m.confidence,
      createdAt: m.created_at,
    })),
  };
}
