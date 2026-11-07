import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg, assertOrgMember } from "../server/org.server.ts";
import { addOrgMember, assertOrgPermission } from "../server/rbac.server.ts";
import { loadRoleWorkspaceForUser, loadRoleOrThrow, loadApplicationBundle } from "../../../lib/recruiting/api.ts";
import {
  assignUserToRole,
  assignUserToApplication,
  getRoleAssignments,
  getApplicationAssignments,
} from "../server/assignments.server.ts";
import { getSharedCandidatePool, getCandidateFullDossier } from "../server/talent-pool.server.ts";
import {
  addCandidateNote,
  getCandidateNotes,
  createRecruitingTask,
  updateTaskStatus,
  getRecruitingTasks,
} from "../server/collaboration.server.ts";
import { updateWithOptimisticLock } from "../../pipeline/server/concurrency.server.ts";
import {
  recordStageTransition,
  recordPlacement,
  updatePlacementLifecycle,
  getFunnelAnalytics,
} from "../../analytics/server/funnel-analytics.server.ts";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "../../analytics/server/backup.server.ts";
import { loadPublicShareView } from "../api/share.ts";
import { loadScreenByApplicationForUser } from "../api/screen-session.ts";
import { deepenRoleTopN } from "../../ranking/server/deepen.server.ts";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test("Multi-Tenant & Multi-Recruiter Isolation Suite", async (t) => {
  const sql = await getSql();

  // -------------------------------------------------------------------------
  // Setup 2 Organizations with 2 Recruiters Each
  // -------------------------------------------------------------------------
  const rec1A = uid("rec1A_jio"); // Owner/Lead of Org 1
  const rec1B = uid("rec1B_jio"); // Recruiter of Org 1
  const rec2A = uid("rec2A_tata"); // Owner/Lead of Org 2
  const rec2B = uid("rec2B_tata"); // Recruiter of Org 2

  const org1 = await ensureUserOrg(rec1A, "Reliance Jio Infocomm Ltd");
  await addOrgMember({
    orgId: org1.orgId,
    userId: rec1B,
    role: "recruiter",
    actorUserId: rec1A,
    title: "Technical Recruiter",
    invitedEmail: "rec1b@jio.com",
  });

  const org2 = await ensureUserOrg(rec2A, "Tata Digital Pvt Ltd");
  await addOrgMember({
    orgId: org2.orgId,
    userId: rec2B,
    role: "recruiter",
    actorUserId: rec2A,
    title: "Senior Recruiter",
    invitedEmail: "rec2b@tatadigital.com",
  });

  // Create Role in Org 1 by Recruiter 1A
  const role1Id = uid("role_jio");
  await sql`
    insert into roles (
      id, org_id, user_id, title, company_name, company_stage, location, work_mode,
      compensation_band, stack, must_haves, nice_to_haves, jd_text, status
    ) values (
      ${role1Id}, ${org1.orgId}, ${rec1A}, 'Principal Backend Architect', 'Reliance Jio',
      'growth', 'Navi Mumbai', 'onsite', '60-80 LPA', '["Go","Kafka","Kubernetes"]',
      '["10+ yrs backend","Distributed systems"]', '["Telecom scale"]',
      'Lead backend architecture for Jio 5G services.', 'open'
    )`;

  // Create Candidate and Application in Org 1
  const cand1Id = uid("cand_jio");
  const app1Id = uid("app_jio");
  await sql`
    insert into candidates (
      id, org_id, user_id, full_name, email, phone, location, current_title, current_company,
      years_experience, resume_text, parsed_json
    ) values (
      ${cand1Id}, ${org1.orgId}, ${rec1A}, 'Aarav Sharma', 'aarav@example.com', '+919876543210',
      'Mumbai', 'Staff Engineer', 'Paytm', 11, 'Resume for distributed systems architect...', '{}'
    )`;
  await sql`
    insert into applications (
      id, org_id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json
    ) values (
      ${app1Id}, ${org1.orgId}, ${rec1A}, ${role1Id}, ${cand1Id}, 'shortlisted', 88,
      '{"score": 88, "summary": "Strong distributed systems background"}'
    )`;

  // Create Screen for Org 1 application
  const screen1Id = uid("screen_jio");
  await sql`
    insert into screens (
      id, org_id, user_id, application_id, questions_json, answers_json, evaluation_json, status, invite_token
    ) values (
      ${screen1Id}, ${org1.orgId}, ${rec1A}, ${app1Id}, '[]', '[]', '{}', 'draft', ${uid("inv")}
    )`;

  // Create Role in Org 2 by Recruiter 2A
  const role2Id = uid("role_tata");
  const cand2Id = uid("cand_tata");
  const app2Id = uid("app_tata");
  await sql`
    insert into roles (
      id, org_id, user_id, title, company_name, company_stage, location, work_mode,
      compensation_band, stack, must_haves, nice_to_haves, jd_text, status
    ) values (
      ${role2Id}, ${org2.orgId}, ${rec2A}, 'Lead iOS Engineer', 'Tata Neu',
      'growth', 'Bengaluru', 'hybrid', '45-60 LPA', '["Swift","SwiftUI"]',
      '["7+ yrs iOS","Superapp scale"]', '["Fintech"]',
      'Build core shopping experience for Tata Neu superapp.', 'open'
    )`;
  await sql`
    insert into candidates (
      id, org_id, user_id, full_name, email, phone, location, current_title, current_company,
      years_experience, resume_text, parsed_json
    ) values (
      ${cand2Id}, ${org2.orgId}, ${rec2A}, 'Priya Patel', 'priya@example.com', '+919123456789',
      'Bengaluru', 'Senior iOS Dev', 'Flipkart', 8, 'Resume for iOS superapp engineer...', '{}'
    )`;
  await sql`
    insert into applications (
      id, org_id, user_id, role_id, candidate_id, pipeline_status, rank_score, rank_json
    ) values (
      ${app2Id}, ${org2.orgId}, ${rec2A}, ${role2Id}, ${cand2Id}, 'shortlisted', 85,
      '{"score": 85, "summary": "Strong iOS performance"}'
    )`;

  // =========================================================================
  // SUBTEST 1: Same Organization Collaboration (Recruiter 1A & Recruiter 1B)
  // =========================================================================
  await t.test(
    "Recruiter 1B can access shared workspace, candidates, and role created by 1A",
    async () => {
      // 1B loads the role workspace created by 1A
      const workspace = await loadRoleWorkspaceForUser(rec1B, role1Id);
      assert.equal(workspace.role.id, role1Id);
      assert.equal(workspace.role.title, "Principal Backend Architect");
      assert.equal(workspace.applications.length, 1);
      assert.equal(workspace.applications[0]?.candidate.fullName, "Aarav Sharma");

      // 1B checks shared talent pool for Org 1
      const pool = await getSharedCandidatePool({ orgId: org1.orgId });
      assert.ok(pool.candidates.some((c) => c.id === cand1Id));
      assert.ok(
        !pool.candidates.some((c) => c.id === cand2Id),
        "Org 1 talent pool must NOT contain Org 2 candidate",
      );

      // 1B views full candidate dossier
      const dossier = await getCandidateFullDossier(org1.orgId, cand1Id, rec1B);
      assert.ok(dossier);
      assert.equal(dossier.candidate.fullName, "Aarav Sharma");
      assert.equal(dossier.applications.length, 1);

      // 1A assigns 1B to the role
      const assignment = await assignUserToRole({
        orgId: org1.orgId,
        roleId: role1Id,
        userId: rec1B,
        assignmentType: "recruiter",
        assignedBy: rec1A,
      });
      assert.equal(assignment.roleId, role1Id);
      assert.equal(assignment.userId, rec1B);

      const roleAssignments = await getRoleAssignments(org1.orgId, role1Id);
      assert.ok(roleAssignments.some((a) => a.userId === rec1B));

      // 1B adds a collaborative note
      const note = await addCandidateNote({
        orgId: org1.orgId,
        candidateId: cand1Id,
        applicationId: app1Id,
        authorId: rec1B,
        authorName: "Recruiter 1B",
        content: "Cleared initial screening, strong fit for high-throughput telecom backend.",
        visibility: "team",
      });
      assert.equal(note.candidateId, cand1Id);

      const notes = await getCandidateNotes({
        orgId: org1.orgId,
        candidateId: cand1Id,
        viewerUserId: rec1A,
      });
      assert.equal(notes.length, 1);
      assert.equal(notes[0]?.authorId, rec1B);

      // 1B creates a recruiting task assigned to 1A
      const task = await createRecruitingTask({
        orgId: org1.orgId,
        title: "Review tech screen evaluation",
        candidateId: cand1Id,
        applicationId: app1Id,
        roleId: role1Id,
        assigneeId: rec1A,
        creatorId: rec1B,
        priority: "high",
      });
      assert.equal(task.assigneeId, rec1A);

      const tasks = await getRecruitingTasks({ orgId: org1.orgId, candidateId: cand1Id });
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]?.id, task.id);

      // 1B updates with optimistic lock
      const optLock = await updateWithOptimisticLock({
        table: "candidates",
        id: cand1Id,
        expectedVersion: 1,
        userId: rec1B,
        orgId: org1.orgId,
        setClauses: { current_company: "Paytm Payments Bank" },
      });
      assert.equal(optLock.updated, true);
      assert.equal(optLock.newVersion, 2);

      // 1B records stage transition & placement commercials
      const transition = await recordStageTransition({
        orgId: org1.orgId,
        applicationId: app1Id,
        toStage: "offered",
        actorUserId: rec1B,
        reason: "Bar raiser interview cleared",
      });
      assert.equal(transition.toStage, "offered");

      const placement = await recordPlacement({
        orgId: org1.orgId,
        roleId: role1Id,
        candidateId: cand1Id,
        applicationId: app1Id,
        offeredCtc: 7000000,
        feePercentage: 15,
        currency: "INR",
      });
      assert.equal(placement.grossPlacementFee, 1050000);

      const updatedPlacement = await updatePlacementLifecycle({
        orgId: org1.orgId,
        applicationId: app1Id,
        joiningStatus: "joined",
        retentionStatus: "retained_90d",
        retentionDays: 90,
      });
      assert.equal(updatedPlacement.joiningStatus, "joined");

      // 1B can load the screen for Org 1 application
      const screen = await loadScreenByApplicationForUser(rec1B, app1Id);
      assert.equal(screen.id, app1Id);
      assert.equal(screen.candidateName, "Aarav Sharma");
    },
  );

  // =========================================================================
  // SUBTEST 2: Cross-Tenant Isolation (Org 2 cannot access or mutate Org 1)
  // =========================================================================
  await t.test(
    "Recruiter 2A cannot read or mutate Org 1 role, candidate or applications",
    async () => {
      // 2A attempts to load Org 1's role workspace -> must throw "Role not found"
      await assert.rejects(
        async () => {
          await loadRoleWorkspaceForUser(rec2A, role1Id);
        },
        /Role not found/i,
        "Recruiter 2A should not be able to load Org 1 role workspace",
      );

      // 2A attempts loadRoleOrThrow for Org 1's role -> must throw "Role not found"
      await assert.rejects(
        async () => {
          await loadRoleOrThrow(rec2A, role1Id);
        },
        /Role not found/i,
        "loadRoleOrThrow must reject access to another tenant's role",
      );

      // 2A attempts loadApplicationBundle for Org 1's application -> must throw "Application not found"
      await assert.rejects(
        async () => {
          await loadApplicationBundle(rec2A, app1Id);
        },
        /Application not found/i,
        "loadApplicationBundle must reject access to another tenant's application",
      );

      // 2A attempts loadScreenByApplicationForUser for Org 1's application -> must reject
      await assert.rejects(
        async () => {
          await loadScreenByApplicationForUser(rec2A, app1Id);
        },
        /Not a member of this organization|Application not found/i,
        "Org 2 cannot view screen session for Org 1 application",
      );

      // 2A attempts to assign a role member to Org 1's role -> must reject
      await assert.rejects(
        async () => {
          await assignUserToRole({
            orgId: org2.orgId,
            roleId: role1Id, // Cross-tenant IDOR attack
            userId: rec2B,
            assignmentType: "recruiter",
            assignedBy: rec2A,
          });
        },
        /Role not found/i,
        "Org 2 cannot assign users to Org 1 role",
      );

      // 2A attempts to assign a user to Org 1's application -> must reject
      await assert.rejects(
        async () => {
          await assignUserToApplication({
            orgId: org2.orgId,
            applicationId: app1Id, // Cross-tenant IDOR attack
            userId: rec2B,
            assignmentType: "reviewer",
            assignedBy: rec2A,
          });
        },
        /Application not found/i,
        "Org 2 cannot assign users to Org 1 application",
      );

      // 2A attempts to add candidate note to Org 1's candidate -> must reject
      await assert.rejects(
        async () => {
          await addCandidateNote({
            orgId: org2.orgId,
            candidateId: cand1Id, // Cross-tenant IDOR attack
            authorId: rec2A,
            authorName: "Recruiter 2A",
            content: "Spam note",
          });
        },
        /Candidate not found/i,
        "Org 2 cannot add notes to Org 1 candidate",
      );

      // 2A attempts to create task on Org 1's candidate -> must reject
      await assert.rejects(
        async () => {
          await createRecruitingTask({
            orgId: org2.orgId,
            title: "Malicious task",
            candidateId: cand1Id, // Cross-tenant IDOR attack
            assigneeId: rec2A,
            creatorId: rec2A,
          });
        },
        /Candidate not found/i,
        "Org 2 cannot create task on Org 1 candidate",
      );

      // 2A attempts optimistic lock update on Org 1's candidate -> must reject
      await assert.rejects(
        async () => {
          await updateWithOptimisticLock({
            table: "candidates",
            id: cand1Id,
            expectedVersion: 2,
            userId: rec2A,
            orgId: org2.orgId,
            setClauses: { current_company: "Tata Malicious Overwrite" },
          });
        },
        /Record not found/i,
        "Optimistic lock must enforce org boundary on select and update",
      );

      // 2A attempts optimistic lock update on Org 1's application -> must reject
      await assert.rejects(
        async () => {
          await updateWithOptimisticLock({
            table: "applications",
            id: app1Id,
            expectedVersion: 1,
            userId: rec2A,
            orgId: org2.orgId,
            setClauses: { pipeline_status: "rejected" },
          });
        },
        /Record not found/i,
        "Optimistic lock must reject application mutation from another tenant",
      );

      // 2A attempts to record placement on Org 1's application -> must reject
      await assert.rejects(
        async () => {
          await recordPlacement({
            orgId: org2.orgId,
            roleId: role1Id,
            candidateId: cand1Id,
            applicationId: app1Id,
            offeredCtc: 5000000,
          });
        },
        /Application .* not found/i,
        "Org 2 cannot record placement for Org 1 application",
      );

      // 2A attempts to update placement lifecycle on Org 1's application -> must reject
      await assert.rejects(
        async () => {
          await updatePlacementLifecycle({
            orgId: org2.orgId,
            applicationId: app1Id,
            joiningStatus: "reneged",
          });
        },
        /Placement for application .* not found/i,
        "Org 2 cannot alter placement lifecycle of Org 1 application",
      );
    },
  );

  // =========================================================================
  // SUBTEST 3: Talent Pool, Search, and Analytics Isolation
  // =========================================================================
  await t.test("Shared candidate pool & analytics isolate tenants completely", async () => {
    // Org 1 pool has candidate 1, not candidate 2
    const org1Pool = await getSharedCandidatePool({ orgId: org1.orgId });
    assert.ok(org1Pool.candidates.some((c) => c.id === cand1Id));
    assert.ok(!org1Pool.candidates.some((c) => c.id === cand2Id));

    // Org 2 pool has candidate 2, not candidate 1
    const org2Pool = await getSharedCandidatePool({ orgId: org2.orgId });
    assert.ok(org2Pool.candidates.some((c) => c.id === cand2Id));
    assert.ok(!org2Pool.candidates.some((c) => c.id === cand1Id));

    // Funnel analytics for Org 1: includes placement financials for Org 1 only
    const org1Analytics = await getFunnelAnalytics({ orgId: org1.orgId });
    assert.equal(org1Analytics.grossMargin.totalPlacements, 1);
    assert.equal(org1Analytics.grossMargin.totalGrossPlacementFeeInr, 1050000);

    // Funnel analytics for Org 2: 0 placements
    const org2Analytics = await getFunnelAnalytics({ orgId: org2.orgId });
    assert.equal(org2Analytics.grossMargin.totalPlacements, 0);
  });

  // =========================================================================
  // SUBTEST 4: Backups & Restores Tenant Isolation
  // =========================================================================
  await t.test("Backup export and restore enforce strict tenant boundaries", async () => {
    // Recruiter 1A creates backup for Org 1
    const backup1 = await createWorkspaceBackup({
      userId: rec1A,
      orgId: org1.orgId,
    });
    assert.ok(backup1.roles.some((r) => r.id === role1Id));
    assert.ok(backup1.candidates.some((c) => c.id === cand1Id));
    assert.ok(
      !backup1.roles.some((r) => r.id === role2Id),
      "Org 1 backup must not contain Org 2 roles",
    );
    assert.ok(
      !backup1.candidates.some((c) => c.id === cand2Id),
      "Org 1 backup must not contain Org 2 candidates",
    );

    // Recruiter 2A creates backup for Org 2
    const backup2 = await createWorkspaceBackup({
      userId: rec2A,
      orgId: org2.orgId,
    });
    assert.ok(backup2.roles.some((r) => r.id === role2Id));
    assert.ok(backup2.candidates.some((c) => c.id === cand2Id));
    assert.ok(
      !backup2.roles.some((r) => r.id === role1Id),
      "Org 2 backup must not contain Org 1 roles",
    );
    assert.ok(
      !backup2.candidates.some((c) => c.id === cand1Id),
      "Org 2 backup must not contain Org 1 candidates",
    );

    // Malicious restore attack: Recruiter 2A attempts to restore a backup that injects Org 1's role ID
    const maliciousPayload = {
      version: backup2.version,
      createdAt: backup2.createdAt,
      userId: rec2A,
      roles: [
        ...backup2.roles,
        {
          id: role1Id, // Org 1's role!
          title: "Hijacked Role",
          company_name: "Tata Hijack",
          company_stage: "seed",
          location: "Bengaluru",
          work_mode: "remote",
        },
      ],
      rubricVersions: backup2.rubricVersions,
      candidates: backup2.candidates,
      applications: backup2.applications,
      screens: backup2.screens,
      auditEvents: backup2.auditEvents,
      stats: {
        ...backup2.stats,
        rolesCount: backup2.roles.length + 1,
      },
    };
    // Recompute valid cryptographic checksum so signature verification passes and logical boundary check is tested
    const json = JSON.stringify(maliciousPayload, Object.keys(maliciousPayload).sort());
    const validChecksum = createHash("sha256").update(json).digest("hex");
    const maliciousBackup = {
      ...maliciousPayload,
      checksum: validChecksum,
    };

    await assert.rejects(
      async () => {
        await restoreWorkspaceBackup({
          userId: rec2A,
          orgId: org2.orgId,
          backup: maliciousBackup,
          mode: "overwrite",
        });
      },
      /Restore rejected: backup contains role IDs belonging to another organization/i,
      "Cross-tenant restore overwrite must be rejected",
    );
  });

  // =========================================================================
  // SUBTEST 5: Public Share Link Access & Token Safety
  // =========================================================================
  await t.test("Public share links require authentic, unguessable tokens", async () => {
    // Seed a valid share record for Org 1
    const shareToken = uid("tok_public");
    const shareId = uid("share_jio");
    const payload = {
      id: shareId,
      token: shareToken,
      kind: "slate",
      title: "Shortlist · Reliance Jio · Backend Architect",
      roleTitle: "Principal Backend Architect",
      companyName: "Reliance Jio",
      companyStage: "growth",
      location: "Navi Mumbai",
      workMode: "onsite",
      message: "Here is your vetted candidate slate.",
      recipientName: "Hiring Manager",
      recipientEmail: "hm@jio.com",
      exportedAt: new Date().toISOString(),
      candidates: [
        {
          applicationId: app1Id,
          candidateName: "Aarav Sharma",
          headline: "Staff Engineer · Paytm",
          currentTitle: "Staff Engineer",
          currentCompany: "Paytm",
          location: "Mumbai",
          rankScore: 88,
          fitLabel: "Strong match",
          rankSummary: "Strong distributed systems background",
          pipelineStatus: "shortlisted",
          screenVerdict: "Recommended",
        },
      ],
    };

    await sql`
      insert into client_shares (
        id, org_id, user_id, role_id, token, kind, title, recipient_email, recipient_name,
        message, payload_json, expires_at
      ) values (
        ${shareId}, ${org1.orgId}, ${rec1A}, ${role1Id}, ${shareToken}, 'slate',
        'Shortlist · Reliance Jio', 'hm@jio.com', 'Hiring Manager',
        'Candidate slate', ${JSON.stringify(payload)}, now() + interval '14 days'
      )`;

    // Public fetch with valid token succeeds
    const publicView = await loadPublicShareView(shareToken);
    assert.equal(publicView.roleTitle, "Principal Backend Architect");
    assert.equal(publicView.candidates.length, 1);
    assert.equal(publicView.candidates[0]?.candidateName, "Aarav Sharma");

    // Invalid / non-existent token throws error
    await assert.rejects(
      async () => {
        await loadPublicShareView("invalid_random_token_12345");
      },
      /This share link is invalid or has expired/i,
      "Invalid share token must be rejected",
    );

    // Expired token throws error
    const expiredToken = uid("tok_expired");
    await sql`
      insert into client_shares (
        id, org_id, user_id, role_id, token, kind, title, recipient_email, recipient_name,
        message, payload_json, expires_at
      ) values (
        ${uid("sh_exp")}, ${org1.orgId}, ${rec1A}, ${role1Id}, ${expiredToken}, 'slate',
        'Expired share', 'hm@jio.com', 'Hiring Manager',
        'Expired', ${JSON.stringify(payload)}, now() - interval '1 day'
      )`;

    await assert.rejects(
      async () => {
        await loadPublicShareView(expiredToken);
      },
      /This share link has expired/i,
      "Expired share token must be rejected",
    );
  });
});
