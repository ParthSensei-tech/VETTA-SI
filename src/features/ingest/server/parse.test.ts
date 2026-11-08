/**
 * A parse must not consume the file it parsed.
 *
 * The upload door decodes a dropped resume once and then uses that same
 * `Uint8Array` twice: first for the text, then for the document store. The second
 * use is the one that cannot say anything when it goes wrong — `captureUploadedDocument`
 * returns null on a zero-length file, by design, so a parser that leaves its
 * caller holding an empty view produces no row, no error and no log line, and the
 * person's forensic checks quietly report "needs the original file" about a file
 * that was in the request.
 *
 * That is not hypothetical: pdf.js *transfers* the buffer it is given, which
 * detaches the caller's view of it. PDFs were the only uploads the store refused
 * to see, and no test that handed the store its own bytes could notice. So these
 * tests assert the bytes, not the text.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ShareCandidate, ShareView } from "../../recruiting/domain/types.ts";
import { shareToPdf } from "../domain/pdf.ts";
import { decodeBase64, parseUploadToResumes } from "./parse.server.ts";

/** A genuine PDF — Vetta writes these itself for share exports. */
function uploadedPdf(): Uint8Array {
  const candidate: ShareCandidate = {
    applicationId: "app-1",
    candidateName: "Priya Ramesh",
    headline: "7 years, fintech",
    currentTitle: "Backend Engineer",
    currentCompany: "Nimbus Technologies",
    location: "Bengaluru",
    rankScore: 82,
    fitLabel: "Strong",
    rankSummary: "Built high-throughput services.",
    pipelineStatus: "shortlisted",
    screenVerdict: "advance",
    card: {
      candidate_name: "Priya Ramesh",
      headline: "7 years, fintech",
      fit_label: "Strong",
      summary: "Owns the payments ledger.",
      highlights: ["Go", "Postgres"],
      watchouts: [],
      interview_probes: [],
      location: "Bengaluru",
      availability: "60 days",
    },
  };
  const view: ShareView = {
    id: "share-1",
    token: "tok-1",
    kind: "slate",
    title: "Senior Backend Engineer — shortlist",
    roleTitle: "Senior Backend Engineer",
    companyName: "Nimbus Technologies",
    companyStage: "Series B",
    location: "Bengaluru",
    workMode: "hybrid",
    message: "Priya Ramesh owns the payments ledger.",
    recipientName: "Hiring",
    recipientEmail: "hiring@nimbus.example",
    exportedAt: new Date(Date.UTC(2026, 10, 8)).toISOString(),
    candidates: [candidate],
  };
  return shareToPdf(view);
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("the PDF parser leaves the caller's bytes intact", async () => {
  const bytes = uploadedPdf();
  const length = bytes.byteLength;
  const before = digest(bytes);

  const parsed = await parseUploadToResumes("priya-ramesh.pdf", bytes);

  assert.equal(parsed.length, 1, "and it did read the file");
  assert.match(parsed[0]!.resumeText, /Priya Ramesh/);
  assert.equal(bytes.byteLength, length, "the view the store is handed is not the empty one");
  assert.equal(digest(bytes), before, "the same bytes, in the same order, still readable");
});

test("the door's whole byte path ends in a file the store will accept", async () => {
  const original = uploadedPdf();
  const length = original.byteLength;
  const before = digest(original);

  // Exactly what `appendIngestItems` does with one dropped file.
  const bytes = decodeBase64(Buffer.from(original).toString("base64"));
  const parsed = await parseUploadToResumes("priya-ramesh.pdf", bytes);

  assert.ok(parsed[0]!.resumeText.length >= 40, "a resume a ranker can work with");
  assert.equal(bytes.length > 0, true, "a zero-length view here is a silent refusal downstream");
  assert.equal(bytes.byteLength, length);
  assert.equal(digest(bytes), before, "and the digest the row carries is the file's own");
});
