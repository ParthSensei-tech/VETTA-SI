/**
 * The store's privacy rules, tested where they are decided.
 *
 * These are the four questions an auditor asks about a table of other people's
 * documents: what counts as a file you may not hold, what turns holding on, when
 * the clock runs out, and what is left afterwards. Each one has a single pure
 * function here, so a change to the posture is a change to a tested line and not
 * a change to a query nobody thought about.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RETENTION_DAYS,
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
} from "./documents.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 8);

test("an identity document is recognised from the name a recruiter would actually use", () => {
  for (const filename of [
    "aadhaar-front.jpg",
    "Adhaar_Card.pdf",
    "PAN card scan.pdf",
    "pan-card.png",
    "voter_id.jpg",
    "passport_photo_page.pdf",
    "driving-licence.jpg",
    "govt-id-back.png",
    "national id.pdf",
    "dl_front.jpg",
  ])
    assert.equal(classifyDocument({ filename, mediaType: "" }), "id", `${filename} is an ID`);

  // An image with nothing to say about itself is not assumed to be a resume:
  // "some photo of some document" is the shape an ID card arrives in.
  assert.equal(classifyDocument({ filename: "IMG_2043.jpg", mediaType: "image/jpeg" }), "other");
});

test("certificates and resumes are told apart, and an unnamed text file is the resume", () => {
  for (const filename of [
    "marksheet.pdf",
    "degree-certificate.pdf",
    "consolidated.pdf",
    "transcript_2019.pdf",
    "diploma scan.pdf",
    "cert-aws.pdf",
  ])
    assert.equal(
      classifyDocument({ filename, mediaType: "application/pdf" }),
      "certificate",
      `${filename} is a certificate`,
    );

  for (const filename of ["resume.pdf", "Rahul_CV.pdf", "curriculum-vitae.docx", "profile.pdf"])
    assert.equal(classifyDocument({ filename, mediaType: "" }), "resume");

  // The drop is a folder of files named after people: the default has to be the
  // resume, or every candidate loses their forensic arms to a naming habit.
  assert.equal(classifyDocument({ filename: "Rahul Mehta.pdf", mediaType: "application/pdf" }), "resume");
});

test("when a name says both, the refusal wins", () => {
  assert.equal(classifyDocument({ filename: "resume_with_aadhaar.pdf", mediaType: "" }), "id");
});

test("retention is a pair of independent noes", () => {
  const table: Array<[DocClass, boolean, ContentState]> = [
    ["resume", true, "stored"],
    ["certificate", true, "stored"],
    ["other", true, "stored"],
    ["resume", false, "not_retained"],
    ["certificate", false, "not_retained"],
    // The ID row that must never exist: bytes refused even after an org turns
    // retention on, because the org's setting is not a licence for that file.
    ["id", true, "refused"],
    ["id", false, "refused"],
  ];
  for (const [docClass, byteRetention, expected] of table) {
    assert.equal(contentStateFor({ docClass, byteRetention }), expected, `${docClass}/${byteRetention}`);
    assert.equal(retainsBytes({ docClass, byteRetention }), expected === "stored");
  }
});

test("no digest is kept when no bytes are kept", () => {
  const sha = "a".repeat(64);
  assert.equal(digestFor({ docClass: "resume", byteRetention: true, sha256: sha }), sha);
  assert.equal(
    digestFor({ docClass: "id", byteRetention: true, sha256: sha }),
    "",
    "a hash of an Aadhaar scan is still a hash of an Aadhaar scan",
  );
  assert.equal(digestFor({ docClass: "resume", byteRetention: false, sha256: sha }), "");
});

test("the clock is clamped, not trusted", () => {
  assert.equal(clampRetentionDays(null), MAX_RETENTION_DAYS);
  assert.equal(clampRetentionDays(undefined), MAX_RETENTION_DAYS);
  assert.equal(clampRetentionDays(Number.NaN), MAX_RETENTION_DAYS);
  assert.equal(clampRetentionDays(0), MAX_RETENTION_DAYS, "zero would purge on arrival");
  assert.equal(clampRetentionDays(-5), MAX_RETENTION_DAYS);
  assert.equal(clampRetentionDays(30), 30);
  assert.equal(clampRetentionDays(365), MAX_RETENTION_DAYS, "a year of resumes is not the posture");
  assert.equal(expiryFrom({ nowMs: NOW, retentionDays: 90 }), NOW + 90 * DAY);
  assert.equal(expiryFrom({ nowMs: NOW, retentionDays: 999 }), NOW + MAX_RETENTION_DAYS * DAY);
});

test("the purge is one transition, and only ever from a file we still hold", () => {
  assert.equal(
    purgeTransition({ contentState: "stored", expiresAtMs: NOW, nowMs: NOW }),
    "purged",
    "expiry is inclusive: a row whose time has come is due now",
  );
  assert.equal(purgeTransition({ contentState: "stored", expiresAtMs: NOW + DAY, nowMs: NOW }), null);
  for (const state of ["purged", "refused", "not_retained"] as ContentState[])
    assert.equal(
      purgeTransition({ contentState: state, expiresAtMs: NOW - DAY, nowMs: NOW }),
      null,
      `${state} has no bytes to purge`,
    );
});

test("an expired row is already unreadable, before the clock has swept it", () => {
  assert.equal(bytesReadable({ contentState: "stored", expiresAtMs: NOW + DAY, nowMs: NOW }), true);
  assert.equal(
    bytesReadable({ contentState: "stored", expiresAtMs: NOW, nowMs: NOW }),
    false,
    "a purge that is five minutes late must not look like retention we still have",
  );
  for (const state of ["purged", "refused", "not_retained"] as ContentState[])
    assert.equal(bytesReadable({ contentState: state, expiresAtMs: NOW + 90 * DAY, nowMs: NOW }), false);
});

test("every way there are no bytes has its own sentence", () => {
  const reasons = (
    ["stored", "purged", "refused", "not_retained", "absent"] as (ContentState | "absent")[]
  ).map(bytesUnavailableReason);
  assert.equal(new Set(reasons).size, 5, "five shapes of absence, five explanations, none duplicated");
  assert.match(bytesUnavailableReason("refused"), /never stored/i);
  assert.match(bytesUnavailableReason("not_retained"), /does not retain/i);
  assert.match(bytesUnavailableReason("purged"), /not retained past/i);
  assert.match(
    bytesUnavailableReason("stored"),
    /not captured/,
    "a stored row that a check cannot read is the capture that never happened",
  );
  assert.match(
    bytesUnavailableReason("absent"),
    /no original file was captured/i,
    "a pasted resume has no file at all, which is not the same gap as an opted-out workspace",
  );
});

test("the lineage ids are the ones that survive a re-save", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  // The attribute form is what this repo's own fixture corpus writes; the
  // element form is what Adobe writes. Reading only one is a silent empty answer.
  assert.deepEqual(
    xmpLineageIds(
      bytes('<rdf:Description xmpMM:DocumentID="uuid:7E31-76C2" xmpMM:InstanceID="uuid:0B22"/>'),
    ),
    ["uuid:7E31-76C2"],
  );
  assert.deepEqual(
    xmpLineageIds(
      bytes(
        "<xmpMM:History><xmpMM:InstanceID>uuid:0B22</xmpMM:InstanceID>" +
          "<xmpMM:DocumentID>uuid:7E31-76C2</xmpMM:DocumentID>" +
          "<xmpMM:OriginalDocumentID>xmp.did:AA11-BB22</xmpMM:OriginalDocumentID></xmpMM:History>",
      ),
    ),
    ["uuid:7E31-76C2", "xmp.did:AA11-BB22"],
  );

  // InstanceID is deliberately not in the answer: it changes on every save, so
  // two files sharing it are the same file, and two files sharing a DocumentID
  // are relatives. Only the second one is a lineage.
  assert.deepEqual(
    xmpLineageIds(bytes("<xmpMM:InstanceID>uuid:0B22</xmpMM:InstanceID>")),
    [],
    "a save id is not an original id",
  );
  assert.deepEqual(
    xmpLineageIds(bytes('<rdf:Description xmpMM:DocumentID="not-an-urn"/>')),
    [],
    "a value that is not an id urn is not an id",
  );
  assert.deepEqual(xmpLineageIds(bytes("%PDF-1.7 no xmp packet here")), []);
  assert.deepEqual(xmpLineageIds(new Uint8Array(0)), [], "an empty file is not a lineage");
});
