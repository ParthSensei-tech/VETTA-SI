import { getSql } from "../../../platform/db.ts";

function newId(): string {
  return crypto.randomUUID();
}

export type NoteVisibility = "team" | "hiring_team" | "private";

export type CandidateNoteRecord = {
  id: string;
  orgId: string;
  candidateId: string;
  applicationId: string | null;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  visibility: NoteVisibility;
  pinned: boolean;
  mentions: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type RecruitingTaskRecord = {
  id: string;
  orgId: string;
  title: string;
  description: string;
  candidateId: string | null;
  candidateName?: string;
  applicationId: string | null;
  roleId: string | null;
  roleTitle?: string;
  assigneeId: string;
  creatorId: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  isOverdue: boolean;
  completedAt: string | null;
  completedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function extractMentions(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9._-]+)/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

/**
 * Adds a new collaborative recruiter note.
 */
export async function addCandidateNote(opts: {
  orgId: string;
  candidateId: string;
  applicationId?: string;
  authorId: string;
  authorName: string;
  authorRole?: string;
  content: string;
  visibility?: NoteVisibility;
  pinned?: boolean;
}): Promise<CandidateNoteRecord> {
  const sql = await getSql();

  const candCheck = await sql<{ id: string }>`
    select id from candidates where id = ${opts.candidateId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
  if (!candCheck[0]) {
    throw new Error("Candidate not found");
  }
  if (opts.applicationId) {
    const appCheck = await sql<{ id: string }>`
      select id from applications where id = ${opts.applicationId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
    if (!appCheck[0]) {
      throw new Error("Application not found");
    }
  }

  const id = newId();
  const visibility = opts.visibility ?? "team";
  const pinned = opts.pinned ?? false;
  const mentions = extractMentions(opts.content);

  await sql`
    insert into candidate_notes (
      id, org_id, candidate_id, application_id, author_id, author_name, author_role,
      content, visibility, pinned, mentions_json, version, created_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.candidateId}, ${opts.applicationId ?? null},
      ${opts.authorId}, ${opts.authorName}, ${opts.authorRole ?? "Recruiter"},
      ${opts.content}, ${visibility}, ${pinned}, ${JSON.stringify(mentions)},
      1, now(), now()
    )`;

  return {
    id,
    orgId: opts.orgId,
    candidateId: opts.candidateId,
    applicationId: opts.applicationId ?? null,
    authorId: opts.authorId,
    authorName: opts.authorName,
    authorRole: opts.authorRole ?? "Recruiter",
    content: opts.content,
    visibility,
    pinned,
    mentions,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Retrieves notes for a candidate or application with role/user visibility filtering.
 */
export async function getCandidateNotes(opts: {
  orgId: string;
  candidateId: string;
  applicationId?: string;
  viewerUserId: string;
  viewerRole?: string;
}): Promise<CandidateNoteRecord[]> {
  const sql = await getSql();
  const isSuperUser = opts.viewerRole === "owner" || opts.viewerRole === "admin";

  const rows = await sql<{
    id: string;
    org_id: string;
    candidate_id: string;
    application_id: string | null;
    author_id: string;
    author_name: string;
    author_role: string;
    content: string;
    visibility: string;
    pinned: boolean;
    mentions_json: string;
    version: number;
    created_at: string;
    updated_at: string;
  }>`
    select id, org_id, candidate_id, application_id, author_id, author_name, author_role,
           content, visibility, pinned, mentions_json, version, created_at, updated_at
    from candidate_notes
    where candidate_id = ${opts.candidateId} and org_id = ${opts.orgId}
      and (${opts.applicationId ?? ""} = '' or application_id = ${opts.applicationId ?? ""} or application_id is null)
      and (
        ${isSuperUser}
        or visibility <> 'private'
        or author_id = ${opts.viewerUserId}
      )
    order by pinned desc, created_at desc`;

  return rows.map((r) => {
    let mentions: string[] = [];
    try {
      mentions = JSON.parse(r.mentions_json || "[]");
    } catch {
      mentions = [];
    }
    return {
      id: r.id,
      orgId: r.org_id,
      candidateId: r.candidate_id,
      applicationId: r.application_id,
      authorId: r.author_id,
      authorName: r.author_name,
      authorRole: r.author_role,
      content: r.content,
      visibility: r.visibility as NoteVisibility,
      pinned: r.pinned,
      mentions,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

/**
 * Creates an actionable recruiting task.
 */
export async function createRecruitingTask(opts: {
  orgId: string;
  title: string;
  description?: string;
  candidateId?: string;
  applicationId?: string;
  roleId?: string;
  assigneeId: string;
  creatorId: string;
  priority?: TaskPriority;
  dueDate?: string;
}): Promise<RecruitingTaskRecord> {
  const sql = await getSql();

  if (opts.candidateId) {
    const candCheck = await sql<{ id: string }>`
      select id from candidates where id = ${opts.candidateId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
    if (!candCheck[0]) throw new Error("Candidate not found");
  }
  if (opts.roleId) {
    const roleCheck = await sql<{ id: string }>`
      select id from roles where id = ${opts.roleId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
    if (!roleCheck[0]) throw new Error("Role not found");
  }
  if (opts.applicationId) {
    const appCheck = await sql<{ id: string }>`
      select id from applications where id = ${opts.applicationId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
    if (!appCheck[0]) throw new Error("Application not found");
  }

  if (opts.assigneeId) {
    const foreignMember = await sql<{ id: string }>`
      select id from organization_members where user_id = ${opts.assigneeId} and org_id != ${opts.orgId} limit 1`;
    if (foreignMember[0]) {
      const assigneeCheck = await sql<{ id: string }>`
        select id from organization_members where org_id = ${opts.orgId} and user_id = ${opts.assigneeId} limit 1`;
      if (!assigneeCheck[0]) throw new Error("Assignee must be a member of this organization");
    }
  }

  const id = newId();
  const priority = opts.priority ?? "medium";

  const dueDateVal: string | null = opts.dueDate ?? null;

  await sql`
    insert into recruiting_tasks (
      id, org_id, title, description, candidate_id, application_id, role_id,
      assignee_id, creator_id, priority, status, due_date, created_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.title}, ${opts.description ?? ""},
      ${opts.candidateId ?? null}, ${opts.applicationId ?? null}, ${opts.roleId ?? null},
      ${opts.assigneeId}, ${opts.creatorId}, ${priority}, 'pending',
      ${dueDateVal},
      now(), now()
    )`;

  return {
    id,
    orgId: opts.orgId,
    title: opts.title,
    description: opts.description ?? "",
    candidateId: opts.candidateId ?? null,
    applicationId: opts.applicationId ?? null,
    roleId: opts.roleId ?? null,
    assigneeId: opts.assigneeId,
    creatorId: opts.creatorId,
    priority,
    status: "pending",
    dueDate: opts.dueDate ?? null,
    isOverdue: false,
    completedAt: null,
    completedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates task status (e.g. marking completed).
 */
export async function updateTaskStatus(opts: {
  orgId: string;
  taskId: string;
  status: TaskStatus;
  userId: string;
}): Promise<RecruitingTaskRecord> {
  const sql = await getSql();
  const isCompleted = opts.status === "completed";

  await sql`
    update recruiting_tasks set
      status = ${opts.status},
      completed_at = case when ${isCompleted} then now() else null end,
      completed_by = case when ${isCompleted} then ${opts.userId} else null end,
      updated_at = now()
    where id = ${opts.taskId} and org_id = ${opts.orgId}`;

  const rows = await sql<{
    id: string;
    org_id: string;
    title: string;
    description: string;
    candidate_id: string | null;
    application_id: string | null;
    role_id: string | null;
    assignee_id: string;
    creator_id: string;
    priority: string;
    status: string;
    due_date: string | null;
    completed_at: string | null;
    completed_by: string | null;
    created_at: string;
    updated_at: string;
  }>`
    select id, org_id, title, description, candidate_id, application_id, role_id,
           assignee_id, creator_id, priority, status, due_date, completed_at,
           completed_by, created_at, updated_at
    from recruiting_tasks
    where id = ${opts.taskId} and org_id = ${opts.orgId}
    limit 1`;

  const r = rows[0];
  if (!r) throw new Error(`Task ${opts.taskId} not found`);

  const now = new Date().toISOString();
  const isOverdue = r.due_date ? r.due_date < now && r.status !== "completed" : false;

  return {
    id: r.id,
    orgId: r.org_id,
    title: r.title,
    description: r.description,
    candidateId: r.candidate_id,
    applicationId: r.application_id,
    roleId: r.role_id,
    assigneeId: r.assignee_id,
    creatorId: r.creator_id,
    priority: r.priority as TaskPriority,
    status: r.status as TaskStatus,
    dueDate: r.due_date,
    isOverdue,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Lists tasks with filtering.
 */
export async function getRecruitingTasks(opts: {
  orgId: string;
  assigneeId?: string;
  candidateId?: string;
  roleId?: string;
  status?: TaskStatus;
  limit?: number;
}): Promise<RecruitingTaskRecord[]> {
  const sql = await getSql();
  const limit = Math.min(opts.limit ?? 50, 100);

  const rows = await sql<{
    id: string;
    org_id: string;
    title: string;
    description: string;
    candidate_id: string | null;
    candidate_name: string | null;
    application_id: string | null;
    role_id: string | null;
    role_title: string | null;
    assignee_id: string;
    creator_id: string;
    priority: string;
    status: string;
    due_date: string | null;
    completed_at: string | null;
    completed_by: string | null;
    created_at: string;
    updated_at: string;
  }>`
    select t.id, t.org_id, t.title, t.description, t.candidate_id, c.full_name as candidate_name,
           t.application_id, t.role_id, r.title as role_title, t.assignee_id, t.creator_id,
           t.priority, t.status, t.due_date, t.completed_at, t.completed_by,
           t.created_at, t.updated_at
    from recruiting_tasks t
    left join candidates c on c.id = t.candidate_id
    left join roles r on r.id = t.role_id
    where t.org_id = ${opts.orgId}
      and (${opts.assigneeId ?? ""} = '' or t.assignee_id = ${opts.assigneeId ?? ""})
      and (${opts.candidateId ?? ""} = '' or t.candidate_id = ${opts.candidateId ?? ""})
      and (${opts.roleId ?? ""} = '' or t.role_id = ${opts.roleId ?? ""})
      and (${opts.status ?? ""} = '' or t.status = ${opts.status ?? ""})
    order by case t.status when 'pending' then 1 when 'in_progress' then 2 else 3 end,
             t.due_date asc nulls last, t.created_at desc
    limit ${limit}`;

  const now = new Date().toISOString();
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    title: r.title,
    description: r.description,
    candidateId: r.candidate_id,
    candidateName: r.candidate_name ?? undefined,
    applicationId: r.application_id,
    roleId: r.role_id,
    roleTitle: r.role_title ?? undefined,
    assigneeId: r.assignee_id,
    creatorId: r.creator_id,
    priority: r.priority as TaskPriority,
    status: r.status as TaskStatus,
    dueDate: r.due_date,
    isOverdue: r.due_date ? r.due_date < now && r.status !== "completed" : false,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
