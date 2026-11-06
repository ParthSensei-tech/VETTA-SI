import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/platform/auth/middleware";
import { ensureUserOrg } from "./org.server";
import { assertOrgPermission, listOrgMembers, addOrgMember, updateOrgMember } from "./rbac.server";
import {
  assignUserToRole,
  removeRoleAssignment,
  getRoleAssignments,
  assignUserToApplication,
  getApplicationAssignments,
} from "./assignments.server";
import { getSharedCandidatePool, getCandidateFullDossier } from "./talent-pool.server";
import { findDuplicateCandidates, mergeCandidates } from "./duplicates.server";
import {
  addCandidateNote,
  getCandidateNotes,
  createRecruitingTask,
  updateTaskStatus,
  getRecruitingTasks,
} from "./collaboration.server";
import { updateWithOptimisticLock } from "./concurrency.server";

// 1. Team & Membership
export const getOrgMembersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const org = await ensureUserOrg(context.userId);
    return listOrgMembers(org.orgId);
  });

export const inviteOrgMemberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        userId: z.string().min(1),
        role: z.enum([
          "owner",
          "admin",
          "lead_recruiter",
          "recruiter",
          "hiring_manager",
          "interviewer",
          "sourcer",
        ]),
        title: z.string().optional(),
        invitedEmail: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return addOrgMember({
      orgId: org.orgId,
      userId: data.userId,
      role: data.role,
      actorUserId: context.userId,
      title: data.title,
      invitedEmail: data.invitedEmail,
    });
  });

// 2. Role Assignments
export const assignRoleMemberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        userId: z.string().min(1),
        assignmentType: z.enum([
          "lead_recruiter",
          "recruiter",
          "hiring_manager",
          "interviewer",
          "sourcer",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "roles:assign");
    return assignUserToRole({
      orgId: org.orgId,
      roleId: data.roleId,
      userId: data.userId,
      assignmentType: data.assignmentType,
      assignedBy: context.userId,
    });
  });

export const getRoleAssignmentsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return getRoleAssignments(org.orgId, data.roleId);
  });

// 3. Shared Candidate Pool
export const getSharedPoolFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        query: z.string().optional(),
        location: z.string().optional(),
        minExp: z.number().optional(),
        maxExp: z.number().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return getSharedCandidatePool({
      orgId: org.orgId,
      ...data,
    });
  });

export const getCandidateDossierFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ candidateId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return getCandidateFullDossier(org.orgId, data.candidateId, context.userId);
  });

// 4. Duplicate Candidate Scanning & Merge
export const findDuplicatesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        candidateId: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        fullName: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return findDuplicateCandidates({
      orgId: org.orgId,
      ...data,
    });
  });

export const mergeCandidatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        canonicalId: z.string().min(1),
        sourceId: z.string().min(1),
        reason: z.string().optional(),
        expectedCanonicalVersion: z.number().optional(),
        expectedSourceVersion: z.number().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "candidates:merge");
    return mergeCandidates({
      orgId: org.orgId,
      canonicalId: data.canonicalId,
      sourceId: data.sourceId,
      mergedBy: context.userId,
      reason: data.reason,
      expectedCanonicalVersion: data.expectedCanonicalVersion,
      expectedSourceVersion: data.expectedSourceVersion,
    });
  });

// 5. Collaborative Notes
export const addCandidateNoteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        candidateId: z.string().min(1),
        applicationId: z.string().optional(),
        content: z.string().min(1),
        visibility: z.enum(["team", "hiring_team", "private"]).optional(),
        pinned: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "notes:create");
    return addCandidateNote({
      orgId: org.orgId,
      candidateId: data.candidateId,
      applicationId: data.applicationId,
      authorId: context.userId,
      authorName: "Recruiter",
      content: data.content,
      visibility: data.visibility,
      pinned: data.pinned,
    });
  });

export const getCandidateNotesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        candidateId: z.string().min(1),
        applicationId: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return getCandidateNotes({
      orgId: org.orgId,
      candidateId: data.candidateId,
      applicationId: data.applicationId,
      viewerUserId: context.userId,
    });
  });

// 6. Actionable Tasks
export const createRecruitingTaskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(1),
        description: z.string().optional(),
        candidateId: z.string().optional(),
        applicationId: z.string().optional(),
        roleId: z.string().optional(),
        assigneeId: z.string().min(1),
        priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
        dueDate: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    await assertOrgPermission(context.userId, org.orgId, "tasks:create");
    return createRecruitingTask({
      orgId: org.orgId,
      title: data.title,
      description: data.description,
      candidateId: data.candidateId,
      applicationId: data.applicationId,
      roleId: data.roleId,
      assigneeId: data.assigneeId,
      creatorId: context.userId,
      priority: data.priority,
      dueDate: data.dueDate,
    });
  });

export const updateTaskStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        taskId: z.string().min(1),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return updateTaskStatus({
      orgId: org.orgId,
      taskId: data.taskId,
      status: data.status,
      userId: context.userId,
    });
  });

export const getRecruitingTasksFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        assigneeId: z.string().optional(),
        candidateId: z.string().optional(),
        roleId: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return getRecruitingTasks({
      orgId: org.orgId,
      ...data,
    });
  });

// 7. Optimistic Concurrency Update
export const updateWithOptimisticLockFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        table: z.enum(["roles", "candidates", "applications", "candidate_notes"]),
        id: z.string().min(1),
        expectedVersion: z.number().int(),
        setClauses: z.record(z.string(), z.any()),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return updateWithOptimisticLock({
      table: data.table,
      id: data.id,
      expectedVersion: data.expectedVersion,
      userId: context.userId,
      orgId: org.orgId,
      setClauses: data.setClauses,
    });
  });
