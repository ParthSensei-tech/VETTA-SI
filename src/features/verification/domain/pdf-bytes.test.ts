import assert from "node:assert/strict";
import test from "node:test";
import {
  appendIncrementalUpdate,
  assemblePdf,
  decodeLatin,
  deflatedObject,
  infoObject,
  objectStreamObject,
  pdfDate,
  pdfLatin,
  pdfString,
  skeletonObjects,
  streamObject,
  textOperators,
  xmpDate,
  xmpObject,
  type PdfAssembly,
  type PdfObjectSpec,
} from "./pdf-bytes.ts";
import { literalStrings, readPdfStructure, showTexts, type PdfStructure } from "./pdf-structure.ts";

/**
 * The corpus primitives, proven at the level the forensic checks rely on.
 *
 * Every assertion here is a claim about bytes: an offset that must match, a
 * table row that must decode, a payload that must not be mistaken for
 * structure. `fixtures.test.ts` makes the same claims about whole documents and
 * about the production parser, so these are the narrow tests that say *which*
 * rule broke when a document-level one fails.
 */

const LINES = [
  "Priya Sharma",
  "Senior Backend Engineer - Bengaluru",
  "Five years building distributed systems in Node.js and Postgres.",
  "Led the ingest pipeline that ranks 200 resumes per batch.",
];

function classicFixture(
  content: PdfObjectSpec = streamObject(4, "", textOperators(LINES)),
): PdfAssembly {
  const sk = skeletonObjects({ contentNum: 4 });
  return assemblePdf({
    objects: [
      sk.catalog,
      sk.pages,
      sk.page,
      content,
      sk.font,
      infoObject(6, { producer: "Acme 1.0", created: "D:20240311091500" }),
    ],
    root: 1,
    info: 6,
  });
}

const scannedNums = (s: PdfStructure) => [...new Set(s.objects.map((o) => o.num))];

test("the offsets an assembly reports are the offsets in its own bytes", () => {
  const asm = classicFixture();
  const text = decodeLatin(asm.bytes);
  for (const [num, offset] of asm.offsets)
    assert.equal(
      text.slice(offset, offset + `${num} 0 obj`.length),
      `${num} 0 obj`,
      `object ${num}`,
    );
  assert.equal(text.slice(asm.xrefStart, asm.xrefStart + 4), "xref");
});

test("a classic table states exactly the offsets the reader resolves", () => {
  const asm = classicFixture();
  const s = readPdfStructure(asm.bytes);
  assert.equal(s.version, "1.4");
  assert.equal(s.tableKind, "classic");
  assert.equal(s.tableChain, 1);
  assert.equal(s.eofCount, 1);
  assert.deepEqual(
    [...s.live.entries()].sort((a, b) => a[0] - b[0]),
    [...asm.offsets.entries()].sort((a, b) => a[0] - b[0]),
  );
  assert.deepEqual(s.orphaned, []);
  assert.deepEqual(s.unreferencedFromRoot, []);
});

test("pdfDate never doubles the D: prefix it is handed", () => {
  // `(D:D:2024…)` is no date at all to a reader, and a date a reader cannot
  // parse is the one thing an anachronism check cannot recover from.
  assert.equal(pdfDate("D:20240311091500"), "(D:20240311091500)");
  assert.equal(pdfDate("20240311091500"), "(D:20240311091500)");
  assert.equal(pdfDate(new Date("2024-03-11T09:15:00Z")), "(D:20240311091500Z)");
  assert.deepEqual(readPdfStructure(classicFixture().bytes).creationDates, ["D:20240311091500"]);
});

test("the XMP half of a date is the other format, for the same instant", () => {
  assert.equal(xmpDate("D:20240311091500"), "2024-03-11T09:15:00Z");
  assert.equal(xmpDate(new Date("2024-03-11T09:15:00Z")), "2024-03-11T09:15:00Z");
  const sk = skeletonObjects({ contentNum: 4, metadataNum: 9 });
  const asm = assemblePdf({
    objects: [
      sk.catalog,
      sk.pages,
      sk.page,
      streamObject(4, "", textOperators(LINES)),
      sk.font,
      infoObject(6, { created: "D:20240311091500" }),
      xmpObject(9, {
        documentId: "uuid:D",
        instanceId: "uuid:I",
        createdAt: "D:20240311091500",
        tool: "Acme",
      }),
    ],
    root: 1,
    info: 6,
  });
  const s = readPdfStructure(asm.bytes);
  assert.equal(s.xmp.present, true);
  assert.deepEqual(s.xmp.documentIds, ["uuid:D"]);
  assert.deepEqual(s.xmp.instanceIds, ["uuid:I"]);
  assert.deepEqual(s.xmp.createDates, ["2024-03-11T09:15:00Z"]);
  assert.deepEqual(s.creationDates, ["D:20240311091500"]);
});

test("pdfString survives the characters a resume actually contains", () => {
  const tricky = "Ankur (he/him) \\ backslash, nested (parens (inside))";
  const s = readPdfStructure(classicFixture(streamObject(4, "", textOperators([tricky]))).bytes);
  assert.deepEqual(showTexts(s), [tricky]);
  assert.deepEqual(literalStrings(pdfString("a\\b")), ["a\\b"]);
});

test("streamObject measures /Length in bytes, never in characters", () => {
  const body = "Priya Sharma - IFE Bengaluru";
  const obj = streamObject(4, "", body);
  const declared = Number(/\/Length (\d+)/.exec(obj.body)![1]);
  assert.equal(declared, pdfLatin(body).byteLength);
  // One latin-1 byte per character is what makes `string.length` === byte
  // offset honest everywhere else in this module — and `pdfLatin` is the only
  // place that decides what happens above 255.
  assert.equal(decodeLatin(pdfLatin("Príya — Sharma")), "Príya ? Sharma");
  assert.equal(decodeLatin(pdfLatin(body)), body);
});

test("a payload may contain the word endstream", () => {
  // `/Length` is what tells the walk where a stream really ends; a scan that
  // stops at the first `endstream` loses every object after it.
  const asm = classicFixture(streamObject(4, "", "BT (a stream with endstream inside it) Tj ET"));
  const s = readPdfStructure(asm.bytes);
  assert.deepEqual(
    scannedNums(s).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(s.orphaned, []);
  assert.deepEqual(showTexts(s), ["a stream with endstream inside it"]);
});

test("object headers inside a content stream are drawn text, not objects", () => {
  const decoy = "12 0 obj 13 0 obj endobj";
  const asm = classicFixture(
    streamObject(4, "", `${textOperators(LINES)}\nBT /F1 6 Tf 40 40 Td ${pdfString(decoy)} Tj ET`),
  );
  const s = readPdfStructure(asm.bytes);
  assert.equal(scannedNums(s).includes(12), false);
  assert.equal(scannedNums(s).includes(13), false);
  assert.deepEqual(s.orphaned, []);
  assert.ok(showTexts(s).includes(decoy));
});

test("deflatedObject writes a zlib stream, which is what /FlateDecode means", () => {
  const asm = classicFixture(deflatedObject(4, "", textOperators(LINES)));
  const s = readPdfStructure(asm.bytes);
  const content = s.objects.find((o) => o.num === 4)!;
  assert.equal(content.inflateFailed, false);
  assert.equal(content.streamStored![0], 0x78);
  assert.equal(decodeLatin(content.stream!), textOperators(LINES));
  assert.deepEqual(showTexts(s), LINES);
});

test("a stream that claims FlateDecode and is not one is reported, not thrown", () => {
  const asm = classicFixture(streamObject(4, "/Filter /FlateDecode", "a".repeat(36)));
  const s = readPdfStructure(asm.bytes);
  assert.equal(s.objects.find((o) => o.num === 4)!.inflateFailed, true);
  // Unreadable is not absent: the rest of the file still resolves, which is the
  // difference between `unverifiable` and a crash.
  assert.equal(s.live.get(5), asm.offsets.get(5));
  assert.deepEqual(s.orphaned, []);
});

test("objectStreamObject writes the index the reader expands", () => {
  const sk = skeletonObjects({ contentNum: 4 });
  const members = [sk.catalog, sk.pages, sk.page, sk.font].map((o) => ({
    num: o.num,
    dict: o.body,
  }));
  const stm = objectStreamObject(7, members);
  assert.match(stm.body, /\/N 4 \/First \d+/);
  const asm = assemblePdf({
    version: "1.5",
    xrefStream: true,
    objects: [
      stm,
      streamObject(4, "", textOperators(LINES)),
      infoObject(6, { producer: "Acme 1.0" }),
    ],
    compressed: members.map((m, index) => ({ num: m.num, container: 7, index })),
    root: 1,
    info: 6,
  });
  const s = readPdfStructure(asm.bytes);
  // `/First` is where the dictionaries begin, and all four are there.
  const payload = decodeLatin(s.objects.find((o) => o.num === 7)!.stream!);
  for (const m of members) assert.ok(payload.includes(m.dict), m.dict.slice(0, 32));
  assert.deepEqual(
    [...s.objStmMembers].sort((a, b) => a - b),
    [1, 2, 3, 5],
  );
  assert.deepEqual(s.orphaned, []);
  // A member has no offset to lose, and the container is reached through its
  // type-2 rows rather than a dictionary: neither is an orphan or unreferenced.
  assert.deepEqual(s.unreferencedFromRoot, []);
  // Metadata that only exists inside the object stream is still visible.
  assert.deepEqual(s.producers, ["Acme 1.0"]);
  assert.deepEqual(s.baseFonts, ["Helvetica"]);
  assert.deepEqual(showTexts(s), LINES);
});

test("a cross-reference stream describes its live rows, its members and itself", () => {
  const sk = skeletonObjects({ contentNum: 4 });
  const members = [sk.catalog, sk.pages];
  const asm = assemblePdf({
    version: "1.5",
    xrefStream: true,
    objects: [
      sk.page,
      streamObject(4, "", textOperators(LINES)),
      sk.font,
      infoObject(6, { producer: "Acme 1.0" }),
      objectStreamObject(
        7,
        members.map((m) => ({ num: m.num, dict: m.body })),
      ),
    ],
    compressed: members.map((m, index) => ({ num: m.num, container: 7, index })),
    free: [{ num: 8, gen: 3, next: 0 }],
    root: 1,
    info: 6,
  });
  const s = readPdfStructure(asm.bytes);
  assert.equal(s.tableKind, "xref-stream");
  assert.equal(s.version, "1.5");
  const row = (num: number) => s.xref.find((r) => r.num === num)!;
  assert.equal(row(4).kind, "n");
  assert.equal(row(4).value, asm.offsets.get(4));
  assert.equal(row(1).kind, "c");
  assert.equal(row(1).value, 7);
  assert.equal(row(1).gen, 0);
  assert.equal(row(8).kind, "f");
  assert.equal(row(8).gen, 3);
  // The table's own row: the one offset that has to be known before the table's
  // bytes exist, which is why it is the last thing in the file.
  assert.equal(row(asm.size - 1).value, asm.xrefStart);
});

test("an incremental update chains /Prev back to the table it replaces", () => {
  const base = classicFixture();
  const replacement = streamObject(
    8,
    "",
    textOperators([...LINES.slice(0, 2), "Rewritten by an editor that keeps the old text."]),
  );
  const updated = appendIncrementalUpdate(base, {
    objects: [skeletonObjects({ contentNum: 8 }).page, replacement],
    free: [{ num: 4, gen: 0, next: 0 }],
    root: 1,
    info: 6,
  });
  assert.equal(updated.eofCount, 2);
  assert.equal(updated.size >= base.size, true);
  const s = readPdfStructure(updated.bytes);
  assert.equal(s.eofCount, 2);
  assert.equal(s.tableChain, 2);
  const trailer = s.trailers.at(-1)!;
  assert.equal(/\/Prev\s+(\d+)/.exec(trailer)![1], String(base.xrefStart));
  assert.deepEqual(
    s.orphaned.map((o) => o.num).sort((a, b) => a - b),
    [3, 4],
  );
  assert.equal(s.live.get(3), updated.offsets.get(3));
  assert.equal(s.live.get(8), updated.offsets.get(8));
  assert.equal(s.live.has(4), false);
});
