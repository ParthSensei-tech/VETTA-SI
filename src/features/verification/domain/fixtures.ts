import type { DocxParts } from "./docx-bytes.ts";
import type { PdfAssembly, PdfObjectSpec } from "./pdf-bytes.ts";
import {
  appendIncrementalUpdate,
  assemblePdf,
  infoObject,
  objectStreamObject,
  skeletonObjects,
  streamObject,
  textOperators,
  xmpObject,
} from "./pdf-bytes.ts";
import { buildDocx } from "./docx-bytes.ts";

/**
 * The forensic corpus: documents whose byte-level history is known exactly,
 * because we wrote that history on purpose.
 *
 * V4's checks are graded against this file, so every fixture carries a
 * ground-truth manifest of *facts about the bytes* — which object numbers exist,
 * which the newest table still points at, how many generations the file owns,
 * what the abandoned objects said. The manifest deliberately contains no
 * verdicts. `contradicted` / `skipped` / `unverifiable` are V4's claim; pinning
 * them here would let the implementation grade its own homework, and the whole
 * reason this feature exists is that a detector which grades itself is how you
 * end up telling a non-native speaker their resume is fake.
 *
 * Three of these fixtures exist only to be *not* flagged: the untouched modern
 * `/ObjStm` file, the file whose text stream happens to contain the bytes
 * `12 0 obj`, and the re-printed certificate. Each is a false positive some
 * plausible-looking orphan rule would have produced, frozen here so the rule
 * cannot be written naively and pass.
 *
 * `build` is a function, not a cached `bytes`, because `pdf.js` detaches the
 * `ArrayBuffer` it is handed — a fixture parsed once reads back as zero bytes.
 * Every caller gets a fresh copy.
 */

const RESUME = [
  "Priya Sharma",
  "Senior Backend Engineer - Bengaluru",
  "Five years building distributed systems in Node.js and Postgres.",
  "Led the ingest pipeline that ranks 200 resumes per batch.",
  "B.Tech Computer Science, NIT Trichy, 2016.",
];

/** The sentence the editor replaces — and the one it leaves behind in the file. */
const RESUME_EDITED_TAIL =
  "Led the ingest pipeline that ranks 200 resumes per batch, including a rewrite in Rust.";

const CERTIFICATE = [
  "Certificate of Achievement",
  "This certifies that Priya Sharma completed",
  "Advanced Data Engineering, 40 hours",
  "Acme Learning, signed 12 March 2024",
];

const DOCX_RESUME = [
  "Priya Sharma",
  "Senior Backend Engineer | Bengaluru",
  "Five years building distributed systems in Node.js and Postgres.",
  "Led the ingest pipeline that ranks 200 resumes per batch.",
  "B.Tech Computer Science, NIT Trichy, 2016.",
];

/* ------------------------------------------------------------------ layout */

/**
 * The four dicts every file needs, as object-stream members. `skeletonObjects`
 * is the single source so a fixture and its incremental update cannot disagree
 * about what page 3 says.
 */
function layout(contentNum: number, metadataNum?: number) {
  const sk = skeletonObjects({ contentNum, metadataNum });
  return { sk, dicts: [sk.catalog.body, sk.pages.body, sk.page.body, sk.font.body] };
}

/**
 * A classic-table PDF 1.4: the shape `Microsoft: Print To PDF`, older Word and
 * most hand-rolled generators emit.
 */
function classicPdf(opts: {
  lines: string[];
  producer: string;
  creator?: string;
  created: string;
  modified?: string;
  font?: PdfObjectSpec;
  documentId?: string;
  instanceId?: string;
  tool?: string;
}): PdfAssembly {
  const metadataNum = opts.documentId ? 9 : undefined;
  const { sk } = layout(4, metadataNum);
  const objects: PdfObjectSpec[] = [
    sk.catalog,
    sk.pages,
    sk.page,
    streamObject(4, "", textOperators(opts.lines)),
    opts.font ?? sk.font,
    infoObject(6, {
      producer: opts.producer,
      creator: opts.creator,
      created: opts.created,
      modified: opts.modified,
    }),
  ];
  if (metadataNum && opts.documentId)
    objects.push(
      xmpObject(metadataNum, {
        documentId: opts.documentId,
        instanceId: opts.instanceId ?? "",
        createdAt: opts.created,
        modifiedAt: opts.modified,
        tool: opts.tool,
      }),
    );
  return assemblePdf({ objects, root: 1, info: 6 });
}

/**
 * A PDF 1.5 with a cross-reference *stream* and every dictionary but the page's
 * content inside one `/ObjStm` — LibreOffice and Google Docs export, and the
 * shape that looks like an orphan to anything scanning raw bytes.
 */
function modernPdf(opts: Parameters<typeof classicPdf>[0]): PdfAssembly {
  const metadataNum = opts.documentId ? 9 : undefined;
  const { sk } = layout(4, metadataNum);
  const info = infoObject(6, {
    producer: opts.producer,
    creator: opts.creator,
    created: opts.created,
    modified: opts.modified,
  });
  const members = [sk.catalog, sk.pages, sk.page, opts.font ?? sk.font, info].map((o) => ({
    num: o.num,
    dict: o.body,
  }));
  const objects: PdfObjectSpec[] = [
    streamObject(4, "", textOperators(opts.lines)),
    objectStreamObject(7, members),
  ];
  if (metadataNum && opts.documentId)
    objects.push(
      xmpObject(metadataNum, {
        documentId: opts.documentId,
        instanceId: opts.instanceId ?? "",
        createdAt: opts.created,
        modifiedAt: opts.modified,
        tool: opts.tool,
      }),
    );
  return assemblePdf({
    version: "1.5",
    xrefStream: true,
    objects,
    compressed: members.map((m, index) => ({ num: m.num, container: 7, index })),
    root: 1,
    info: 6,
  });
}

/* ----------------------------------------------------------------- fixtures */

/** `resume-classic` plus an edit that abandons the text object it replaced. */
function editedPdf(): PdfAssembly {
  const base = classicPdf({
    lines: RESUME,
    producer: "Microsoft: Print To PDF",
    creator: "Microsoft® Word for Microsoft 365",
    created: "D:20240311091500",
    modified: "D:20240311091500",
  });
  const { sk } = layout(4);
  const page = { ...sk.page, body: sk.page.body.replace("/Contents 4 0 R", "/Contents 8 0 R") };
  return appendIncrementalUpdate(base, {
    objects: [
      page,
      streamObject(8, "", textOperators([...RESUME.slice(0, 3), RESUME_EDITED_TAIL, RESUME[4]])),
    ],
    // The slot 4 used to own is now free, which is the only statement in the
    // file that knows the old text is not part of the document any more.
    free: [{ num: 4, gen: 0, next: 0 }],
    root: 1,
    info: 6,
  });
}

/** One honest file, saved twice: the document UUID holds, the instance UUID does not. */
const TWO_SAVES_DOCUMENT_ID = "uuid:7A4C1E90-2B1F-11EF-9A3B-0A0027E8D3F1";
const TWO_SAVES_INSTANCE_ID_FIRST = TWO_SAVES_DOCUMENT_ID;
const TWO_SAVES_INSTANCE_ID_SECOND = "uuid:B1D0F4A2-3C55-11EF-8E77-0A0027E8D3F1";

/** One generation, then a second save that rewrites `/Info` and the XMP. */
function twoSavesPdf(): PdfAssembly {
  const base = classicPdf({
    lines: RESUME,
    producer: "Microsoft® Word for Microsoft 365",
    creator: "Microsoft® Word for Microsoft 365",
    created: "D:20240311091500",
    modified: "D:20240311094100",
    documentId: TWO_SAVES_DOCUMENT_ID,
    instanceId: TWO_SAVES_INSTANCE_ID_FIRST,
    tool: "Microsoft® Word for Microsoft 365",
  });
  return appendIncrementalUpdate(base, {
    objects: [
      infoObject(6, {
        producer: "Microsoft® Word for Microsoft 365",
        creator: "Microsoft® Word for Microsoft 365",
        created: "D:20240311091500",
        modified: "D:20240312160500",
      }),
      xmpObject(9, {
        documentId: TWO_SAVES_DOCUMENT_ID,
        // Stable across saves; the instance is not. This pair is what separates
        // "edited twice" from "exported twice from different sources".
        instanceId: TWO_SAVES_INSTANCE_ID_SECOND,
        createdAt: "D:20240311091500",
        modifiedAt: "D:20240312160500",
        tool: "Microsoft® Word for Microsoft 365",
      }),
    ],
    root: 1,
    info: 6,
  });
}

/** The bytes `12 0 obj` inside a live content stream, as text. */
function decoyPdf(): PdfAssembly {
  const quoted = "(a fake header: 12 0 obj 13 0 obj endobj) Tj";
  const content = streamObject(
    4,
    "",
    `${textOperators(RESUME)}\nBT /F1 6 Tf 40 40 Td ${quoted} ET\n`,
  );
  const { sk } = layout(4);
  return assemblePdf({
    objects: [
      sk.catalog,
      sk.pages,
      sk.page,
      content,
      sk.font,
      infoObject(6, { producer: "Acme Resume Builder 3.1", created: "D:20240311091500" }),
    ],
    root: 1,
    info: 6,
  });
}

export type PdfFixtureExpect = {
  kind: "pdf";
  /** What the newest cross-reference statement is — `absent` has no orphans by construction. */
  tableKind: "classic" | "xref-stream" | "absent";
  /** `%%EOF` count: a second one is a saved-twice file, not a corrupt one. */
  eofCount: number;
  /** Tables reachable by following `/Prev`. */
  tableChain: number;
  /** Top-level `num gen obj` headers a correct reader finds, ascending — decoys excluded. */
  scannedObjectNums: number[];
  /** Present as bytes, not pointed at by the newest table. */
  orphanedObjectNums: number[];
  /** Dictionaries living inside an `/ObjStm`: records with no offset to lose. */
  objStmMemberNums: number[];
  /**
   * Live but unreachable from `/Root`/`/Info`. Empty for every fixture here: the
   * `/Info` object, the cross-reference stream and an `/ObjStm` container are all
   * legitimately unreferenced, and a rule that treats this list as a tamper
   * signal fails on a pristine file.
   */
  unreferencedFromRoot: number[];
  producers: string[];
  creators: string[];
  creationDates: string[];
  modDates: string[];
  baseFonts: string[];
  xmpDocumentIds: string[];
  xmpInstanceIds: string[];
  /** The same instants XMP holds — in W3C-DTF, not the `/Info` form. */
  xmpCreateDates: string[];
  xmpModifyDates: string[];
  /** Literals inside the abandoned objects: what the document used to say. */
  orphanedTextContains: string[];
  /** The `(…) Tj` operands a reader draws, in order: the document as it now reads. */
  showTexts: string[];
  /** Substrings the production text extractor must still return. */
  textContains: string[];
};

export type DocxFixtureExpect = {
  kind: "docx";
  /** Sorted member list — a package with no `word/settings.xml` is a writer fingerprint. */
  memberNames: string[];
  /** Subset assertions on `readDocxPackage().core` / `.app`. */
  core: Record<string, string>;
  app: Record<string, string>;
  rsids: string[];
  rootRsId?: string;
  trackChanges: boolean;
  textContains: string[];
};

export type ForensicFixture = {
  id: string;
  /** What a reader of this corpus is supposed to learn from it. */
  reason: string;
  filename: string;
  build: () => Uint8Array;
  expect: PdfFixtureExpect | DocxFixtureExpect;
};

export const FORENSIC_FIXTURES: ForensicFixture[] = [
  {
    id: "resume-classic",
    reason:
      "The untouched baseline: one generation, classic table, nothing abandoned. Every rule must be silent here.",
    filename: "priya-resume-classic.pdf",
    build: () =>
      classicPdf({
        lines: RESUME,
        producer: "Microsoft® Word for Microsoft 365",
        creator: "Microsoft® Word for Microsoft 365",
        created: "D:20240311091500",
        modified: "D:20240311091500",
      }).bytes,
    expect: {
      kind: "pdf",
      tableKind: "classic",
      eofCount: 1,
      tableChain: 1,
      scannedObjectNums: [1, 2, 3, 4, 5, 6],
      orphanedObjectNums: [],
      objStmMemberNums: [],
      unreferencedFromRoot: [],
      producers: ["Microsoft® Word for Microsoft 365"],
      creators: ["Microsoft® Word for Microsoft 365"],
      creationDates: ["D:20240311091500"],
      modDates: ["D:20240311091500"],
      baseFonts: ["Helvetica"],
      xmpDocumentIds: [],
      xmpInstanceIds: [],
      xmpCreateDates: [],
      xmpModifyDates: [],
      orphanedTextContains: [],
      showTexts: RESUME,
      textContains: ["Priya Sharma", "NIT Trichy, 2016."],
    },
  },
  {
    id: "resume-modern",
    reason:
      "A pristine PDF 1.5 with `/ObjStm` and a `/Type /XRef` stream. The false positive this fixture exists to catch: dictionaries that have no offset of their own are not orphans.",
    filename: "priya-resume-modern.pdf",
    build: () =>
      modernPdf({
        lines: RESUME,
        producer: "LibreOffice 24.2.4.2 (Windows)",
        creator: "Writer",
        created: "D:20240311091500",
        modified: "D:20240311091500",
        documentId: "uuid:0D0A1B2C-3D4E-5F60-7182-93A4B5C6D7E8",
        instanceId: "uuid:0D0A1B2C-3D4E-5F60-7182-93A4B5C6D7E8",
        tool: "LibreOffice 24.2.4.2 (Windows)",
      }).bytes,
    expect: {
      kind: "pdf",
      tableKind: "xref-stream",
      eofCount: 1,
      tableChain: 1,
      scannedObjectNums: [4, 7, 9, 10],
      orphanedObjectNums: [],
      objStmMemberNums: [1, 2, 3, 5, 6],
      unreferencedFromRoot: [],
      producers: ["LibreOffice 24.2.4.2 (Windows)"],
      creators: ["Writer"],
      creationDates: ["D:20240311091500"],
      modDates: ["D:20240311091500"],
      baseFonts: ["Helvetica"],
      xmpDocumentIds: ["uuid:0D0A1B2C-3D4E-5F60-7182-93A4B5C6D7E8"],
      xmpInstanceIds: ["uuid:0D0A1B2C-3D4E-5F60-7182-93A4B5C6D7E8"],
      xmpCreateDates: ["2024-03-11T09:15:00Z"],
      xmpModifyDates: ["2024-03-11T09:15:00Z"],
      orphanedTextContains: [],
      showTexts: RESUME,
      textContains: ["Priya Sharma", "NIT Trichy, 2016."],
    },
  },
  {
    id: "resume-edited",
    reason:
      "The tamper this feature is for: the page points at object 8 and object 4 is still in the file, marked free, still holding the sentence that was replaced.",
    filename: "priya-resume-edited.pdf",
    build: () => editedPdf().bytes,
    expect: {
      kind: "pdf",
      tableKind: "classic",
      eofCount: 2,
      tableChain: 2,
      scannedObjectNums: [1, 2, 3, 4, 5, 6, 8],
      orphanedObjectNums: [3, 4],
      objStmMemberNums: [],
      unreferencedFromRoot: [],
      producers: ["Microsoft: Print To PDF"],
      creators: ["Microsoft® Word for Microsoft 365"],
      creationDates: ["D:20240311091500"],
      modDates: ["D:20240311091500"],
      baseFonts: ["Helvetica"],
      xmpDocumentIds: [],
      xmpInstanceIds: [],
      xmpCreateDates: [],
      xmpModifyDates: [],
      orphanedTextContains: [RESUME[3]],
      showTexts: [RESUME[0], RESUME[1], RESUME[2], RESUME_EDITED_TAIL, RESUME[4]],
      textContains: ["Rust", "Priya Sharma"],
    },
  },
  {
    id: "resume-two-saves",
    reason:
      "Two honest saves: `/Prev` chain of two, `DocumentID` unchanged, `InstanceID` replaced. A file edited twice is not a file fabricated twice, and only this pair says which.",
    filename: "priya-resume-two-saves.pdf",
    build: () => twoSavesPdf().bytes,
    expect: {
      kind: "pdf",
      tableKind: "classic",
      eofCount: 2,
      tableChain: 2,
      scannedObjectNums: [1, 2, 3, 4, 5, 6, 9],
      orphanedObjectNums: [6, 9],
      objStmMemberNums: [],
      unreferencedFromRoot: [],
      producers: ["Microsoft® Word for Microsoft 365", "Microsoft® Word for Microsoft 365"],
      creators: ["Microsoft® Word for Microsoft 365", "Microsoft® Word for Microsoft 365"],
      creationDates: ["D:20240311091500", "D:20240311091500"],
      modDates: ["D:20240311094100", "D:20240312160500"],
      baseFonts: ["Helvetica"],
      xmpDocumentIds: [TWO_SAVES_DOCUMENT_ID, TWO_SAVES_DOCUMENT_ID],
      xmpInstanceIds: [TWO_SAVES_INSTANCE_ID_FIRST, TWO_SAVES_INSTANCE_ID_SECOND],
      xmpCreateDates: ["2024-03-11T09:15:00Z", "2024-03-11T09:15:00Z"],
      xmpModifyDates: ["2024-03-11T09:41:00Z", "2024-03-12T16:05:00Z"],
      orphanedTextContains: ["D:20240311094100"],
      showTexts: RESUME,
      textContains: ["Priya Sharma"],
    },
  },
  {
    id: "resume-anachronism",
    reason:
      "Created 2014, written by a build that shipped in 2024. The dates disagree inside one generation, so no orphan rule sees it and only the tool/date comparison does.",
    filename: "priya-resume-anachronism.pdf",
    build: () =>
      modernPdf({
        lines: RESUME,
        producer: "LibreOffice 24.2.4.2 (Windows)",
        creator: "Writer",
        created: "D:20140601083000",
        modified: "D:20140601083000",
        documentId: "uuid:9F8E7D6C-5B4A-3210-FEDC-BA9876543210",
        instanceId: "uuid:9F8E7D6C-5B4A-3210-FEDC-BA9876543210",
        tool: "LibreOffice 24.2.4.2 (Windows)",
      }).bytes,
    expect: {
      kind: "pdf",
      tableKind: "xref-stream",
      eofCount: 1,
      tableChain: 1,
      scannedObjectNums: [4, 7, 9, 10],
      orphanedObjectNums: [],
      objStmMemberNums: [1, 2, 3, 5, 6],
      unreferencedFromRoot: [],
      producers: ["LibreOffice 24.2.4.2 (Windows)"],
      creators: ["Writer"],
      creationDates: ["D:20140601083000"],
      modDates: ["D:20140601083000"],
      baseFonts: ["Helvetica"],
      xmpDocumentIds: ["uuid:9F8E7D6C-5B4A-3210-FEDC-BA9876543210"],
      xmpInstanceIds: ["uuid:9F8E7D6C-5B4A-3210-FEDC-BA9876543210"],
      // The same impossible instant, in the other format: 2014, from a build
      // that did not exist until a decade later.
      xmpCreateDates: ["2014-06-01T08:30:00Z"],
      xmpModifyDates: ["2014-06-01T08:30:00Z"],
      orphanedTextContains: [],
      showTexts: RESUME,
      textContains: ["Priya Sharma"],
    },
  },
  {
    id: "certificate-reprint",
    reason:
      "A certificate re-exported through a print driver: one generation, driver producer, subset font, a day between create and modify. There is no history left to read, so V4 must return unverifiable — never contradicted.",
    filename: "acme-certificate-reprint.pdf",
    build: () =>
      classicPdf({
        lines: CERTIFICATE,
        producer: "Microsoft: Print To PDF",
        creator: "Microsoft® Word for Microsoft 365",
        created: "D:20240312090000",
        modified: "D:20240313174500",
        font: { num: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEE+Calibri >>" },
      }).bytes,
    expect: {
      kind: "pdf",
      tableKind: "classic",
      eofCount: 1,
      tableChain: 1,
      scannedObjectNums: [1, 2, 3, 4, 5, 6],
      orphanedObjectNums: [],
      objStmMemberNums: [],
      unreferencedFromRoot: [],
      producers: ["Microsoft: Print To PDF"],
      creators: ["Microsoft® Word for Microsoft 365"],
      creationDates: ["D:20240312090000"],
      modDates: ["D:20240313174500"],
      baseFonts: ["ABCDEE+Calibri"],
      xmpDocumentIds: [],
      xmpInstanceIds: [],
      xmpCreateDates: [],
      xmpModifyDates: [],
      orphanedTextContains: [],
      showTexts: CERTIFICATE,
      textContains: ["Certificate of Achievement", "Advanced Data Engineering, 40 hours"],
    },
  },
  {
    id: "resume-decoy-stream",
    reason:
      "The text `12 0 obj` as drawing content. A whole-file regex over these bytes finds two orphans that do not exist; the cursor walk must not.",
    filename: "priya-resume-decoy.pdf",
    build: () => decoyPdf().bytes,
    expect: {
      kind: "pdf",
      tableKind: "classic",
      eofCount: 1,
      tableChain: 1,
      scannedObjectNums: [1, 2, 3, 4, 5, 6],
      orphanedObjectNums: [],
      objStmMemberNums: [],
      unreferencedFromRoot: [],
      producers: ["Acme Resume Builder 3.1"],
      creators: [],
      creationDates: ["D:20240311091500"],
      modDates: [],
      baseFonts: ["Helvetica"],
      xmpDocumentIds: [],
      xmpInstanceIds: [],
      xmpCreateDates: [],
      xmpModifyDates: [],
      orphanedTextContains: [],
      // The decoy is drawn content, not structure: it reaches the reader's text
      // and must not reach its object table.
      showTexts: [...RESUME, "a fake header: 12 0 obj 13 0 obj endobj"],
      textContains: ["a fake header: 12 0 obj 13 0 obj endobj", "Priya Sharma"],
    },
  },
  {
    id: "certificate-modern-flat",
    reason:
      "A cross-reference stream over an entirely uncompressed file — Google Docs export. Proves the reader handles `xref-stream` with no `/ObjStm`, so compressed and modern are not conflated.",
    filename: "acme-certificate-modern-flat.pdf",
    build: () => {
      const { sk } = layout(4, 9);
      return assemblePdf({
        version: "1.5",
        xrefStream: true,
        objects: [
          sk.catalog,
          sk.pages,
          sk.page,
          streamObject(4, "", textOperators(CERTIFICATE)),
          sk.font,
          infoObject(6, {
            producer: "Google Docs",
            created: "D:20240312090000",
            modified: "D:20240312090000",
          }),
          xmpObject(9, {
            documentId: "uuid:11223344-5566-7788-99AA-BBCCDDEEFF00",
            instanceId: "uuid:11223344-5566-7788-99AA-BBCCDDEEFF00",
            createdAt: "D:20240312090000",
            modifiedAt: "D:20240312090000",
            tool: "Google Docs",
          }),
        ],
        root: 1,
        info: 6,
      }).bytes;
    },
    expect: {
      kind: "pdf",
      tableKind: "xref-stream",
      eofCount: 1,
      tableChain: 1,
      scannedObjectNums: [1, 2, 3, 4, 5, 6, 9, 10],
      orphanedObjectNums: [],
      objStmMemberNums: [],
      unreferencedFromRoot: [],
      producers: ["Google Docs"],
      creators: [],
      creationDates: ["D:20240312090000"],
      modDates: ["D:20240312090000"],
      baseFonts: ["Helvetica"],
      xmpDocumentIds: ["uuid:11223344-5566-7788-99AA-BBCCDDEEFF00"],
      xmpInstanceIds: ["uuid:11223344-5566-7788-99AA-BBCCDDEEFF00"],
      xmpCreateDates: ["2024-03-12T09:00:00Z"],
      xmpModifyDates: ["2024-03-12T09:00:00Z"],
      orphanedTextContains: [],
      showTexts: CERTIFICATE,
      textContains: ["Certificate of Achievement"],
    },
  },
  {
    id: "resume-docx-libreoffice",
    reason:
      "A clean word-processor resume: no `word/settings.xml` at all, because LibreOffice keeps no revision-save table. Absence of editing history is normal for this writer.",
    filename: "priya-resume-libreoffice.docx",
    build: () => {
      const parts: DocxParts = {
        paragraphs: DOCX_RESUME,
        core: {
          creator: "Priya Sharma",
          lastModifiedBy: "Priya Sharma",
          revision: 2,
          created: new Date("2024-03-11T09:15:00Z"),
          modified: new Date("2024-03-11T09:41:00Z"),
          title: "Priya Sharma - Resume",
        },
        app: {
          application: "LibreOffice 24.2",
          appVersion: "24.02",
          docSecurity: 0,
          totalEditingTime: 18,
          pages: 2,
          words: 44,
          characters: 260,
          company: "Acme Technologies",
        },
        mtime: new Date("2024-03-11T09:41:00Z"),
      };
      return buildDocx(parts);
    },
    expect: {
      kind: "docx",
      memberNames: [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/app.xml",
        "docProps/core.xml",
        "word/document.xml",
      ],
      core: {
        "dc:creator": "Priya Sharma",
        "cp:lastModifiedBy": "Priya Sharma",
        "cp:revision": "2",
        "dcterms:created": "2024-03-11T09:15:00Z",
        "dcterms:modified": "2024-03-11T09:41:00Z",
      },
      app: { Application: "LibreOffice 24.2", TotalTime: "18", Words: "44" },
      rsids: [],
      trackChanges: false,
      textContains: ["Priya Sharma", "NIT Trichy, 2016."],
    },
  },
  {
    id: "resume-docx-edited",
    reason:
      "A resume with a real editing life: six revision-save-IDs, revision 27, seven hours of editing time, two months between first and last save. Nothing here is a fabrication signal — this is what honest work looks like.",
    filename: "priya-resume-word-edited.docx",
    build: () => {
      const rsids = ["00A0B1C2", "0001A2B3", "0044AA55", "00B7C8D9", "0112EE33", "0199FA70"];
      const parts: DocxParts = {
        paragraphs: DOCX_RESUME,
        core: {
          creator: "Priya Sharma",
          lastModifiedBy: "Priya Sharma",
          revision: 27,
          created: new Date("2024-01-08T18:20:00Z"),
          modified: new Date("2024-03-11T09:41:00Z"),
          title: "Priya Sharma - Resume",
          keywords: "backend;node",
        },
        app: {
          application: "Microsoft® Word for Microsoft 365",
          appVersion: "16.00",
          docSecurity: 0,
          template: "Normal.dotm",
          totalEditingTime: 419,
          pages: 2,
          words: 44,
          characters: 260,
          company: "Acme Technologies",
        },
        rsids,
        rootRsId: rsids[0],
        mtime: new Date("2024-03-11T09:41:00Z"),
      };
      return buildDocx(parts);
    },
    expect: {
      kind: "docx",
      memberNames: [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/app.xml",
        "docProps/core.xml",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/settings.xml",
      ],
      core: {
        "dc:creator": "Priya Sharma",
        "cp:revision": "27",
        "dcterms:created": "2024-01-08T18:20:00Z",
        "dcterms:modified": "2024-03-11T09:41:00Z",
      },
      app: {
        Application: "Microsoft® Word for Microsoft 365",
        TotalTime: "419",
        Template: "Normal.dotm",
        Words: "44",
      },
      rsids: ["0001A2B3", "0044AA55", "00A0B1C2", "00B7C8D9", "0112EE33", "0199FA70"],
      rootRsId: "00A0B1C2",
      trackChanges: false,
      textContains: ["Priya Sharma", "Bengaluru"],
    },
  },
  {
    id: "resume-docx-one-save",
    reason:
      "The shape a generator produces and no person does: one revision, zero editing minutes, `created` and `modified` the same second, one revision-save-ID, and a full page of text. The fields disagree with each other, not with a rule.",
    filename: "priya-resume-one-save.docx",
    build: () => {
      const parts: DocxParts = {
        paragraphs: DOCX_RESUME,
        core: {
          creator: "Priya Sharma",
          lastModifiedBy: "Priya Sharma",
          revision: 1,
          created: new Date("2024-03-11T09:15:00Z"),
          modified: new Date("2024-03-11T09:15:00Z"),
          title: "Priya Sharma - Resume",
        },
        app: {
          application: "Microsoft® Word for Microsoft 365",
          appVersion: "16.00",
          docSecurity: 0,
          template: "Normal.dotm",
          totalEditingTime: 0,
          pages: 2,
          words: 44,
          characters: 260,
          company: "Acme Technologies",
        },
        rsids: ["00A0B1C2"],
        rootRsId: "00A0B1C2",
        mtime: new Date("2024-03-11T09:15:00Z"),
      };
      return buildDocx(parts);
    },
    expect: {
      kind: "docx",
      memberNames: [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/app.xml",
        "docProps/core.xml",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/settings.xml",
      ],
      core: {
        "cp:revision": "1",
        "dcterms:created": "2024-03-11T09:15:00Z",
        "dcterms:modified": "2024-03-11T09:15:00Z",
      },
      app: { Application: "Microsoft® Word for Microsoft 365", TotalTime: "0", Words: "44" },
      rsids: ["00A0B1C2"],
      rootRsId: "00A0B1C2",
      trackChanges: false,
      textContains: ["Priya Sharma", "Five years building distributed systems"],
    },
  },
];

export function fixtureById(id: string): ForensicFixture {
  const found = FORENSIC_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`no forensic fixture ${id}`);
  return found;
}

export const pdfFixtures = FORENSIC_FIXTURES.filter(
  (f): f is ForensicFixture & { expect: PdfFixtureExpect } => f.expect.kind === "pdf",
);

export const docxFixtures = FORENSIC_FIXTURES.filter(
  (f): f is ForensicFixture & { expect: DocxFixtureExpect } => f.expect.kind === "docx",
);
