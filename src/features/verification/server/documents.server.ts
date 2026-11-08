/**
 * The document store: what we hold of a candidate's original file, and for how long.
 *
 * Tier A reads the text that ingestion already extracted. The checks that catch a
 * *forged file* — an incremental update whose old objects are still in there, a
 * toolchain that post-dates the document it claims, a certificate re-printed over
 * somebody else's page — need the bytes, and holding somebody's PDF is a
 * different kind of promise from holding a parse of it. So this file is where the
 * promise is kept: it is the only place that writes `documents`, and every
 * decision it makes is delegated to `domain/documents.ts`, where the same
 * decision can be argued with a unit test instead of a migration.
 *
 * Four rules, and the first is the reason the other three exist:
 *
 *  1. **Retention is an org's decision, off by default, and the absence of a
 *     settings row is the answer.** A capture that forgets to look the setting up
 *     stores nothing rather than everything.
 *  2. **An identity document is refused outright** — no bytes and no digest,
 *     because a hash of an Aadhaar scan is still a handle on an Aadhaar scan. The
 *     refusal *is* recorded: that is the row an auditor asks for.
 *  3. **A metadata row is written even when nothing is kept.** The file arrived,
 *     we classified it, we declined to hold it — that history is what makes "we
 *     could not run the byte checks, and here is why" a sentence the drawer can
 *     say truthfully. It carries no digest and no bytes, so it is not a shadow
 *     copy of something we said we would not keep.
 *  4. **Nothing is read without the clock's permission.** `bytesReadable()` is
 *     applied at read time, not only at sweep time, so a purge that has not run
 *     yet is not a window in which an expired file is still forensically
 *     available.
 *
 * This file may write `documents` and `org_document_settings`. It may not write a
 * verdict, a ledger row, or anything on the rank path — the rails in
 * `scripts/check-verification.mjs` enforce the second half of that sentence.
 */
import { createHash } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import {
  bytesReadable,
  bytesUnavailableReason,
  classifyDocument,
  clampRetentionDays,
  contentStateFor,
  digestFor,
  expiryFrom,
  purgeTransition,
  retainsBytes,
  xmpLineageIds,
  type ContentState,
  type DocClass,
} from "../domain/documents.ts";

export type DocumentRecord = {
  id: string;
  orgId: string;
  userId: string;
  ingestJobId: string | null;
  candidateId: string | null;
  applicationId: string | null;
  roleId: string | null;
  docClass: DocClass;
  filename: string;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  xmpIdsHash: string;
  contentState: ContentState;
  consentBasis: string;
  retentionDays: number;
  expiresAtMs: number;
  purgedAtMs: number | null;
  createdAtMs: number;
};

export type CapturedDocument = {
  documentId: string;
  docClass: DocClass;
  contentState: ContentState;
  /** False when the bytes are not in the database — refused, or not retained. */
  retained: boolean;
};

export type ByteRetention = {
  byteRetention: boolean;
  retentionDays: number;
};

/** What a consent-withdrawal or a retention sweep did to one person's files. */
export type PurgeResult = { purged: number };

function newId(): string {
  return crypto.randomUUID();
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The lineage hash, or the refusal to keep one.
 *
 * `xmpMM:DocumentID` / `xmpMM:OriginalDocumentID` are the ids that survive a
 * re-save, so two files that share them came from one original — which is the
 * whole value, and it needs only equality, never the plaintext. So we keep the
 * digest of the sorted id list and throw the ids away: a cross-document cluster
 * can still be found, and a leaked table still cannot tell anyone which tool made
 * which person's resume.
 */
function lineageHash(bytes: Uint8Array): string {
  const ids = xmpLineageIds(bytes);
  if (ids.length === 0) return "";
  return createHash("sha256").update([...new Set(ids)].sort().join("\n")).digest("hex");
}

function ms(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapDocument(row: DocumentDbRow): DocumentRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    ingestJobId: row.ingest_job_id ?? null,
    candidateId: row.candidate_id ?? null,
    applicationId: row.application_id ?? null,
    roleId: row.role_id ?? null,
    docClass: row.doc_class as DocClass,
    filename: row.filename,
    mediaType: row.media_type,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes ?? 0),
    xmpIdsHash: row.xmp_ids_hash,
    contentState: row.content_state as ContentState,
    consentBasis: row.consent_basis,
    retentionDays: Number(row.retention_days ?? 0),
    expiresAtMs: ms(row.expires_at),
    purgedAtMs: row.purged_at == null ? null : ms(row.purged_at),
    createdAtMs: ms(row.created_at),
  };
}

type DocumentDbRow = {
  id: string;
  org_id: string;
  user_id: string;
  ingest_job_id: string | null;
  candidate_id: string | null;
  application_id: string | null;
  role_id: string | null;
  doc_class: string;
  filename: string;
  media_type: string;
  sha256: string;
  size_bytes: number | string;
  xmp_ids_hash: string;
  content_state: string;
  consent_basis: string;
  retention_days: number | string;
  expires_at: unknown;
  purged_at: unknown | null;
  created_at: unknown;
};

/**
 * Does this workspace keep original files?
 *
 * An absent row is `false`, not `undefined` and not an error: the whole posture
 * rests on the default being the safe one when nobody has decided anything.
 */
export async function byteRetentionForOrg(orgId: string): Promise<ByteRetention> {
  const sql = await getSql();
  const rows = await sql<{ byte_retention: boolean | null; retention_days: number | string }>`
    select byte_retention, retention_days from org_document_settings where org_id = ${orgId}
    limit 1`;
  const row = rows[0];
  if (!row) return { byteRetention: false, retentionDays: clampRetentionDays(null) };
  return {
    byteRetention: row.byte_retention === true,
    retentionDays: clampRetentionDays(Number(row.retention_days)),
  };
}

/**
 * Turn byte retention on or off for one workspace.
 *
 * Turning it *off* purges what is already held, in the same call. A switch that
 * only stops future captures would leave a workspace that has just opted out of
 * holding resumes still holding every resume it ever took — which is the opposite
 * of what the switch means.
 */
export async function setByteRetention(opts: {
  orgId: string;
  userId: string;
  byteRetention: boolean;
  retentionDays?: number | null;
  nowMs?: number;
}): Promise<ByteRetention & PurgeResult> {
  const sql = await getSql();
  const nowMs = opts.nowMs ?? Date.now();
  const retentionDays = clampRetentionDays(opts.retentionDays ?? null);
  await sql`
    insert into org_document_settings (org_id, user_id, byte_retention, retention_days, updated_at)
    values (${opts.orgId}, ${opts.userId}, ${opts.byteRetention}, ${retentionDays},
            ${new Date(nowMs).toISOString()})
    on conflict (org_id) do update set
      byte_retention = excluded.byte_retention,
      retention_days = excluded.retention_days,
      user_id = excluded.user_id,
      updated_at = excluded.updated_at`;
  if (opts.byteRetention) return { byteRetention: true, retentionDays, purged: 0 };
  const purged = await purgeRetainedBytes({ orgId: opts.orgId, nowMs });
  return { byteRetention: false, retentionDays, purged };
}

/**
 * Record the file a recruiter just dropped — and decide, here, whether to keep it.
 *
 * Called from the upload path with the bytes still in hand, because this is the
 * only moment they exist anywhere in this product. Every rule that decides what
 * happens to them lives in `domain/documents.ts`; this function only turns the
 * answer into a row.
 *
 * It never throws on purpose: a store that is down costs a candidate a forensic
 * check and nothing else. The ingest job still gets created, ranked and verified
 * exactly as it did before this table existed.
 */
export async function captureUploadedDocument(opts: {
  orgId: string;
  userId: string;
  filename: string;
  bytes: Uint8Array;
  ingestJobId?: string | null;
  roleId?: string | null;
  mediaType?: string;
  nowMs?: number;
}): Promise<CapturedDocument | null> {
  const bytes = opts.bytes;
  if (bytes.length === 0) return null;

  const nowMs = opts.nowMs ?? Date.now();
  const docClass = classifyDocument({ filename: opts.filename, mediaType: opts.mediaType });
  const { byteRetention, retentionDays } = await byteRetentionForOrg(opts.orgId);
  const keep = retainsBytes({ docClass, byteRetention });
  const contentState = contentStateFor({ docClass, byteRetention });
  const sha256 = digestFor({ docClass, byteRetention, sha256: sha256Hex(bytes) });
  const xmpIdsHash = keep ? lineageHash(bytes) : "";
  // The clock only runs on bytes we actually hold; a refusal or a metadata row
  // expires the moment it is created, so no later reader can mistake it for a
  // file that is still available.
  const expiresAtMs = keep ? expiryFrom({ nowMs, retentionDays }) : nowMs;

  const sql = await getSql();
  const id = newId();
  await sql`
    insert into documents (
      id, org_id, user_id, ingest_job_id, role_id, doc_class, filename, media_type,
      sha256, size_bytes, xmp_ids_hash, content, content_state, consent_basis,
      retention_days, expires_at, created_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.userId}, ${opts.ingestJobId ?? null}, ${opts.roleId ?? null},
      ${docClass}, ${opts.filename}, ${opts.mediaType ?? ""},
      ${sha256}, ${bytes.length}, ${xmpIdsHash}, ${keep ? Buffer.from(bytes) : null},
      ${contentState}, ${keep ? "document_forensics" : ""},
      ${retentionDays}, ${new Date(expiresAtMs).toISOString()},
      ${new Date(nowMs).toISOString()}, ${new Date(nowMs).toISOString()}
    )`;
  return { documentId: id, docClass, contentState, retained: keep };
}

/**
 * Say whose file it turned out to be.
 *
 * Ingestion learns the candidate only after it has parsed and ranked the
 * document, so the capture arrives with a job id and no person. This is the
 * second half of that handoff: it runs next to `enqueueVerification`, from the
 * queue, and it is what lets a verdict later be re-checked against the file a
 * named person uploaded.
 */
export async function bindDocumentToApplication(opts: {
  ingestJobId: string;
  candidateId?: string | null;
  applicationId?: string | null;
}): Promise<number> {
  if (!opts.candidateId && !opts.applicationId) return 0;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update documents
    set candidate_id = coalesce(${opts.candidateId ?? null}, candidate_id),
        application_id = coalesce(${opts.applicationId ?? null}, application_id),
        updated_at = now()
    where ingest_job_id = ${opts.ingestJobId}
      and (candidate_id is null or application_id is null)
    returning id`;
  return rows.length;
}

/** Every file recorded for one application, newest first, without their bytes. */
export async function documentsForApplication(
  applicationId: string,
): Promise<DocumentRecord[]> {
  const sql = await getSql();
  const rows = await sql<DocumentDbRow>`
    select id, org_id, user_id, ingest_job_id, candidate_id, application_id, role_id,
           doc_class, filename, media_type, sha256, size_bytes, xmp_ids_hash,
           content_state, consent_basis, retention_days, expires_at, purged_at, created_at
    from documents
    where application_id = ${applicationId}
    order by created_at desc`;
  return rows.map(mapDocument);
}

/**
 * Has this person told us to stop reading their file?
 *
 * The consent clock and the sweep are the slow path; this is the fast one. A
 * withdrawal writes a `granted = false` row and *then* purges, and a purge that
 * has not finished — or that failed — must not leave the bytes readable, because
 * the promise a person made us is not a request to delete. So every read door
 * checks the refusal for itself, and an error on the way to that check refuses
 * too: an unreadable consent table costs a forensic arm, and a readable one with
 * a withdrawal in it costs a candidate's file.
 */
async function bytesRefusedBySubject(orgId: string, candidateId: string | null): Promise<boolean> {
  if (!orgId || !candidateId) return false;
  try {
    const { isPurposeWithdrawn } = await import("../../people/server/privacy.server.ts");
    return await isPurposeWithdrawn({
      orgId,
      subjectId: candidateId,
      purpose: "document_forensics",
    });
  } catch (err) {
    console.error("[vetta-documents] consent check failed; refusing bytes", err);
    return true;
  }
}

/**
 * What one workspace's file-shelf looks like, for the settings that control it.
 *
 * Counts by state rather than a total, because the states mean different things
 * to the person reading them: `stored` is what is exposed, `refused` is what the
 * posture bought, and `purged` is the clock having done its job. The byte figure
 * is a sum over rows still held, so a workspace that switches retention on can
 * see what it just agreed to keep.
 */
export async function documentStoreSummaryForOrg(orgId: string): Promise<{
  byteRetention: boolean;
  retentionDays: number;
  counts: Record<ContentState, number>;
  bytesHeld: number;
  newestExpiryMs: number | null;
}> {
  const sql = await getSql();
  const { byteRetention, retentionDays } = await byteRetentionForOrg(orgId);
  const rows = await sql<{
    content_state: string;
    n: number | string;
    bytes: number | string;
  }>`
    select content_state, count(*) as n, coalesce(sum(size_bytes), 0) as bytes
    from documents
    where org_id = ${orgId}
    group by content_state`;
  const counts: Record<ContentState, number> = {
    stored: 0,
    purged: 0,
    refused: 0,
    not_retained: 0,
  };
  let bytesHeld = 0;
  for (const row of rows) {
    const state = row.content_state as ContentState;
    if (!(state in counts)) continue;
    counts[state] = Number(row.n ?? 0);
    // Only a `stored` row is bytes anybody is still exposed for; the same
    // `size_bytes` on a purged row is the memory of a file, not the file.
    if (state === "stored") bytesHeld = Number(row.bytes ?? 0);
  }
  const due = await sql<{ expires_at: unknown }>`
    select expires_at from documents
    where org_id = ${orgId} and content_state = 'stored'
    order by expires_at desc
    limit 1`;
  return {
    byteRetention,
    retentionDays,
    counts,
    bytesHeld,
    newestExpiryMs: due[0] ? ms(due[0].expires_at) : null,
  };
}

/**
 * The bytes a forensic arm may look at, or the reason there are none.
 *
 * `content_state` alone is not enough: a row can be `stored` with a clock that
 * ran out hours ago and a sweep that has not visited yet. So the expiry is
 * re-checked against the wall clock on every read, and the state column is only
 * ever the *slow* correction. `bytesUnavailableReason()` then gives the arm a
 * sentence to record, which is what stops an unrun check from looking like a
 * clean one.
 */
export async function loadDocumentForAnalysis(
  applicationId: string,
  nowMs: number = Date.now(),
): Promise<{
  document: DocumentRecord | null;
  bytes: Uint8Array | null;
  unavailableReason: string;
}> {
  const [document] = await documentsForApplication(applicationId);
  if (!document) {
    return { document: null, bytes: null, unavailableReason: bytesUnavailableReason("absent") };
  }
  if (
    !bytesReadable({
      contentState: document.contentState,
      expiresAtMs: document.expiresAtMs,
      nowMs,
    })
  ) {
    // A `stored` row whose clock has run out is reported as purged. The sweep
    // runs when it runs; when it happens is not allowed to change what the
    // product tells a candidate about their own file.
    const why = document.contentState === "stored" ? "purged" : document.contentState;
    return { document, bytes: null, unavailableReason: bytesUnavailableReason(why) };
  }
  if (await bytesRefusedBySubject(document.orgId, document.candidateId)) {
    return { document, bytes: null, unavailableReason: bytesUnavailableReason("withdrawn") };
  }
  const sql = await getSql();
  const rows = await sql<{ content: Uint8Array | null }>`
    select content from documents where id = ${document.id} limit 1`;
  const content = rows[0]?.content ?? null;
  if (!content || content.length === 0) {
    // The state says held and the column says otherwise. A row that is lying
    // about having a file is treated as one we do not have, so an arm never
    // reaches a forensic conclusion over an empty buffer.
    return { document, bytes: null, unavailableReason: bytesUnavailableReason("purged") };
  }
  return { document, bytes: content, unavailableReason: "" };
}

/**
 * Is there a file to forensicate, without fetching it?
 *
 * The ladder asks this once per application to decide `hasRawBytes`, and the
 * answer must come from the same two facts a real read is gated by — the state
 * column and the wall clock — or a check would report that bytes exist while the
 * arm that uses them finds none. `loadDocumentForAnalysis` is the heavier door
 * for the arm itself; this one exists so the queue never has to pull megabytes
 * through the pool just to set a boolean.
 */
export async function documentBytesAvailableForApplication(
  applicationId: string,
  nowMs: number = Date.now(),
): Promise<{ available: boolean; reason: string }> {
  const sql = await getSql();
  // One row answers both questions: the `order by` prefers a `stored` row so a
  // re-upload that *was* retained is not hidden behind an older refusal, and the
  // newest row otherwise, so the reason is the true one for this application.
  const rows = await sql<{
    content_state: string;
    expires_at: unknown;
    org_id: string;
    candidate_id: string | null;
  }>`
    select content_state, expires_at, org_id, candidate_id from documents
    where application_id = ${applicationId}
    order by (content_state = 'stored') desc, created_at desc
    limit 1`;
  const row = rows[0];
  if (!row) return { available: false, reason: bytesUnavailableReason("absent") };
  const state = row.content_state as ContentState;
  if (
    !bytesReadable({ contentState: state, expiresAtMs: ms(row.expires_at), nowMs })
  ) {
    // A `stored` row whose clock has run out is reported as purged, for the same
    // reason `loadDocumentForAnalysis` does: the sweep's schedule is not
    // allowed to change what the ladder says about a person's file.
    const why = state === "stored" ? "purged" : state;
    return { available: false, reason: bytesUnavailableReason(why) };
  }
  if (await bytesRefusedBySubject(row.org_id, row.candidate_id))
    return { available: false, reason: bytesUnavailableReason("withdrawn") };
  return { available: true, reason: "" };
}

/**
 * Run the 90-day clock.
 *
 * Bytes go, the explanation stays: class, size, digest, lineage hash, expiry and
 * timestamps all survive, because a verdict that was reached from this file has
 * to stay readable after the file is gone. `purgeTransition()` is the only
 * arbiter of what is due, so the sweep and the read gate cannot disagree about it.
 */
export async function purgeExpiredDocumentBytes(
  orgId?: string | null,
  nowMs: number = Date.now(),
): Promise<PurgeResult> {
  const sql = await getSql();
  const rows = orgId
    ? await sql<{ id: string; content_state: string; expires_at: unknown }>`
        select id, content_state, expires_at from documents
        where org_id = ${orgId} and content_state = 'stored'
        order by expires_at
        limit 500`
    : await sql<{ id: string; content_state: string; expires_at: string }>`
        select id, content_state, expires_at from documents
        where content_state = 'stored'
        order by expires_at
        limit 500`;
  const due = rows
    .filter((row) =>
      purgeTransition({
        contentState: row.content_state as ContentState,
        expiresAtMs: ms(row.expires_at),
        nowMs,
      }) === "purged",
    )
    .map((row) => row.id);
  return purgeBytesByIds(due, nowMs);
}

/**
 * Stop keeping one workspace's files, whatever the clock says.
 *
 * The switch-off path in `setByteRetention` needs this without waiting for 500
 * rows to age out; it shares the write with the sweep so "purged" means one thing
 * wherever it is set.
 */
async function purgeRetainedBytes(opts: {
  orgId: string;
  nowMs: number;
}): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select id from documents where org_id = ${opts.orgId} and content_state = 'stored'
    order by expires_at
    limit 500`;
  const { purged } = await purgeBytesByIds(rows.map((row) => row.id), opts.nowMs);
  return purged;
}

async function purgeBytesByIds(ids: string[], nowMs: number): Promise<PurgeResult> {
  if (ids.length === 0) return { purged: 0 };
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update documents
    set content = null,
        content_state = 'purged',
        consent_basis = '',
        purged_at = ${new Date(nowMs).toISOString()},
        updated_at = ${new Date(nowMs).toISOString()}
    where id = any(${ids}) and content_state = 'stored'
    returning id`;
  return { purged: rows.length };
}

/**
 * Which rows belong to one person — the store's only identity rule.
 *
 * Three routes, because a row can be reachable by any of them: a bound capture
 * is found by candidate, an application that outlived its job is found by
 * application, and a file captured *before* anybody was known is found only by
 * the ingest job it arrived under. Missing the third is how an erasure request
 * quietly leaves a resume in the database.
 *
 * The `case when …` guards are not decoration: `= any($n)` is parsed even when
 * the caller passed nothing, so each route is gated by its own length rather
 * than trusting an empty array to be the identity it isn't.
 */
async function documentIdsForSubject(subject: {
  orgId: string;
  candidateId: string;
  applicationIds: string[];
  jobIds: string[];
}): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select id from documents
    where org_id = ${subject.orgId}
      and (
        candidate_id = ${subject.candidateId}
        or (case when ${subject.applicationIds.length} > 0
                 then application_id = any(${subject.applicationIds}) else false end)
        or (case when ${subject.jobIds.length} > 0
                 then ingest_job_id = any(${subject.jobIds}) else false end)
      )`;
  return rows.map((row) => row.id);
}

/**
 * A person withdrew the forensics purpose: stop holding their files.
 *
 * Rows survive as metadata, because the *verdict* a check reached from a file we
 * are no longer allowed to keep still has to be explainable to that person. What
 * goes is the file, the digest and the lineage hash — everything derived from
 * bytes we are no longer permitted to hold.
 */
export async function purgeDocumentBytesForSubject(opts: {
  orgId: string;
  candidateId: string;
  applicationIds?: string[];
  jobIds?: string[];
  nowMs?: number;
}): Promise<PurgeResult> {
  const ids = await documentIdsForSubject({
    orgId: opts.orgId,
    candidateId: opts.candidateId,
    applicationIds: opts.applicationIds ?? [],
    jobIds: opts.jobIds ?? [],
  });
  if (ids.length === 0) return { purged: 0 };
  const sql = await getSql();
  const now = new Date(opts.nowMs ?? Date.now()).toISOString();
  const rows = await sql<{ id: string }>`
    update documents
    set content = null,
        content_state = 'purged',
        sha256 = '',
        xmp_ids_hash = '',
        consent_basis = '',
        purged_at = ${now},
        updated_at = ${now}
    where id = any(${ids}) and content_state = 'stored'
    returning id`;
  return { purged: rows.length };
}

/**
 * Erase one person's documents — rows and all — for `eraseSubject`.
 *
 * A deletion request is not a retention event: nothing stays, not the bytes, not
 * the digest, not the row that says we declined to keep them.
 */
export async function forgetCandidateDocuments(opts: {
  orgId: string;
  candidateId: string;
  applicationIds?: string[];
  jobIds?: string[];
}): Promise<number> {
  const ids = await documentIdsForSubject({
    orgId: opts.orgId,
    candidateId: opts.candidateId,
    applicationIds: opts.applicationIds ?? [],
    jobIds: opts.jobIds ?? [],
  });
  if (ids.length === 0) return 0;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from documents where id = any(${ids}) returning id`;
  return rows.length;
}
