/**
 * The five byte-level arms, graded against the corpus.
 *
 * `forensics.test.ts` proves the reader extracts the right facts; this file
 * proves the ladder turns those facts into the right *words about a person*. The
 * load-bearing assertion in here is not the one that catches a forgery, it is the
 * set that catches the detector: `resume-classic`, `resume-modern`,
 * `certificate-reprint`, `resume-decoy-stream`, `resume-two-saves` and both the
 * edited and the LibreOffice DOCX must all come back with no accusing row, and
 * `certificate-reprint` in particular must come back `unverifiable` and never
 * `contradicted`, because a print driver leaves nothing to read and "nothing to
 * read" is the state a false positive is made of.
 *
 * The arms are run with their ids explicitly allowed. On a free plan they are
 * outside `checkIdsForPlan` and never reach this code, which is a fact about V5's
 * entitlement gate and not about these rules, so the gate is asserted in
 * `tier-a.test.ts` instead of being quietly relied on here.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { adjudicate, isAccusingVerdict } from "../adjudicate.ts";
import {
  dropUngrounded,
  extractClaims,
  type ClaimDetail,
  type ClaimKind,
  type ExtractedClaim,
} from "../claims.ts";
import { fixtureById, type ForensicFixture } from "../fixtures.ts";
import { analyzeDocument, type DocumentForensics } from "../forensics.ts";
import { CHECK_REGISTRY, checksForKind, runLadder } from "./registry.ts";

const NOW = "2026-11";

const claim = (
  kind: ClaimKind,
  quote: string,
  detail: ClaimDetail = {},
): ExtractedClaim => ({ kind, statement: kind, quote, detail });

/** Every forensic id, allowed regardless of plan, so this file tests rules and not entitlement. */
const FORENSIC_IDS = new Set(
  CHECK_REGISTRY.filter(
    (c) => c.id.startsWith("document.") || c.id === "education.cgpa_document_mismatch",
  ).map((c) => c.id),
);

const read = (id: string, docClass?: "resume" | "certificate"): DocumentForensics => {
  const f: ForensicFixture = fixtureById(id);
  return analyzeDocument({ bytes: f.build(), filename: f.filename, docClass });
};

/** One claim, one file, the whole ladder — the same call the ledger makes per claim. */
const runOn = (c: ExtractedClaim, documents: readonly DocumentForensics[]) =>
  runLadder({
    claim: c,
    siblings: [],
    now: NOW,
    hasRawBytes: true,
    documents,
    availableDependencies: new Set(),
    allowedCheckIds: FORENSIC_IDS,
  });

const verdictOf = (c: ExtractedClaim, documents: readonly DocumentForensics[]) =>
  adjudicate(runOn(c, documents), CHECK_REGISTRY);

/**
 * Only the forensic rows out of a ladder run.
 *
 * The ladder answers for every check registered for the kind, so the Tier A and
 * V6 rows come back `skipped` under `allowedCheckIds` — true, and asserted in
 * `tier-a.test.ts`, but noise when the question is what the bytes said.
 */
const forensicOnly = (c: ExtractedClaim, documents: readonly DocumentForensics[]) =>
  runOn(c, documents).filter((o) => FORENSIC_IDS.has(o.checkId));

/** How many forensic rows a kind should produce — the grade arm is education-only. */
const expectedRows = (kind: ClaimKind) => checksForKind(kind).filter((c) => FORENSIC_IDS.has(c.id));

/** The sentence `resume-edited` left behind in object 4, and the one that replaced it. */
const OLD_LINE = "Led the ingest pipeline that ranks 200 resumes per batch.";
const ADDED_LINE = "Led the ingest pipeline that ranks 200 resumes per batch, including a rewrite in Rust.";

/** An education claim that states a grade, which is what the certificate arm reads. */
const GRADE_CLAIM = claim("education", "B.Tech Computer Science, NIT Trichy, 2016 with CGPA 8.4.", {
  startMonth: "2012",
  endMonth: "2016",
});

describe("the arms over the whole corpus", () => {
  const corpus = [
    ["resume-classic", "resume"],
    ["resume-modern", "resume"],
    ["resume-edited", "resume"],
    ["resume-two-saves", "resume"],
    ["resume-anachronism", "resume"],
    ["resume-decoy-stream", "resume"],
    ["certificate-reprint", "certificate"],
    ["certificate-modern-flat", "certificate"],
    ["resume-docx-libreoffice", "resume"],
    ["resume-docx-edited", "resume"],
    ["resume-docx-one-save", "resume"],
  ] as const;

  for (const [id, docClass] of corpus) {
    test(`${id} is read without throwing, for every claim kind`, () => {
      const documents = [read(id, docClass)];
      for (const kind of ["tenure", "employment_period", "education", "credential", "metric", "identity"] as const) {
        const out = verdictOf(claim(kind, documents[0].visibleLines[0] ?? "Priya Sharma"), documents);
        // The one thing the corpus guarantees: an unreadable or unrecognised file
        // never produces an accusation. `impossible` is reserved for arithmetic.
        assert.notEqual(out.verdict, "impossible", `${id}/${kind}`);
      }
    });
  }

  test("the two pristine files say nothing, in the sense of saying so", () => {
    for (const id of ["resume-classic", "resume-modern"]) {
      const outcomes = forensicOnly(
        claim("employment_period", "B.Tech Computer Science, NIT Trichy, 2016."),
        [read(id)],
      );
      assert.equal(outcomes.length, expectedRows("employment_period").length, `${id} lost a row`);
      for (const o of outcomes) {
        assert.equal(o.observation, "silent", `${id}/${o.checkId}`);
        assert.ok(o.note?.length, `${id}/${o.checkId} is silent without a reason`);
      }
      const out = adjudicate(outcomes, CHECK_REGISTRY);
      assert.equal(out.verdict, "unverifiable", id);
      assert.equal(out.attempted, false, `${id}: a shrug is not speech`);
    }
  });

  test("the decoy stream produces no orphan, because the cursor walk is not a regex", () => {
    const outcomes = runOn(claim("metric", OLD_LINE), [read("resume-decoy-stream")]);
    assert.equal(outcomes.find((o) => o.checkId === "document.orphaned_text")?.observation, "silent");
    assert.equal(adjudicate(outcomes, CHECK_REGISTRY).verdict, "unverifiable");
  });
});

/**
 * The claims the ledger really stores, over the file they came from.
 *
 * Everything above in this file hand-builds a claim, and the first version of
 * `document.orphaned_text` passed that bar while failing the real one: the
 * extractor's `statement` is our label for the claim ("Scale claim with no
 * source: …") and its `quote` is the document's sentence, and comparing an
 * abandoned sentence to a label matches nothing — which the arm read as a
 * substitution, and which made every resume in the corpus that mentions a number
 * its own file also mentions a fabrication. Only `extractClaims` output can show
 * that, so this group feeds it, and does it for the whole corpus: a candidate who
 * typed exactly what their own file says is never accused by the file.
 */
describe("nobody is contradicted by their own document", () => {
  const corpus = [
    ["resume-classic", "resume"],
    ["resume-modern", "resume"],
    ["resume-edited", "resume"],
    ["resume-two-saves", "resume"],
    ["resume-anachronism", "resume"],
    ["resume-decoy-stream", "resume"],
    ["certificate-reprint", "certificate"],
    ["certificate-modern-flat", "certificate"],
    ["resume-docx-libreoffice", "resume"],
    ["resume-docx-edited", "resume"],
    ["resume-docx-one-save", "resume"],
  ] as const;

  for (const [id, docClass] of corpus) {
    test(`${id}: the sentences it draws, checked against its own bytes`, () => {
      const analysis = read(id, docClass);
      const text = analysis.visibleLines.join("\n");
      const claims = dropUngrounded(extractClaims(text), text).kept;
      if (id.startsWith("resume"))
        assert.ok(claims.length > 0, `${id} produced no claims from ${JSON.stringify(text)}`);
      for (const c of claims) {
        const out = verdictOf(c, [analysis]);
        assert.ok(
          !isAccusingVerdict(out.verdict),
          `${id} / ${c.kind} / ${c.quote}: ${out.verdict} resting on ${out.restsOn} — ${out.note}`,
        );
      }
    });
  }
});

describe("document.orphaned_text — the only arm the edit history makes definitive", () => {
  test("a substituted number is contradicted, from the file's own bytes", () => {
    const documents = [read("resume-edited")];
    // The certificate-shape forgery: the page now says 8.4, object 4 still says 6.8.
    const c = claim("education", "CGPA 8.4 on a scale of ten, awarded for the B.Tech.");
    const outcomes = runOn(c, documents);
    // No such abandoned line exists in that fixture, so first prove the arm is
    // silent rather than wrong, then feed it the substitution directly.
    assert.equal(
      outcomes.find((o) => o.checkId === "document.orphaned_text")?.observation,
      "silent",
    );

    const forged: DocumentForensics = {
      ...documents[0],
      orphanedLines: [
        { line: "CGPA 6.8 on a scale of ten, awarded for the B.Tech.", fromObject: 4, drawn: false },
      ],
    };
    const found = runOn(c, [forged]).find((o) => o.checkId === "document.orphaned_text");
    assert.equal(found?.observation, "inconsistent");
    assert.match(found?.note ?? "", /object 4/);
    assert.equal(found?.detail?.numbersDiffer, true);
    // Definitive: this is the row that is allowed to call the claim false.
    assert.equal(adjudicate(runOn(c, [forged]), CHECK_REGISTRY).verdict, "contradicted");
  });

  test("an honest edit is an edit, not a fabrication", () => {
    // `resume-edited` as it really is: the later save added a clause. The corpus's
    // most important negative — the same file, the same orphan, the opposite
    // verdict if this rule is written carelessly.
    const outcomes = runOn(claim("metric", ADDED_LINE), [read("resume-edited")]);
    const orphan = outcomes.find((o) => o.checkId === "document.orphaned_text");
    assert.equal(orphan?.observation, "silent");
    assert.match(orphan?.note ?? "", /added to it/);
  });

  test("a line the page still draws is a repeat, not a predecessor", () => {
    const documents = [read("resume-two-saves")];
    for (const line of ["Priya Sharma", OLD_LINE, "Five years building distributed systems in Node.js and Postgres."])
      assert.equal(
        runOn(claim("identity", line), documents).find((o) => o.checkId === "document.orphaned_text")
          ?.observation,
        "silent",
        line,
      );
  });

  test("with no bytes the row says so instead of looking clean", () => {
    const outcomes = runLadder({
      claim: claim("metric", OLD_LINE),
      siblings: [],
      now: NOW,
      hasRawBytes: false,
      availableDependencies: new Set(),
      allowedCheckIds: FORENSIC_IDS,
    }).filter((o) => FORENSIC_IDS.has(o.checkId));
    for (const o of outcomes) {
      assert.equal(o.observation, "skipped", o.checkId);
      assert.match(o.note ?? "", /original document bytes/);
    }
    assert.equal(adjudicate(outcomes, CHECK_REGISTRY).verdict, "unverifiable");
  });
});

describe("document.incremental_update — the trail, without the accusation", () => {
  test("a rewritten page is reported and cannot accuse", () => {
    const outcomes = runOn(claim("metric", ADDED_LINE), [read("resume-edited")]);
    const row = outcomes.find((o) => o.checkId === "document.incremental_update");
    assert.equal(row?.observation, "inconsistent");
    assert.match(row?.note ?? "", /generations/);
    const out = adjudicate(outcomes, CHECK_REGISTRY);
    // The cap is the product: the recruiter sees that something was rewritten and
    // that the engine would not call it a lie on that evidence alone.
    assert.equal(out.verdict, "unverifiable");
    assert.equal(out.cappedFrom, "contradicted");
    assert.ok(out.contributingCheckIds.includes("document.incremental_update"));
  });

  test("two honest saves leave metadata behind, and that is all", () => {
    const outcomes = runOn(claim("employment_period", "Senior Backend Engineer - Bengaluru"), [
      read("resume-two-saves"),
    ]);
    const row = outcomes.find((o) => o.checkId === "document.incremental_update");
    assert.equal(row?.observation, "silent");
    assert.match(row?.note ?? "", /metadata only/);
    assert.equal(adjudicate(outcomes, CHECK_REGISTRY).cappedFrom, "");
  });

  test("a flattened reprint has no history, which is not a finding", () => {
    // The fixture's own manifest sentence: "V4 must return unverifiable — never
    // contradicted." One generation, print-driver producer, nothing abandoned.
    const documents = [read("certificate-reprint", "certificate")];
    for (const line of documents[0].visibleLines) {
      const out = adjudicate(runOn(claim("credential", line), documents), CHECK_REGISTRY);
      assert.equal(out.verdict, "unverifiable", line);
      assert.notEqual(out.verdict, "contradicted");
    }
  });
});

describe("document.anachronism", () => {
  test("a file written before its tool existed is inconsistent, not contradicted", () => {
    const documents = [read("resume-anachronism")];
    const outcomes = runOn(
      claim("education", "B.Tech Computer Science, NIT Trichy, 2016.", { startMonth: "2012", endMonth: "2016" }),
      documents,
    );
    const row = outcomes.find((o) => o.checkId === "document.anachronism");
    assert.equal(row?.observation, "inconsistent");
    assert.match(row?.note ?? "", /LibreOffice 24\.2/);
    assert.match(row?.note ?? "", /115 months earlier/);
    const out = adjudicate(outcomes, CHECK_REGISTRY);
    assert.equal(out.verdict, "unverifiable");
    assert.equal(out.cappedFrom, "contradicted");
  });

  test("it stays quiet for a claim that has nothing to do with a date", () => {
    const documents = [read("resume-anachronism")];
    const outcomes = runOn(claim("identity", "priya.sharma@example.com"), documents);
    const row = outcomes.find((o) => o.checkId === "document.anachronism");
    assert.equal(row?.observation, "silent");
    assert.match(row?.note ?? "", /does not depend on when the file was written/);
  });

  test("a tool younger than the file is not an anachronism", () => {
    for (const id of ["resume-classic", "resume-modern", "resume-edited"])
      assert.equal(
        runOn(claim("employment_period", "Senior Backend Engineer - Bengaluru"), [read(id)]).find(
          (o) => o.checkId === "document.anachronism",
        )?.observation,
        "silent",
        id,
      );
  });
});

describe("document.docx_edit_history", () => {
  test("the generator's shape fires", () => {
    const outcomes = runOn(claim("employment_period", "Priya Sharma"), [read("resume-docx-one-save")]);
    const row = outcomes.find((o) => o.checkId === "document.docx_edit_history");
    assert.equal(row?.observation, "inconsistent");
    assert.match(row?.note ?? "", /one save at zero recorded editing minutes/);
    assert.equal(adjudicate(outcomes, CHECK_REGISTRY).cappedFrom, "contradicted");
  });

  test("a real editing life and a writer with no revision table both stay silent", () => {
    for (const id of ["resume-docx-edited", "resume-docx-libreoffice"]) {
      const row = runOn(claim("employment_period", "Priya Sharma"), [read(id)]).find(
        (o) => o.checkId === "document.docx_edit_history",
      );
      assert.equal(row?.observation, "silent", id);
    }
    // The PDF case is not "no signal", it is "no such signal": a PDF has no
    // revision-save table to disagree with.
    const pdf = runOn(claim("employment_period", "Priya Sharma"), [read("resume-classic")]).find(
      (o) => o.checkId === "document.docx_edit_history",
    );
    assert.match(pdf?.note ?? "", /no editing life to read/);
  });
});

describe("education.cgpa_document_mismatch", () => {
  const claimed = GRADE_CLAIM;

  test("a certificate that disagrees is contradicted, definitively", () => {
    const marksheet: DocumentForensics = {
      ...read("certificate-modern-flat", "certificate"),
      grades: [{ value: "6.8", line: "CGPA: 6.8" }],
    };
    const row = runOn(claimed, [read("resume-classic"), marksheet]).find(
      (o) => o.checkId === "education.cgpa_document_mismatch",
    );
    assert.equal(row?.observation, "inconsistent");
    assert.match(row?.note ?? "", /this claim says 8\.4/);
    assert.equal(row?.detail?.claimed, "8.4");
    assert.equal(adjudicate(runOn(claimed, [marksheet]), CHECK_REGISTRY).verdict, "contradicted");
  });

  test("a certificate that agrees is evidence, not a shrug", () => {
    const marksheet: DocumentForensics = {
      ...read("certificate-modern-flat", "certificate"),
      grades: [{ value: "8.4", line: "CGPA: 8.4" }],
    };
    const outcomes = runOn(claimed, [marksheet]);
    assert.equal(
      outcomes.find((o) => o.checkId === "education.cgpa_document_mismatch")?.observation,
      "supported",
    );
    assert.equal(adjudicate(outcomes, CHECK_REGISTRY).verdict, "verified");
  });

  test("without a certificate the arm declines, because a resume is not corroboration", () => {
    // The claim's own file states the grade; comparing it to itself would print a
    // verdict out of one number.
    const resumeWithGrade: DocumentForensics = {
      ...read("resume-classic"),
      grades: [{ value: "6.8", line: "CGPA: 6.8" }],
    };
    const row = runOn(claimed, [resumeWithGrade]).find(
      (o) => o.checkId === "education.cgpa_document_mismatch",
    );
    assert.equal(row?.observation, "silent");
    assert.match(row?.note ?? "", /no certificate was retained/);
  });

  test("two scales are one result written twice", () => {
    const marksheet: DocumentForensics = {
      ...read("certificate-modern-flat", "certificate"),
      grades: [{ value: "72.5", line: "Percentage: 72.5%" }],
    };
    const row = runOn(claimed, [marksheet]).find(
      (o) => o.checkId === "education.cgpa_document_mismatch",
    );
    assert.equal(row?.observation, "silent");
    assert.match(row?.note ?? "", /same scale/);
  });

  test("it speaks only for education claims", () => {
    const marksheet: DocumentForensics = {
      ...read("certificate-modern-flat", "certificate"),
      grades: [{ value: "6.8", line: "CGPA: 6.8" }],
    };
    assert.equal(
      runOn(claim("credential", "Advanced Data Engineering, 40 hours"), [marksheet]).find(
        (o) => o.checkId === "education.cgpa_document_mismatch",
      ),
      undefined,
      "the registry should not route a credential claim to this arm",
    );
  });
});

describe("the arms cannot be reached by accident", () => {
  test("a file that failed to read silences every arm rather than failing the run", () => {
    const jpeg = analyzeDocument({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), filename: "marksheet.jpg" });
    assert.ok(jpeg.readError);
    const outcomes = forensicOnly(GRADE_CLAIM, [jpeg]);
    assert.equal(outcomes.length, FORENSIC_IDS.size);
    for (const o of outcomes)
      assert.ok(
        o.observation === "silent" || o.observation === "skipped",
        `${o.checkId} spoke about a JPEG: ${o.observation}`,
      );
  });

  test("bytes present but nothing analysed is silent, never supported", () => {
    // The state a caller reaches by setting `hasRawBytes` without doing the read:
    // it must not be able to produce a `verified`.
    const outcomes = forensicOnly(GRADE_CLAIM, []);
    const out = adjudicate(outcomes, CHECK_REGISTRY);
    assert.equal(out.verdict, "unverifiable");
    assert.equal(out.attempted, false);
  });
});
