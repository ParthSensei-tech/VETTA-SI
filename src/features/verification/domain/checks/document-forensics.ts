/**
 * The byte-level arms: what the candidate's own file says about its making.
 *
 * Tier A reasons about the sentences a resume contains. These five read the file
 * those sentences were written into — how many times it was saved, what it
 * abandoned on the way, which build of which program claims to have produced it
 * and when, and what its grade line says against the grade the candidate typed
 * into the form. The distinction matters because the two kinds of evidence are
 * not equally deniable: a person can argue with a reading of their prose, and
 * cannot argue with a byte range their editor left in the file.
 *
 * Which is exactly why four of these five are registered NON-definitive. The
 * corpus in `fixtures.ts` is what decides that, and it decides it in the
 * negative: `certificate-reprint` went through a print driver, so it has no
 * history left to read, and a rule that reads absence of history as evidence of
 * fabrication would fail every scanned marksheet in the pool; `resume-two-saves`
 * has two generations and one abandoned XMP packet, which is what Microsoft Word
 * doing its job looks like; `resume-docx-libreoffice` reports no editing life at
 * all because LibreOffice writes no revision table. An honest file can look like
 * each of those, so only the substitution case — the file still holding the
 * sentence the claim replaced — is allowed to accuse a person, and only
 * `education.cgpa_document_mismatch` accuses from a comparison of two documents.
 *
 * All five are silent when there is nothing to read, and a silent arm is not a
 * passed arm: `adjudicate()` treats it as no evidence, and the coverage number
 * says so.
 */

import type { CheckOutcome } from "../adjudicate.ts";
import type { DocumentForensics } from "../forensics.ts";
import { documentGrades, sentencePredecessor } from "../forensics.ts";
import type { PureCheck } from "./tier-a.ts";

/**
 * The claim's own words, which is what an abandoned sentence is compared against.
 *
 * The quote, not the statement: the quote is the document's sentence verbatim and
 * the statement is our label for it ("Scale claim with no source: …"), and an
 * abandoned sentence compared against a label matches nothing, which the arm then
 * reads as a substitution. The grounding gate already guarantees the quote is in
 * the file, so this is the only side of the comparison that can be trusted.
 */
const claimText = (claim: { statement: string; quote: string }) =>
  claim.quote.length > 0 ? claim.quote : claim.statement;

/** The files worth reading: read successfully, and holding prose of their own. */
function readable(documents: readonly DocumentForensics[] | undefined): DocumentForensics[] {
  return (documents ?? []).filter((d) => d.readError === "" && d.format !== "unknown");
}

/**
 * The sentence this claim replaced, in the same file, in an object the newest
 * cross-reference table no longer points at.
 *
 * The only shape that may accuse. A `numbersDiffer` substitution is a person
 * changing `6.8` into `8.4` and leaving the `6.8` in the file; a change that goes
 * in both directions at once is the same act with words instead of digits. An
 * addition and a deletion are not: `resume-edited` is in the corpus precisely to
 * be the honest version of this — "…per batch" became "…per batch, including a
 * rewrite in Rust" — and a rule that called that a fabrication would call every
 * edited resume in the world a fabrication.
 */
export const checkOrphanedText: PureCheck = ({ claim, documents }) => {
  const files = readable(documents);
  if (files.length === 0) return silent("no readable document was retained");
  for (const file of files) {
    const found = sentencePredecessor(claimText(claim), file.orphanedLines);
    if (!found) continue;
    const substituted =
      found.numbersDiffer || (found.onlyAdded === false && found.onlyRemoved === false);
    if (!substituted)
      return silent(
        found.onlyAdded
          ? "the abandoned sentence is contained in the claim, so the claim added to it"
          : "the abandoned sentence contains the claim, so the claim shortened it",
      );
    return {
      checkId: "",
      observation: "inconsistent",
      note:
        `The file still holds a superseded version of this sentence, in object ` +
        `${found.fromObject ?? "?"}, which the current page no longer references: ` +
        `${JSON.stringify(found.line)}.`,
      detail: {
        filename: file.filename,
        fromObject: found.fromObject,
        abandoned: found.line,
        claimed: claimText(claim),
        numbersDiffer: found.numbersDiffer,
        generations: file.generations,
      },
    };
  }
  return silent("no abandoned sentence matches this claim");
};

/**
 * Whether the visible page is a later save of an earlier one.
 *
 * Two generations is normal — Word does it every time somebody presses save — so
 * the row only fires when the older generation still holds *content* the newer one
 * dropped. `resume-two-saves` has two generations and abandons only its `/Info`
 * and XMP packet, which is metadata, and `certificate-reprint` has one generation
 * because a print driver flattened it. Both must stay silent here, and both do.
 *
 * When it does fire it is an observation about the file's life, not about the
 * claim's truth, which is why it is non-definitive: an edit explains a rewritten
 * page, and an edit is not a lie.
 */
export const checkIncrementalUpdate: PureCheck = ({ claim, documents }) => {
  const files = readable(documents);
  if (files.length === 0) return silent("no readable document was retained");
  const rewritten = files.filter((f) => f.hasAbandonedContent && f.tableChain > 1);
  if (rewritten.length === 0)
    return silent(
      files.every((f) => f.generations <= 1)
        ? "each retained file is a single generation"
        : "the extra generations abandoned metadata only, not page content",
    );
  // The claim's own sentence is what decides whether this row is about it at all:
  // a two-generation file edited in a paragraph the candidate never claimed
  // anything from says nothing about this claim.
  const matched = rewritten.find((f) => sentencePredecessor(claimText(claim), f.orphanedLines));
  if (!matched)
    return silent("the page this claim comes from was not the page the later save replaced");
  const file = matched;
  return {
    checkId: "",
    observation: "inconsistent",
    note:
      `Its text was rewritten by a later save inside the same file: ` +
      `${file.filename} carries ${file.generations} generations and still holds the ` +
      `page this claim replaced.`,
    detail: {
      filename: file.filename,
      generations: file.generations,
      tableChain: file.tableChain,
      abandonedObjects: [...new Set(file.orphanedLines.map((l) => l.fromObject))],
    },
  };
};

/** Kinds whose truth depends on a date, and so on the date the file was written. */
const DATE_BEARING = new Set(["education", "employment_period", "tenure", "credential"]);

/**
 * A tool that did not exist when the file says it was made.
 *
 * Measured against the latest date in the file and not the earliest, for the
 * reason in `forensics.ts`: a 2014 resume re-saved by a 2024 build is a document
 * with a history. Even then this is an observation, not an accusation — a `/Info`
 * dictionary is free text and any tool that writes it can be told a lie by a
 * template. It fires only for claims that are *about* dates, because a tool
 * anachronism says nothing about an email domain.
 */
export const checkAnachronism: PureCheck = ({ claim, documents }) => {
  const files = readable(documents);
  if (files.length === 0) return silent("no readable document was retained");
  if (!DATE_BEARING.has(claim.kind))
    return silent(`a ${claim.kind} claim does not depend on when the file was written`);
  const withAnachronism = files.find((f) => f.anachronisms.length > 0);
  if (!withAnachronism) return silent("every tool the file names predates the file");
  const [first] = withAnachronism.anachronisms;
  return {
    checkId: "",
    observation: "inconsistent",
    note:
      `${withAnachronism.filename} names ${first.tool}, which cannot predate ` +
      `${first.shippedMonth}, and the latest date the file records for itself is ` +
      `${first.statedMonth} — ${first.months} months earlier.`,
    detail: {
      filename: withAnachronism.filename,
      tools: withAnachronism.tools,
      statedMonth: withAnachronism.statedMonth,
      anachronisms: withAnachronism.anachronisms,
    },
  };
};

/**
 * The DOCX that describes an editing life it did not live.
 *
 * Not "few revisions" — `resume-docx-libreoffice` reports revision 2 over eighteen
 * minutes with no revision table at all, because that is what a writer that keeps
 * no revision table looks like, and it is extremely common. The row fires on one
 * shape only: a whole document, one save, zero recorded minutes, one revision-save
 * id, every field agreeing that nothing was ever touched. `resume-docx-one-save`
 * is in the corpus because that is the shape a generator produces and no person
 * produces, and `resume-docx-edited` is in it because a person's file is nothing
 * like it.
 */
export const checkDocxEditHistory: PureCheck = ({ documents }) => {
  const files = readable(documents);
  if (files.length === 0) return silent("no readable document was retained");
  const docx = files.filter((f) => f.docx);
  if (docx.length === 0) return silent("no retained file is a DOCX, so there is no editing life to read");
  const generated = docx.flatMap((f) => (f.docx?.singleSaveWholeDocument ? [{ file: f, life: f.docx }] : []));
  if (generated.length === 0)
    return silent(
      docx.map((f) => `${f.filename} records revision ${f.docx?.revision} over ${f.docx?.totalEditingMinutes} minutes`).join("; "),
    );
  const first = generated[0];
  return {
    checkId: "",
    observation: "inconsistent",
    note:
      `${first.file.filename} describes a whole document written in one save at zero ` +
      `recorded editing minutes (${first.life.words} words, revision ${first.life.revision}, ` +
      `${first.life.rsidCount} revision-save id). That is the shape a text ` +
      `generator produces and an editor does not.`,
    detail: {
      filenames: generated.map((f) => f.file.filename),
      revision: first.life.revision,
      totalEditingMinutes: first.life.totalEditingMinutes,
      rsidCount: first.life.rsidCount,
      words: first.life.words,
      application: first.life.application,
    },
  };
};

/** Which side of the mark a grade is stated on, so two scales are never compared. */
const scaleOf = (value: number) => (value <= 10 ? "ten" : "hundred");

/**
 * The claimed grade against the grade the certificate's own bytes state.
 *
 * Definitive, and the only arm here that is allowed to be, because both sides of
 * the comparison are documents the candidate supplied: the form says `8.4`, the
 * marksheet in the same application says `6.8`, and there is no reading of that
 * pair that ends with both being true. Three things keep it narrow:
 *
 *  - it needs a file classified as a `certificate`. A resume that mentions a
 *    CGPA is the claim's own restatement, not evidence about it, so comparing a
 *    resume to itself would print a contradiction out of one number.
 *  - it compares only inside one scale. `8.4` and `72.5%` are the same result
 *    written twice, and an arm that called them a mismatch would fail every
 *    Indian marksheet in the pool, which reports percentage and CGPA in different
 *    rows of the same page.
 *  - it says nothing when either side has no grade word. `documentGrades` requires
 *    one, so a phone number or a bare decimal is never read as a result.
 *
 * `supported` is reported only on an actual match, which is what makes the row
 * worth more than the silence it replaced.
 */
export const checkCgpaDocumentMismatch: PureCheck = ({ claim, documents }) => {
  if (claim.kind !== "education") return silent("not an education claim");
  const files = readable(documents);
  const certificates = files.filter((f) => f.docClass === "certificate" && f.grades.length > 0);
  if (certificates.length === 0)
    return silent(
      files.some((f) => f.docClass === "certificate")
        ? "the retained certificate states no grade this rule can read"
        : "no certificate was retained for this application",
    );
  const claimed = documentGrades([claimText(claim)]);
  if (claimed.length === 0) return silent("the claim states no grade to compare");
  for (const certificate of certificates) {
    for (const want of claimed) {
      const wanted = Number(want.value);
      const comparable = certificate.grades.filter(
        (g) => scaleOf(Number(g.value)) === scaleOf(wanted),
      );
      if (comparable.length === 0) continue;
      const match = comparable.find((g) => Number(g.value) === wanted);
      if (match)
        return {
          checkId: "",
          observation: "supported",
          note: `${certificate.filename} states ${match.value}, which is what this claim says.`,
          detail: { filename: certificate.filename, grade: match.value, line: match.line },
        };
      return {
        checkId: "",
        observation: "inconsistent",
        note:
          `${certificate.filename} states ${comparable.map((g) => g.value).join(" or ")} ` +
          `(${comparable[0].line}), and this claim says ${want.value}.`,
        detail: {
          filename: certificate.filename,
          claimed: want.value,
          inDocument: comparable.map((g) => g.value),
          line: comparable[0].line,
        },
      };
    }
  }
  return silent("no retained certificate is on the same scale as this claim");
};

/** Same shape as Tier A's helper, which is not exported because it is two lines. */
function silent(note: string): CheckOutcome {
  return { checkId: "", observation: "silent", note };
}
