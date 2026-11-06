import test from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../platform/db.ts";
import { ensureUserOrg } from "./org.server.ts";
import { hasPermission, ROLE_PERMISSIONS, type OrgRole, type OrgPermission } from "./rbac.ts";
import {
  assertOrgPermission,
  addOrgMember,
  updateOrgMember,
  listOrgMembers,
  getOrgMembership,
} from "./rbac.server.ts";
import {
  assignUserToRole,
  getRoleAssignments,
  removeRoleAssignment,
  assignUserToApplication,
  getApplicationAssignments,
} from "./assignments.server.ts";
import { getSharedCandidatePool, getCandidateFullDossier } from "./talent-pool.server.ts";
import {
  normalizeEmail,
  normalizePhone,
  normalizeLinkedin,
  findDuplicateCandidates,
  mergeCandidates,
} from "../../features/ingest/server/duplicates.server.ts";
import {
  addCandidateNote,
  getCandidateNotes,
  createRecruitingTask,
  updateTaskStatus,
  getRecruitingTasks,
} from "./collaboration.server.ts";
import { updateWithOptimisticLock } from "./concurrency.server.ts";
import { ConcurrencyConflictError } from "./concurrency.ts";

function uid(): string {
  return crypto.randomUUID();
}

// ============================================================================
// 1. RBAC & MULTI-RECRUITER ROLES
// ============================================================================

test("RBAC: permission matrix adheres to enterprise governance ladder", () => {
  // Owner has all permissions
  assert.equal(hasPermission("owner", "org:manage"), true);
  assert.equal(hasPermission("owner", "candidates:merge"), true);
  assert.equal(hasPermission("owner", "notes:view_private"), true);

  // Recruiter can edit and create candidates and review applications, but cannot manage members or org
  assert.equal(hasPermission("recruiter", "candidates:create"), true);
  assert.equal(hasPermission("recruiter", "applications:review"), true);
  assert.equal(hasPermission("recruiter", "members:manage"), false);
  assert.equal(hasPermission("recruiter", "org:manage"), false);

  // Hiring Manager can review, edit roles and see sensitive candidate data, but cannot delete roles
  assert.equal(hasPermission("hiring_manager", "applications:review"), true);
  assert.equal(hasPermission("hiring_manager", "roles:delete"), false);

  // Interviewer can only review applications and leave notes/tasks
  assert.equal(hasPermission("interviewer", "applications:review"), true);
  assert.equal(hasPermission("interviewer", "notes:create"), true);
  assert.equal(hasPermission("interviewer", "candidates:create"), false);
  assert.equal(hasPermission("interviewer", "candidates:merge"), false);

  // Sourcer can create candidates, but cannot merge or move stages
  assert.equal(hasPermission("sourcer", "candidates:create"), true);
  assert.equal(hasPermission("sourcer", "candidates:merge"), false);
  assert.equal(hasPermission("sourcer", "applications:move_stage"), false);
});

test("RBAC: membership management, invitation, and role enforcement", async () => {
  const ownerId = `owner-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Reliance Digital Talent");

  const recruiterId = `recruiter-${uid()}`;
  const sourcerId = `sourcer-${uid()}`;

  // Owner invites recruiter
  const member = await addOrgMember({
    orgId: org.orgId,
    userId: recruiterId,
    role: "recruiter",
    actorUserId: ownerId,
    title: "Senior Tech Recruiter",
    invitedEmail: "recruiter@jio.reliance.in",
  });

  assert.equal(member.role, "recruiter");
  assert.equal(member.status, "active");
  assert.equal(member.title, "Senior Tech Recruiter");

  // Owner invites sourcer
  await addOrgMember({
    orgId: org.orgId,
    userId: sourcerId,
    role: "sourcer",
    actorUserId: ownerId,
    title: "Talent Sourcer",
  });

  // Verify assertOrgPermission allows authorized action
  const checked = await assertOrgPermission(recruiterId, org.orgId, "candidates:create");
  assert.equal(checked.userId, recruiterId);

  // Verify assertOrgPermission blocks unauthorized action
  await assert.rejects(async () => {
    await assertOrgPermission(sourcerId, org.orgId, "candidates:merge");
  }, /Forbidden: Role 'sourcer' lacks 'candidates:merge' permission/);

  // Update member role from recruiter to lead_recruiter
  const updated = await updateOrgMember({
    orgId: org.orgId,
    targetUserId: recruiterId,
    actorUserId: ownerId,
    role: "lead_recruiter",
  });
  assert.equal(updated.role, "lead_recruiter");

  // List members
  const members = await listOrgMembers(org.orgId);
  assert.ok(members.length >= 3);
  assert.equal(members[0]!.role, "owner");
});

// ============================================================================
// 2. ASSIGNMENTS (ROLES & APPLICATIONS)
// ============================================================================

test("Assignments: role and candidate application assignments with team hierarchy", async () => {
  const sql = await getSql();
  const ownerId = `owner-${uid()}`;
  const recruiterId = `lead-${uid()}`;
  const hmId = `hm-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Jio Cloud Services");

  const roleId = uid();
  await sql`
    insert into roles (id, user_id, org_id, company_name, company_stage, title)
    values (${roleId}, ${ownerId}, ${org.orgId}, 'Jio Platforms', 'enterprise', 'Principal Distributed Systems Architect')`;

  // Assign lead recruiter and hiring manager
  const leadAssign = await assignUserToRole({
    orgId: org.orgId,
    roleId,
    userId: recruiterId,
    assignmentType: "lead_recruiter",
    assignedBy: ownerId,
  });
  assert.equal(leadAssign.assignmentType, "lead_recruiter");

  await assignUserToRole({
    orgId: org.orgId,
    roleId,
    userId: hmId,
    assignmentType: "hiring_manager",
    assignedBy: ownerId,
  });

  const roleAssignments = await getRoleAssignments(org.orgId, roleId);
  assert.equal(roleAssignments.length, 2);
  assert.equal(roleAssignments[0]!.assignmentType, "lead_recruiter");
  assert.equal(roleAssignments[1]!.assignmentType, "hiring_manager");

  // Candidate application assignment
  const candId = uid();
  const appId = uid();
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, resume_text)
    values (${candId}, ${ownerId}, ${org.orgId}, 'Amitabh Verma', 'amitabh@example.com', 'Senior Architect')`;
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status)
    values (${appId}, ${ownerId}, ${org.orgId}, ${roleId}, ${candId}, 'review')`;

  const appAssign = await assignUserToApplication({
    orgId: org.orgId,
    applicationId: appId,
    userId: recruiterId,
    assignmentType: "owner",
    assignedBy: ownerId,
  });
  assert.equal(appAssign.assignmentType, "owner");

  const appAssignments = await getApplicationAssignments(org.orgId, appId);
  assert.equal(appAssignments.length, 1);
  assert.equal(appAssignments[0]!.userId, recruiterId);
});

// ============================================================================
// 3. SHARED CANDIDATE POOL & DOSSIER
// ============================================================================

test("Shared Candidate Pool: queries talent across all roles and returns full candidate dossier", async () => {
  const sql = await getSql();
  const ownerId = `owner-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Reliance Retail & Commerce");

  const candId = uid();
  await sql`
    insert into candidates (
      id, user_id, org_id, full_name, email, phone, location, linkedin_url,
      current_title, current_company, years_experience, resume_text, parsed_json, version
    ) values (
      ${candId}, ${ownerId}, ${org.orgId}, 'Sneha Patel', 'sneha.patel@example.com',
      '+91 98200 11223', 'Mumbai, India', 'https://linkedin.com/in/sneha-patel-retail',
      'Senior Product Manager', 'Tata Digital', 7.5,
      'Product Manager with 7+ years scaling omnichannel digital platforms.',
      ${JSON.stringify({ skills: ["Product Management", "Omnichannel", "SQL", "Roadmapping"] })},
      1
    )`;

  // Role 1
  const role1 = uid();
  await sql`
    insert into roles (id, user_id, org_id, company_name, company_stage, title)
    values (${role1}, ${ownerId}, ${org.orgId}, 'Reliance Retail', 'enterprise', 'Lead Product Manager')`;

  // Application 1
  const app1 = uid();
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status, rank_score, recruiter_notes)
    values (${app1}, ${ownerId}, ${org.orgId}, ${role1}, ${candId}, 'screen', 88, 'Strong consumer tech background')`;

  // Query shared pool
  const pool = await getSharedCandidatePool({
    orgId: org.orgId,
    query: "Sneha",
    minExp: 5,
  });

  assert.equal(pool.totalCount, 1);
  assert.equal(pool.candidates[0]!.fullName, "Sneha Patel");
  assert.equal(pool.candidates[0]!.totalApplications, 1);
  assert.equal(pool.candidates[0]!.latestRoleTitle, "Lead Product Manager");

  // Retrieve full dossier
  const dossier = await getCandidateFullDossier(org.orgId, candId, ownerId);
  assert.ok(dossier);
  assert.equal(dossier.candidate.fullName, "Sneha Patel");
  assert.equal(dossier.applications.length, 1);
  assert.equal(dossier.applications[0]!.rankScore, 88);
});

// ============================================================================
// 4. DUPLICATE DETECTION & CONFLICT-SAFE MERGE
// ============================================================================

test("Duplicate Detection: normalization and multi-factor heuristics", async () => {
  assert.equal(normalizeEmail("  Priya.Sharma@Gmail.COM "), "priya.sharma@gmail.com");
  assert.equal(normalizePhone("+91 98765-43210"), "9876543210");
  assert.equal(normalizePhone("09876543210"), "9876543210");
  assert.equal(
    normalizeLinkedin("https://www.linkedin.com/in/priya-sharma-dev/"),
    "priya-sharma-dev",
  );

  const sql = await getSql();
  const ownerId = `owner-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Jio Telecom Software");

  const cand1 = uid();
  const cand2 = uid();

  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, linkedin_url, current_company, resume_text)
    values (${cand1}, ${ownerId}, ${org.orgId}, 'Priya Sharma', 'priya.sharma@techcorp.in', '+91 98765 43210', 'https://linkedin.com/in/priyasharma', 'TechCorp', 'Python Lead')`;

  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, linkedin_url, current_company, resume_text)
    values (${cand2}, ${ownerId}, ${org.orgId}, 'Priya Sharma', 'priya.sharma@techcorp.in', '9876543210', 'https://linkedin.com/in/priyasharma', 'TechCorp', 'Senior Python Developer')`;

  const duplicates = await findDuplicateCandidates({
    orgId: org.orgId,
    candidateId: cand1,
  });

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0]!.candidateId, cand2);
  assert.equal(duplicates[0]!.confidence, 1.0);
  assert.ok(duplicates[0]!.matchReasons.includes("Exact email match"));
});

test("Duplicate Merge: atomic, conflict-safe candidate merge with cross-role preservation", async () => {
  const sql = await getSql();
  const ownerId = `owner-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Reliance Enterprise Cloud");

  const roleA = uid();
  const roleB = uid();
  await sql`insert into roles (id, user_id, org_id, company_name, company_stage, title)
            values (${roleA}, ${ownerId}, ${org.orgId}, 'Jio', 'enterprise', 'Backend Architect')`;
  await sql`insert into roles (id, user_id, org_id, company_name, company_stage, title)
            values (${roleB}, ${ownerId}, ${org.orgId}, 'Jio', 'enterprise', 'Cloud Platform Lead')`;

  const canonicalId = uid();
  const sourceId = uid();

  // Canonical candidate
  await sql`
    insert into candidates (
      id, user_id, org_id, full_name, email, phone, location, linkedin_url,
      current_title, current_company, years_experience, resume_text, version
    ) values (
      ${canonicalId}, ${ownerId}, ${org.orgId}, 'Rajesh Kumar', 'rajesh.kumar@gmail.com',
      '', 'Bengaluru', '', 'Tech Lead', 'Infosys', 8.0, 'Resume A', 1
    )`;

  // Duplicate candidate with complementary phone & linkedin
  await sql`
    insert into candidates (
      id, user_id, org_id, full_name, email, phone, location, linkedin_url,
      current_title, current_company, years_experience, resume_text, version
    ) values (
      ${sourceId}, ${ownerId}, ${org.orgId}, 'Rajesh Kumar', 'rajesh.k@infosys.com',
      '+91 9988776655', 'Bengaluru', 'https://linkedin.com/in/rajeshkumar-cloud',
      'Senior Lead', 'Infosys', 8.5, 'Resume B', 1
    )`;

  // Canonical applied to Role A
  const appA = uid();
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status, rank_score, recruiter_notes)
    values (${appA}, ${ownerId}, ${org.orgId}, ${roleA}, ${canonicalId}, 'interview', 85, 'Solid systems design')`;

  // Duplicate applied to Role A AND Role B
  const appSourceA = uid();
  const appSourceB = uid();
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status, rank_score, recruiter_notes)
    values (${appSourceA}, ${ownerId}, ${org.orgId}, ${roleA}, ${sourceId}, 'offer', 92, 'Exceptional communication')`;
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status, rank_score, recruiter_notes)
    values (${appSourceB}, ${ownerId}, ${org.orgId}, ${roleB}, ${sourceId}, 'ranked', 78, 'Applied to platform team')`;

  // Source has a task
  const taskId = uid();
  await sql`
    insert into recruiting_tasks (id, org_id, title, candidate_id, assignee_id, creator_id)
    values (${taskId}, ${org.orgId}, 'Conduct VP Round', ${sourceId}, ${ownerId}, ${ownerId})`;

  // Source has a note
  const noteId = uid();
  await sql`
    insert into candidate_notes (id, org_id, candidate_id, author_id, author_name, content)
    values (${noteId}, ${org.orgId}, ${sourceId}, ${ownerId}, 'Lead Recruiter', 'Notice period 30 days buyout possible')`;

  // Execute merge
  const mergeResult = await mergeCandidates({
    orgId: org.orgId,
    canonicalId,
    sourceId,
    mergedBy: ownerId,
    expectedCanonicalVersion: 1,
    expectedSourceVersion: 1,
  });

  assert.equal(mergeResult.success, true);
  assert.equal(mergeResult.newCanonicalVersion, 2);

  // 1. Verify canonical profile received merged phone and linkedin
  const updatedCanonical = await sql<{
    phone: string;
    linkedin_url: string;
    status: string;
    version: number;
  }>`select phone, linkedin_url, status, version from candidates where id = ${canonicalId}`;
  assert.equal(updatedCanonical[0]!.phone, "+91 9988776655");
  assert.equal(updatedCanonical[0]!.linkedin_url, "https://linkedin.com/in/rajeshkumar-cloud");
  assert.equal(updatedCanonical[0]!.version, 2);

  // 2. Verify source candidate is marked merged
  const updatedSource = await sql<{ status: string; merged_into_id: string }>`
    select status, merged_into_id from candidates where id = ${sourceId}`;
  assert.equal(updatedSource[0]!.status, "merged");
  assert.equal(updatedSource[0]!.merged_into_id, canonicalId);

  // 3. Verify overlapping application on Role A was merged cleanly
  const remainingAppA = await sql<{ rank_score: number; recruiter_notes: string }>`
    select rank_score, recruiter_notes from applications where id = ${appA}`;
  assert.equal(remainingAppA[0]!.rank_score, 92); // highest score kept
  assert.ok(remainingAppA[0]!.recruiter_notes.includes("Solid systems design"));
  assert.ok(remainingAppA[0]!.recruiter_notes.includes("Exceptional communication"));

  // 4. Verify Role B application was re-pointed to canonical
  const transferredAppB = await sql<{ candidate_id: string }>`
    select candidate_id from applications where id = ${appSourceB}`;
  assert.equal(transferredAppB[0]!.candidate_id, canonicalId);

  // 5. Verify task and note were re-pointed to canonical
  const reTask = await sql<{
    candidate_id: string;
  }>`select candidate_id from recruiting_tasks where id = ${taskId}`;
  assert.equal(reTask[0]!.candidate_id, canonicalId);

  const reNote = await sql<{
    candidate_id: string;
  }>`select candidate_id from candidate_notes where id = ${noteId}`;
  assert.equal(reNote[0]!.candidate_id, canonicalId);
});

// ============================================================================
// 5. COLLABORATIVE NOTES & TASKS
// ============================================================================

test("Collaborative Notes: authoring, visibility, pinned items, and mentions", async () => {
  const sql = await getSql();
  const ownerId = `owner-${uid()}`;
  const recruiterId = `recruiter-${uid()}`;
  const interviewerId = `interviewer-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Reliance AI Center");

  const candId = uid();
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, resume_text)
    values (${candId}, ${ownerId}, ${org.orgId}, 'Ananya Gupta', 'ananya@example.com', 'LLM Engineer')`;

  // Public team note with mentions
  const note1 = await addCandidateNote({
    orgId: org.orgId,
    candidateId: candId,
    authorId: recruiterId,
    authorName: "Kavita Rao",
    authorRole: "Technical Recruiter",
    content: "Screen passed with flying colors! @rajesh check her PyTorch projects.",
    visibility: "team",
    pinned: true,
  });

  assert.equal(note1.pinned, true);
  assert.deepEqual(note1.mentions, ["rajesh"]);

  // Private note from recruiter
  await addCandidateNote({
    orgId: org.orgId,
    candidateId: candId,
    authorId: recruiterId,
    authorName: "Kavita Rao",
    authorRole: "Technical Recruiter",
    content: "Candidate holds competing Google offer at 42 LPA. We must match fast.",
    visibility: "private",
  });

  // Query as author: both visible
  const authorNotes = await getCandidateNotes({
    orgId: org.orgId,
    candidateId: candId,
    viewerUserId: recruiterId,
  });
  assert.equal(authorNotes.length, 2);

  // Query as external interviewer: private note is hidden
  const interviewerNotes = await getCandidateNotes({
    orgId: org.orgId,
    candidateId: candId,
    viewerUserId: interviewerId,
    viewerRole: "interviewer",
  });
  assert.equal(interviewerNotes.length, 1);
  assert.equal(interviewerNotes[0]!.id, note1.id);
});

test("Actionable Tasks: creation, priority, completion and filtering", async () => {
  const sql = await getSql();
  const ownerId = `owner-${uid()}`;
  const recruiterId = `recruiter-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Reliance Strategic Hiring");

  const candId = uid();
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, resume_text)
    values (${candId}, ${ownerId}, ${org.orgId}, 'Vikram Nair', 'vikram@example.com', 'Cloud Architect')`;

  const task = await createRecruitingTask({
    orgId: org.orgId,
    title: "Schedule Offer Negotiation Call",
    description: "Discuss joining bonus and stock options",
    candidateId: candId,
    assigneeId: recruiterId,
    creatorId: ownerId,
    priority: "urgent",
    dueDate: new Date(Date.now() + 86400000).toISOString(),
  });

  assert.equal(task.priority, "urgent");
  assert.equal(task.status, "pending");

  // Query tasks for recruiter
  const myTasks = await getRecruitingTasks({
    orgId: org.orgId,
    assigneeId: recruiterId,
    status: "pending",
  });
  assert.equal(myTasks.length, 1);
  assert.equal(myTasks[0]!.title, "Schedule Offer Negotiation Call");

  // Complete task
  const completed = await updateTaskStatus({
    orgId: org.orgId,
    taskId: task.id,
    status: "completed",
    userId: recruiterId,
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedBy, recruiterId);
  assert.ok(completed.completedAt);
});

// ============================================================================
// 6. CONFLICT-SAFE UPDATES (OPTIMISTIC CONCURRENCY CONTROL)
// ============================================================================

test("Conflict-Safe Updates: optimistic locking succeeds on version match and detects concurrent collision", async () => {
  const sql = await getSql();
  const ownerId = `owner-${uid()}`;
  const org = await ensureUserOrg(ownerId, "Reliance Tech Operations");

  const roleId = uid();
  await sql`
    insert into roles (id, user_id, org_id, company_name, company_stage, title, version)
    values (${roleId}, ${ownerId}, ${org.orgId}, 'Jio Enterprise', 'enterprise', 'Site Reliability Engineer', 1)`;

  // Recruiter 1 updates role with matching version (version 1 -> 2)
  const res1 = await updateWithOptimisticLock({
    table: "roles",
    id: roleId,
    expectedVersion: 1,
    userId: ownerId,
    setClauses: { title: "Staff Site Reliability Engineer" },
  });

  assert.equal(res1.updated, true);
  assert.equal(res1.newVersion, 2);

  // Recruiter 2 attempts to update role still thinking it is version 1 (concurrent collision!)
  await assert.rejects(
    async () => {
      await updateWithOptimisticLock({
        table: "roles",
        id: roleId,
        expectedVersion: 1, // Stale version!
        userId: ownerId,
        setClauses: { title: "Lead SRE & Platform Architect" },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ConcurrencyConflictError);
      assert.equal(err.code, "CONCURRENCY_CONFLICT");
      assert.equal(err.status, 409);
      assert.equal(err.expectedVersion, 1);
      assert.equal(err.currentVersion, 2);
      assert.equal(err.currentSnapshot.title, "Staff Site Reliability Engineer");
      return true;
    },
  );
});
