/**
 * What a file says about its own making.
 *
 * Tier A reasons about what a resume *claims*. This file reads what the resume
 * *is*: how many times it was saved, which build of which program wrote it, what
 * the abandoned objects still hold, and whether the dates the document recorded
 * for itself are compatible with the tool it says it was made with. A fabrication
 * usually fails at the second thing, not the first — the sentence is plausible and
 * the file's own history contradicts it.
 *
 * Two constraints decide the shape of everything below, and both come from the
 * corpus in `fixtures.ts`:
 *
 *  1. **Reading a file is not accusing a person.** `resume-two-saves` was edited
 *     twice, honestly, and only the pair (`DocumentID` held, `InstanceID`
 *     replaced) says so; `certificate-reprint` went through a print driver and has
 *     no history left to read, which is a blind spot and not a finding. So the
 *     rules here report *differences*, and the registry — not this file — decides
 *     whether a difference is allowed to become a verdict.
 *  2. **A structure nobody recognised yields nothing, not a guess.** A
 *     `tableKind` of `absent` has no orphans by construction; a dictionary inside
 *     an `/ObjStm` has no offset to lose and is not an orphan; `12 0 obj` written
 *     as drawing content is not an object. Each of those is a fixture precisely
 *     because a naive reader finds a tamper there. So this file reports only facts
 *     the cursor-walking readers in `pdf-structure.ts` / `docx-bytes.ts` confirm,
 *     and an unreadable file comes back with `readError` set instead of throwing —
 *     a broken parse must not be able to fail a candidate's whole verification.
 *
 * No IO, no environment, no clock: the bytes arrive as an argument, so the same
 * file yields the same answer on any machine in any year.
 */

import { monthsBetween, parseMonthKey } from "./claims.ts";
import { readDocxPackage } from "./docx-bytes.ts";
import type { DocClass } from "./documents.ts";
import { literalStrings, readPdfStructure, showTexts } from "./pdf-structure.ts";
import type { PdfStructure } from "./pdf-structure.ts";

export type DocumentFormat = "pdf" | "docx" | "unknown";

export type SentencePredecessor = {
  line: string;
  fromObject: number | null;
  /** A number in the claim's sentence is not the number in the abandoned one. */
  numbersDiffer: boolean;
  /** The claim's sentence contains the abandoned one — content was added, not changed. */
  onlyAdded: boolean;
  /** The abandoned sentence contains the claim's — content was dropped, not changed. */
  onlyRemoved: boolean;
};

export type ToolAnachronism = {
  /** The string the file wrote about itself, e.g. `LibreOffice 24.2.4.2 (Windows)`. */
  tool: string;
  /** The earliest month that build could have existed, `YYYY-MM`. */
  shippedMonth: string;
  /** The latest date the file recorded for itself, `YYYY-MM`. */
  statedMonth: string;
  months: number;
};

/** An abandoned sentence, with the object it was abandoned from. */
export type AbandonedLine = {
  line: string;
  fromObject: number | null;
  /** The page still draws this exact string, so it is a repeat, not a predecessor. */
  drawn: boolean;
};

export type DocxEditingLife = {
  revision: number | null;
  totalEditingMinutes: number | null;
  rsidCount: number;
  /** Whether the package carries `word/settings.xml` at all — LibreOffice does not. */
  hasRevisionTable: boolean;
  trackChanges: boolean;
  application: string;
  words: number | null;
  /** The generator's shape: a full document, one save, zero recorded minutes. */
  singleSaveWholeDocument: boolean;
};

export type DocumentForensics = {
  format: DocumentFormat;
  docClass: DocClass | "";
  filename: string;
  /** The strings the newest page actually draws, in order. Empty when unreadable. */
  visibleLines: string[];
  /** Byte-present, prose-shaped, and not pointed at by the newest table. */
  orphanedLines: AbandonedLine[];
  /** Generations in the file: 1 for a PDF with one `%%EOF`; the save count for a DOCX. */
  generations: number;
  /** `/Prev` tables reachable — the honest "saved twice" signal for a PDF. */
  tableChain: number;
  /** XMP ids that survive a re-save, and the ones that are supposed to change. */
  lineage: { documentIds: string[]; instanceIds: string[] };
  tools: string[];
  createdMonth: string | null;
  /**
   * The latest month any date in the file claims for itself. Anachronisms are
   * measured against this and not `createdMonth`: a 2014 resume honestly
   * re-saved by a 2024 build has a 2014 creation stamp, and reading the tool
   * against the *earliest* date would call that file forged.
   */
  statedMonth: string | null;
  /** Second-precision stamps, so "created and modified in the same second" is a fact. */
  createdInstant: string;
  modifiedInstant: string;
  anachronisms: ToolAnachronism[];
  baseFonts: string[];
  /**
   * Whether an abandoned object still holds drawing operators — i.e. a page the
   * file no longer points at, as opposed to the dictionaries a second save also
   * abandons. `resume-two-saves` has orphans and no abandoned page; `resume-edited`
   * has both, and only the second one means the visible text was changed.
   */
  hasAbandonedContent: boolean;
  docx: DocxEditingLife | null;
  /** Grade tokens the file's own bytes state, each with the line it came from. */
  grades: { value: string; line: string }[];
  /** Set when the file could not be read at all; every arm then declines to speak. */
  readError: string;
};

type AnalysisBase = {
  docClass: DocClass | "";
  filename: string;
};

/* ------------------------------------------------------------------ tool ages */

/**
 * The earliest month a named build could have existed.
 *
 * Deliberately a floor and not a release date, because a floor is the only value
 * that cannot make an honest file look forged: `Microsoft® Word for Microsoft 365`
 * is what the 16.x binaries report, and they began shipping in 2015-09 — three
 * years before the Microsoft 365 *brand* existed. Anything not recognised returns
 * `null`, and `null` is silence, never "the tool is fine".
 */
const TOOL_FLOORS: { re: RegExp; month: (match: RegExpExecArray) => string | null }[] = [
  // LibreOffice branch numbering: 4.x 2012, 5.x 2015, 6.x 2018, 7.x 2021, and
  // from 24.x the branch *is* the year, so the floor is that January.
  {
    re: /libreoffice\s+(\d{1,2})(?:\.(\d{1,2}))?/i,
    month: (m) => {
      const major = Number(m[1]);
      const minor = Number(m[2] ?? 0);
      if (major >= 24) return `${2000 + major}-01`;
      if (major === 7) return minor >= 6 ? "2023-02" : "2021-08";
      if (major === 6) return "2018-02";
      if (major === 5) return "2015-08";
      if (major === 4) return "2012-02";
      return null;
    },
  },
  // The Office 16.x line — Word 2016 and everything since, whatever it is called.
  { re: /(?:word|excel|powerpoint)[^0-9]{0,30}(?:365|2016|2019|2021)/i, month: () => "2015-09" },
  { re: /(?:word|office)\s*2013/i, month: () => "2012-10" },
  { re: /(?:word|office)\s*2010/i, month: () => "2010-03" },
  // Adobe's perpetual numbering: 11.x was 2012, and from 2019 the version number
  // is the year (Acrobat 2019 reports 19.x).
  {
    re: /acrobat[^0-9]{0,12}(\d{1,2})(?:\.(\d{1,2}))?/i,
    month: (m) => {
      const major = Number(m[1]);
      if (major >= 19) return `${2000 + major}-01`;
      if (major === 11) return "2012-09";
      if (major === 10) return "2011-09";
      if (major === 9) return "2008-06";
      return null;
    },
  },
  {
    re: /adobe pdf library\s*(\d{1,2})/i,
    month: (m) => (Number(m[1]) >= 19 ? `${2000 + Number(m[1])}-01` : "2007-01"),
  },
  // iText: 5.x 2009, 7.x 2016, 8.x 2023.
  {
    re: /itext[^0-9]{0,4}(\d{1,2})/i,
    month: (m) => {
      const major = Number(m[1]);
      if (major >= 8) return "2023-12";
      if (major === 7) return "2016-12";
      if (major === 5) return "2009-12";
      return "2005-01";
    },
  },
];

export function earliestToolRelease(tool: string): string | null {
  for (const floor of TOOL_FLOORS) {
    const match = floor.re.exec(tool);
    if (!match) continue;
    const month = floor.month(match);
    if (month && parseMonthKey(month)) return month;
  }
  return null;
}

/* ---------------------------------------------------------------- date reading */

/** `D:20240311091500+05'30'` or `2024-03-11T09:15:00Z` → `2024-03`, or null. */
function monthOf(value: string | undefined): string | null {
  if (!value) return null;
  const m = /(20\d{2})[-:]?(\d{2})/.exec(value);
  if (!m) return null;
  const key = `${m[1]}-${m[2]}`;
  return parseMonthKey(key) ? key : null;
}

/** The stamp as the file wrote it, normalised to second precision for comparison. */
function instantOf(value: string | undefined): string {
  if (!value) return "";
  const m =
    /(20\d{2})[-:]?(\d{2})[-:]?(\d{2})[T ]?(\d{2}):?(\d{2})?:?(\d{2})?/.exec(value);
  if (!m) return "";
  return [m[1], m[2], m[3], m[4] ?? "00", m[5] ?? "00", m[6] ?? "00"].join("-");
}

/* ----------------------------------------------------------- sentence matching */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "was", "were", "are",
  "into", "over", "their", "them", "they", "then", "than", "who", "which", "while", "about",
  "your", "our", "his", "her", "its", "all", "any", "not", "but", "off", "out", "per", "via",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9+%]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/** Every number a sentence states, in the order written — `200`, `6.8`, `40`. */
function numbers(value: string): string {
  return (value.match(/\d+(?:\.\d+)?/g) ?? []).join("|");
}

/** Prose rather than a stamp, a font name or an XML packet: what an orphan rule may quote. */
function isProse(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 25) return false;
  if (/^(?:D:\d|20\d\d-|19\d\d-)/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length >= 4;
}

function flattened(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The abandoned line this claim's sentence replaced, if there is one.
 *
 * The conditions are all load-bearing. The overlap must be shared *vocabulary*
 * and not digits, because two unrelated "200" lines in one resume would otherwise
 * pair up and accuse each other — so three content words in common, or two that
 * are most of the shorter sentence, which is what "the same line, one value
 * apart" actually looks like. The abandoned line must not be something the page
 * still draws, because a repeated footer is not a predecessor. And a value change
 * outranks an addition, because an addition is what an honest edit looks like and
 * only the substitution is allowed to accuse.
 */
export function sentencePredecessor(
  claim: string,
  abandoned: readonly AbandonedLine[],
): SentencePredecessor | null {
  const mine = tokens(claim);
  if (mine.size < 3) return null;
  const claimFlat = flattened(claim);
  let best: (SentencePredecessor & { shared: number }) | null = null;
  for (const candidate of abandoned) {
    if (candidate.drawn) continue;
    if (candidate.line.trim() === claim.trim()) continue;
    const theirs = tokens(candidate.line);
    if (theirs.size < 3) continue;
    let shared = 0;
    for (const t of theirs) if (mine.has(t)) shared += 1;
    const smaller = Math.min(mine.size, theirs.size);
    if (shared < 3 && !(shared >= 2 && shared / smaller >= 0.6)) continue;
    const candidateFlat = flattened(candidate.line);
    const found: SentencePredecessor & { shared: number } = {
      line: candidate.line,
      fromObject: candidate.fromObject,
      numbersDiffer: numbers(claim) !== numbers(candidate.line),
      // Containment rather than prefix: the extractor's quote is the document's
      // sentence and nothing else, but a save that added a clause mid-sentence, or
      // dropped a full stop, is the same honest act and must not read as a
      // substitution.
      onlyAdded:
        candidateFlat.length > 0 && claimFlat.includes(candidateFlat) && claimFlat !== candidateFlat,
      onlyRemoved:
        claimFlat.length > 0 && candidateFlat.includes(claimFlat) && claimFlat !== candidateFlat,
      shared,
    };
    if (
      !best ||
      (found.numbersDiffer && !best.numbersDiffer) ||
      (found.numbersDiffer === best.numbersDiffer && found.shared > best.shared)
    )
      best = found;
  }
  if (!best) return null;
  return {
    line: best.line,
    fromObject: best.fromObject,
    numbersDiffer: best.numbersDiffer,
    onlyAdded: best.onlyAdded,
    onlyRemoved: best.onlyRemoved,
  };
}

/* ------------------------------------------------------------------ tool ages */

/** Every tool the file names, against the latest date the file itself states. */
function anachronismsFor(tools: readonly string[], statedMonth: string | null): ToolAnachronism[] {
  if (!statedMonth) return [];
  const out: ToolAnachronism[] = [];
  for (const tool of tools) {
    const shipped = earliestToolRelease(tool);
    if (!shipped) continue;
    const gap = monthsBetween(statedMonth, shipped);
    if (gap !== null && gap > 0) out.push({ tool, shippedMonth: shipped, statedMonth, months: gap });
  }
  return out;
}

/**
 * The grades a document states about itself.
 *
 * Only `CGPA`/`GPA`/percentage forms sitting next to a word that says *grade*: a
 * bare `8.4` on a page is a rating, a score in a different row, or part of a phone
 * number, and an arm that read any of those as the candidate's grade would accuse
 * a person on a coincidence.
 */
const GRADE = /(?:cgpa|gpa|grade|percentage|aggregate)\D{0,10}(\d{1,2}(?:\.\d{1,2})?)\s*(?:%|\/\s*10)?/gi;

export function documentGrades(lines: readonly string[]): { value: string; line: string }[] {
  const out: { value: string; line: string }[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(GRADE)) {
      const value = m[1];
      if (!value || Number(value) > 100) continue;
      out.push({ value, line: line.trim().slice(0, 200) });
    }
  }
  return out;
}

/* -------------------------------------------------------------------- readers */

/**
 * The two dates the file holds, taken from every place a writer puts them.
 *
 * A second generation rewrites `/Info` and the XMP, so the newest stamp is in the
 * newest object and the original creation stamp survives in the older one — which
 * is why `createdMonth` reads the *earliest* and `statedMonth` the *latest*. An
 * anachronism measured against the earliest would fire on every resume that was
 * written in 2014 and re-saved in 2024, and a rule with that false-positive rate
 * cannot be shown to a recruiter.
 */
function dateMonths(structure: PdfStructure): { created: string | null; stated: string | null } {
  const toMonths = (values: readonly string[]) =>
    values
      .map(monthOf)
      .filter((m): m is string => Boolean(m))
      .sort();
  const created = toMonths([...structure.creationDates, ...structure.xmp.createDates]);
  const stated = [...created, ...toMonths([...structure.modDates, ...structure.xmp.modifyDates])];
  return { created: created[0] ?? null, stated: stated[stated.length - 1] ?? created[0] ?? null };
}

/**
 * Whether a later save replaced the page rather than merely re-stamped it.
 *
 * A `/Prev` chain of 2 says only that the file was opened twice. What separates an
 * edit from a save is an abandoned *content* stream — the page the newest table no
 * longer points at, still in the file, still holding its text operators. Checking
 * for the operators and not just the object is what keeps the reader from finding
 * `12 0 obj` written inside a drawing.
 */
function abandonedContent(structure: PdfStructure): boolean {
  return structure.orphaned.some((o) => /\bBT\b/.test(o.text) && /\)\s*Tj/.test(o.text));
}

function fromPdf(bytes: Uint8Array, base: AnalysisBase): DocumentForensics {
  const structure = readPdfStructure(bytes);
  const visible = showTexts(structure);
  const drawn = new Set(visible.map((line) => line.trim()));
  // A second save abandons its `/Info` and its XMP packet along with the page it
  // edited, and the literals in those dictionaries — the writer's name, the tool's
  // version — are metadata values, not sentences the document used to make. Only
  // `resume-edited`'s free content object is the second thing, and telling them
  // apart is the whole difference between "saved twice" and "rewritten".
  const metadataValues = new Set(
    [
      ...structure.producers,
      ...structure.creators,
      ...structure.xmp.tools,
      ...structure.creationDates,
      ...structure.modDates,
      ...structure.xmp.createDates,
      ...structure.xmp.modifyDates,
      ...structure.xmp.documentIds,
      ...structure.xmp.instanceIds,
    ]
      .filter(Boolean)
      .map((value) => value.trim()),
  );
  const abandoned: AbandonedLine[] = structure.orphaned.flatMap((object) =>
    literalStrings(object.text)
      .filter((line) => isProse(line) && !metadataValues.has(line.trim()))
      .map((line) => ({ line, fromObject: object.num, drawn: drawn.has(line.trim()) })),
  );
  const tools = [...new Set([...structure.producers, ...structure.creators, ...structure.xmp.tools])];
  const { created, stated } = dateMonths(structure);
  return {
    format: "pdf",
    ...base,
    visibleLines: visible,
    orphanedLines: abandoned,
    generations: structure.eofCount,
    tableChain: structure.tableChain,
    lineage: { documentIds: structure.xmp.documentIds, instanceIds: structure.xmp.instanceIds },
    tools,
    createdMonth: created,
    statedMonth: stated,
    createdInstant: instantOf(structure.creationDates[0]),
    modifiedInstant: instantOf(structure.modDates[0]),
    anachronisms: anachronismsFor(tools, stated),
    baseFonts: structure.baseFonts,
    hasAbandonedContent: abandonedContent(structure),
    docx: null,
    grades: documentGrades(visible),
    readError: "",
  };
}

function fromDocx(bytes: Uint8Array, base: AnalysisBase): DocumentForensics {
  const pkg = readDocxPackage(bytes);
  const revision = pkg.core["cp:revision"] ? Number(pkg.core["cp:revision"]) : NaN;
  const totalMinutes = pkg.app["TotalTime"] ? Number(pkg.app["TotalTime"]) : NaN;
  const words = pkg.app["Words"] ? Number(pkg.app["Words"]) : NaN;
  const created = pkg.core["dcterms:created"] ?? "";
  const modified = pkg.core["dcterms:modified"] ?? "";
  const createdInstant = instantOf(created);
  const application = pkg.app["Application"] ?? "";
  const createdMonth = monthOf(created);
  const modifiedMonth = monthOf(modified);
  const statedMonth =
    createdMonth && modifiedMonth
      ? createdMonth >= modifiedMonth
        ? createdMonth
        : modifiedMonth
      : createdMonth ?? modifiedMonth;
  return {
    format: "docx",
    ...base,
    visibleLines: pkg.documentText ? pkg.documentText.split(/\n+/).filter(Boolean) : [],
    // A ZIP member list is not an object table: nothing here is byte-present and
    // unpointed-at, so the orphan rule has no subject in a DOCX.
    orphanedLines: [],
    generations: Number.isFinite(revision) && revision > 0 ? revision : 1,
    tableChain: 1,
    lineage: { documentIds: [], instanceIds: [] },
    tools: [application].filter(Boolean),
    createdMonth,
    statedMonth,
    createdInstant,
    modifiedInstant: instantOf(modified),
    anachronisms: anachronismsFor([application], statedMonth),
    baseFonts: [],
    hasAbandonedContent: false,
    docx: {
      revision: Number.isFinite(revision) ? revision : null,
      totalEditingMinutes: Number.isFinite(totalMinutes) ? totalMinutes : null,
      rsidCount: pkg.rsids.length,
      hasRevisionTable: pkg.names.includes("word/settings.xml"),
      trackChanges: pkg.trackChanges,
      application,
      words: Number.isFinite(words) ? words : null,
      // The fields disagree with each other, not with a rule. A person's resume
      // accrues revisions and minutes; a generator writes a full page in one save
      // at zero recorded editing time. `rsidCount <= 1` and the same-second stamp
      // are what separate `resume-docx-one-save` from `resume-docx-edited`, and
      // the LibreOffice fixture stays out of reach because it reports revision 2
      // and eighteen minutes whatever its `settings.xml` says.
      singleSaveWholeDocument:
        revision === 1 &&
        totalMinutes === 0 &&
        Boolean(createdInstant) &&
        createdInstant === instantOf(modified) &&
        Number.isFinite(words) &&
        words >= 20 &&
        pkg.rsids.length <= 1,
    },
    grades: documentGrades(pkg.documentText ? [pkg.documentText] : []),
    readError: "",
  };
}

function unreadable(
  format: DocumentFormat,
  base: AnalysisBase,
  readError: string,
): DocumentForensics {
  return {
    format,
    ...base,
    visibleLines: [],
    orphanedLines: [],
    generations: 0,
    tableChain: 0,
    lineage: { documentIds: [], instanceIds: [] },
    tools: [],
    createdMonth: null,
    statedMonth: null,
    createdInstant: "",
    modifiedInstant: "",
    anachronisms: [],
    baseFonts: [],
    hasAbandonedContent: false,
    docx: null,
    grades: [],
    readError,
  };
}

/**
 * Read one file.
 *
 * Never throws. A document that is neither a PDF nor a DOCX — a JPEG of a
 * marksheet, which is a great deal of what Indian candidates actually upload —
 * comes back as `unknown` with `readError` set, and every arm that needs the file
 * declines to speak rather than treating "I could not read it" as "it is clean".
 */
export function analyzeDocument(input: {
  bytes: Uint8Array;
  filename?: string;
  docClass?: DocClass;
}): DocumentForensics {
  const bytes = input.bytes && input.bytes.byteLength > 0 ? input.bytes : new Uint8Array(0);
  const base: AnalysisBase = {
    docClass: input.docClass ?? "",
    filename: input.filename ?? "",
  };
  if (bytes.byteLength === 0) return unreadable("unknown", base, "The file is empty.");
  const isPdf = new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isPdf && !isZip)
    return unreadable("unknown", base, "Not a PDF or a DOCX, so there is no document history to read.");
  try {
    return isPdf ? fromPdf(bytes, base) : fromDocx(bytes, base);
  } catch (err) {
    return unreadable(
      isPdf ? "pdf" : "docx",
      base,
      err instanceof Error ? err.message : "The file could not be read.",
    );
  }
}
