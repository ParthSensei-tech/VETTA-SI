/**
 * Official Company Career Portal Direct Ingestion & Job Sync Engine
 *
 * Implements direct resume ingestion for specific job openings from official company
 * career portals / job sites with strict, non-invasive security guarantees:
 *  1. Zero Website Intrusion: Operates completely outside the company web server.
 *  2. Explicit Recruiter Authorization: Logs user ID and timestamp when enabled.
 *  3. Ingestion Modes: Secure Webhook Push, Read-Only Feed Pull, and Manual Sync.
 *  4. Automatic Evidence-Grounded Ranking & Shortlisting: Evaluates role requirements
 *     and routes qualified candidates directly into the Human-in-the-Loop review queue.
 */

import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import { parseJson } from "../../../shared/utils.ts";
import { matchCandidateToRole } from "../../ranking/domain/match-engine.ts";
import { createHitlCheckpoint } from "./autonomous-portal.server.ts";
import {
  validateExternalPortalUrl,
  validateResumeBuffer,
  sanitizeResumePayload,
} from "../domain/portal-security.ts";
import type {
  RoleExternalPortalConfig,
  PortalSyncLog,
  ExternalPortalCandidatePayload,
  ExternalPortalSyncSummary,
  PortalSyncMode,
} from "../../recruiting/domain/types.ts";

function formatConfigRow(r: any): RoleExternalPortalConfig {
  return {
    id: String(r.id),
    roleId: String(r.role_id || r.roleId),
    orgId: String(r.org_id || r.orgId),
    isEnabled: Boolean(r.is_enabled ?? r.isEnabled ?? false),
    portalJobUrl: String(r.portal_job_url || r.portalJobUrl || ""),
    syncMode: (r.sync_mode || r.syncMode || "webhook_push") as PortalSyncMode,
    feedApiUrl: String(r.feed_api_url || r.feedApiUrl || ""),
    feedAuthToken: String(r.feed_auth_token || r.feedAuthToken || ""),
    webhookToken: String(r.webhook_token || r.webhookToken || ""),
    autoShortlist: Boolean(r.auto_shortlist ?? r.autoShortlist ?? true),
    authorizedByUserId: r.authorized_by_user_id || r.authorizedByUserId || null,
    authorizedAt: r.authorized_at ? new Date(r.authorized_at).toISOString() : null,
    lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
    lastSyncStatus: (r.last_sync_status || r.lastSyncStatus || "idle") as any,
    lastSyncMessage: String(r.last_sync_message || r.lastSyncMessage || ""),
    createdAt: new Date(String(r.created_at || r.createdAt || Date.now())).toISOString(),
    updatedAt: new Date(String(r.updated_at || r.updatedAt || Date.now())).toISOString(),
  };
}

function formatLogRow(r: any): PortalSyncLog {
  return {
    id: String(r.id),
    roleId: String(r.role_id || r.roleId),
    orgId: String(r.org_id || r.orgId),
    syncType: (r.sync_type || r.syncType || "webhook") as any,
    resumesFetched: Number(r.resumes_fetched ?? r.resumesFetched ?? 0),
    resumesParsed: Number(r.resumes_parsed ?? r.resumesParsed ?? 0),
    candidatesShortlisted: Number(r.candidates_shortlisted ?? r.candidatesShortlisted ?? 0),
    status: (r.status || "success") as any,
    detailsJson: String(r.details_json || r.detailsJson || "{}"),
    errorMessage: String(r.error_message || r.errorMessage || ""),
    createdAt: new Date(String(r.created_at || r.createdAt || Date.now())).toISOString(),
  };
}

/**
 * Loads or initializes the external portal configuration for a specific job role.
 */
export async function getRoleExternalPortalConfig(opts: {
  roleId: string;
  orgId: string;
}): Promise<RoleExternalPortalConfig> {
  const sql = await getSql();

  const [row] = await sql`
    select * from role_external_portal_configs
    where role_id = ${opts.roleId} and org_id = ${opts.orgId}
    limit 1
  `;

  if (row) {
    return formatConfigRow(row);
  }

  // Create initial dormant configuration with a cryptographically unique webhook token
  const id = `rportal_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const webhookToken = `wh_tok_${randomUUID().replace(/-/g, "")}`;

  await sql`
    insert into role_external_portal_configs (
      id, role_id, org_id, is_enabled, portal_job_url, sync_mode,
      feed_api_url, feed_auth_token, webhook_token, auto_shortlist,
      last_sync_status, created_at, updated_at
    ) values (
      ${id}, ${opts.roleId}, ${opts.orgId}, false, '', 'webhook_push',
      '', '', ${webhookToken}, true, 'idle', now(), now()
    )
  `;

  const [created] = await sql`
    select * from role_external_portal_configs where id = ${id} limit 1
  `;
  return formatConfigRow(created);
}

/**
 * Updates external portal sync settings for a role.
 * Records explicit recruiter authorization timestamp when enabled.
 */
export async function updateRoleExternalPortalConfig(opts: {
  roleId: string;
  orgId: string;
  userId: string;
  isEnabled: boolean;
  portalJobUrl?: string;
  syncMode?: PortalSyncMode;
  feedApiUrl?: string;
  feedAuthToken?: string;
  autoShortlist?: boolean;
}): Promise<RoleExternalPortalConfig> {
  const sql = await getSql();
  const current = await getRoleExternalPortalConfig({ roleId: opts.roleId, orgId: opts.orgId });

  // Validate portal job URL if provided
  let portalUrl = (opts.portalJobUrl ?? current.portalJobUrl).trim();
  if (opts.isEnabled && portalUrl) {
    const urlCheck = validateExternalPortalUrl(portalUrl);
    if (!urlCheck.valid) {
      throw new Error(`Invalid Career Portal URL: ${urlCheck.error}`);
    }
    portalUrl = urlCheck.normalized!;
  }

  // Validate feed API URL if feed_pull is selected
  let feedUrl = (opts.feedApiUrl ?? current.feedApiUrl).trim();
  const syncMode = opts.syncMode ?? current.syncMode;
  if (opts.isEnabled && syncMode === "feed_pull" && feedUrl) {
    const feedCheck = validateExternalPortalUrl(feedUrl);
    if (!feedCheck.valid) {
      throw new Error(`Invalid Feed API URL: ${feedCheck.error}`);
    }
    feedUrl = feedCheck.normalized!;
  }

  const authorizedBy = opts.isEnabled ? opts.userId : current.authorizedByUserId;
  const authorizedAt = opts.isEnabled ? new Date().toISOString() : current.authorizedAt;

  await sql`
    update role_external_portal_configs
    set
      is_enabled = ${opts.isEnabled},
      portal_job_url = ${portalUrl},
      sync_mode = ${syncMode},
      feed_api_url = ${feedUrl},
      feed_auth_token = ${opts.feedAuthToken ?? current.feedAuthToken},
      auto_shortlist = ${opts.autoShortlist ?? current.autoShortlist},
      authorized_by_user_id = ${authorizedBy},
      authorized_at = ${authorizedAt ? new Date(authorizedAt).toISOString() : null},
      updated_at = now()
    where id = ${current.id}
  `;

  const [updated] = await sql`
    select * from role_external_portal_configs where id = ${current.id} limit 1
  `;
  return formatConfigRow(updated);
}

/**
 * Processes a single candidate resume submitted or fetched from the official company portal.
 * Runs sanitization, parsing, evidence-grounded ranking, and automatic HITL checkpointing.
 */
export async function processExternalPortalIngestion(opts: {
  roleId: string;
  orgId: string;
  payload: ExternalPortalCandidatePayload;
  syncType?: "webhook" | "feed_pull" | "manual";
}): Promise<{
  ok: boolean;
  applicationId: string;
  candidateName: string;
  score: number;
  fitLevel: string;
  shortlisted: boolean;
}> {
  const sql = await getSql();

  // 1. Verify role exists and load details
  const [roleRow] = await sql`select * from roles where id = ${opts.roleId} limit 1`;
  if (!roleRow) {
    throw new Error(`Role ${opts.roleId} not found`);
  }

  // 2. Security & contact point sanitization
  const sanitizedRes = sanitizeResumePayload(opts.payload);
  if (!sanitizedRes.valid || !sanitizedRes.sanitized) {
    throw new Error(`Candidate payload failed security sanitization: ${sanitizedRes.error}`);
  }
  const candidateData = sanitizedRes.sanitized;

  // 3. Extract text from binary if base64 provided
  let finalResumeText = candidateData.resumeText || "";
  if (candidateData.resumeBase64) {
    try {
      const buffer = Buffer.from(candidateData.resumeBase64, "base64");
      const bufferCheck = validateResumeBuffer(buffer, candidateData.resumeFilename);
      if (!bufferCheck.valid) {
        throw new Error(`Resume binary verification failed: ${bufferCheck.error}`);
      }
      // If no plain text was passed, use decoded UTF-8 string or note
      if (!finalResumeText || finalResumeText.length < 50) {
        finalResumeText = buffer.toString("utf-8");
      }
    } catch (e: any) {
      if (!finalResumeText) {
        throw new Error(`Failed to decode resume attachment: ${e.message}`);
      }
    }
  }

  if (!finalResumeText || finalResumeText.length < 20) {
    throw new Error("Resume content is too short or missing valid text");
  }

  // 4. Build role input for evidence-grounded matching
  const roleInput = {
    companyName: String(roleRow.company_name || roleRow.companyName || "Company"),
    companyStage: String(roleRow.company_stage || roleRow.companyStage || "seed"),
    title: String(roleRow.title),
    location: String(roleRow.location || ""),
    workMode: String(roleRow.work_mode || "hybrid"),
    employmentType: String(roleRow.employment_type || "full_time"),
    compensationBand: String(roleRow.compensation_band || ""),
    stack: parseJson<string[]>(String(roleRow.stack || "[]"), []),
    mustHaves: parseJson<string[]>(String(roleRow.must_haves || "[]"), []),
    niceToHaves: parseJson<string[]>(String(roleRow.nice_to_haves || "[]"), []),
    jdText: String(roleRow.jd_text || ""),
  };

  // 5. Run multi-stage retrieval & evidence-grounded match
  const matchResult = matchCandidateToRole({
    resumeText: finalResumeText,
    role: roleInput,
  });

  const { profile, rank } = matchResult;
  const candidateId = randomUUID();
  const applicationId = randomUUID();

  // 6. Save candidate record
  await sql`
    insert into candidates (
      id, user_id, org_id, full_name, email, phone, location,
      linkedin_url, current_title, current_company, years_experience,
      resume_text, parsed_json, created_at, updated_at
    ) values (
      ${candidateId}, ${opts.orgId}, ${opts.orgId},
      ${candidateData.fullName || profile.full_name},
      ${candidateData.email || profile.email},
      ${candidateData.phone || profile.phone},
      ${candidateData.location || profile.location},
      ${candidateData.linkedinUrl || profile.linkedin_url},
      ${profile.current_title}, ${profile.current_company}, ${profile.years_experience},
      ${finalResumeText}, ${JSON.stringify(profile)}, now(), now()
    )
  `;

  // 7. Save application record with official portal attribution
  const isShortlisted = rank.score >= 70 && rank.level !== "no";
  const pipelineStatus = isShortlisted ? "shortlisted" : "ingested";

  await sql`
    insert into applications (
      id, user_id, org_id, role_id, candidate_id, pipeline_status,
      rank_score, rank_json, source, recruiter_notes, created_at, updated_at
    ) values (
      ${applicationId}, ${opts.orgId}, ${opts.orgId}, ${opts.roleId}, ${candidateId},
      ${pipelineStatus}, ${rank.score}, ${JSON.stringify(rank)},
      'official_career_portal',
      ${`Directly ingested from official company career portal. Scored ${rank.score}/100 (${rank.level}).`},
      now(), now()
    )
  `;

  // 8. Create HITL Gate Checkpoint if qualified or has missing information
  const missingRequirements = rank.requirements?.filter((r) => r.status === "missing_info") || [];
  if (isShortlisted) {
    await createHitlCheckpoint({
      orgId: opts.orgId,
      roleId: opts.roleId,
      applicationId,
      checkpointType: "shortlist_interview",
      candidateName: candidateData.fullName,
      roleTitle: roleInput.title,
      aiRecommendation: "advance",
      aiScore: rank.score,
      aiFitLevel: rank.level,
      evidenceSummary: rank.summary,
      missingRequirements: missingRequirements.map((m) => m.requirement),
    });
  }

  return {
    ok: true,
    applicationId,
    candidateName: candidateData.fullName,
    score: rank.score,
    fitLevel: rank.level,
    shortlisted: isShortlisted,
  };
}

/**
 * Triggers an isolated, read-only feed pull sync from the company's official career portal endpoint.
 */
export async function syncExternalPortalFeed(opts: {
  roleId: string;
  orgId: string;
}): Promise<ExternalPortalSyncSummary> {
  const sql = await getSql();
  const config = await getRoleExternalPortalConfig({ roleId: opts.roleId, orgId: opts.orgId });

  if (!config.isEnabled) {
    throw new Error("Direct Career Portal Ingestion is disabled for this role");
  }

  const feedUrl = config.feedApiUrl.trim();
  if (!feedUrl) {
    throw new Error("No Feed API URL configured for this role");
  }

  // 1. SSRF validation
  const urlCheck = validateExternalPortalUrl(feedUrl);
  if (!urlCheck.valid) {
    throw new Error(`Security validation failed: ${urlCheck.error}`);
  }

  // Update status to syncing
  await sql`
    update role_external_portal_configs
    set last_sync_status = 'syncing', updated_at = now()
    where id = ${config.id}
  `;

  const errors: string[] = [];
  let fetchedCount = 0;
  let parsedCount = 0;
  let shortlistedCount = 0;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Vetta-CareerPortal-Sync/2.0 (Read-Only Applicant Ingestion)",
    };
    if (config.feedAuthToken) {
      headers.Authorization = `Bearer ${config.feedAuthToken}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000); // 15-second timeout

    const res = await fetch(feedUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Feed endpoint returned HTTP ${res.status}: ${await res.text()}`);
    }

    const rawJson = (await res.json()) as any;
    const candidatesList: ExternalPortalCandidatePayload[] = Array.isArray(rawJson)
      ? rawJson
      : Array.isArray(rawJson.candidates)
        ? rawJson.candidates
        : Array.isArray(rawJson.applicants)
          ? rawJson.applicants
          : [];

    fetchedCount = candidatesList.length;

    for (const cand of candidatesList) {
      try {
        const result = await processExternalPortalIngestion({
          roleId: opts.roleId,
          orgId: opts.orgId,
          payload: cand,
          syncType: "feed_pull",
        });
        parsedCount++;
        if (result.shortlisted) shortlistedCount++;
      } catch (err: any) {
        errors.push(`Candidate ${cand.fullName || "unknown"}: ${err.message}`);
      }
    }

    // Record success log
    const logId = randomUUID();
    await sql`
      insert into portal_sync_logs (
        id, role_id, org_id, sync_type, resumes_fetched, resumes_parsed,
        candidates_shortlisted, status, details_json, error_message, created_at
      ) values (
        ${logId}, ${opts.roleId}, ${opts.orgId}, 'feed_pull',
        ${fetchedCount}, ${parsedCount}, ${shortlistedCount},
        ${errors.length > 0 ? "partial" : "success"},
        ${JSON.stringify({ fetchedCount, parsedCount, shortlistedCount, errors })},
        ${errors.join("; ").slice(0, 500)}, now()
      )
    `;

    // Update config status
    await sql`
      update role_external_portal_configs
      set
        last_sync_at = now(),
        last_sync_status = ${errors.length > 0 ? "partial" : "success"},
        last_sync_message = ${`Synced ${parsedCount}/${fetchedCount} resumes. Shortlisted ${shortlistedCount}.`},
        updated_at = now()
      where id = ${config.id}
    `;

    return {
      ok: true,
      syncedCount: parsedCount,
      shortlistedCount,
      hitlCheckpointsCreated: shortlistedCount,
      errors,
    };
  } catch (err: any) {
    const errorMsg = err.message || "Failed to fetch from official career feed";
    // Record failed log
    const logId = randomUUID();
    await sql`
      insert into portal_sync_logs (
        id, role_id, org_id, sync_type, resumes_fetched, resumes_parsed,
        candidates_shortlisted, status, details_json, error_message, created_at
      ) values (
        ${logId}, ${opts.roleId}, ${opts.orgId}, 'feed_pull',
        0, 0, 0, 'failed', '{}', ${errorMsg.slice(0, 500)}, now()
      )
    `;

    await sql`
      update role_external_portal_configs
      set
        last_sync_at = now(),
        last_sync_status = 'failed',
        last_sync_message = ${errorMsg.slice(0, 300)},
        updated_at = now()
      where id = ${config.id}
    `;

    throw new Error(errorMsg);
  }
}

/**
 * Loads recent sync history logs for a role.
 */
export async function getRolePortalSyncLogs(opts: {
  roleId: string;
  orgId: string;
  limit?: number;
}): Promise<PortalSyncLog[]> {
  const sql = await getSql();
  const limit = opts.limit ?? 20;

  const rows = await sql`
    select * from portal_sync_logs
    where role_id = ${opts.roleId} and org_id = ${opts.orgId}
    order by created_at desc
    limit ${limit}
  `;

  return rows.map(formatLogRow);
}
