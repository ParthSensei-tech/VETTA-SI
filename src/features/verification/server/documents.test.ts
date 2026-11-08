/**
 * The document store against a real database.
 *
 * The pure rules are tested where they are decided (`domain/documents.test.ts`).
 * What only a running store can prove is the four things a byte table is
 * actually judged on:
 *
 *  1. a byte written through `pg` comes back as the same bytes — and comes back
 *     as *nothing* when the org never opted in;
 *  2. a refusal refuses the derived values too, not only the file, and refuses
 *     twice without colliding; while two resumes with identical bytes stay two
 *     rows, because each is somebody's own evidence;
 *  3. the clock purges what is due and only what is due, and an expired row is
 *     unreadable from the second it expires rather than from the second the sweep
 *     gets around to it;
 *  4. erasure reaches every row that belongs to a person — including the ones
 *     bound to nobody but an ingest job.
 *
 * A fifth group is here because the store is not an island: it proves the four
 * callers are wired, not just the functions they call. The ingest queue binds a
 * file to the person it ranked, and the privacy server's three doors —
 * withdrawal, deletion request, daily sweep — each reach the shelf they are
 * supposed to reach. Those are the assertions that fail when somebody refactors
 * a `try` block away, and no unit test of either feature can see it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import {
  eraseSubject,
  isPurposeWithdrawn,
  purgeExpiredCandidateData,
  withdrawConsent,
} from "../../people/server/privacy.server.ts";
import { processQueueSlice } from "../../pipeline/server/queue.server.ts";
import { DEFAULT_RETENTION_DAYS } from "../domain/documents.ts";
import { fixtureById, type ForensicFixture } from "../domain/fixtures.ts";
import {
  analyzeDocumentsForApplication,
  bindDocumentToApplication,
  byteRetentionForOrg,
  captureUploadedDocument,
  documentBytesAvailableForApplication,
  documentStoreSummaryForOrg,
  documentsForApplication,
  forgetCandidateDocuments,
  loadDocumentForAnalysis,
  purgeDocumentBytesForSubject,
  purgeExpiredDocumentBytes,
  setByteRetention,
} from "./documents.server.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 8);
const HORIZON = NOW + DEFAULT_RETENTION_DAYS * DAY;

let seq = 0;
const uid = () => `doc-${Date.now().toString(36)}-${(seq += 1)}`;

/** A resume PDF with a lineage id in it, the way a real one arrives. */
function resumeBytes(documentId = "uuid:7E31-76C2-1111-2222"): Uint8Array {
  return new TextEncoder().encode(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n` +
      `2 0 obj\n<< /Type /Metadata /Subtype /XML >>\nstream\n` +
      `<x:xmpmeta><rdf:RDF><rdf:Description` +
      ` xmpMM:DocumentID="${documentId}" xmpMM:InstanceID="uuid:0B22"/>` +
      `</rdf:RDF></x:xmpmeta>\nendstream\nendobj\n%%EOF\n`,
  );
}

async function workspace(orgName = "Vetta Store Test Co") {
  const userId = uid();
  const org = await ensureUserOrg(userId, orgName);
  return { userId, orgId: org.orgId };
}

/** A workspace that said yes to holding files — without this, every row is metadata. */
async function retainingWorkspace(orgName?: string) {
  const f = await workspace(orgName);
  await setByteRetention({ orgId: f.orgId, userId: f.userId, byteRetention: true, nowMs: NOW });
  return f;
}

const rawRow = async (documentId: string) => {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select content, content_state, sha256, xmp_ids_hash, consent_basis, size_bytes,
           retention_days, expires_at, purged_at, doc_class, candidate_id, application_id
    from documents where id = ${documentId} limit 1`;
  assert.ok(rows[0], `expected a documents row for ${documentId}`);
  return rows[0];
};

/** The whole point of the table, stated once so no test has to re-assert it. */
const isStored = (row: Record<string, unknown>) => {
  assert.equal(row.content_state, "stored");
  assert.ok(row.content instanceof Uint8Array, "pg hands a bytea back as bytes, not text");
  assert.equal(row.consent_basis, "document_forensics");
  assert.match(String(row.sha256), /^[0-9a-f]{64}$/);
  assert.equal(new Date(String(row.expires_at)).getTime(), HORIZON);
};

const RESUME_TEXT = `PRIYA RAMESH
Senior Backend Engineer | Bengaluru, Karnataka
Backend engineer with 7 years of experience building high-throughput services for fintech.
Nimbus Technologies, Bengaluru — Senior Backend Engineer, Mar 2019 - Present`;

/**
 * What the ingest path actually leaves behind by the time a person exists.
 *
 * The store's own tests bind ids by hand, which proves the update but not the
 * wiring. The three doors that matter — a withdrawal, a deletion request and the
 * daily retention sweep — live in `features/people/server/privacy.server.ts`, and
 * to be tested they need the whole chain a real upload produces: role, batch,
 * job, candidate, application and a file bound across all of them.
 */
async function personWithFile(
  f: { userId: string; orgId: string },
  opts: { nowMs?: number; jobId?: string; filename?: string } = {},
) {
  const sql = await getSql();
  const roleId = uid();
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleId}, ${f.userId}, 'Nimbus', 'growth', 'Senior Backend Engineer', 'Bengaluru',
            'open', ${f.orgId})`;
  const batchId = uid();
  await sql`
    insert into ingest_batches (id, user_id, role_id, source_name, status, total_count)
    values (${batchId}, ${f.userId}, ${roleId}, 'wiring', 'completed', 1)`;
  const candidateId = uid();
  await sql`
    insert into candidates (id, user_id, full_name, email, resume_text, org_id)
    values (${candidateId}, ${f.userId}, 'Priya Ramesh', 'priya@nimbus.example', ${RESUME_TEXT},
            ${f.orgId})`;
  const applicationId = uid();
  await sql`
    insert into applications (id, user_id, role_id, candidate_id, pipeline_status, org_id)
    values (${applicationId}, ${f.userId}, ${roleId}, ${candidateId}, 'ranked', ${f.orgId})`;
  const jobId = opts.jobId ?? uid();
  await sql`
    insert into ingest_jobs (
      id, user_id, batch_id, role_id, filename, resume_text, status, application_id, org_id
    ) values (${jobId}, ${f.userId}, ${batchId}, ${roleId}, ${opts.filename ?? "resume.pdf"},
              ${RESUME_TEXT}, 'completed', ${applicationId}, ${f.orgId})`;
  const captured = await captureUploadedDocument({
    ...f,
    filename: opts.filename ?? "resume.pdf",
    mediaType: "application/pdf",
    bytes: resumeBytes(),
    ingestJobId: jobId,
    roleId,
    nowMs: opts.nowMs ?? NOW,
  });
  assert.ok(captured);
  await bindDocumentToApplication({ ingestJobId: jobId, candidateId, applicationId });
  return { roleId, batchId, jobId, candidateId, applicationId, documentId: captured.documentId };
}

test("the person's withdrawal reaches the shelf through the privacy server", async () => {
  const f = await retainingWorkspace("Withdrawal Wiring Co");
  const p = await personWithFile(f);
  assert.equal((await documentBytesAvailableForApplication(p.applicationId)).available, true);

  const result = await withdrawConsent({
    orgId: f.orgId,
    subjectId: p.candidateId,
    purpose: "document_forensics",
  });

  assert.equal(result.erased, false, "stopping the scan is not stopping the evaluation");
  const row = await rawRow(p.documentId);
  assert.equal(row.content, null, "the file goes");
  assert.equal(row.content_state, "purged");
  assert.equal(row.candidate_id, p.candidateId, "the explanation stays");
  assert.equal((await documentsForApplication(p.applicationId)).length, 1);
  assert.equal((await documentBytesAvailableForApplication(p.applicationId)).available, false);
  assert.equal(
    await isPurposeWithdrawn({
      orgId: f.orgId,
      subjectId: p.candidateId,
      purpose: "document_forensics",
    }),
    true,
    "and the refusal is on the record, not only in the column",
  );
});

test("a deletion request deletes the bytes as well as the person", async () => {
  const f = await retainingWorkspace("Erasure Wiring Co");
  const p = await personWithFile(f);
  // A second file that arrived under a job the rank never adopted: only the
  // person's own text connects it to her, and only after the jobs are deleted.
  const orphan = await personWithFile(f, { jobId: uid(), filename: "marksheet.pdf" });

  const result = await eraseSubject({
    orgId: f.orgId,
    subjectId: p.candidateId,
    reason: "request",
  });

  assert.equal(result.erased, true);
  assert.equal(result.stores.documents, 2, "the bound file and the one only its job named");
  const sql = await getSql();
  const left = await sql<{ n: string }>`
    select count(*)::text as n from documents where org_id = ${f.orgId}`;
  assert.equal(left[0].n, "0", "and no third row that outlived her");
  assert.equal((await documentsForApplication(p.applicationId)).length, 0);
  assert.equal(
    (await documentsForApplication(orphan.applicationId)).length,
    0,
    "the second file named nobody but the resume text she withdrew",
  );
});

test("the daily sweep runs the document clock, which is not the candidate clock", async () => {
  const f = await retainingWorkspace("Sweep Wiring Co");
  // Held for its full window, and then some — while the person it belongs to is
  // nowhere near her own (much longer) retention horizon.
  const p = await personWithFile(f, { nowMs: NOW - (DEFAULT_RETENTION_DAYS + 7) * DAY });
  assert.equal((await rawRow(p.documentId)).content_state, "stored");
  assert.equal((await documentBytesAvailableForApplication(p.applicationId)).available, false);

  await purgeExpiredCandidateData(f.orgId);

  const row = await rawRow(p.documentId);
  assert.equal(row.content_state, "purged", "the sweep caught up with the read gate");
  assert.equal(row.content, null);
  const sql = await getSql();
  assert.equal(
    Number(
      (await sql`select count(*)::text as n from candidates where id = ${p.candidateId}`)[0].n,
    ),
    1,
    "and the candidate herself is untouched — different clock, different decision",
  );
});

test("an org that never chose anything keeps nothing", async () => {
  const f = await workspace();
  assert.deepEqual(await byteRetentionForOrg(f.orgId), {
    byteRetention: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
  });

  const bytes = resumeBytes();
  const captured = await captureUploadedDocument({
    ...f,
    filename: "Rahul Mehta.pdf",
    mediaType: "application/pdf",
    bytes,
    nowMs: NOW,
  });
  assert.ok(captured);
  assert.deepEqual(
    {
      docClass: captured.docClass,
      contentState: captured.contentState,
      retained: captured.retained,
    },
    { docClass: "resume", contentState: "not_retained", retained: false },
  );

  const row = await rawRow(captured.documentId);
  assert.equal(row.content, null, "the default is a null blob, not an empty one");
  assert.equal(row.sha256, "", "and no digest either — a fingerprint of a file we do not hold");
  assert.equal(row.xmp_ids_hash, "");
  assert.equal(row.consent_basis, "");
  assert.equal(Number(row.size_bytes), bytes.length, "the size of a file is not the file");
  assert.equal(new Date(String(row.expires_at)).getTime(), NOW, "no clock runs on nothing");

  const missing = await loadDocumentForAnalysis(uid(), NOW);
  assert.equal(missing.bytes, null);
  assert.match(missing.unavailableReason, /no original file was captured/i);
});

test("retention on: the bytes come back byte for byte", async () => {
  const f = await retainingWorkspace();
  const bytes = resumeBytes();
  const captured = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: uid(),
    bytes,
    nowMs: NOW,
  });
  assert.ok(captured?.retained);

  const row = await rawRow(captured!.documentId);
  isStored(row);
  assert.deepEqual([...(row.content as Uint8Array)], [...bytes]);
  assert.equal(Number(row.retention_days), DEFAULT_RETENTION_DAYS);

  // The lineage id is kept as a digest: files from one original still have to be
  // findable, and a leaked table still must not name anybody's tool.
  assert.match(String(row.xmp_ids_hash), /^[0-9a-f]{64}$/);
  assert.ok(!String(row.xmp_ids_hash).includes("7E31-76C2"), "no plaintext id is stored");
});

test("an identity document is refused twice, and two identical resumes are two rows", async () => {
  const f = await retainingWorkspace();
  const bytes = resumeBytes();
  const idCard = await captureUploadedDocument({
    ...f,
    filename: "aadhaar-front.jpg",
    mediaType: "image/jpeg",
    ingestJobId: uid(),
    bytes,
    nowMs: NOW,
  });
  const panCard = await captureUploadedDocument({
    ...f,
    filename: "PAN card scan.pdf",
    mediaType: "application/pdf",
    ingestJobId: uid(),
    bytes,
    nowMs: NOW,
  });
  assert.equal(idCard?.docClass, "id");
  assert.equal(idCard?.retained, false, "an org saying yes is not the person saying yes");
  assert.equal(panCard?.contentState, "refused");

  for (const captured of [idCard, panCard]) {
    const row = await rawRow(captured!.documentId);
    assert.equal(row.content, null);
    assert.equal(row.sha256, "", "a hash of an Aadhaar scan is still a hash of an Aadhaar scan");
    assert.equal(row.xmp_ids_hash, "");
  }

  // Two *resumes* with the same bytes: the second candidate did nothing wrong and
  // must still get their own row, their own binding and their own evidence.
  const priya = await captureUploadedDocument({
    ...f,
    filename: "priya.pdf",
    mediaType: "application/pdf",
    ingestJobId: uid(),
    bytes,
    nowMs: NOW,
  });
  const kiran = await captureUploadedDocument({
    ...f,
    filename: "kiran.pdf",
    mediaType: "application/pdf",
    ingestJobId: uid(),
    bytes,
    nowMs: NOW,
  });
  assert.ok(priya?.retained && kiran?.retained);
  assert.notEqual(priya!.documentId, kiran!.documentId);

  const sql = await getSql();
  const digest = String((await rawRow(priya!.documentId)).sha256);
  const sameContent = await sql<{ n: number | string }>`
    select count(*) as n from documents
    where org_id = ${f.orgId} and sha256 = ${digest} and content_state = 'stored'`;
  assert.equal(Number(sameContent[0].n), 2, "a duplicate is a query, not a constraint");

  const refusal = await loadDocumentForAnalysis(uid(), NOW);
  assert.match(refusal.unavailableReason, /no original file was captured/i);
});

test("the queue tells the store whose file it turned out to be", async () => {
  const f = await retainingWorkspace();
  const jobId = uid();
  const captured = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: jobId,
    bytes: resumeBytes(),
    nowMs: NOW,
  });
  const neighbour = await captureUploadedDocument({
    ...f,
    filename: "other-resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: uid(),
    bytes: resumeBytes("uuid:A-DIFFERENT-JOB"),
    nowMs: NOW,
  });

  const applicationId = uid();
  const candidateId = uid();
  assert.equal(
    await bindDocumentToApplication({ ingestJobId: jobId, candidateId, applicationId }),
    1,
    "one row, and only the row that arrived under that job",
  );
  const bound = await documentsForApplication(applicationId);
  assert.equal(bound.length, 1);
  assert.equal(bound[0].id, captured!.documentId);
  assert.equal(bound[0].candidateId, candidateId);
  assert.equal(bound[0].expiresAtMs, HORIZON);
  assert.equal((await documentsForApplication(uid())).length, 0, "the neighbour stayed unbound");
  assert.equal(
    (await rawRow(neighbour!.documentId)).candidate_id,
    null,
    "unbound means its own row still names nobody",
  );

  assert.equal(
    await bindDocumentToApplication({
      ingestJobId: jobId,
      candidateId: uid(),
      applicationId: uid(),
    }),
    0,
    "a re-run does not move an already-bound verdict onto a new person",
  );
  assert.equal(await bindDocumentToApplication({ ingestJobId: uid() }), 0, "nobody to bind");
  assert.equal(
    await bindDocumentToApplication({ ingestJobId: uid(), candidateId: uid() }),
    0,
    "a job the store never saw is not a row to claim",
  );
});

test("readable bytes stop at the clock, not at the sweep", async () => {
  const f = await retainingWorkspace();
  const jobId = uid();
  const applicationId = uid();
  const captured = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: jobId,
    bytes: resumeBytes(),
    nowMs: NOW,
  });
  await bindDocumentToApplication({ ingestJobId: jobId, candidateId: uid(), applicationId });

  const readable = await loadDocumentForAnalysis(applicationId, NOW + DAY);
  assert.ok(readable.bytes, "day one of ninety is still held");
  assert.equal(readable.unavailableReason, "");

  // Pull the expiry forward to a day from now, then read it two days from now —
  // the row still claims `stored` and is still not readable. The state column is
  // the slow correction; the read gate is the one that keeps the promise.
  const sql = await getSql();
  await sql`
    update documents set expires_at = ${new Date(NOW + 2 * DAY).toISOString()}
    where id = ${captured!.documentId}`;
  const late = await loadDocumentForAnalysis(applicationId, NOW + 3 * DAY);
  assert.equal(late.bytes, null);
  assert.match(late.unavailableReason, /not retained past/i);
  assert.equal(
    (await rawRow(captured!.documentId)).content_state,
    "stored",
    "no sweep had visited yet",
  );

  // The sweep agrees with the gate, to the millisecond, inclusively.
  assert.equal((await purgeExpiredDocumentBytes(f.orgId, NOW + 2 * DAY - 1)).purged, 0);
  assert.equal((await purgeExpiredDocumentBytes(f.orgId, NOW + 2 * DAY)).purged, 1);

  const purged = await rawRow(captured!.documentId);
  assert.equal(purged.content, null);
  assert.equal(purged.content_state, "purged");
  assert.ok(purged.purged_at, "and the purge is dated");
  assert.equal(Number(purged.size_bytes), resumeBytes().length, "the size stays");
  assert.match(
    String(purged.sha256),
    /^[0-9a-f]{64}$/,
    "the digest stays: a verdict has to stay explainable after its file is gone",
  );
  assert.match(String(purged.xmp_ids_hash), /^[0-9a-f]{64}$/);
  assert.equal(purged.doc_class, "resume");
  assert.equal(
    (await purgeExpiredDocumentBytes(f.orgId, NOW + 9 * DAY)).purged,
    0,
    "once, not repeatedly",
  );

  const afterPurge = await loadDocumentForAnalysis(applicationId, NOW + 9 * DAY);
  assert.match(afterPurge.unavailableReason, /not retained past the verification window/);
});

test("switching retention off stops holding what was already held", async () => {
  const f = await retainingWorkspace();
  const resume = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    bytes: resumeBytes(),
    nowMs: NOW,
  });
  const marksheet = await captureUploadedDocument({
    ...f,
    filename: "marksheet.pdf",
    mediaType: "application/pdf",
    bytes: resumeBytes("uuid:MARKSHEET"),
    nowMs: NOW,
  });
  assert.ok(resume?.retained && marksheet?.retained);

  const off = await setByteRetention({
    orgId: f.orgId,
    userId: f.userId,
    byteRetention: false,
    nowMs: NOW,
  });
  assert.deepEqual(off, {
    byteRetention: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
    purged: 2,
  });
  for (const captured of [resume, marksheet]) {
    const row = await rawRow(captured!.documentId);
    assert.equal(row.content, null);
    assert.equal(row.content_state, "purged");
    assert.equal(row.consent_basis, "", "and no consent claim survives the switch");
  }

  // Turning it back on does not resurrect the earlier files.
  await setByteRetention({ orgId: f.orgId, userId: f.userId, byteRetention: true, nowMs: NOW });
  const fresh = await captureUploadedDocument({
    ...f,
    filename: "new-resume.pdf",
    mediaType: "application/pdf",
    bytes: resumeBytes("uuid:FRESH"),
    nowMs: NOW,
  });
  assert.equal(fresh?.retained, true);
  assert.equal((await rawRow(resume!.documentId)).content, null);
});

test("a withdrawal of the forensics purpose removes the file, not the verdict", async () => {
  const f = await retainingWorkspace();
  const jobId = uid();
  const candidateId = uid();
  const applicationId = uid();
  const captured = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: jobId,
    bytes: resumeBytes(),
    nowMs: NOW,
  });
  await bindDocumentToApplication({ ingestJobId: jobId, candidateId, applicationId });

  assert.deepEqual(
    await purgeDocumentBytesForSubject({
      orgId: f.orgId,
      candidateId,
      applicationIds: [applicationId],
      nowMs: NOW + DAY,
    }),
    { purged: 1 },
  );
  const row = await rawRow(captured!.documentId);
  assert.equal(row.content, null);
  assert.equal(row.sha256, "", "nothing derived from the bytes survives the withdrawal");
  assert.equal(row.xmp_ids_hash, "");
  assert.equal(row.content_state, "purged");
  assert.equal(row.consent_basis, "");
  assert.equal(row.candidate_id, candidateId, "the row stays: a verdict must stay explainable");
  assert.equal(row.application_id, applicationId);

  const unreadable = await loadDocumentForAnalysis(applicationId, NOW + DAY);
  assert.match(unreadable.unavailableReason, /not retained past/i);
});

test("erasure reaches the rows bound to a person, an application or only a job", async () => {
  const f = await retainingWorkspace();
  const other = await workspace("Other Store Test Co");
  const candidateId = uid();
  const applicationId = uid();
  const boundJob = uid();
  const orphanJob = uid();

  const bound = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: boundJob,
    bytes: resumeBytes(),
    nowMs: NOW,
  });
  await bindDocumentToApplication({ ingestJobId: boundJob, candidateId, applicationId });

  // A file whose candidate was never learned: only the job connects it to a person.
  const orphan = await captureUploadedDocument({
    ...f,
    filename: "certificate.pdf",
    mediaType: "application/pdf",
    ingestJobId: orphanJob,
    bytes: resumeBytes("uuid:ORPHAN"),
    nowMs: NOW,
  });

  // Somebody else's workspace, same candidate id: not this erasure's business.
  const elsewhere = await captureUploadedDocument({
    ...other,
    filename: "their-resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: uid(),
    bytes: resumeBytes("uuid:ELSEWHERE"),
    nowMs: NOW,
  });
  const sql = await getSql();
  await sql`
    update documents set candidate_id = ${candidateId} where id = ${elsewhere!.documentId}`;

  assert.equal(
    await forgetCandidateDocuments({ orgId: f.orgId, candidateId, jobIds: [orphanJob] }),
    2,
    "the person's own row and the job-only row, and nothing else",
  );
  const [mine] = await sql<{ n: number | string }>`
    select count(*) as n from documents where org_id = ${f.orgId}`;
  assert.equal(Number(mine.n), 0);
  assert.equal(
    Number(
      (
        await sql<{ n: number | string }>`
    select count(*) as n from documents where id = ${elsewhere!.documentId}`
      )[0].n,
    ),
    1,
  );
  assert.equal(
    (await documentsForApplication(applicationId)).length,
    0,
    "and the application it belonged to can no longer be read",
  );
  assert.ok(orphan && bound);

  // Empty id lists are the ordinary case, not a crash: a person with no
  // applications yet, and no jobs their file arrived under.
  assert.equal(await forgetCandidateDocuments({ orgId: f.orgId, candidateId: uid() }), 0);
  assert.deepEqual(await purgeDocumentBytesForSubject({ orgId: f.orgId, candidateId: uid() }), {
    purged: 0,
  });
});

/**
 * The refusal is in force at the door, not at the sweep.
 *
 * The row below still has its bytes: a withdrawal whose purge has not run, or
 * failed, or is running behind this read, must still not hand a document to a
 * forensic arm. This is the case the whole `content_state` design would quietly
 * lose if the only gate were the sweep — the state says `stored`, and the person
 * has said no.
 */
test("a recorded withdrawal refuses the bytes even while they are still in the column", async () => {
  const f = await retainingWorkspace();
  const jobId = uid();
  const candidateId = uid();
  const applicationId = uid();
  const captured = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: jobId,
    bytes: resumeBytes(),
    nowMs: NOW,
  });
  await bindDocumentToApplication({ ingestJobId: jobId, candidateId, applicationId });
  const sql = await getSql();
  // The row a person's portal writes when they turn the file purpose off. Inserted
  // here rather than through `withdrawConsent` because that call also purges, and
  // the point of this test is the state where the purge has not happened.
  await sql`
    insert into consent_records (
      id, org_id, subject_type, subject_id, purpose, lawful_basis, granted, source,
      meta_json, notice_version, granted_at, withdrawn_at
    ) values (
      ${uid()}, ${f.orgId}, ${"candidate"}, ${candidateId}, ${"document_forensics"},
      ${"consent"}, ${false}, ${"withdrawal"}, ${"{}"}, ${"v1"}, ${new Date(NOW).toISOString()},
      ${new Date(NOW).toISOString()}
    )`;

  assert.equal((await rawRow(captured!.documentId)).content instanceof Uint8Array, true);
  const loaded = await loadDocumentForAnalysis(applicationId, NOW);
  assert.equal(loaded.bytes, null);
  assert.match(loaded.unavailableReason, /asked us not to keep their document/i);
  const gate = await documentBytesAvailableForApplication(applicationId, NOW);
  assert.equal(gate.available, false);
  assert.match(gate.reason, /asked us not to keep/i);
});

/**
 * The two read doors must not disagree.
 *
 * The ladder asks the cheap question to set `hasRawBytes`; the arm asks the
 * expensive one to get the bytes. If those ever answered differently, a report
 * would claim a byte-level check ran on a document no arm was handed — which is
 * the exact failure the coverage rows exist to prevent.
 */
test("the cheap gate and the heavy door give the same answer, in every state", async () => {
  const f = await retainingWorkspace();
  const plain = await workspace("Plain Gate Co");

  const cases: Array<{ org: typeof f; applicationId: string; filename: string; expect: boolean }> =
    [
      // A file we hold, inside its clock.
      { org: f, applicationId: uid(), filename: "resume.pdf", expect: true },
      // An identity document: the row exists, and the bytes never did.
      { org: f, applicationId: uid(), filename: "aadhaar-front.jpg", expect: false },
      // A workspace that has not turned retention on: metadata only.
      { org: plain, applicationId: uid(), filename: "resume.pdf", expect: false },
    ];

  for (const testCase of cases) {
    const jobId = uid();
    const captured = await captureUploadedDocument({
      ...testCase.org,
      filename: testCase.filename,
      mediaType: "application/pdf",
      ingestJobId: jobId,
      bytes: resumeBytes(`uuid:${testCase.applicationId}`),
      nowMs: NOW,
    });
    assert.ok(captured);
    await bindDocumentToApplication({ ingestJobId: jobId, applicationId: testCase.applicationId });
    const gate = await documentBytesAvailableForApplication(testCase.applicationId, NOW);
    const door = await loadDocumentForAnalysis(testCase.applicationId, NOW);
    assert.equal(gate.available, testCase.expect, testCase.filename);
    assert.equal(door.bytes !== null, testCase.expect, `${testCase.filename} through the door`);
    assert.equal(gate.reason, door.unavailableReason, "and they explain it the same way");
  }

  // The fourth case is the one a clock creates: held at capture, expired by the
  // time anybody asks, and neither door is allowed to notice the difference.
  const aging = uid();
  const agedJob = uid();
  const captured = await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    ingestJobId: agedJob,
    bytes: resumeBytes(),
    nowMs: NOW,
  });
  await bindDocumentToApplication({ ingestJobId: agedJob, applicationId: aging });
  const late = NOW + DEFAULT_RETENTION_DAYS * DAY + 1;
  const gate = await documentBytesAvailableForApplication(aging, late);
  const door = await loadDocumentForAnalysis(aging, late);
  assert.equal(gate.available, false);
  assert.equal(door.bytes, null);
  assert.match(gate.reason, /not retained past the verification window/);
  assert.equal(gate.reason, door.unavailableReason);
  assert.equal(
    (await rawRow(captured!.documentId)).content_state,
    "stored",
    "an expired row is unreadable before it is swept: the clock gates reads, the sweep reclaims disk",
  );
});

/**
 * The reading the byte arms are handed, and the identity of what was read.
 *
 * Three things only this door can prove. A grade comparison needs the resume
 * *and* the marksheet, so the answer is per application rather than per file; the
 * fingerprint has to describe the set, unchanged by upload order, because it is
 * what splits one candidate's cache key when the prose did not change and the
 * file did; and a workspace that never opted in gets `""` rather than a hash of
 * nothing, because `""` is the value that leaves every pre-forensics report
 * readable instead of re-grading it.
 */
test("the byte arms are handed every readable file, with the set's own identity", async () => {
  const f = await retainingWorkspace("Analysis Door Co");
  const resume = fixtureById("resume-classic");
  const certificate = fixtureById("certificate-reprint");

  const shelf = async (applicationId: string, files: readonly ForensicFixture[]) => {
    for (const file of files) {
      const jobId = uid();
      const captured = await captureUploadedDocument({
        ...f,
        filename: file.filename,
        mediaType: "application/pdf",
        ingestJobId: jobId,
        bytes: file.build(),
        nowMs: NOW,
      });
      assert.ok(captured);
      await bindDocumentToApplication({ ingestJobId: jobId, applicationId });
    }
    return applicationId;
  };

  const both = await shelf(uid(), [certificate, resume]);
  const read = await analyzeDocumentsForApplication(both, NOW);
  assert.equal(read.unavailableReason, "");
  assert.deepEqual(
    read.documents.map((d) => d.filename).sort(),
    ["acme-certificate-reprint.pdf", "priya-resume-classic.pdf"],
    "the certificate is in the list the grade arm reads",
  );
  assert.deepEqual(
    read.documents.map((d) => [d.filename.slice(0, 4), d.docClass, d.format, d.readError]).sort(),
    [["acme", "certificate", "pdf", ""], ["priy", "resume", "pdf", ""]],
    "classified by the store, read by the domain",
  );
  assert.match(read.documentFingerprint, /^[0-9a-f]{64}$/);

  // The same two files in the other order, for another candidate: same key.
  const reversed = await shelf(uid(), [resume, certificate]);
  assert.equal(
    (await analyzeDocumentsForApplication(reversed, NOW)).documentFingerprint,
    read.documentFingerprint,
    "upload order is not evidence",
  );

  // One more file, one more key — and the cap decides which file is in it.
  const withEdit = await shelf(uid(), [resume, certificate, fixtureById("resume-edited")]);
  const three = await analyzeDocumentsForApplication(withEdit, NOW);
  assert.notEqual(three.documentFingerprint, read.documentFingerprint);
  assert.equal(three.documents.length, 3);
  const capped = await analyzeDocumentsForApplication(withEdit, NOW, 1);
  assert.equal(capped.documents.length, 1, "a slate of two hundred is not a licence to read gigabytes");
  assert.notEqual(capped.documentFingerprint, three.documentFingerprint, "of one file, or of three");

  const plain = await workspace("No Door Co");
  const plainApp = uid();
  const plainJob = uid();
  await captureUploadedDocument({
    ...plain,
    filename: resume.filename,
    mediaType: "application/pdf",
    ingestJobId: plainJob,
    bytes: resume.build(),
    nowMs: NOW,
  });
  await bindDocumentToApplication({ ingestJobId: plainJob, applicationId: plainApp });
  const nothing = await analyzeDocumentsForApplication(plainApp, NOW);
  assert.deepEqual(nothing.documents, []);
  assert.equal(nothing.documentFingerprint, "", "no files, no salt");
  assert.match(nothing.unavailableReason, /does not retain document bytes/i);
});

test("the shelf tells the workspace what is on it", async () => {
  const f = await retainingWorkspace("Summary Store Co");
  const bytes = resumeBytes();
  await captureUploadedDocument({
    ...f,
    filename: "resume.pdf",
    mediaType: "application/pdf",
    bytes,
    nowMs: NOW,
  });
  await captureUploadedDocument({
    ...f,
    filename: "aadhaar-card.pdf",
    mediaType: "application/pdf",
    bytes,
    nowMs: NOW,
  });
  await captureUploadedDocument({
    ...f,
    filename: "marksheet.pdf",
    mediaType: "application/pdf",
    bytes,
    nowMs: NOW - DEFAULT_RETENTION_DAYS * DAY - DAY,
  });

  const summary = await documentStoreSummaryForOrg(f.orgId);
  assert.equal(summary.byteRetention, true);
  assert.equal(summary.retentionDays, DEFAULT_RETENTION_DAYS);
  assert.deepEqual(summary.counts, { stored: 2, purged: 0, refused: 1, not_retained: 0 });
  // The expired-but-not-yet-swept row is still `stored` in the column, so it
  // counts as held; the sweep is what turns it into `purged`, and the summary is
  // the sweep's witness rather than a second opinion about the clock.
  assert.equal(summary.bytesHeld, bytes.length * 2);
  assert.ok(
    summary.newestExpiryMs !== null && summary.newestExpiryMs > NOW,
    "the newest expiry is the date the workspace should expect",
  );

  const never = await documentStoreSummaryForOrg((await workspace("Empty Shelf Co")).orgId);
  assert.deepEqual(never, {
    byteRetention: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
    counts: { stored: 0, purged: 0, refused: 0, not_retained: 0 },
    bytesHeld: 0,
    newestExpiryMs: null,
  });
});

/**
 * The store running inside the pipeline, rather than next to it.
 *
 * Every test above calls `bindDocumentToApplication` from this file, which proves
 * the function but not the wiring — the interesting half is that the *ingest
 * queue* is the caller. So this one builds what `appendIngestItems` leaves behind
 * (a role, a batch, a `queued` job and a file captured against that job id) and
 * then runs the real `processQueueSlice`, asserting that the rank path handed the
 * bytes to a person without ever being told about them.
 *
 * It also asserts the second handoff, on `verification_jobs`, sits next to the
 * first: one success branch, two best-effort callers, and a documents table that
 * cannot change what the rank wrote.
 */
test("the ingest queue binds the file it ranked, and never tells the rank about it", async () => {
  const sql = await getSql();
  const f = await retainingWorkspace("Orchestration Store Co");
  const roleId = uid();
  await sql`
    insert into roles (id, user_id, company_name, company_stage, title, location, status, org_id)
    values (${roleId}, ${f.userId}, 'Nimbus', 'growth', 'Senior Backend Engineer', 'Bengaluru',
            'open', ${f.orgId})`;
  const batchId = uid();
  await sql`
    insert into ingest_batches (id, user_id, role_id, source_name, status, total_count)
    values (${batchId}, ${f.userId}, ${roleId}, 'orchestration test', 'queued', 1)`;
  const jobId = uid();
  await sql`
    insert into ingest_jobs (id, user_id, batch_id, role_id, filename, resume_text, status, org_id)
    values (${jobId}, ${f.userId}, ${batchId}, ${roleId}, 'priya-ramesh.pdf',
            ${`PRIYA RAMESH\nSenior Backend Engineer | Bengaluru\nBackend engineer with 7 years of experience\nbuilding high-throughput services for fintech.\nNimbus Technologies — Senior Backend Engineer, Mar 2019 - Present`},
            'queued', ${f.orgId})`;

  // Upload time knows only the job. This is the row the rank has to adopt.
  const captured = await captureUploadedDocument({
    ...f,
    filename: "priya-ramesh.pdf",
    mediaType: "application/pdf",
    bytes: resumeBytes(),
    ingestJobId: jobId,
    roleId,
    nowMs: NOW,
  });
  assert.ok(captured);
  assert.equal((await rawRow(captured.documentId)).candidate_id, null);

  const result = await processQueueSlice({ userId: f.userId, maxJobs: 1, budgetMs: 45_000 });
  assert.equal(result.completed, 1, `the rank itself must succeed: ${JSON.stringify(result)}`);

  const [job] = await sql<{ status: string; application_id: string | null }>`
    select status, application_id from ingest_jobs where id = ${jobId} limit 1`;
  assert.equal(job.status, "completed");
  assert.ok(job.application_id, "the queue produced an application");

  const row = await rawRow(captured.documentId);
  assert.equal(row.application_id, job.application_id, "the file now belongs to that application");
  assert.ok(row.candidate_id, "and to that person");
  assert.equal(
    (await documentBytesAvailableForApplication(String(job.application_id))).available,
    true,
    "which is what makes the ladder's `hasRawBytes` truthful",
  );

  const [verification] = await sql<{ n: string }>`
    select count(*)::text as n from verification_jobs where application_id = ${job.application_id}`;
  assert.equal(verification.n, "1", "the other handoff in the same branch still ran");
});

/**
 * The three callers a store cannot survive without, read where they are written.
 *
 * These are the ones a functional test cannot reach: the upload path is a server
 * function with a request context, and the panel is a component. What can be
 * proved from here is the shape each one must keep — the store asks permission of
 * the org rather than the caller, never of the caller rather than the org, and a
 * store that throws costs a forensic check and nothing else. `queue.test.ts` uses
 * the same technique for the same reason: the failure mode is somebody editing the
 * call away, and no assertion about behaviour catches that from the other side.
 */
const source = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\s+/g, " ");

test("the upload path captures bytes as a witness, not as a step", () => {
  const batch = source("../../ingest/api/batch.ts");
  const loop = batch.indexOf("for (const item of data.items)");
  assert.ok(loop > -1, "one append loop is where an upload becomes jobs");
  const authority = batch.slice(0, loop);
  assert.match(authority, /if \(data\.captureBytes\)/, "the caller's flag is what opens the door");
  assert.match(authority, /byteRetentionForOrg/, "and the org's setting is what decides");
  assert.match(authority, /let mayRetainBytes = false/, "a failed read leaves it not retaining");
  assert.match(authority, /console\.error\("\[vetta-documents\]"/, "and says so in the log");

  const success = batch.slice(loop, batch.indexOf("} catch (err) { failed += 1", loop));
  assert.ok(
    success.includes("insert into ingest_jobs"),
    "the file is captured after the job it belongs to exists",
  );
  assert.match(success, /if \(mayRetainBytes && bytes && jobIds\.length\)/);
  assert.match(success, /captureUploadedDocument/);
  const capture = success.slice(success.indexOf("if (mayRetainBytes"));
  assert.match(capture, /console\.error\("\[vetta-documents\]"/, "swallowed at the call");
  assert.ok(
    !/failed \+= 1|added \+= 1|errors\.push/.test(capture),
    "the capture cannot move the counts the recruiter sees",
  );

  // The client's flag has to actually arrive, or the door above never opens.
  assert.match(source("../../recruiting/ui/batch-ingest-dialog.tsx"), /captureBytes: true/);
});

test("the ladder is told about bytes by the store, not by the settings row", () => {
  const queue = source("./queue.server.ts");
  const gate = queue.indexOf("let hasRawBytes = false");
  assert.ok(gate > -1, "the worker starts as unsure as the store can make it");
  const window = queue.slice(gate, queue.indexOf("runVerification", gate));
  assert.match(window, /documentBytesAvailableForApplication/);
  assert.ok(
    !/byteRetentionForOrg/.test(window),
    "an org that opted in and a candidate whose file is gone are different answers",
  );
});

test("the workspace can see and change its own shelf", () => {
  const api = source("../api/verification-api.ts");
  assert.match(api, /export const getDocumentStore = createServerFn\(\{ method: "GET" \}\)/);
  assert.match(
    api,
    /export const setDocumentStoreRetention = createServerFn\(\{ method: "POST" \}\)/,
  );
  assert.match(api, /documentStoreSummaryForOrg/);
  assert.match(api, /setByteRetention/);
  // Both wires take the org from the session the middleware verified, never from
  // the caller — otherwise one workspace could read, or switch off, another's shelf.
  const at = api.indexOf("export const setDocumentStoreRetention");
  for (const wire of [api.slice(api.indexOf("export const getDocumentStore"), at), api.slice(at)]) {
    assert.match(wire, /\.middleware\(\[authMiddleware\]\)/);
    assert.match(wire, /ensureUserOrg\(context\.userId\)/);
    assert.ok(!/orgId: (data|input)/.test(wire), "no org id arrives from the page");
  }
  assert.ok(
    !/runVerification|adjudicate\(/.test(api),
    "nothing on this surface can ask for a verdict — the panel is a drawer, not a lever",
  );

  const panel = source("../ui/document-store-panel.tsx");
  assert.match(panel, /useDocumentStoreQuery\(\)/);
  assert.match(panel, /setDocumentStoreRetention/);
  assert.match(panel, /Aadhaar/, "the one thing that is never stored is said out loud");
  assert.match(source("../../../routes/app/roles.$roleId.tsx"), /<DocumentStorePanel \/>/);
});
