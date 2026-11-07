import { zlibSync } from "fflate";

/**
 * Byte-level PDF assembly.
 *
 * The verification feature is graded on forensic *artifacts* — an orphaned text
 * object, a second `%%EOF`, an XMP `InstanceID` that moved while `DocumentID`
 * did not — and no PDF writer in this repo can express those: `shareToPdf` emits
 * one flat generation whose table it computes for itself. So the fixture corpus
 * has to be able to say "object 8 is still in the file and the xref now marks it
 * free", which is a statement about byte offsets — and byte offsets are the one
 * thing a human gets wrong and a machine cannot.
 *
 * Pure and isomorphic by contract: no IO, no server module, no view. Bytes go in,
 * bytes come out, so the same builders serve a `node --test` run today and a
 * browser-side paste box later without a second implementation.
 *
 * The file is assembled as latin-1 text and encoded once at the end: every byte
 * this module can emit is 0-255 by construction, which is what makes the offset
 * arithmetic (`string.length` === byte offset) honest. `pdfLatin` is the only
 * place that decides what happens above 255, and it decides `?`.
 */

export function pdfLatin(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i] = code > 255 ? 0x3f : code;
  }
  return bytes;
}

export function decodeLatin(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/** The `(...)` literal form, escaped the way the spec requires. */
export function pdfString(text: string): string {
  const latin = decodeLatin(pdfLatin(text));
  return `(${latin.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

/**
 * `/Info` wants `D:YYYYMMDDHHMMSSzzzz`, and callers pass it with or without the
 * prefix — a writer that doubled it emits a date no reader can parse.
 */
export function pdfDate(value: string | Date): string {
  if (typeof value === "string") {
    const bare = value.replace(/^\(|\)$/g, "");
    return `(${bare.startsWith("D:") ? bare : `D:${bare}`})`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const at = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `(D:${at(value)}Z)`;
}

/**
 * The same instant in the other format every real file carries it in: XMP is
 * W3C-DTF (`2024-03-11T09:15:00Z`) while `/Info` is `D:20240311091500`. A check
 * that compares the two has to parse both, so the corpus emits both from one
 * input rather than letting a fixture state the same clock twice in one shape.
 */
export function xmpDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, "Z");
  const m = /^D?:?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : value;
}

export type PdfObjectSpec = { num: number; gen?: number; body: string };

/**
 * A slot that is *free* in the table while its bytes are still in the file.
 * This is the whole orphan mechanism: an editor that replaces object 8 does not
 * erase it, it re-points the page's `/Contents` at a new number and marks 8 free
 * so a later save can reuse the slot.
 */
export type PdfFreeSlot = { num: number; gen?: number; next: number };

/** An object that lives inside an `/ObjStm` instead of at its own byte offset. */
export type PdfCompressedMember = { num: number; container: number; index: number };

export type AssemblePdfOptions = {
  version?: string;
  /** The high-byte comment line every real writer emits after the header. */
  binaryComment?: boolean;
  objects: PdfObjectSpec[];
  free?: PdfFreeSlot[];
  /** Only expressible through a cross-reference *stream*, which needs PDF 1.5. */
  compressed?: PdfCompressedMember[];
  root: number;
  info?: number;
  idArray?: string;
  /** `/Size` override — a table that covers past generations is legal. */
  sizeHint?: number;
  /**
   * Emit the table as a compressed `/Type /XRef` object rather than a classic
   * `xref` + `trailer` pair. This is what LibreOffice, Google Docs export and
   * every modern SDK produce, so it is also the shape an orphan check must not
   * mistake for tampering.
   */
  xrefStream?: boolean;
  /** Object number for the table itself when `xrefStream` is on. */
  xrefStreamNum?: number;
};

export type PdfAssembly = {
  bytes: Uint8Array;
  /** Absolute byte offset of each object's `num gen obj`, by object number. */
  offsets: Map<number, number>;
  xrefStart: number;
  eofCount: number;
  size: number;
  tableKind: "classic" | "xref-stream";
};

type Row = { kind: "n"; offset: number } | { kind: "f"; gen: number; next: number };

function rowText(row: Row): string {
  return row.kind === "n"
    ? `${String(row.offset).padStart(10, "0")} 00000 n \n`
    : `${String(row.next).padStart(10, "0")} ${String(row.gen).padStart(5, "0")} f \n`;
}

/** Objects are emitted in number order, the way a linearising writer does. */
function renderObjects(
  objects: PdfObjectSpec[],
  at: number,
): { text: string; offsets: Map<number, number> } {
  const offsets = new Map<number, number>();
  let text = "";
  for (const o of [...objects].sort((a, b) => a.num - b.num)) {
    offsets.set(o.num, at + text.length);
    text += `${o.num} ${o.gen ?? 0} obj\n${o.body}\nendobj\n`;
  }
  return { text, offsets };
}

function tableRows(live: Map<number, number>, free: PdfFreeSlot[], size: number): string {
  const freeByNum = new Map(free.map((f) => [f.num, f]));
  let rows = `0 ${size}\n${rowText({ kind: "f", gen: 65535, next: 0 })}`;
  for (let num = 1; num < size; num += 1) {
    const freed = freeByNum.get(num);
    if (freed) {
      rows += rowText({ kind: "f", gen: freed.gen ?? 0, next: freed.next });
    } else if (live.has(num)) {
      rows += rowText({ kind: "n", offset: live.get(num)! });
    } else {
      // A classic table is positional, so a number that is neither live nor
      // declared free still needs a row. 65535 is what a reader sees when a
      // writer lies about a slot — the orphan check has to tolerate it rather
      // than crash, so the assembler emits exactly that instead of inventing an
      // error case no real file produces.
      rows += rowText({ kind: "f", gen: 65535, next: 0 });
    }
  }
  return rows;
}

/**
 * The packed fields of a `/Type /XRef` stream, `/W [1 4 2]`.
 *
 * Object 0 still gets a row — a real table always starts by describing the free
 * head — and compressed members carry their container in the offset field and
 * their index in the generation field, which is precisely why a reader must
 * know the type byte before treating either as a byte offset.
 */
function xrefStreamFields(opts: {
  live: Map<number, number>;
  free: PdfFreeSlot[];
  compressed: PdfCompressedMember[];
  size: number;
}): Uint8Array {
  const freeByNum = new Map(opts.free.map((f) => [f.num, f]));
  const byNum = new Map(opts.compressed.map((c) => [c.num, c]));
  const rows: number[][] = [[0, 0, 0]];
  for (let num = 1; num < opts.size; num += 1) {
    const member = byNum.get(num);
    const freed = freeByNum.get(num);
    if (member) rows.push([2, member.container, member.index]);
    else if (freed) rows.push([0, freed.next, freed.gen ?? 0]);
    else if (opts.live.has(num)) rows.push([1, opts.live.get(num)!, 0]);
    else rows.push([0, 0, 65535]);
  }
  const bytes: number[] = [];
  for (const [type, a, b] of rows) {
    bytes.push(
      type,
      (a >>> 24) & 0xff,
      (a >>> 16) & 0xff,
      (a >>> 8) & 0xff,
      a & 0xff,
      (b >>> 8) & 0xff,
      b & 0xff,
    );
  }
  return Uint8Array.from(bytes);
}

function trailerText(opts: {
  size: number;
  root: number;
  info?: number;
  idArray?: string;
  prevStartxref?: number;
}): string {
  const entries = [
    `/Size ${opts.size}`,
    `/Root ${opts.root} 0 R`,
    opts.info ? `/Info ${opts.info} 0 R` : "",
    opts.idArray ? `/ID ${opts.idArray}` : "",
    opts.prevStartxref === undefined ? "" : `/Prev ${opts.prevStartxref}`,
  ].filter(Boolean);
  return `trailer << ${entries.join(" ")} >>\n`;
}

function highest(opts: {
  objects: PdfObjectSpec[];
  free?: PdfFreeSlot[];
  compressed?: PdfCompressedMember[];
  root: number;
  info?: number;
}): number {
  let max = opts.root;
  if (opts.info) max = Math.max(max, opts.info);
  for (const o of opts.objects) max = Math.max(max, o.num);
  for (const f of opts.free ?? []) max = Math.max(max, f.num);
  for (const c of opts.compressed ?? []) max = Math.max(max, c.num, c.container);
  return max;
}

export function assemblePdf(opts: AssemblePdfOptions): PdfAssembly {
  const header = `%PDF-${opts.version ?? (opts.xrefStream ? "1.5" : "1.4")}\n${opts.binaryComment ? "%\u00b5\u00cd\u00d3\u00d3\n" : ""}`;
  const rendered = renderObjects(opts.objects, header.length);
  const size = opts.sizeHint ?? highest(opts) + 1;
  if (!opts.xrefStream) {
    const xrefStart = header.length + rendered.text.length;
    const tail =
      `xref\n${tableRows(rendered.offsets, opts.free ?? [], size)}` +
      trailerText({ size, root: opts.root, info: opts.info, idArray: opts.idArray }) +
      `startxref\n${xrefStart}\n%%EOF\n`;
    return {
      bytes: pdfLatin(`${header}${rendered.text}${tail}`),
      offsets: rendered.offsets,
      xrefStart,
      eofCount: 1,
      size,
      tableKind: "classic",
    };
  }

  // The table describes itself, so its own offset is the one number that has to
  // be known before its bytes exist — and it is knowable, because the table is
  // the last thing in the file and everything before it is already measured.
  const xrefNum = opts.xrefStreamNum ?? size;
  const tableSize = size > xrefNum ? size : xrefNum + 1;
  const xrefStart = header.length + rendered.text.length;
  const live = new Map(rendered.offsets);
  live.set(xrefNum, xrefStart);
  const data = xrefStreamFields({
    live,
    free: opts.free ?? [],
    compressed: opts.compressed ?? [],
    size: tableSize,
  });
  const entries = [
    "/Type /XRef",
    `/Size ${tableSize}`,
    "/W [1 4 2]",
    `/Root ${opts.root} 0 R`,
    opts.info ? `/Info ${opts.info} 0 R` : "",
    opts.idArray ? `/ID ${opts.idArray}` : "",
    "/Filter /FlateDecode",
  ]
    .filter(Boolean)
    .join(" ");
  // `/Filter /FlateDecode` is in the dictionary above, so the payload has to
  // actually be deflated — a table that only *claims* to be compressed is
  // unreadable to every real parser, and a fixture that fails that way would
  // look like a tampered file rather than a well-formed modern one.
  const body = streamObject(xrefNum, entries, Uint8Array.from(zlibSync(data))).body;
  return {
    bytes: pdfLatin(
      `${header}${rendered.text}${xrefNum} 0 obj\n${body}\nendobj\nstartxref\n${xrefStart}\n%%EOF\n`,
    ),
    offsets: live,
    xrefStart,
    eofCount: 1,
    size: tableSize,
    tableKind: "xref-stream",
  };
}

/**
 * A second generation over an assembled file: the new objects land after the old
 * `%%EOF`, the new table restates every offset that is still live, and the
 * trailer says `/Prev`. This is what an edit-and-save actually produces, and it
 * is why `%%EOF` count and the `DocumentID`/`InstanceID` pair are signals rather
 * than trivia.
 *
 * The base must be a classic-table file. `/Prev` chains over a cross-reference
 * stream are legal and common, but they are also the shape where a reader that
 * merges generations wrong invents orphans, so the corpus does not lean on it
 * until a fixture needs it.
 */
export function appendIncrementalUpdate(
  base: PdfAssembly,
  opts: Omit<
    AssemblePdfOptions,
    "version" | "binaryComment" | "xrefStream" | "xrefStreamNum" | "compressed"
  >,
): PdfAssembly {
  const prefix = decodeLatin(base.bytes).replace(/[\n]*$/, "\n");
  const rendered = renderObjects(opts.objects, prefix.length);
  const live = new Map(base.offsets);
  for (const [num, offset] of rendered.offsets) live.set(num, offset);
  for (const freed of opts.free ?? []) live.delete(freed.num);
  const size = opts.sizeHint ?? Math.max(highest(opts), base.size - 1) + 1;
  const xrefStart = prefix.length + rendered.text.length;
  const tail =
    `xref\n${tableRows(live, opts.free ?? [], size)}` +
    trailerText({
      size,
      root: opts.root,
      info: opts.info,
      idArray: opts.idArray,
      prevStartxref: base.xrefStart,
    }) +
    `startxref\n${xrefStart}\n%%EOF\n`;
  return {
    bytes: pdfLatin(`${prefix}${rendered.text}${tail}`),
    offsets: live,
    xrefStart,
    eofCount: base.eofCount + 1,
    size,
    tableKind: "classic",
  };
}

/* ------------------------------------------------------------------ objects */

/** `/Length` is a byte count, so it is measured here and never handed in. */
export function streamObject(
  num: number,
  entries: string,
  data: Uint8Array | string,
): PdfObjectSpec {
  const bytes = typeof data === "string" ? pdfLatin(data) : data;
  const trimmed = entries.trim();
  const head = trimmed
    ? `<< ${trimmed} /Length ${bytes.length} >>`
    : `<< /Length ${bytes.length} >>`;
  return { num, body: `${head}\nstream\n${decodeLatin(bytes)}\nendstream` };
}

// `zlibSync`, not `deflateSync`: `/FlateDecode` means a zlib-wrapped stream, and
// pdf.js refuses a raw deflate with "Unknown compression method" — which looks
// exactly like a corrupted upload, so a fixture built the wrong way would test
// nothing about forensics at all.
export function deflatedObject(num: number, entries: string, text: string): PdfObjectSpec {
  return streamObject(
    num,
    `${entries.trim()} /Filter /FlateDecode`.trim(),
    Uint8Array.from(zlibSync(pdfLatin(text))),
  );
}

/** Text-drawing operators, one `BT … ET` block per line, top-down. */
export function textOperators(
  lines: string[],
  opts?: { size?: number; top?: number; left?: number; leading?: number; font?: string },
): string {
  const size = opts?.size ?? 12;
  const leading = opts?.leading ?? 16;
  const left = opts?.left ?? 48;
  const font = opts?.font ?? "F1";
  let y = opts?.top ?? 780;
  return lines
    .map((line) => {
      const op = `BT /${font} ${size} Tf ${left} ${y} Td ${pdfString(line)} Tj ET`;
      y -= leading;
      return op;
    })
    .join("\n");
}

export function infoObject(
  num: number,
  fields: {
    producer?: string;
    creator?: string;
    title?: string;
    author?: string;
    created?: string | Date;
    modified?: string | Date;
  },
): PdfObjectSpec {
  const entries = [
    fields.title ? `/Title ${pdfString(fields.title)}` : "",
    fields.author ? `/Author ${pdfString(fields.author)}` : "",
    fields.producer ? `/Producer ${pdfString(fields.producer)}` : "",
    fields.creator ? `/Creator ${pdfString(fields.creator)}` : "",
    fields.created ? `/CreationDate ${pdfDate(fields.created)}` : "",
    fields.modified ? `/ModDate ${pdfDate(fields.modified)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { num, body: `<< ${entries} >>` };
}

/**
 * The XMP packet, hand-written for the same reason as everything else here: a
 * library normalises away the field the check reads. `xmpMM:DocumentID` is stable
 * across saves while `xmpMM:InstanceID` is not, and that pair is what separates
 * "edited twice" from "exported twice from the same source".
 */
export function xmpObject(
  num: number,
  fields: {
    documentId: string;
    instanceId: string;
    createdAt?: string | Date;
    modifiedAt?: string | Date;
    tool?: string;
  },
): PdfObjectSpec {
  const packet = [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    '  xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    '  xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
    `  xmp:CreateDate="${fields.createdAt ? xmpDate(fields.createdAt) : ""}"`,
    `  xmp:ModifyDate="${fields.modifiedAt ? xmpDate(fields.modifiedAt) : ""}"`,
    `  xmp:CreatorTool="${fields.tool ?? ""}"`,
    `  xmpMM:DocumentID="${fields.documentId}"`,
    `  xmpMM:InstanceID="${fields.instanceId}"/>`,
    "</rdf:RDF></x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
  return streamObject(num, "/Type /Metadata /Subtype /XML", packet);
}

export type ObjectStreamMember = { num: number; dict: string };

/**
 * PDF 1.5 object stream: several objects inside one deflate, no `n 0 obj` of
 * their own. This is the shape a modern writer emits — and the reason an orphan
 * check that only greps the raw bytes finds "text" in a compressed blob and
 * reports a tamper that never happened.
 */
export function objectStreamObject(num: number, members: ObjectStreamMember[]): PdfObjectSpec {
  const headers: string[] = [];
  let payload = "";
  for (const m of members) {
    headers.push(`${m.num} ${payload.length}`);
    payload += m.dict;
  }
  const head = `${headers.join(" ")} `;
  return streamObject(
    num,
    `/Type /ObjStm /N ${members.length} /First ${head.length} /Filter /FlateDecode`,
    Uint8Array.from(zlibSync(pdfLatin(head + payload))),
  );
}

/** Catalog / pages / page / font — the minimum a reader needs to walk a file. */
export function skeletonObjects(opts: {
  contentNum: number;
  catalogNum?: number;
  pagesNum?: number;
  pageNum?: number;
  fontNum?: number;
  metadataNum?: number;
}): { catalog: PdfObjectSpec; pages: PdfObjectSpec; page: PdfObjectSpec; font: PdfObjectSpec } {
  const catalogNum = opts.catalogNum ?? 1;
  const pagesNum = opts.pagesNum ?? 2;
  const pageNum = opts.pageNum ?? 3;
  const fontNum = opts.fontNum ?? 5;
  const extra = opts.metadataNum ? `/Metadata ${opts.metadataNum} 0 R` : "";
  return {
    catalog: {
      num: catalogNum,
      body: `<< /Type /Catalog /Pages ${pagesNum} 0 R ${extra}>>`.replace("  ", " "),
    },
    pages: { num: pagesNum, body: `<< /Type /Pages /Kids [${pageNum} 0 R] /Count 1 >>` },
    page: {
      num: pageNum,
      body:
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${opts.contentNum} 0 R >>`,
    },
    font: { num: fontNum, body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` },
  };
}
