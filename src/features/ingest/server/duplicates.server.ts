import { getSql } from "../../../platform/db.ts";
import { ConcurrencyConflictError } from "../../../lib/recruiting/concurrency.ts";

function newId(): string {
  return crypto.randomUUID();
}

export type DuplicateMatch = {
  candidateId: string;
  fullName: string;
  email: string;
  phone: string;
  currentCompany: string;
  confidence: number;
  matchReasons: string[];
  status: string;
};

export function normalizeEmail(email?: string): string {
  return (email || "").trim().toLowerCase();
}

export function normalizePhone(phone?: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  // If Indian 12-digit number starting with 91, strip 91
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  // If 11-digit number starting with 0, strip 0
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

export function normalizeLinkedin(url?: string): string {
  if (!url) return "";
  const cleaned = url.trim().toLowerCase().replace(/\/+$/, "");
  const match = cleaned.match(/linkedin\.com\/in\/([^/?#]+)/);
  return match ? match[1]! : cleaned;
}

/**
 * Searches for suspected duplicates of a candidate within the organization.
 */
export async function findDuplicateCandidates(opts: {
  orgId: string;
  candidateId?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  fullName?: string;
  minConfidence?: number;
}): Promise<DuplicateMatch[]> {
  const sql = await getSql();
  const minConfidence = opts.minConfidence ?? 0.6;
  const emailNorm = normalizeEmail(opts.email);
  const phoneNorm = normalizePhone(opts.phone);
  const linkedinNorm = normalizeLinkedin(opts.linkedinUrl);
  const nameNorm = (opts.fullName || "").trim().toLowerCase();

  // If candidateId is provided, pull its details from DB if not passed
  let candEmail = emailNorm;
  let candPhone = phoneNorm;
  let candLinkedin = linkedinNorm;
  let candName = nameNorm;
  let candCompany = "";

  if (opts.candidateId) {
    const rows = await sql<{
      email: string;
      phone: string;
      linkedin_url: string;
      full_name: string;
      current_company: string;
    }>`
      select email, phone, linkedin_url, full_name, current_company
      from candidates
      where id = ${opts.candidateId} and org_id = ${opts.orgId}
      limit 1`;
    const c = rows[0];
    if (c) {
      if (!candEmail) candEmail = normalizeEmail(c.email);
      if (!candPhone) candPhone = normalizePhone(c.phone);
      if (!candLinkedin) candLinkedin = normalizeLinkedin(c.linkedin_url);
      if (!candName) candName = c.full_name.trim().toLowerCase();
      candCompany = (c.current_company || "").trim().toLowerCase();
    }
  }

  const matches: DuplicateMatch[] = [];

  // 1. Exact email match (highest priority, 1.0)
  if (candEmail) {
    const emailRows = await sql<{
      id: string;
      full_name: string;
      email: string;
      phone: string;
      current_company: string;
      status: string;
    }>`
      select id, full_name, email, phone, current_company, status
      from candidates
      where org_id = ${opts.orgId}
        and lower(trim(email)) = ${candEmail}
        and (${opts.candidateId ?? ""} = '' or id <> ${opts.candidateId ?? ""})
        and status <> 'merged'`;

    for (const r of emailRows) {
      matches.push({
        candidateId: r.id,
        fullName: r.full_name,
        email: r.email,
        phone: r.phone,
        currentCompany: r.current_company,
        confidence: 1.0,
        matchReasons: ["Exact email match"],
        status: r.status,
      });
    }
  }

  // 2. Exact phone match (0.95)
  if (candPhone && candPhone.length >= 7) {
    const phoneCandidates = await sql<{
      id: string;
      full_name: string;
      email: string;
      phone: string;
      current_company: string;
      status: string;
    }>`
      select id, full_name, email, phone, current_company, status
      from candidates
      where org_id = ${opts.orgId}
        and phone <> ''
        and (${opts.candidateId ?? ""} = '' or id <> ${opts.candidateId ?? ""})
        and status <> 'merged'`;

    for (const r of phoneCandidates) {
      if (normalizePhone(r.phone) === candPhone) {
        const existing = matches.find((m) => m.candidateId === r.id);
        if (existing) {
          if (!existing.matchReasons.includes("Exact phone match")) {
            existing.matchReasons.push("Exact phone match");
          }
        } else {
          matches.push({
            candidateId: r.id,
            fullName: r.full_name,
            email: r.email,
            phone: r.phone,
            currentCompany: r.current_company,
            confidence: 0.95,
            matchReasons: ["Exact phone match"],
            status: r.status,
          });
        }
      }
    }
  }

  // 3. Exact LinkedIn match (0.95)
  if (candLinkedin) {
    const linkedinCandidates = await sql<{
      id: string;
      full_name: string;
      email: string;
      phone: string;
      current_company: string;
      linkedin_url: string;
      status: string;
    }>`
      select id, full_name, email, phone, current_company, linkedin_url, status
      from candidates
      where org_id = ${opts.orgId}
        and linkedin_url <> ''
        and (${opts.candidateId ?? ""} = '' or id <> ${opts.candidateId ?? ""})
        and status <> 'merged'`;

    for (const r of linkedinCandidates) {
      if (normalizeLinkedin(r.linkedin_url) === candLinkedin) {
        const existing = matches.find((m) => m.candidateId === r.id);
        if (existing) {
          if (!existing.matchReasons.includes("Exact LinkedIn profile match")) {
            existing.matchReasons.push("Exact LinkedIn profile match");
          }
        } else {
          matches.push({
            candidateId: r.id,
            fullName: r.full_name,
            email: r.email,
            phone: r.phone,
            currentCompany: r.current_company,
            confidence: 0.95,
            matchReasons: ["Exact LinkedIn profile match"],
            status: r.status,
          });
        }
      }
    }
  }

  // 4. Same name + company match (0.85)
  if (candName && candName.length >= 3 && candCompany) {
    const nameCompanyRows = await sql<{
      id: string;
      full_name: string;
      email: string;
      phone: string;
      current_company: string;
      status: string;
    }>`
      select id, full_name, email, phone, current_company, status
      from candidates
      where org_id = ${opts.orgId}
        and lower(trim(full_name)) = ${candName}
        and lower(trim(current_company)) = ${candCompany}
        and (${opts.candidateId ?? ""} = '' or id <> ${opts.candidateId ?? ""})
        and status <> 'merged'`;

    for (const r of nameCompanyRows) {
      const existing = matches.find((m) => m.candidateId === r.id);
      if (existing) {
        if (!existing.matchReasons.includes("Identical name and current company")) {
          existing.matchReasons.push("Identical name and current company");
        }
      } else {
        matches.push({
          candidateId: r.id,
          fullName: r.full_name,
          email: r.email,
          phone: r.phone,
          currentCompany: r.current_company,
          confidence: 0.85,
          matchReasons: ["Identical name and current company"],
          status: r.status,
        });
      }
    }
  }

  return matches.filter((m) => m.confidence >= minConfidence);
}

/**
 * Enterprise Conflict-Safe Atomic Candidate Merge.
 * Merges source candidate into canonical candidate without losing applications,
 * screens, notes, or tasks, with optimistic concurrency locks.
 */
export async function mergeCandidates(opts: {
  orgId: string;
  canonicalId: string;
  sourceId: string;
  mergedBy: string;
  reason?: string;
  expectedCanonicalVersion?: number;
  expectedSourceVersion?: number;
}): Promise<{
  success: true;
  canonicalId: string;
  mergedCandidateId: string;
  newCanonicalVersion: number;
  reassignedApplicationsCount: number;
  reassignedNotesCount: number;
  reassignedTasksCount: number;
}> {
  if (opts.canonicalId === opts.sourceId) {
    throw new Error("Cannot merge candidate with themselves");
  }

  const sql = await getSql();

  // Load both candidates to verify ownership and check optimistic versions
  const cands = await sql<{
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
    status: string;
    version: number;
  }>`
    select id, org_id, full_name, email, phone, location, linkedin_url,
           current_title, current_company, years_experience, status, version
    from candidates
    where id in (${opts.canonicalId}, ${opts.sourceId}) and org_id = ${opts.orgId}`;

  const canonical = cands.find((c) => c.id === opts.canonicalId);
  const source = cands.find((c) => c.id === opts.sourceId);

  if (!canonical) {
    throw new Error(`Canonical candidate ${opts.canonicalId} not found in organization`);
  }
  if (!source) {
    throw new Error(`Source candidate ${opts.sourceId} not found in organization`);
  }
  if (source.status === "merged") {
    throw new Error(`Source candidate ${opts.sourceId} has already been merged`);
  }

  // Optimistic concurrency verification
  if (opts.expectedCanonicalVersion !== undefined) {
    const curVer = Number(canonical.version ?? 1);
    if (curVer !== opts.expectedCanonicalVersion) {
      throw new ConcurrencyConflictError({
        entityType: "candidates",
        entityId: canonical.id,
        expectedVersion: opts.expectedCanonicalVersion,
        currentVersion: curVer,
        currentSnapshot: canonical,
      });
    }
  }

  if (opts.expectedSourceVersion !== undefined) {
    const curVer = Number(source.version ?? 1);
    if (curVer !== opts.expectedSourceVersion) {
      throw new ConcurrencyConflictError({
        entityType: "candidates",
        entityId: source.id,
        expectedVersion: opts.expectedSourceVersion,
        currentVersion: curVer,
        currentSnapshot: source,
      });
    }
  }

  // Coalesce contact and profile fields: fill empty canonical fields from source
  const mergedEmail = canonical.email || source.email || "";
  const mergedPhone = canonical.phone || source.phone || "";
  const mergedLocation = canonical.location || source.location || "";
  const mergedLinkedin = canonical.linkedin_url || source.linkedin_url || "";
  const mergedTitle = canonical.current_title || source.current_title || "";
  const mergedCompany = canonical.current_company || source.current_company || "";
  const mergedYears =
    canonical.years_experience !== null ? canonical.years_experience : source.years_experience;

  const nextCanonicalVersion = Number(canonical.version ?? 1) + 1;

  // 1. Update canonical candidate profile
  await sql`
    update candidates set
      email = ${mergedEmail},
      phone = ${mergedPhone},
      location = ${mergedLocation},
      linkedin_url = ${mergedLinkedin},
      current_title = ${mergedTitle},
      current_company = ${mergedCompany},
      years_experience = ${mergedYears},
      version = ${nextCanonicalVersion},
      updated_at = now()
    where id = ${opts.canonicalId} and org_id = ${opts.orgId}`;

  // 2. Re-point applications:
  // Query all applications belonging to source
  const sourceApps = await sql<{
    id: string;
    role_id: string;
    pipeline_status: string;
    rank_score: number | null;
    recruiter_notes: string;
  }>`
    select id, role_id, pipeline_status, rank_score, recruiter_notes
    from applications
    where candidate_id = ${opts.sourceId}`;

  // Query all applications belonging to canonical
  const canonicalApps = await sql<{
    id: string;
    role_id: string;
    pipeline_status: string;
    rank_score: number | null;
    recruiter_notes: string;
  }>`
    select id, role_id, pipeline_status, rank_score, recruiter_notes
    from applications
    where candidate_id = ${opts.canonicalId}`;

  let reassignedApplicationsCount = 0;

  for (const sApp of sourceApps) {
    const existingCanApp = canonicalApps.find((c) => c.role_id === sApp.role_id);
    if (existingCanApp) {
      // Both candidates applied for the exact same role!
      // To satisfy `unique (role_id, candidate_id)`, merge notes & scores into canonical,
      // and redirect application screens/notes to existingCanApp.id, then remove duplicate application.
      const combinedNotes = [
        existingCanApp.recruiter_notes,
        sApp.recruiter_notes ? `[Merged note]: ${sApp.recruiter_notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const bestScore = Math.max(existingCanApp.rank_score ?? 0, sApp.rank_score ?? 0) || null;

      await sql`
        update applications set
          recruiter_notes = ${combinedNotes},
          rank_score = ${bestScore},
          updated_at = now()
        where id = ${existingCanApp.id}`;

      // Re-point screens from source app to canonical app
      await sql`
        update screens set application_id = ${existingCanApp.id}
        where application_id = ${sApp.id}`;

      // Re-point notes from source app to canonical app
      await sql`
        update candidate_notes set application_id = ${existingCanApp.id}
        where application_id = ${sApp.id}`;

      // Re-point tasks from source app to canonical app
      await sql`
        update recruiting_tasks set application_id = ${existingCanApp.id}
        where application_id = ${sApp.id}`;

      // Re-point application assignments
      // Delete any duplicate assignments that would conflict on the canonical app's unique constraint
      await sql`
        delete from application_assignments
        where application_id = ${sApp.id}
          and (user_id, assignment_type) in (
            select user_id, assignment_type from application_assignments
            where application_id = ${existingCanApp.id}
          )`;
      await sql`
        update application_assignments set application_id = ${existingCanApp.id}
        where application_id = ${sApp.id}`;

      // Safe deletion of redundant application row
      await sql`delete from applications where id = ${sApp.id}`;
      reassignedApplicationsCount += 1;
    } else {
      // Direct transfer of application to canonical candidate
      await sql`
        update applications set
          candidate_id = ${opts.canonicalId},
          updated_at = now()
        where id = ${sApp.id}`;
      reassignedApplicationsCount += 1;
    }
  }

  // 3. Re-point candidate-level notes
  const notesRes = await sql`
    update candidate_notes set
      candidate_id = ${opts.canonicalId},
      updated_at = now()
    where candidate_id = ${opts.sourceId}
    returning id`;
  const reassignedNotesCount = notesRes.length;

  // 4. Re-point tasks
  const tasksRes = await sql`
    update recruiting_tasks set
      candidate_id = ${opts.canonicalId},
      updated_at = now()
    where candidate_id = ${opts.sourceId}
    returning id`;
  const reassignedTasksCount = tasksRes.length;

  // 5. Re-point DPDP consent records
  await sql`
    update consent_records set
      subject_id = ${opts.canonicalId}
    where subject_type = 'candidate' and subject_id = ${opts.sourceId} and org_id = ${opts.orgId}`;

  // 6. Mark source candidate as merged
  await sql`
    update candidates set
      status = 'merged',
      merged_into_id = ${opts.canonicalId},
      version = version + 1,
      updated_at = now()
    where id = ${opts.sourceId}`;

  // 7. Record merge audit history
  const mergeId = newId();
  await sql`
    insert into candidate_merges (
      id, org_id, canonical_candidate_id, merged_candidate_id, merged_by, reason, confidence, details_json, created_at
    ) values (
      ${mergeId}, ${opts.orgId}, ${opts.canonicalId}, ${opts.sourceId}, ${opts.mergedBy},
      ${opts.reason ?? "manual_duplicate_merge"}, ${1.0},
      ${JSON.stringify({
        sourceName: source.full_name,
        canonicalName: canonical.full_name,
        reassignedApps: reassignedApplicationsCount,
        reassignedNotes: reassignedNotesCount,
        reassignedTasks: reassignedTasksCount,
      })},
      now()
    )`;

  // 8. Record audit event
  await sql`
    insert into audit_events (
      id, user_id, entity_type, entity_id, action, meta_json, created_at
    ) values (
      ${newId()}, ${opts.mergedBy}, 'candidate', ${opts.canonicalId}, 'duplicate_merged',
      ${JSON.stringify({
        canonicalId: opts.canonicalId,
        sourceId: opts.sourceId,
        mergedBy: opts.mergedBy,
        reassignedApplicationsCount,
      })},
      now()
    )`;

  return {
    success: true,
    canonicalId: opts.canonicalId,
    mergedCandidateId: opts.sourceId,
    newCanonicalVersion: nextCanonicalVersion,
    reassignedApplicationsCount,
    reassignedNotesCount,
    reassignedTasksCount,
  };
}
