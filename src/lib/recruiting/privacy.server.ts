/**
 * Consent, withdrawal, and deletion.
 * A withdrawal of evaluation deletes the person everywhere we stored them.
 * A narrower withdrawal only stops that use (shares, voice, learning).
 */

import { getSql } from "../../platform/db.ts";
import {
  NOTICE_VERSION,
  PRIVACY_STORES,
  basisAllows,
  providerForgetResult,
  purposeById,
  purposeDenied,
  sha256Hex,
  stripShareCandidates,
  subjectRef,
  type PrivacyStore,
  type PurposeId,
} from "./privacy.ts";

function newId(): string {
  return crypto.randomUUID();
}

type OrgFlags = {
  employerCoversClientShare: boolean;
  employerCoversModelTraining: boolean;
  retentionDays: number;
};

async function orgFlags(orgId: string): Promise<OrgFlags> {
  const sql = await getSql();
  const rows = await sql<{
    employer_covers_client_share: boolean | null;
    employer_covers_model_training: boolean | null;
    retention_days: number | null;
  }>`
    select employer_covers_client_share, employer_covers_model_training, retention_days
    from organizations where id = ${orgId} limit 1`;
  const row = rows[0];
  return {
    employerCoversClientShare: row?.employer_covers_client_share ?? true,
    employerCoversModelTraining: row?.employer_covers_model_training ?? false,
    retentionDays: row?.retention_days ?? 365,
  };
}

export async function recordConsent(opts: {
  orgId: string;
  subjectType: "candidate" | "applicant";
  subjectId: string;
  purpose: string;
  source?: string;
  meta?: Record<string, unknown>;
  lawfulBasis?: "consent" | "employer_instruction";
}): Promise<void> {
  if (!purposeById(opts.purpose)) return;
  const sql = await getSql();
  const basis = opts.lawfulBasis ?? "consent";
  const existing = await sql<{ id: string }>`
    select id from consent_records
    where org_id = ${opts.orgId} and subject_id = ${opts.subjectId}
      and purpose = ${opts.purpose} and lawful_basis = ${basis}
      and granted = true and withdrawn_at is null
    limit 1`;
  if (existing[0]) return;
  await sql`
    insert into consent_records (
      id, org_id, subject_type, subject_id, purpose, lawful_basis, granted, source,
      meta_json, notice_version, granted_at
    ) values (
      ${newId()}, ${opts.orgId}, ${opts.subjectType}, ${opts.subjectId},
      ${opts.purpose}, ${basis}, ${true}, ${opts.source ?? "portal"},
      ${JSON.stringify(opts.meta ?? {})}, ${NOTICE_VERSION}, now()
    )`;
}

/** Recruiter upload: the employer already holds the resume for hiring. */
export async function recordEmployerIntake(opts: {
  orgId: string;
  subjectId: string;
  source?: string;
}): Promise<void> {
  const flags = await orgFlags(opts.orgId);
  const purposes: PurposeId[] = ["recruitment_evaluation"];
  if (flags.employerCoversClientShare) purposes.push("client_disclosure");
  if (flags.employerCoversModelTraining) purposes.push("model_improvement");
  for (const purpose of purposes) {
    await recordConsent({
      orgId: opts.orgId,
      subjectType: "candidate",
      subjectId: opts.subjectId,
      purpose,
      source: opts.source ?? "recruiter_upload",
      lawfulBasis: "employer_instruction",
      meta: { noticeVersion: NOTICE_VERSION },
    });
  }
}

export async function mayProcess(opts: {
  orgId: string;
  subjectId: string;
  purpose: PurposeId;
}): Promise<boolean> {
  const sql = await getSql();
  const flags = await orgFlags(opts.orgId);
  const rows = await sql<{ granted: boolean; lawful_basis: string }>`
    select granted, lawful_basis from consent_records
    where org_id = ${opts.orgId} and subject_id = ${opts.subjectId}
      and purpose = ${opts.purpose}`;
  return basisAllows({
    purpose: opts.purpose,
    rows: rows.map((row) => ({ granted: row.granted && true, basis: row.lawful_basis })),
    employerCoversClientShare: flags.employerCoversClientShare,
    employerCoversModelTraining: flags.employerCoversModelTraining,
  });
}

export async function assertMayProcess(opts: {
  orgId?: string | null;
  subjectId: string;
  applicationId?: string;
  purpose: PurposeId;
}): Promise<void> {
  const sql = await getSql();
  let orgId = opts.orgId ?? null;
  if (!orgId) {
    const rows = await sql<{ org_id: string | null }>`
      select org_id from candidates where id = ${opts.subjectId} limit 1`;
    orgId = rows[0]?.org_id ?? null;
  }
  if (!orgId) {
    if (opts.purpose === "recruitment_evaluation") return;
    throw new Error(purposeDenied(opts.purpose));
  }
  const ok = await mayProcess({ orgId, subjectId: opts.subjectId, purpose: opts.purpose });
  if (!ok) throw new Error(purposeDenied(opts.purpose));
}

export async function hasActiveConsent(opts: {
  orgId: string;
  subjectId: string;
  purpose: string;
}): Promise<boolean> {
  if (!purposeById(opts.purpose)) return false;
  return mayProcess({
    orgId: opts.orgId,
    subjectId: opts.subjectId,
    purpose: opts.purpose as PurposeId,
  });
}

async function applicationIdsFor(subjectId: string): Promise<{
  userId: string;
  orgId: string | null;
  email: string;
  phone: string;
  fullName: string;
  resumeText: string;
  applicationIds: string[];
  resumeHashes: string[];
  screenIds: string[];
  approvalIds: string[];
}> {
  const sql = await getSql();
  const people = await sql<{
    user_id: string;
    org_id: string | null;
    email: string;
    phone: string;
    full_name: string;
    resume_text: string;
  }>`
    select user_id, org_id, coalesce(email, '') as email, coalesce(phone, '') as phone,
           coalesce(full_name, '') as full_name, coalesce(resume_text, '') as resume_text
    from candidates where id = ${subjectId} limit 1`;
  const person = people[0];
  if (!person) {
    return {
      userId: "",
      orgId: null,
      email: "",
      phone: "",
      fullName: "",
      resumeText: "",
      applicationIds: [],
      resumeHashes: [],
      screenIds: [],
      approvalIds: [],
    };
  }
  const apps = await sql<{ id: string; resume_hash: string | null }>`
    select id, resume_hash from applications where candidate_id = ${subjectId}`;
  const applicationIds = apps.map((a) => a.id);
  let screenIds: string[] = [];
  let approvalIds: string[] = [];
  if (applicationIds.length) {
    const screens = await sql<{ id: string }>`
      select id from screens where application_id = any(${applicationIds})`;
    screenIds = screens.map((s) => s.id);
    const approvals = await sql<{ id: string }>`
      select id from approvals where application_id = any(${applicationIds})`;
    approvalIds = approvals.map((a) => a.id);
  }
  return {
    userId: person.user_id,
    orgId: person.org_id,
    email: person.email,
    phone: person.phone,
    fullName: person.full_name,
    resumeText: person.resume_text,
    applicationIds,
    resumeHashes: apps.map((a) => a.resume_hash ?? "").filter((h) => h.length > 0),
    screenIds,
    approvalIds,
  };
}

async function forgetProviders(
  orgId: string,
  subjectId: string,
  applicationIds: string[] = [],
): Promise<Array<{ provider: string; status: string; detail: string }>> {
  const sql = await getSql();
  const rows = applicationIds.length
    ? await sql<{ provider: string }>`
        select distinct provider from provider_disclosures
        where org_id = ${orgId} and (subject_id = ${subjectId} or application_id = any(${applicationIds}))`
    : await sql<{ provider: string }>`
        select distinct provider from provider_disclosures
        where org_id = ${orgId} and subject_id = ${subjectId}`;
  const results = rows.map((row) => providerForgetResult(row.provider));
  if (applicationIds.length) {
    await sql`delete from provider_disclosures where org_id = ${orgId} and (subject_id = ${subjectId} or application_id = any(${applicationIds}))`;
  } else {
    await sql`delete from provider_disclosures where org_id = ${orgId} and subject_id = ${subjectId}`;
  }
  return results;
}

async function stripShares(
  orgId: string | null,
  userId: string,
  applicationIds: string[],
): Promise<number> {
  if (!applicationIds.length) return 0;
  const sql = await getSql();
  const blocked = new Set(applicationIds);
  const shares = await sql<{ id: string; payload_json: string }>`
    select id, payload_json from client_shares
    where ((${orgId}::text is not null and org_id = ${orgId}) or user_id = ${userId})
      and revoked_at is null`;
  let touched = 0;
  for (const share of shares) {
    let payload: { candidates?: Array<{ applicationId: string }> };
    try {
      payload = JSON.parse(share.payload_json) as { candidates?: Array<{ applicationId: string }> };
    } catch {
      continue;
    }
    const list = payload.candidates ?? [];
    if (!list.some((c) => blocked.has(c.applicationId))) continue;
    const { kept } = stripShareCandidates(list, blocked);
    touched += 1;
    if (kept.length === 0) {
      await sql`
        update client_shares
        set payload_json = ${JSON.stringify({ ...payload, candidates: [] })},
            title = 'Revoked share',
            revoked_at = now()
        where id = ${share.id}`;
    } else {
      await sql`
        update client_shares
        set payload_json = ${JSON.stringify({ ...payload, candidates: kept })}
        where id = ${share.id}`;
    }
  }
  return touched;
}

export async function recordProviderDisclosure(opts: {
  orgId: string;
  subjectId: string;
  applicationId?: string | null;
  purpose: PurposeId;
  provider: string;
  prompt: string;
}): Promise<void> {
  const sql = await getSql();
  const promptSha = (await sha256Hex(opts.prompt)).slice(0, 32);
  await sql`
    insert into provider_disclosures (
      id, org_id, subject_id, application_id, purpose, provider, prompt_sha256, no_store
    ) values (
      ${newId()}, ${opts.orgId}, ${opts.subjectId}, ${opts.applicationId ?? null},
      ${opts.purpose}, ${opts.provider}, ${promptSha}, ${true}
    )`;
}

export type EraseResult = {
  erased: boolean;
  subjectRef: string;
  stores: Partial<Record<PrivacyStore, number>>;
  providers: Array<{ provider: string; status: string; detail: string }>;
};

/**
 * Delete one person from every store that can hold them.
 * Model weights stay: they are aggregates and cannot be subtracted.
 * The receipt stores a hash, not a name or email.
 */
export async function eraseSubject(opts: {
  orgId: string;
  subjectId: string;
  reason: "withdrawal" | "retention" | "request";
}): Promise<EraseResult> {
  const sql = await getSql();
  const scope = await applicationIdsFor(opts.subjectId);
  const orgId = scope.orgId || opts.orgId;
  const ref = await subjectRef(orgId, opts.subjectId);
  const stores: Partial<Record<PrivacyStore, number>> = {};
  const empty = (): EraseResult => ({ erased: false, subjectRef: ref, stores, providers: [] });
  if (!scope.userId) return empty();

  const ids = scope.applicationIds;
  const entityIds = [opts.subjectId, ...ids, ...scope.screenIds, ...scope.approvalIds];

  if (ids.length) {
    const jobs = await sql`
      delete from ingest_jobs where application_id = any(${ids}) returning 1`;
    stores.ingest_jobs = jobs.length;
    const labels =
      await sql`delete from rank_labels where application_id = any(${ids}) returning 1`;
    stores.rank_labels = labels.length;
    const feedback =
      await sql`delete from rank_feedback where application_id = any(${ids}) returning 1`;
    stores.rank_feedback = feedback.length;
    const traces =
      await sql`delete from rank_traces where application_id = any(${ids}) returning 1`;
    stores.rank_traces = traces.length;
    const shadows =
      await sql`delete from shadow_comparisons where application_id = any(${ids}) returning 1`;
    stores.shadow_comparisons = shadows.length;
    const outcomes =
      await sql`delete from outcome_events where application_id = any(${ids}) returning 1`;
    stores.outcome_events = outcomes.length;
    const reminders =
      await sql`delete from screen_reminders where application_id = any(${ids}) returning 1`;
    stores.screen_reminders = reminders.length;
    const evals = await sql`
      delete from eval_cases
      where application_id = any(${ids}) returning 1`;
    stores.eval_cases = evals.length;
    const approvals =
      await sql`delete from approvals where application_id = any(${ids}) returning 1`;
    stores.approvals = approvals.length;
    const screens = await sql`delete from screens where application_id = any(${ids}) returning 1`;
    stores.screens = screens.length;
  }

  if (scope.resumeHashes.length) {
    const cache = await sql`
      delete from rank_cache
      where (user_id = ${scope.userId} or ${scope.userId} = '') and resume_hash = any(${scope.resumeHashes}) returning 1`;
    stores.rank_cache = cache.length;
    try {
      const { evictRankCache } = await import("./rank-cache.server");
      evictRankCache(scope.resumeHashes);
    } catch {
      /* in-memory cache eviction */
    }
    await sql`delete from rank_traces where resume_hash = any(${scope.resumeHashes})`;
  }

  const embeddings =
    await sql`delete from candidate_embeddings where candidate_id = ${opts.subjectId} returning 1`;
  stores.embeddings = embeddings.length;

  if (scope.resumeText.trim().length >= 40) {
    const leftover = await sql`
      delete from ingest_jobs
      where (user_id = ${scope.userId} or ${scope.userId} = '') and resume_text = ${scope.resumeText} returning 1`;
    stores.ingest_jobs = (stores.ingest_jobs ?? 0) + leftover.length;
    await sql`delete from eval_cases where resume_text = ${scope.resumeText}`;
    try {
      const { forgetObservedDocument } = await import("./domain-embed.server");
      stores.embed_seen = await forgetObservedDocument(scope.resumeText);
    } catch {
      stores.embed_seen = 0;
    }
  }

  stores.client_shares = await stripShares(orgId, scope.userId, ids);

  const audit = await sql`
    delete from audit_events
    where (user_id = ${scope.userId} or ${scope.userId} = '') and entity_id = any(${entityIds}) returning 1`;
  stores.audit_events = audit.length;
  if (scope.email) {
    const leaked = await sql`
      delete from audit_events
      where (user_id = ${scope.userId} or ${scope.userId} = '') and meta_json ilike ${"%" + scope.email + "%"} returning 1`;
    stores.audit_events = (stores.audit_events ?? 0) + leaked.length;
  }
  if (scope.phone && scope.phone.length > 5) {
    const leakedPhone = await sql`
      delete from audit_events
      where (user_id = ${scope.userId} or ${scope.userId} = '') and meta_json ilike ${"%" + scope.phone + "%"} returning 1`;
    stores.audit_events = (stores.audit_events ?? 0) + leakedPhone.length;
  }
  if (scope.fullName && scope.fullName.length > 3) {
    const leakedName = await sql`
      delete from audit_events
      where (user_id = ${scope.userId} or ${scope.userId} = '') and meta_json ilike ${"%" + scope.fullName + "%"} returning 1`;
    stores.audit_events = (stores.audit_events ?? 0) + leakedName.length;
  }

  const providers = orgId ? await forgetProviders(orgId, opts.subjectId, ids) : [];
  stores.provider_disclosures = providers.length;

  const consent = await sql`
    delete from consent_records where org_id = ${orgId} and subject_id = ${opts.subjectId} returning 1`;
  stores.consent_records = consent.length;

  const apps =
    await sql`delete from applications where candidate_id = ${opts.subjectId} returning 1`;
  stores.applications = apps.length;
  const people = await sql`delete from candidates where id = ${opts.subjectId} returning 1`;
  stores.candidates = people.length;

  if (orgId) {
    await sql`
      insert into erasure_receipts (id, org_id, subject_ref, reason, stores_json, provider_forget_json)
      values (
        ${newId()}, ${orgId}, ${ref}, ${opts.reason},
        ${JSON.stringify(stores)}, ${JSON.stringify(providers)}
      )`;
  }

  return { erased: (stores.candidates ?? 0) > 0, subjectRef: ref, stores, providers };
}

async function withdrawRows(opts: {
  orgId: string;
  subjectId: string;
  purpose?: string;
}): Promise<void> {
  const sql = await getSql();
  if (opts.purpose) {
    await sql`
      update consent_records set granted = false, withdrawn_at = now()
      where org_id = ${opts.orgId} and subject_id = ${opts.subjectId}
        and purpose = ${opts.purpose} and granted = true`;
    return;
  }
  await sql`
    update consent_records set granted = false, withdrawn_at = now()
    where org_id = ${opts.orgId} and subject_id = ${opts.subjectId} and granted = true`;
}

/**
 * Stop one purpose. Stopping evaluation deletes the person.
 * Stopping sharing revokes them from export links.
 * Stopping voice wipes voice turns. Stopping learning blocks future training.
 */
export async function withdrawConsent(opts: {
  orgId: string;
  subjectId: string;
  purpose?: string;
}): Promise<{ withdrawn: number; erased: boolean; subjectRef?: string }> {
  const purpose = opts.purpose as PurposeId | undefined;
  if (purpose && !purposeById(purpose)) return { withdrawn: 0, erased: false };

  if (!purpose || purpose === "recruitment_evaluation") {
    await withdrawRows({ orgId: opts.orgId, subjectId: opts.subjectId, purpose });
    const erased = await eraseSubject({
      orgId: opts.orgId,
      subjectId: opts.subjectId,
      reason: "withdrawal",
    });
    return { withdrawn: 1, erased: erased.erased, subjectRef: erased.subjectRef };
  }

  await withdrawRows(opts);
  const sql = await getSql();
  const remaining = await sql<{ id: string }>`
    select id from consent_records
    where org_id = ${opts.orgId} and subject_id = ${opts.subjectId}
      and purpose = ${purpose}
    limit 1`;
  if (!remaining[0]) {
    await sql`
      insert into consent_records (
        id, org_id, subject_type, subject_id, purpose, lawful_basis, granted, source,
        meta_json, notice_version, granted_at, withdrawn_at
      ) values (
        ${newId()}, ${opts.orgId}, ${"candidate"}, ${opts.subjectId},
        ${purpose}, ${"consent"}, ${false}, ${"withdrawal"},
        ${"{}"}, ${NOTICE_VERSION}, now(), now()
      )`;
  }
  if (purpose === "client_disclosure") {
    const scope = await applicationIdsFor(opts.subjectId);
    await stripShares(opts.orgId, scope.userId, scope.applicationIds);
    if (scope.applicationIds.length) {
      await sql`
        update approvals
        set status = 'rejected', reviewer_note = 'Consent withdrawn for client disclosure', decided_at = now()
        where application_id = any(${scope.applicationIds}) and status in ('pending', 'approved')`;
    }
  }
  if (purpose === "model_improvement") {
    const scope = await applicationIdsFor(opts.subjectId);
    if (scope.applicationIds.length) {
      await sql`delete from rank_labels where application_id = any(${scope.applicationIds})`;
      await sql`delete from rank_feedback where application_id = any(${scope.applicationIds})`;
    }
    if (scope.resumeText.trim().length >= 40) {
      try {
        const { forgetObservedDocument } = await import("./domain-embed.server");
        await forgetObservedDocument(scope.resumeText);
      } catch {
        /* best-effort forget */
      }
    }
    await sql`
      delete from provider_disclosures
      where org_id = ${opts.orgId}
        and (subject_id = ${opts.subjectId} or (case when ${scope.applicationIds.length} > 0 then application_id = any(${scope.applicationIds}) else false end))
        and purpose = ${"model_improvement"}`;
  }
  if (purpose === "voice_prescreen") {
    const scope = await applicationIdsFor(opts.subjectId);
    if (scope.applicationIds.length) {
      const screens = await sql<{ id: string; transcript_json: string; evaluation_json: string }>`
        select id, transcript_json, evaluation_json from screens
        where application_id = any(${scope.applicationIds})`;
      for (const screen of screens) {
        let turns: Array<{ channel?: string; text?: string }> = [];
        try {
          turns = JSON.parse(screen.transcript_json) as Array<{ channel?: string; text?: string }>;
        } catch {
          turns = [];
        }
        const voiceText = new Set(
          turns
            .filter((turn) => turn.channel === "voice")
            .map((turn) => (turn.text ?? "").trim())
            .filter(Boolean),
        );
        const kept = turns.filter((turn) => turn.channel !== "voice");
        const answers = await sql<{ answers_json: string }>`
          select answers_json from screens where id = ${screen.id} limit 1`;
        let answerRows: Array<{ question_id?: string; answer?: string }> = [];
        try {
          answerRows = JSON.parse(answers[0]?.answers_json ?? "[]") as Array<{
            question_id?: string;
            answer?: string;
          }>;
        } catch {
          answerRows = [];
        }
        const nextAnswers = answerRows.map((row) =>
          voiceText.has((row.answer ?? "").trim()) ? { ...row, answer: "" } : row,
        );
        const hasRemainingAnswers = nextAnswers.some((a) => (a.answer ?? "").trim().length > 0);
        await sql`
          update screens set
            transcript_json = ${JSON.stringify(kept)},
            answers_json = ${JSON.stringify(nextAnswers)},
            status = ${hasRemainingAnswers ? "awaiting" : "draft"},
            evaluation_json = ${hasRemainingAnswers ? screen.evaluation_json : "{}"},
            updated_at = now()
          where id = ${screen.id}`;
      }
    }
  }
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from consent_records
    where org_id = ${opts.orgId} and subject_id = ${opts.subjectId} and granted = false`;
  return { withdrawn: Number(rows[0]?.n ?? 0), erased: false };
}

export async function purgeExpiredCandidateData(orgId?: string): Promise<{ purged: number }> {
  const sql = await getSql();
  const orgs = orgId
    ? await sql<{ id: string; retention_days: number }>`
        select id, retention_days from organizations where id = ${orgId}`
    : await sql<{ id: string; retention_days: number }>`
        select id, retention_days from organizations`;

  let purged = 0;
  for (const org of orgs) {
    const days = org.retention_days ?? 365;
    const old = await sql<{ id: string }>`
      select id from candidates
      where org_id = ${org.id}
        and updated_at < now() - (${String(days)} || ' days')::interval
      limit 100`;
    for (const person of old) {
      const result = await eraseSubject({
        orgId: org.id,
        subjectId: person.id,
        reason: "retention",
      });
      if (result.erased) purged += 1;
    }
    await sql`
      delete from rank_cache rc
      where rc.updated_at < now() - (${String(days)} || ' days')::interval
        and rc.user_id in (select user_id from organization_members where org_id = ${org.id})
        and not exists (
          select 1 from applications a
          where a.user_id = rc.user_id and a.resume_hash = rc.resume_hash and a.resume_hash <> ''
        )`;
    try {
      const { clearRankCache } = await import("./rank-cache.server");
      clearRankCache();
    } catch {
      /* in-memory cache clear */
    }
    await sql`
      delete from erasure_receipts
      where org_id = ${org.id}
        and created_at < now() - interval '1095 days'`;
    await sql`
      delete from provider_disclosures d
      where d.org_id = ${org.id}
        and not exists (select 1 from candidates c where c.id = d.subject_id)`;
    await sql`
      delete from audit_events
      where created_at < now() - (${String(days)} || ' days')::interval
        and entity_type in ('application', 'candidate', 'screen', 'approval', 'share')
        and user_id in (select user_id from organization_members where org_id = ${org.id})`;
    await sql`
      update ingest_jobs
      set resume_text = '', filename = ''
      where updated_at < now() - (${String(days)} || ' days')::interval
        and user_id in (select user_id from organization_members where org_id = ${org.id})
        and (
          application_id is null
          or not exists (select 1 from applications a where a.id = ingest_jobs.application_id)
        )`;
  }
  return { purged };
}

export async function setOrgRetentionDays(orgId: string, days: number): Promise<void> {
  const sql = await getSql();
  const clamped = Math.max(30, Math.min(2555, Math.floor(days)));
  await sql`
    update organizations set retention_days = ${clamped}, updated_at = now()
    where id = ${orgId}`;
}

export async function setOrgPrivacyFlags(opts: {
  orgId: string;
  retentionDays: number;
  employerCoversClientShare: boolean;
  employerCoversModelTraining: boolean;
}): Promise<void> {
  const sql = await getSql();
  const days = Math.max(30, Math.min(2555, Math.floor(opts.retentionDays)));
  await sql`
    update organizations set
      retention_days = ${days},
      employer_covers_client_share = ${opts.employerCoversClientShare},
      employer_covers_model_training = ${opts.employerCoversModelTraining},
      updated_at = now()
    where id = ${opts.orgId}`;
}

export async function orgPrivacySummary(orgId: string): Promise<{
  retentionDays: number;
  employerCoversClientShare: boolean;
  employerCoversModelTraining: boolean;
  receipts: Array<{ subjectRef: string; reason: string; createdAt: string; stores: string[] }>;
}> {
  const sql = await getSql();
  const flags = await orgFlags(orgId);
  const receipts = await sql<{
    subject_ref: string;
    reason: string;
    stores_json: string;
    created_at: unknown;
  }>`
    select subject_ref, reason, stores_json, created_at
    from erasure_receipts
    where org_id = ${orgId}
    order by created_at desc
    limit 12`;
  return {
    retentionDays: flags.retentionDays,
    employerCoversClientShare: flags.employerCoversClientShare,
    employerCoversModelTraining: flags.employerCoversModelTraining,
    receipts: receipts.map((row) => {
      let stores: string[] = [];
      try {
        const parsed = JSON.parse(row.stores_json) as Record<string, number>;
        stores = PRIVACY_STORES.filter((name) => (parsed[name] ?? 0) > 0);
      } catch {
        stores = [];
      }
      const created =
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at ?? "");
      return { subjectRef: row.subject_ref, reason: row.reason, createdAt: created, stores };
    }),
  };
}

export async function filterShareApplicationIds(opts: {
  orgId: string | null;
  applicationIds: string[];
}): Promise<string[]> {
  if (!opts.applicationIds.length || !opts.orgId) return opts.applicationIds;
  const sql = await getSql();
  const rows = await sql<{ id: string; candidate_id: string; org_id: string | null }>`
    select id, candidate_id, org_id from applications where id = any(${opts.applicationIds})`;
  const allowed: string[] = [];
  for (const row of rows) {
    const orgId = row.org_id || opts.orgId;
    const ok = await mayProcess({
      orgId,
      subjectId: row.candidate_id,
      purpose: "client_disclosure",
    });
    if (ok) allowed.push(row.id);
  }
  return allowed;
}
