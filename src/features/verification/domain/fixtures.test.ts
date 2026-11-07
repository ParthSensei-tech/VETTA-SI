import assert from "node:assert/strict";
import test from "node:test";
import { parseUploadToResumes } from "../../ingest/server/parse.server.ts";
import type { DocxPackage } from "./docx-bytes.ts";
import type { PdfStructure } from "./pdf-structure.ts";
import { orphanedLiterals, readPdfStructure, showTexts } from "./pdf-structure.ts";
import { readDocxPackage } from "./docx-bytes.ts";
import {
  docxFixtures,
  FORENSIC_FIXTURES,
  fixtureById,
  pdfFixtures,
  type DocxFixtureExpect,
  type ForensicFixture,
  type PdfFixtureExpect,
} from "./fixtures.ts";

/**
 * The corpus, checked against its own manifest and against production.
 *
 * Two independent things have to stay true about a fixture, and they fail in
 * opposite directions. It must still be a document: `parseUploadToResumes` —
 * the same function a recruiter's upload hits — has to read it, or the fixture
 * is testing a file no one would ever accept. And it must still be a *known*
 * document: every byte-level fact in its manifest has to hold, or the checks
 * built on top of it are graded against a fiction.
 *
 * The manifest holds facts only. No test here asserts a verdict — those are
 * V4's claim to make, and a corpus that pre-decided them would grade its own
 * homework.
 */

const pick = (source: Record<string, string>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, source[k]]));

/** Each manifest field, read out of the structure view. `kind` and `textContains` are asserted separately. */
const pdfFacts: Record<
  Exclude<keyof PdfFixtureExpect, "kind" | "textContains">,
  (s: PdfStructure, e: PdfFixtureExpect) => unknown
> = {
  tableKind: (s) => s.tableKind,
  eofCount: (s) => s.eofCount,
  tableChain: (s) => s.tableChain,
  scannedObjectNums: (s) => [...new Set(s.objects.map((o) => o.num))].sort((a, b) => a - b),
  orphanedObjectNums: (s) => s.orphaned.map((o) => o.num).sort((a, b) => a - b),
  objStmMemberNums: (s) => [...s.objStmMembers].sort((a, b) => a - b),
  unreferencedFromRoot: (s) => s.unreferencedFromRoot,
  producers: (s) => s.producers,
  creators: (s) => s.creators,
  creationDates: (s) => s.creationDates,
  modDates: (s) => s.modDates,
  baseFonts: (s) => s.baseFonts,
  xmpDocumentIds: (s) => s.xmp.documentIds,
  xmpInstanceIds: (s) => s.xmp.instanceIds,
  xmpCreateDates: (s) => s.xmp.createDates,
  xmpModifyDates: (s) => s.xmp.modifyDates,
  orphanedTextContains: (s, e) =>
    e.orphanedTextContains.filter((t) => orphanedLiterals(s).includes(t)),
  showTexts: (s) => showTexts(s),
};

const docxFacts: Record<
  Exclude<keyof DocxFixtureExpect, "kind" | "textContains">,
  (p: DocxPackage, e: DocxFixtureExpect) => unknown
> = {
  memberNames: (p) => [...p.names].sort(),
  core: (p, e) => pick(p.core, Object.keys(e.core)),
  app: (p, e) => pick(p.app, Object.keys(e.app)),
  rsids: (p) => p.rsids,
  rootRsId: (p) => p.rootRsId,
  trackChanges: (p) => p.trackChanges,
};

test("the corpus is a set of distinct, described documents", () => {
  const ids = FORENSIC_FIXTURES.map((f) => f.id);
  const names = FORENSIC_FIXTURES.map((f) => f.filename);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
  for (const f of FORENSIC_FIXTURES) {
    assert.ok(f.reason.length > 20, `${f.id} has no reason`);
    assert.ok(f.build().byteLength > 0, `${f.id} is empty`);
    assert.equal(
      f.filename.endsWith(f.expect.kind === "pdf" ? ".pdf" : ".docx"),
      true,
      `${f.id} is a ${f.expect.kind} named ${f.filename}`,
    );
  }
  // Both halves have to be represented or the manifest cannot say which rule failed.
  assert.ok(pdfFixtures.length >= 4);
  assert.ok(docxFixtures.length >= 3);
});

for (const f of FORENSIC_FIXTURES) {
  test(`production reads ${f.id}`, async () => {
    // The bytes are handed over un-copied on purpose: `build()` returns a fresh
    // buffer each call precisely because pdf.js detaches whatever it parses.
    const parsed = await parseUploadToResumes(f.filename, f.build());
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].filename, f.filename.replace(/^.*[/\\]/, ""));
    assert.ok(
      parsed[0].resumeText.length > 40,
      `${f.id}: below the ingest minimum of 40 characters`,
    );
    for (const want of f.expect.textContains)
      assert.ok(
        parsed[0].resumeText.includes(want),
        `${f.id}: extractor lost ${JSON.stringify(want)}`,
      );
  });
}

for (const f of pdfFixtures) {
  test(`pdf artifacts match ${f.id}'s manifest`, () => {
    const s = readPdfStructure(f.build());
    const e = f.expect;
    assert.equal(e.kind, "pdf");
    for (const [field, read] of Object.entries(pdfFacts))
      assert.deepEqual(read(s, e), e[field as keyof PdfFixtureExpect], `${f.id}.${field}`);
  });
}

for (const f of docxFixtures) {
  test(`docx package matches ${f.id}'s manifest`, () => {
    const p = readDocxPackage(f.build());
    const e = f.expect;
    assert.equal(e.kind, "docx");
    for (const [field, read] of Object.entries(docxFacts))
      assert.deepEqual(read(p, e), e[field as keyof DocxFixtureExpect], `${f.id}.${field}`);
  });
}

test("a fixture outlives being parsed, because the corpus is built and not cached", async () => {
  const f: ForensicFixture = fixtureById("resume-modern");
  const first = f.build();
  const parsed = await parseUploadToResumes(f.filename, first);
  assert.ok(parsed[0].resumeText.includes("Priya Sharma"));
  // Measured, not assumed: pdf.js transfers the buffer it is given, so a cached
  // fixture would read back as nothing for every caller after the first.
  assert.equal(first.byteLength, 0);
  assert.ok(readPdfStructure(f.build()).objects.length > 0);
});

test("the untouched modern file has the same history as the untouched classic one", () => {
  // The corpus's most important negative: two different writer shapes, and
  // nothing in either one for an orphan rule to find.
  for (const id of [
    "resume-classic",
    "resume-modern",
    "certificate-modern-flat",
    "resume-decoy-stream",
  ]) {
    const f = fixtureById(id);
    const s = readPdfStructure(f.build());
    assert.deepEqual(s.orphaned, [], id);
    assert.deepEqual(s.unreferencedFromRoot, [], id);
    assert.equal(s.eofCount, 1, id);
    assert.equal(s.tableChain, 1, id);
  }
});

test("only the edited and saved-twice fixtures abandon anything", () => {
  const abandoning = pdfFixtures
    .filter((f) => readPdfStructure(f.build()).orphaned.length > 0)
    .map((f) => f.id)
    .sort();
  assert.deepEqual(abandoning, ["resume-edited", "resume-two-saves"]);
});
