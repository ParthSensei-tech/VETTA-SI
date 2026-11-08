import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fixtureById, pdfFixtures, docxFixtures, type DocxFixtureExpect, type PdfFixtureExpect } from "./fixtures.ts";
import { readPdfStructure } from "./pdf-structure.ts";
import {
  analyzeDocument,
  documentGrades,
  earliestToolRelease,
  sentencePredecessor,
  type AbandonedLine,
  type DocumentForensics,
} from "./forensics.ts";

/**
 * The forensic reader, graded against the corpus it was written for.
 *
 * `fixtures.test.ts` proves the manifest still describes these bytes. This file
 * proves the *rules* read that manifest correctly, in both directions, and the
 * direction that costs more is the negative one: `resume-classic` and
 * `resume-modern` and `resume-decoy-stream` are pristine, and an analysis that
 * finds a tamper in any of them is not a detector, it is a liability. So every
 * fixture below is asserted for what it must NOT report as well as what it must.
 *
 * Nothing here asserts a verdict. `forensics.ts` reports differences; whether a
 * difference may accuse is the registry's decision, and it is tested in
 * `checks/document-forensics.test.ts`.
 */

const analyze = (id: string): DocumentForensics =>
  analyzeDocument({ bytes: fixtureById(id).build(), filename: fixtureById(id).filename });

const expect = <T>(id: string) => fixtureById(id).expect as T;

describe("the format sniff", () => {
  test("a file that is neither is reported, not guessed", () => {
    const jpeg = analyzeDocument({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]),
      filename: "aadhaar-front.jpg",
    });
    assert.equal(jpeg.format, "unknown");
    assert.match(jpeg.readError, /not a pdf or a docx/i);
    // The refusal is the point: an arm that saw `readError` and spoke anyway
    // would be forensicating a photograph with a PDF reader's assumptions.
    assert.deepEqual(jpeg.orphanedLines, []);
    assert.deepEqual(jpeg.anachronisms, []);
    assert.equal(jpeg.generations, 0);
  });

  test("an empty buffer and a truncated header cannot throw", () => {
    assert.equal(analyzeDocument({ bytes: new Uint8Array(0) }).readError, "The file is empty.");
    // `%PDF-` with nothing after it: a real reader reaches for a table that is
    // not there, and the analysis has to absorb that rather than fail the job.
    const truncated = analyzeDocument({ bytes: new TextEncoder().encode("%PDF-1.4\n") });
    assert.equal(truncated.format, "pdf");
    assert.ok(typeof truncated.readError === "string");
  });
});

describe("every fixture, read the way its manifest says", () => {
  for (const f of pdfFixtures) {
    test(`${f.id} yields exactly its manifest's history`, () => {
      const e = f.expect as PdfFixtureExpect;
      const a = analyzeDocument({ bytes: f.build(), filename: f.filename });
      assert.equal(a.readError, "", `${f.id} could not be read`);
      assert.equal(a.format, "pdf");
      assert.equal(a.generations, e.eofCount, `${f.id} generations`);
      assert.equal(a.tableChain, e.tableChain, `${f.id} /Prev chain`);
      assert.deepEqual(a.lineage.documentIds, e.xmpDocumentIds, `${f.id} document ids`);
      assert.deepEqual(a.lineage.instanceIds, e.xmpInstanceIds, `${f.id} instance ids`);
      // Every tool the manifest names is in the analysis, and the analysis names
      // nothing beyond the union of `/Info` and XMP tool strings.
      const named = [...new Set([...e.producers, ...e.creators])];
      for (const tool of named) assert.ok(a.tools.includes(tool), `${f.id} lost ${tool}`);
      assert.equal(a.tools.length, named.length, `${f.id} invented a tool`);
      // Orphan prose is the pre-edit sentence and nothing else: not a date stamp,
      // not a font name, not the tool the writer recorded about itself.
      const abandoned = a.orphanedLines.filter((line) => !line.drawn).map((line) => line.line);
      assert.deepEqual(abandoned, e.orphanedTextContains.filter((t) => t.length >= 25), `${f.id} orphans`);
    });
  }

  for (const f of docxFixtures) {
    test(`${f.id} yields exactly its manifest's package`, () => {
      const e = f.expect as DocxFixtureExpect;
      const a = analyzeDocument({ bytes: f.build(), filename: f.filename });
      assert.equal(a.readError, "", `${f.id} could not be read`);
      assert.equal(a.format, "docx");
      // A ZIP has no abandoned objects, so the orphan arm has no subject in a DOCX.
      assert.deepEqual(a.orphanedLines, []);
      assert.equal(a.tableChain, 1);
      assert.equal(a.docx?.trackChanges, e.trackChanges);
      assert.equal(a.docx?.rsidCount, e.rsids.length, `${f.id} revision-save ids`);
      assert.equal(a.docx?.hasRevisionTable, e.memberNames.includes("word/settings.xml"));
      assert.equal(a.docx?.application, e.app.Application ?? a.docx?.application);
    });
  }
});

describe("the three findings the corpus exists to produce", () => {
  test("the edited resume's page has a predecessor, and it is the replaced sentence", () => {
    const e = expect<PdfFixtureExpect>("resume-edited");
    const [previous] = e.orphanedTextContains;
    const now = e.showTexts.find((line) => line.includes("Rust"));
    assert.ok(previous && now, "the fixture changed shape");
    const a = analyze("resume-edited");
    const found = sentencePredecessor(now, a.orphanedLines);
    assert.ok(found, "the edited sentence has no abandoned predecessor");
    assert.equal(found.line, previous);
    assert.equal(found.fromObject, 4, "the free slot the table names");
    // Added, not rewritten — which is the difference between a lie and an edit,
    // and the reason only one of the two arms below may accuse.
    assert.equal(found.onlyAdded, true);
    assert.equal(found.onlyRemoved, false);
    assert.equal(found.numbersDiffer, false);
    assert.equal(a.generations, 2, "the edit is only visible because the trail is");
  });

  test("a value change is what makes an orphan an accusation", () => {
    // The plan's headline case, written here rather than in the corpus: the
    // certificate's own bytes still hold the old grade.
    const abandoned: AbandonedLine[] = [
      { line: "CGPA 6.8 on a scale of ten", fromObject: 4, drawn: false },
      { line: "Advanced Data Engineering, forty hours of coursework", fromObject: 5, drawn: false },
    ];
    const found = sentencePredecessor("CGPA 8.4 on a scale of ten", abandoned);
    assert.ok(found);
    assert.equal(found.numbersDiffer, true);
    assert.equal(found.onlyAdded, false);
    // Same vocabulary, different number: `8.4` does not contain `6.8`, so this is
    // a substitution and the definitive arm is allowed to see it as one.
    const added = sentencePredecessor("CGPA 6.8 on a scale of ten, with distinction", abandoned);
    assert.ok(added);
    assert.equal(added.numbersDiffer, false, "the number is unchanged, so nothing was substituted");
    assert.equal(added.onlyRemoved, false);
    // The third shape: the sentence got *shorter*. Content was dropped, which an
    // editor does for length, and an arm that called that a substitution would
    // accuse a candidate for trimming their own page.
    const shorter = sentencePredecessor("CGPA 6.8 on a scale of ten", [
      { line: "CGPA 6.8 on a scale of ten, with distinction", fromObject: 7, drawn: false },
    ]);
    assert.ok(shorter);
    assert.equal(shorter.onlyRemoved, true);
    assert.equal(shorter.onlyAdded, false);
    assert.equal(shorter.numbersDiffer, false);
  });

  test("two honest saves produce no predecessor at all", () => {
    const e = expect<PdfFixtureExpect>("resume-two-saves");
    const a = analyze("resume-two-saves");
    assert.equal(a.generations, 2);
    assert.equal(a.tableChain, 2);
    // The pair that separates an edit from a fabrication: the document id held and
    // the instance id did not. Both statements are in the analysis, and neither is
    // a finding.
    assert.equal(new Set(a.lineage.documentIds).size, 1);
    assert.equal(new Set(a.lineage.instanceIds).size, 2);
    assert.deepEqual(a.orphanedLines.filter((l) => !l.drawn), [], "the abandoned objects are metadata");
    for (const line of e.showTexts)
      assert.equal(sentencePredecessor(line, a.orphanedLines), null, line);
  });

  test("the file written before its own tool existed", () => {
    const a = analyze("resume-anachronism");
    assert.equal(a.createdMonth, "2014-06");
    assert.equal(a.anachronisms.length, 1);
    const [one] = a.anachronisms;
    assert.match(one.tool, /LibreOffice 24\.2/);
    assert.equal(one.shippedMonth, "2024-01");
    assert.equal(one.months, 115);
    // The anachronism is measured against the *latest* date the file records for
    // itself, so a 2014 resume honestly re-saved by a 2024 build — where the
    // creation stamp stays 2014 and the modification stamp does not — is a file
    // with a history, not a file that disagrees with itself.
    assert.equal(one.statedMonth, "2014-06");
    // The same string, on the same build floor, on a file created after it: the
    // pristine modern fixture, which must stay silent.
    assert.deepEqual(analyze("resume-modern").anachronisms, []);
    assert.deepEqual(analyze("resume-classic").anachronisms, []);
  });

  test("an abandoned page is rarer than an abandoned dictionary", () => {
    // The corpus's sharpest pair, and the one the arms depend on: `resume-edited`
    // abandons the sentence the page used to draw, `resume-two-saves` abandons
    // only the `/Info` and the XMP packet a second save rewrites. Both have
    // orphans; only one has content the file stopped pointing at — and treating
    // the second as the first is how an honest double-save gets accused.
    assert.equal(analyze("resume-edited").hasAbandonedContent, true);
    const withOrphans = pdfFixtures
      .filter((f) => readPdfStructure(f.build()).orphaned.length > 0)
      .map((f) => f.id);
    for (const id of withOrphans)
      assert.equal(
        analyze(id).hasAbandonedContent,
        id === "resume-edited",
        `${id} abandoned content it did not have`,
      );
    for (const f of docxFixtures) assert.equal(analyze(f.id).hasAbandonedContent, false, f.id);
  });

  test("the date an anachronism is measured against is the file's own latest", () => {
    for (const f of pdfFixtures) {
      const e = f.expect as PdfFixtureExpect;
      const a = analyze(f.id);
      const stated = [...e.creationDates, ...e.modDates, ...e.xmpCreateDates, ...e.xmpModifyDates]
        .map((v) => /(20\d{2})[-:]?(\d{2})/.exec(v)?.slice(1, 3).join("-"))
        .filter(Boolean)
        .sort();
      assert.equal(
        a.statedMonth,
        stated[stated.length - 1] ?? a.createdMonth,
        `${f.id} statedMonth is not the latest date in the file`,
      );
      assert.ok(
        !a.createdMonth || !a.statedMonth || a.createdMonth <= a.statedMonth,
        `${f.id} statedMonth precedes its own creation date`,
      );
    }
  });

  test("the generator's DOCX disagrees with itself", () => {
    const oneSave = analyze("resume-docx-one-save");
    assert.equal(oneSave.docx?.singleSaveWholeDocument, true);
    assert.equal(oneSave.docx?.revision, 1);
    assert.equal(oneSave.docx?.totalEditingMinutes, 0);
    assert.ok(oneSave.createdInstant.length > 0);
    assert.equal(oneSave.createdInstant, oneSave.modifiedInstant);
    // The two shapes that look like it and are not: a real editing life, and a
    // writer that keeps no revision table at all.
    assert.equal(analyze("resume-docx-edited").docx?.singleSaveWholeDocument, false);
    assert.equal(analyze("resume-docx-libreoffice").docx?.singleSaveWholeDocument, false);
    assert.equal(analyze("resume-docx-edited").docx?.revision, 27);
    assert.equal(analyze("resume-docx-edited").docx?.totalEditingMinutes, 419);
  });
});

describe("the tool floors", () => {
  test("a floor is the earliest the build could have existed, never the latest", () => {
    // The Microsoft 365 string is what 16.x binaries report, and 16.x predates
    // the brand by years — reading the brand's date would forge a tamper out of a
    // legitimate 2016-2020 document.
    assert.equal(earliestToolRelease("Microsoft® Word for Microsoft 365"), "2015-09");
    assert.equal(earliestToolRelease("LibreOffice 24.2.4.2 (Windows)"), "2024-01");
    assert.equal(earliestToolRelease("LibreOffice 7.3.5.2"), "2021-08");
    assert.equal(earliestToolRelease("Acrobat 24.002"), "2024-01");
    assert.equal(earliestToolRelease("iText 7.1.13"), "2016-12");
  });

  test("an unrecognised tool says nothing", () => {
    for (const tool of [
      "Microsoft: Print To PDF",
      "Acme Resume Builder 3.1",
      "Skia/PDF m108 Google Docs Renderer",
      "",
    ])
      assert.equal(earliestToolRelease(tool), null, tool);
  });
});

describe("grades the document states about itself", () => {
  test("a grade word is required, because a bare number is not a grade", () => {
    const lines = ["CGPA: 8.4", "Percentage 72.5%", "Aggregate 61", "Phone 98765 43210", "8.4"];
    const values = lines.map((line) => documentGrades([line]).map((g) => g.value));
    assert.deepEqual(values[0], ["8.4"]);
    assert.deepEqual(values[1], ["72.5"]);
    assert.deepEqual(values[2], ["61"]);
    // A phone number and an orphan decimal are not grades, and an arm that read
    // them as grades would contradict people on noise.
    assert.deepEqual(values[3], []);
    assert.deepEqual(values[4], []);
    // The line travels with the value, because a verdict has to be quotable.
    assert.equal(documentGrades(["CGPA: 8.4"])[0].line, "CGPA: 8.4");
    assert.deepEqual(analyze("resume-classic").grades, [], "a resume states no grade here");
  });
});
