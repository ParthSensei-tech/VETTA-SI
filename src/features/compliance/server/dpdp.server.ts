/**
 * DPDP Act & DPDP Rules Compliance Server Service.
 *
 * Implements:
 * - Enterprise DPA Execution
 * - DPDP Compliance & Statutory Penalty Exposure Audit
 * - Candidate Rights (DSAR) & Grievance Redressal
 * - 72-Hour Personal Data Breach Incident Management & DPBI Filing
 * - Purpose Retention Garbage Collection & Erasure Receipts
 */

import { getSql } from "../../../platform/db.ts";
import {
  DPA_CURRENT_VERSION,
  calculateComplianceScore,
  classifyBreachSeverity,
  generateDpbiBreachReport,
  type BreachSeverity,
  type ComplianceAuditInput,
  type ComplianceScoreResult,
  type DsarRequestType,
  type ProvenanceType,
} from "../domain/dpdp.ts";
import { sha256Hex } from "../../people/domain/privacy.ts";
import { purgeExpiredCandidateData } from "../../people/server/privacy.server.ts";

function newId(): string {
  return crypto.randomUUID();
}

export interface DpaRecord {
  id: string;
  orgId: string;
  userId: string;
  version: string;
  signerName: string;
  signerTitle: string | null;
  ipAddress: string | null;
  agreedAt: string;
}

export interface GrievanceOfficerRecord {
  id: string;
  orgId: string;
  officerName: string;
  officerEmail: string;
  officerPhone: string;
  physicalAddress: string;
  updatedAt: string;
}

export interface DsarRequestRecord {
  id: string;
  orgId: string;
  candidateId: string | null;
  applicationId: string | null;
  requestType: DsarRequestType;
  subjectEmail: string;
  subjectName: string | null;
  details: string;
  nomineeName: string | null;
  nomineeContact: string | null;
  status: "pending" | "in_progress" | "resolved" | "rejected";
  slaDeadline: string;
  daysRemaining: number;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface BreachIncidentRecord {
  id: string;
  orgId: string;
  title: string;
  severity: BreachSeverity;
  affectedCandidatesCount: number;
  dataCategories: string[];
  rootCause: string;
  containmentStatus: string;
  containmentActions: string;
  dpbiNotified: boolean;
  dpbiNotifiedAt: string | null;
  dpbiReferenceNumber: string | null;
  candidatesNotified: boolean;
  detectedAt: string;
  createdAt: string;
}

export interface OrgComplianceSummary {
  audit: ComplianceScoreResult;
  stats: {
    totalCandidates: number;
    unconsentedCandidates: number;
    unverifiedScrapedCandidates: number;
    candidatesExceedingRetention: number;
    retentionDays: number;
    dpaSigned: boolean;
    dpaVersion: string | null;
    dpoConfigured: boolean;
    pendingDsarCount: number;
    overdueDsarCount: number;
    activeBreachesCount: number;
  };
  dpa: DpaRecord | null;
  dpo: GrievanceOfficerRecord | null;
}

/**
 * Executes a full DPDP Compliance & Penalty Exposure audit for an organization.
 */
export async function auditOrgDpdpCompliance(orgId: string): Promise<OrgComplianceSummary> {
  const sql = await getSql();

  // 1. DPA Agreement check
  const dpaRows = await sql<{
    id: string;
    org_id: string;
    user_id: string;
    version: string;
    signer_name: string;
    signer_title: string | null;
    ip_address: string | null;
    agreed_at: unknown;
  }>`
    select id, org_id, user_id, version, signer_name, signer_title, ip_address, agreed_at
    from dpdp_dpa_agreements
    where org_id = ${orgId}
    order by agreed_at desc
    limit 1`;

  const dpaRecord: DpaRecord | null = dpaRows[0]
    ? {
        id: String(dpaRows[0].id),
        orgId: String(dpaRows[0].org_id),
        userId: String(dpaRows[0].user_id),
        version: String(dpaRows[0].version),
        signerName: String(dpaRows[0].signer_name),
        signerTitle: dpaRows[0].signer_title ? String(dpaRows[0].signer_title) : null,
        ipAddress: dpaRows[0].ip_address ? String(dpaRows[0].ip_address) : null,
        agreedAt:
          dpaRows[0].agreed_at instanceof Date
            ? dpaRows[0].agreed_at.toISOString()
            : String(dpaRows[0].agreed_at ?? ""),
      }
    : null;

  // 2. Organization retention days
  const orgRows = await sql<{ retention_days: number | null }>`
    select retention_days from organizations where id = ${orgId} limit 1`;
  const retentionDays = Number(orgRows[0]?.retention_days ?? 365);

  // 3. Candidates total & provenance check
  const candStats = await sql<{
    total_candidates: number;
    scraped_candidates: number;
  }>`
    select
      count(*)::int as total_candidates,
      count(*) filter (where provenance_type = 'unverified_scrape')::int as scraped_candidates
    from candidates
    where org_id = ${orgId}`;

  const totalCandidates = Number(candStats[0]?.total_candidates ?? 0);
  const unverifiedScrapedCandidates = Number(candStats[0]?.scraped_candidates ?? 0);

  // 4. Candidates without active consent
  const unconsentedRows = await sql<{ n: number }>`
    select count(c.id)::int as n
    from candidates c
    where c.org_id = ${orgId}
      and not exists (
        select 1 from consent_records cr
        where cr.org_id = ${orgId}
          and cr.subject_id = c.id
          and cr.purpose = 'recruitment_evaluation'
          and cr.granted = true
          and cr.withdrawn_at is null
      )`;
  const unconsentedCandidates = Number(unconsentedRows[0]?.n ?? 0);

  // 5. Candidates exceeding retention policy
  const expiredCandRows = await sql<{ n: number }>`
    select count(*)::int as n
    from candidates
    where org_id = ${orgId}
      and updated_at < now() - (${String(retentionDays)} || ' days')::interval`;
  const candidatesExceedingRetention = Number(expiredCandRows[0]?.n ?? 0);

  // 6. Grievance Redressal Officer (DPO) check
  const dpoRows = await sql<{
    id: string;
    org_id: string;
    officer_name: string;
    officer_email: string;
    officer_phone: string;
    physical_address: string;
    updated_at: unknown;
  }>`
    select id, org_id, officer_name, officer_email, officer_phone, physical_address, updated_at
    from dpdp_grievance_officers
    where org_id = ${orgId} limit 1`;

  const dpoRecord: GrievanceOfficerRecord | null = dpoRows[0]
    ? {
        id: String(dpoRows[0].id),
        orgId: String(dpoRows[0].org_id),
        officerName: String(dpoRows[0].officer_name),
        officerEmail: String(dpoRows[0].officer_email),
        officerPhone: String(dpoRows[0].officer_phone),
        physicalAddress: String(dpoRows[0].physical_address),
        updatedAt:
          dpoRows[0].updated_at instanceof Date
            ? dpoRows[0].updated_at.toISOString()
            : String(dpoRows[0].updated_at ?? ""),
      }
    : null;

  // 7. DSAR Candidate Requests stats
  const dsarStats = await sql<{
    pending_count: number;
    overdue_count: number;
  }>`
    select
      count(*) filter (where status in ('pending', 'in_progress'))::int as pending_count,
      count(*) filter (where status in ('pending', 'in_progress') and sla_deadline < now())::int as overdue_count
    from dpdp_candidate_requests
    where org_id = ${orgId}`;

  const pendingDsarCount = Number(dsarStats[0]?.pending_count ?? 0);
  const overdueDsarCount = Number(dsarStats[0]?.overdue_count ?? 0);

  // 8. Unresolved breach incidents
  const breachStats = await sql<{ active_breaches: number }>`
    select count(*)::int as active_breaches
    from dpdp_breach_incidents
    where org_id = ${orgId} and containment_status <> 'resolved'`;
  const activeBreachesCount = Number(breachStats[0]?.active_breaches ?? 0);

  // Compute pure audit score
  const auditInput: ComplianceAuditInput = {
    dpaSigned: Boolean(dpaRecord),
    dpaSignedVersion: dpaRecord?.version,
    totalCandidates,
    unconsentedCandidates,
    unverifiedScrapedCandidates,
    retentionDays,
    candidatesExceedingRetention,
    dpoConfigured: Boolean(dpoRecord),
    pendingDsarCount,
    overdueDsarCount,
    unresolvedBreachesCount: activeBreachesCount,
  };

  const audit = calculateComplianceScore(auditInput);

  return {
    audit,
    stats: {
      totalCandidates,
      unconsentedCandidates,
      unverifiedScrapedCandidates,
      candidatesExceedingRetention,
      retentionDays,
      dpaSigned: Boolean(dpaRecord),
      dpaVersion: dpaRecord?.version ?? null,
      dpoConfigured: Boolean(dpoRecord),
      pendingDsarCount,
      overdueDsarCount,
      activeBreachesCount,
    },
    dpa: dpaRecord,
    dpo: dpoRecord,
  };
}

/**
 * Records an authorized executive's acceptance of the enterprise DPA.
 */
export async function recordDpaAgreement(opts: {
  orgId: string;
  userId: string;
  signerName: string;
  signerTitle?: string;
  ipAddress?: string;
  version?: string;
}): Promise<DpaRecord> {
  const sql = await getSql();
  const id = newId();
  const version = opts.version ?? DPA_CURRENT_VERSION;
  const termsHash = await sha256Hex(`DPA:${version}:${opts.orgId}:${opts.signerName}`);

  const rows = await sql<{
    id: string;
    org_id: string;
    user_id: string;
    version: string;
    signer_name: string;
    signer_title: string | null;
    ip_address: string | null;
    agreed_at: unknown;
  }>`
    insert into dpdp_dpa_agreements (
      id, org_id, user_id, version, terms_hash, ip_address, signer_name, signer_title, agreed_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.userId}, ${version}, ${termsHash},
      ${opts.ipAddress ?? null}, ${opts.signerName}, ${opts.signerTitle ?? null}, now()
    )
    returning id, org_id, user_id, version, signer_name, signer_title, ip_address, agreed_at`;

  const r = rows[0]!;
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    userId: String(r.user_id),
    version: String(r.version),
    signerName: String(r.signer_name),
    signerTitle: r.signer_title ? String(r.signer_title) : null,
    ipAddress: r.ip_address ? String(r.ip_address) : null,
    agreedAt: r.agreed_at instanceof Date ? r.agreed_at.toISOString() : String(r.agreed_at ?? ""),
  };
}

/**
 * Upserts Grievance Redressal / Data Protection Officer (DPO) details for an organization.
 */
export async function configureGrievanceOfficer(opts: {
  orgId: string;
  officerName: string;
  officerEmail: string;
  officerPhone: string;
  physicalAddress: string;
}): Promise<GrievanceOfficerRecord> {
  const sql = await getSql();
  const id = newId();

  const rows = await sql<{
    id: string;
    org_id: string;
    officer_name: string;
    officer_email: string;
    officer_phone: string;
    physical_address: string;
    updated_at: unknown;
  }>`
    insert into dpdp_grievance_officers (
      id, org_id, officer_name, officer_email, officer_phone, physical_address, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.officerName}, ${opts.officerEmail},
      ${opts.officerPhone}, ${opts.physicalAddress}, now()
    )
    on conflict (org_id) do update set
      officer_name = excluded.officer_name,
      officer_email = excluded.officer_email,
      officer_phone = excluded.officer_phone,
      physical_address = excluded.physical_address,
      updated_at = now()
    returning id, org_id, officer_name, officer_email, officer_phone, physical_address, updated_at`;

  const r = rows[0]!;
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    officerName: String(r.officer_name),
    officerEmail: String(r.officer_email),
    officerPhone: String(r.officer_phone),
    physicalAddress: String(r.physical_address),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? ""),
  };
}

/**
 * Creates a Data Principal request (Access Summary / Correction / Erasure / Grievance / Nomination).
 */
export async function createDsarRequest(opts: {
  orgId: string;
  candidateId?: string | null;
  applicationId?: string | null;
  requestType: DsarRequestType;
  subjectEmail: string;
  subjectName?: string | null;
  details: string;
  nomineeName?: string | null;
  nomineeContact?: string | null;
}): Promise<DsarRequestRecord> {
  const sql = await getSql();
  const id = newId();

  const rows = await sql<{
    id: string;
    org_id: string;
    candidate_id: string | null;
    application_id: string | null;
    request_type: string;
    subject_email: string;
    subject_name: string | null;
    details: string;
    nominee_name: string | null;
    nominee_contact: string | null;
    status: string;
    sla_deadline: unknown;
    resolution_notes: string | null;
    resolved_at: unknown;
    created_at: unknown;
  }>`
    insert into dpdp_candidate_requests (
      id, org_id, candidate_id, application_id, request_type,
      subject_email, subject_name, details, nominee_name, nominee_contact,
      status, sla_deadline, created_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.candidateId ?? null}, ${opts.applicationId ?? null},
      ${opts.requestType}, ${opts.subjectEmail}, ${opts.subjectName ?? null},
      ${opts.details}, ${opts.nomineeName ?? null}, ${opts.nomineeContact ?? null},
      'pending', (now() + interval '30 days'), now(), now()
    )
    returning id, org_id, candidate_id, application_id, request_type,
              subject_email, subject_name, details, nominee_name, nominee_contact,
              status, sla_deadline, resolution_notes, resolved_at, created_at`;

  const r = rows[0]!;
  const deadlineDate = r.sla_deadline instanceof Date ? r.sla_deadline : new Date(String(r.sla_deadline));
  const daysRemaining = Math.max(0, Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return {
    id: String(r.id),
    orgId: String(r.org_id),
    candidateId: r.candidate_id ? String(r.candidate_id) : null,
    applicationId: r.application_id ? String(r.application_id) : null,
    requestType: r.request_type as DsarRequestType,
    subjectEmail: String(r.subject_email),
    subjectName: r.subject_name ? String(r.subject_name) : null,
    details: String(r.details),
    nomineeName: r.nominee_name ? String(r.nominee_name) : null,
    nomineeContact: r.nominee_contact ? String(r.nominee_contact) : null,
    status: r.status as DsarRequestRecord["status"],
    slaDeadline: deadlineDate.toISOString(),
    daysRemaining,
    resolutionNotes: r.resolution_notes ? String(r.resolution_notes) : null,
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
  };
}

/**
 * Lists active and resolved Data Principal (DSAR) requests for an organization.
 */
export async function listDsarRequests(orgId: string): Promise<DsarRequestRecord[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    org_id: string;
    candidate_id: string | null;
    application_id: string | null;
    request_type: string;
    subject_email: string;
    subject_name: string | null;
    details: string;
    nominee_name: string | null;
    nominee_contact: string | null;
    status: string;
    sla_deadline: unknown;
    resolution_notes: string | null;
    resolved_at: unknown;
    created_at: unknown;
  }>`
    select id, org_id, candidate_id, application_id, request_type,
           subject_email, subject_name, details, nominee_name, nominee_contact,
           status, sla_deadline, resolution_notes, resolved_at, created_at
    from dpdp_candidate_requests
    where org_id = ${orgId}
    order by case when status = 'pending' then 0 when status = 'in_progress' then 1 else 2 end,
             sla_deadline asc`;

  return rows.map((r) => {
    const deadlineDate = r.sla_deadline instanceof Date ? r.sla_deadline : new Date(String(r.sla_deadline));
    const daysRemaining = Math.max(0, Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    return {
      id: String(r.id),
      orgId: String(r.org_id),
      candidateId: r.candidate_id ? String(r.candidate_id) : null,
      applicationId: r.application_id ? String(r.application_id) : null,
      requestType: r.request_type as DsarRequestType,
      subjectEmail: String(r.subject_email),
      subjectName: r.subject_name ? String(r.subject_name) : null,
      details: String(r.details),
      nomineeName: r.nominee_name ? String(r.nominee_name) : null,
      nomineeContact: r.nominee_contact ? String(r.nominee_contact) : null,
      status: r.status as DsarRequestRecord["status"],
      slaDeadline: deadlineDate.toISOString(),
      daysRemaining,
      resolutionNotes: r.resolution_notes ? String(r.resolution_notes) : null,
      resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
    };
  });
}

/**
 * Resolves a candidate rights (DSAR) request.
 */
export async function resolveDsarRequest(opts: {
  orgId: string;
  requestId: string;
  resolvedByUserId: string;
  resolutionNotes: string;
  status: "resolved" | "rejected";
}): Promise<void> {
  const sql = await getSql();
  await sql`
    update dpdp_candidate_requests set
      status = ${opts.status},
      resolution_notes = ${opts.resolutionNotes},
      resolved_by = ${opts.resolvedByUserId},
      resolved_at = now(),
      updated_at = now()
    where id = ${opts.requestId} and org_id = ${opts.orgId}`;
}

/**
 * Records a personal data breach incident and computes statutory severity.
 */
export async function logBreachIncident(opts: {
  orgId: string;
  title: string;
  affectedCandidatesCount: number;
  dataCategories: string[];
  rootCause: string;
  containmentActions: string;
  isExfiltrationConfirmed?: boolean;
}): Promise<BreachIncidentRecord> {
  const sql = await getSql();
  const id = newId();

  const classification = classifyBreachSeverity({
    affectedCandidatesCount: opts.affectedCandidatesCount,
    dataCategories: opts.dataCategories,
    isExfiltrationConfirmed: opts.isExfiltrationConfirmed ?? false,
  });

  const categoriesJson = JSON.stringify(opts.dataCategories);

  const rows = await sql<{
    id: string;
    org_id: string;
    title: string;
    severity: string;
    affected_candidates_count: number;
    data_categories: string;
    root_cause: string;
    containment_status: string;
    containment_actions: string;
    dpbi_notified: boolean;
    dpbi_notified_at: unknown;
    dpbi_reference_number: string | null;
    candidates_notified: boolean;
    detected_at: unknown;
    created_at: unknown;
  }>`
    insert into dpdp_breach_incidents (
      id, org_id, title, severity, affected_candidates_count, data_categories,
      root_cause, containment_status, containment_actions, dpbi_notified,
      candidates_notified, detected_at, created_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.title}, ${classification.severity},
      ${opts.affectedCandidatesCount}, ${categoriesJson}, ${opts.rootCause},
      'investigating', ${opts.containmentActions}, false, false, now(), now(), now()
    )
    returning *`;

  const r = rows[0]!;
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    title: String(r.title),
    severity: r.severity as BreachSeverity,
    affectedCandidatesCount: Number(r.affected_candidates_count),
    dataCategories: opts.dataCategories,
    rootCause: String(r.root_cause),
    containmentStatus: String(r.containment_status),
    containmentActions: String(r.containment_actions),
    dpbiNotified: Boolean(r.dpbi_notified),
    dpbiNotifiedAt: r.dpbi_notified_at ? String(r.dpbi_notified_at) : null,
    dpbiReferenceNumber: r.dpbi_reference_number ? String(r.dpbi_reference_number) : null,
    candidatesNotified: Boolean(r.candidates_notified),
    detectedAt: r.detected_at instanceof Date ? r.detected_at.toISOString() : String(r.detected_at ?? ""),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
  };
}

/**
 * Lists breach incidents for an organization.
 */
export async function listBreachIncidents(orgId: string): Promise<BreachIncidentRecord[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    org_id: string;
    title: string;
    severity: string;
    affected_candidates_count: number;
    data_categories: string;
    root_cause: string;
    containment_status: string;
    containment_actions: string;
    dpbi_notified: boolean;
    dpbi_notified_at: unknown;
    dpbi_reference_number: string | null;
    candidates_notified: boolean;
    detected_at: unknown;
    created_at: unknown;
  }>`
    select * from dpdp_breach_incidents
    where org_id = ${orgId}
    order by detected_at desc`;

  return rows.map((r) => {
    let cats: string[] = [];
    try {
      cats = JSON.parse(r.data_categories) as string[];
    } catch {
      cats = [];
    }
    return {
      id: String(r.id),
      orgId: String(r.org_id),
      title: String(r.title),
      severity: r.severity as BreachSeverity,
      affectedCandidatesCount: Number(r.affected_candidates_count),
      dataCategories: cats,
      rootCause: String(r.root_cause),
      containmentStatus: String(r.containment_status),
      containmentActions: String(r.containment_actions),
      dpbiNotified: Boolean(r.dpbi_notified),
      dpbiNotifiedAt: r.dpbi_notified_at ? String(r.dpbi_notified_at) : null,
      dpbiReferenceNumber: r.dpbi_reference_number ? String(r.dpbi_reference_number) : null,
      candidatesNotified: Boolean(r.candidates_notified),
      detectedAt: r.detected_at instanceof Date ? r.detected_at.toISOString() : String(r.detected_at ?? ""),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
    };
  });
}

/**
 * Generates statutory DPBI notice text for an incident.
 */
export async function generateDpbiFiling(opts: {
  orgId: string;
  incidentId: string;
}): Promise<string> {
  const sql = await getSql();
  const orgRows = await sql<{ name: string }>`
    select name from organizations where id = ${opts.orgId} limit 1`;
  const orgName = orgRows[0]?.name ?? "Authorized Employer";

  const incidentRows = await sql<{
    id: string;
    title: string;
    affected_candidates_count: number;
    data_categories: string;
    root_cause: string;
    containment_actions: string;
    detected_at: unknown;
  }>`
    select id, title, affected_candidates_count, data_categories, root_cause,
           containment_actions, detected_at
    from dpdp_breach_incidents
    where id = ${opts.incidentId} and org_id = ${opts.orgId}
    limit 1`;

  const inc = incidentRows[0];
  if (!inc) throw new Error("Incident not found");

  const dpoRows = await sql<{
    officer_name: string;
    officer_email: string;
    officer_phone: string;
  }>`
    select officer_name, officer_email, officer_phone
    from dpdp_grievance_officers
    where org_id = ${opts.orgId} limit 1`;

  const dpoContact = {
    name: dpoRows[0]?.officer_name ?? "Designated Officer",
    email: dpoRows[0]?.officer_email ?? "privacy@company.com",
    phone: dpoRows[0]?.officer_phone ?? "+91-0000000000",
  };

  let categories: string[] = [];
  try {
    categories = JSON.parse(inc.data_categories) as string[];
  } catch {
    categories = [];
  }

  const detectedIso =
    inc.detected_at instanceof Date
      ? inc.detected_at.toISOString()
      : String(inc.detected_at ?? new Date().toISOString());

  return generateDpbiBreachReport({
    incidentId: String(inc.id),
    orgName,
    detectedAtIso: detectedIso,
    affectedCount: Number(inc.affected_candidates_count),
    dataCategories: categories,
    rootCause: String(inc.root_cause),
    containmentActions: String(inc.containment_actions),
    dpoContact,
  });
}

/**
 * Runs automated DPDP purpose retention garbage collection.
 */
export async function runDpdpRetentionGc(orgId: string): Promise<{ purged: number }> {
  return purgeExpiredCandidateData(orgId);
}
