import { inflateSync, unzlibSync } from "fflate";
import { decodeLatin } from "./pdf-bytes.ts";

/**
 * Reading a PDF at the same level this corpus writes it.
 *
 * This is not a text extractor — `pdf-parse` already does that and the product
 * keeps using it. What the forensic checks need is the *structure* view that a
 * text extractor throws away: which object numbers exist, which ones the newest
 * cross-reference table points at, how many generations the file carries, and
 * what literals sit inside objects nobody references any more.
 *
 * The scanner is a cursor walk, not one regex over the whole file, and that
 * distinction is load-bearing. A `/FlateDecode` payload is arbitrary bytes, so a
 * `7 0 obj` sequence can appear *inside* compressed data by accident; a regex
 * that matched it would report an orphan in a pristine modern PDF — the exact
 * false positive this feature exists to avoid. The walk only accepts an object
 * header at top level, and `pdf-bytes.test.ts` proves it against a compressed
 * fixture deliberately packed with decoy bytes.
 *
 * What "orphaned" means here, and why it is the xref and not the page tree:
 * an object whose slot in the *newest* table is free or missing is what an
 * editor leaves behind, and that is the claim a `contradicted` verdict would
 * rest on. Reachability from `/Root` is reported separately, because in a
 * compressed PDF the `/ObjStm` container is legitimately unreferenced from
 * `/Root` — calling that a tamper would be the same class of mistake.
 */

export type XrefRow = {
  num: number;
  /** `n` in use at an offset, `f` free, `c` inside an object stream. */
  kind: "n" | "f" | "c";
  /** Byte offset when `n`; the free-chain head when `f`; the container when `c`. */
  value: number;
  /** Generation when `f`; the index inside the container when `c`. */
  gen: number;
};

export type PdfObjectRecord = {
  num: number;
  gen: number;
  /**
   * Byte offset of the `num gen obj` header, or `-1` for a dictionary that was
   * expanded out of an object stream and therefore has no position of its own.
   */
  offset: number;
  /** The `/ObjStm` holding this record, when `offset` is `-1`. */
  inObjStm?: number;
  dict: string;
  /** Stream payload, inflated when the dictionary says `/FlateDecode`. */
  stream?: Uint8Array;
  streamStored?: Uint8Array;
  /** The dictionary claims `/FlateDecode` and the bytes are not a deflate. */
  inflateFailed?: boolean;
  /** Dictionary plus (inflated) stream text, for literal and operator scans. */
  text: string;
};

export type PdfStructure = {
  version: string;
  /** `%%EOF` count: 1 is one generation, 2+ is an incremental-update trail. */
  eofCount: number;
  /** Every `startxref` target, in file order, oldest first. */
  startxrefs: number[];
  trailers: string[];
  /** Rows of the newest table — the one a reader would use. */
  xref: XrefRow[];
  /**
   * What the newest table actually is. `absent` means this file has no usable
   * cross-reference statement at all, and then `live` is what the scan could
   * find and `orphaned` is empty by construction: without a table there is no
   * claim to contradict, and a check that says otherwise is guessing.
   */
  tableKind: "classic" | "xref-stream" | "absent";
  /** Tables reachable by following `/Prev`: 1 is one generation, more is a trail. */
  tableChain: number;
  /**
   * What the newest table points at — plus any number only an older table in
   * the `/Prev` chain mentions, which is how a partial update is read correctly.
   */
  live: Map<number, number>;
  objects: PdfObjectRecord[];
  /** Present as bytes, not pointed at by the newest table. */
  orphaned: PdfObjectRecord[];
  /**
   * Live per the table, but nothing reachable from `/Root` or `/Info` refers to
   * them. The cross-reference stream and any `/ObjStm` container are excluded by
   * construction — both are legitimately unreachable from a dictionary, and a
   * check that reads this list without knowing that flags every modern file.
   */
  unreferencedFromRoot: number[];
  producers: string[];
  creators: string[];
  creationDates: string[];
  modDates: string[];
  baseFonts: string[];
  /** Object numbers carried inside an `/ObjStm` rather than as their own body. */
  objStmMembers: number[];
  xmp: {
    present: boolean;
    documentIds: string[];
    instanceIds: string[];
    createDates: string[];
    modifyDates: string[];
    tools: string[];
  };
};

const TOKEN =
  /(\d+)\s+(\d+)\s+obj\b|stream\r?\n|endstream|endobj|xref\b|trailer\b|startxref\b|%%EOF/g;

function isFlate(dict: string): boolean {
  return /\/Filter\s*(?:\[[^\]]*\/FlateDecode|\/FlateDecode)/.test(dict);
}

/**
 * The `<< … >>` that opens an object body, brace-counted. Stopping at the first
 * `>>` ends a dictionary inside a `/Resources` value, and a name token may
 * legally contain `<` or `>`, so both are skipped explicitly.
 *
 * `to` is the object's body end. Without it, an object whose body is a bare
 * array or number — `9 0 obj [6 0 R 7 0 R] endobj` — has no dictionary at all,
 * and the scan would happily return the *next* object's, handing that object's
 * references to this one.
 */
export function readDictAt(text: string, from: number, to = text.length): string {
  const start = text.indexOf("<<", from);
  if (start < 0 || start >= to) return "";
  let depth = 0;
  let i = start;
  while (i < to) {
    const ch = text[i];
    if (text.startsWith("<<", i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith(">>", i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return text.slice(start + 2, i - 2).trim();
    } else if (ch === "/") {
      i += 1;
      while (i < to && !/[<>[\]()/\s%]/.test(text[i])) i += 1;
    } else if (ch === "(") {
      let nested = 1;
      i += 1;
      while (i < to && nested > 0) {
        if (text[i] === "\\") i += 1;
        else if (text[i] === "(") nested += 1;
        else if (text[i] === ")") nested -= 1;
        i += 1;
      }
    } else i += 1;
  }
  return text.slice(start + 2, to).trim();
}

/** Every `(...)` literal in a chunk of PDF source, escapes folded. */
export function literalStrings(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "(") continue;
    let j = i + 1;
    let value = "";
    while (j < text.length) {
      const ch = text[j];
      if (ch === "\\") {
        const next = text[j + 1] ?? "";
        value += next === "n" ? "\n" : next === "t" ? "\t" : next === "()" ? "(" : next;
        j += 2;
        continue;
      }
      if (ch === ")") break;
      value += ch;
      j += 1;
    }
    out.push(value);
    i = j;
  }
  return out;
}

const LITERAL_RE = /(\((?:[^()\\]|\\.)*\))/g;

function fieldLiterals(dicts: string[], key: string): string[] {
  const out: string[] = [];
  for (const dict of dicts) {
    const re = new RegExp(`${key}\\s*${LITERAL_RE.source}`, "g");
    for (const m of dict.matchAll(re)) out.push(...literalStrings(m[1]));
  }
  return out;
}

/** Inflate, or `null` when the payload is not what the dictionary claims. */
function inflate(bytes: Uint8Array): Uint8Array | null {
  try {
    // `/FlateDecode` is zlib in practice — a two-byte header over the deflate
    // stream — but a payload without the header still decodes, so both are
    // tried in that order rather than rejecting a real file over a wrapper.
    return Uint8Array.from(unzlibSync(bytes));
  } catch {
    try {
      return Uint8Array.from(inflateSync(bytes));
    } catch {
      // A damaged stream is a finding for the caller to report, not an exception
      // here: the structure view has to survive long enough to say *which*
      // object is unreadable. That is the difference between `unverifiable` and
      // a crash.
      return null;
    }
  }
}

/** The positional `xref` table at `offset`. */
function parseXrefAt(text: string, offset: number): XrefRow[] {
  if (!text.startsWith("xref", offset)) return [];
  const rows: XrefRow[] = [];
  let i = offset + 4;
  for (;;) {
    const head = /^\s+(\d+)\s+(\d+)\s*\n/.exec(text.slice(i));
    if (!head) break;
    const start = Number(head[1]);
    const count = Number(head[2]);
    i += head[0].length;
    for (let n = 0; n < count; n += 1) {
      const entry = /^(\d{10})\s(\d{5})\s([nf])/.exec(text.slice(i, i + 20));
      if (!entry) return rows;
      rows.push({
        num: start + n,
        kind: entry[3] as "n" | "f",
        value: Number(entry[1]),
        gen: Number(entry[2]),
      });
      i += entry[0].length;
      // Entry lines are exactly 20 bytes (`n` after the 3rd char, then EOL), but
      // writers vary on CR/LF/space, so consume to the next line end.
      const eol = text.indexOf("\n", i);
      i = eol < 0 ? text.length : eol + 1;
    }
  }
  return rows;
}

/** A cross-reference statement: either a classic table plus trailer, or a `/Type /XRef` object. */
type PdfTable = {
  start: number;
  kind: "classic" | "xref-stream";
  /** The object number of a cross-reference *stream* — classic tables have none. */
  num?: number;
  rows: XrefRow[];
  dict: string;
};

/**
 * The packed `/W` fields of a cross-reference stream.
 *
 * A zero width means the field is absent and takes its default — type defaults
 * to `1` (in use), which is why the check cannot simply read the first byte of
 * every row. Rows for compressed members are skipped from the offset map by the
 * caller: their "offset" is an object number and their "generation" is an index.
 */
function parseXrefStream(dict: string, data: Uint8Array): XrefRow[] {
  const w = /\/W\s*\[([\d\s]+)\]/.exec(dict);
  if (!w) return [];
  const widths = w[1].trim().split(/\s+/).map(Number);
  if (widths.length < 2 || widths.some((n) => !Number.isFinite(n) || n < 0 || n > 8)) return [];
  const size = /\/Size\s+(\d+)/.exec(dict);
  const index = /\/Index\s*\[([\d\s]+)\]/.exec(dict);
  const ranges: Array<[number, number]> = [];
  if (index) {
    const nums = index[1].trim().split(/\s+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) ranges.push([nums[i], nums[i + 1]]);
  }
  if (!ranges.length) ranges.push([0, size ? Number(size[1]) : 0]);
  const rows: XrefRow[] = [];
  let p = 0;
  for (const [start, count] of ranges) {
    for (let k = 0; k < count; k += 1) {
      const field = (i: number, dflt: number) => {
        const len = widths[i] ?? 0;
        // A zero width is not "a byte that happens to be 0", it is "this field
        // is absent, take the default" — and the default for type is `1`, which
        // is the whole reason `/W [0 4 2]` files are still readable.
        if (!len) return dflt;
        let v = 0;
        for (let b = 0; b < len; b += 1) {
          v = v * 256 + (p < data.length ? data[p] : 0);
          p += 1;
        }
        return v;
      };
      const type = field(0, 1);
      const value = field(1, 0);
      const gen = widths.length > 2 ? field(2, 0) : 0;
      if (p > data.length) return rows;
      rows.push({
        num: start + k,
        kind: type === 1 ? "n" : type === 2 ? "c" : "f",
        value,
        gen,
      });
    }
  }
  return rows;
}

/** One table, wherever `start` says it is — and whether it is a table at all. */
function readTableAt(
  text: string,
  objects: PdfObjectRecord[],
  trailerSpans: Array<{ at: number; dict: string }>,
  start: number,
): PdfTable | null {
  if (text.startsWith("xref", start)) {
    const trailer = trailerSpans.find((s) => s.at >= start);
    return { start, kind: "classic", rows: parseXrefAt(text, start), dict: trailer?.dict ?? "" };
  }
  const obj = objects.find((o) => o.offset === start && /\/Type\s*\/XRef/.test(o.dict));
  if (!obj) return null;
  return {
    start,
    num: obj.num,
    kind: "xref-stream",
    rows: parseXrefStream(obj.dict, obj.stream ?? new Uint8Array()),
    dict: obj.dict,
  };
}

type Scanned = {
  num: number;
  gen: number;
  offset: number;
  dict: string;
  streamStored?: Uint8Array;
};

/** `/Length`, unless it is an indirect reference — then it is not a number we have. */
function declaredLength(dict: string): number | undefined {
  const m = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  return m ? Number(m[1]) : undefined;
}

/**
 * The object bodies, in file order.
 *
 * `TOKEN` searches *forward* from the cursor rather than requiring a match at
 * it, and each object is consumed up to its `endobj`. That pairing is what keeps
 * a compressed payload from being read as structure: deflate data is arbitrary
 * bytes, so `12 0 obj` can fall out of a font stream by chance, and a plain
 * whole-file scan would report the object the page never references. Once a
 * header is accepted, the next token decides the body's shape, so the walk never
 * re-enters a stream it has already skipped.
 */
function scanObjects(text: string): Scanned[] {
  const found: Scanned[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    TOKEN.lastIndex = cursor;
    const m = TOKEN.exec(text);
    if (!m) break;
    const after = m.index + m[0].length;
    if (m[1] === undefined) {
      cursor = after;
      continue;
    }
    const num = Number(m[1]);
    const gen = Number(m[2]);
    TOKEN.lastIndex = after;
    const next = TOKEN.exec(text);
    const stop = next ? next.index : text.length;
    const dict = readDictAt(text, after, stop);
    if (!next || !next[0].startsWith("stream")) {
      found.push({ num, gen, offset: m.index, dict });
      cursor = next ? stop + next[0].length : after + 1;
      continue;
    }
    const dataStart = next.index + next[0].length;
    const length = declaredLength(dict);
    // A declared `/Length` points past any `endstream` that only looks like one;
    // a lying or missing one falls back to the first match, which is a finding
    // for the caller rather than a reason to fail the read here.
    let endStream = length === undefined ? -1 : text.indexOf("endstream", dataStart + length);
    if (endStream < 0) endStream = text.indexOf("endstream", dataStart);
    if (endStream < 0) {
      found.push({ num, gen, offset: m.index, dict });
      cursor = dataStart + 1;
      continue;
    }
    const raw = text.slice(dataStart, endStream).replace(/\r?\n$/, "");
    found.push({
      num,
      gen,
      offset: m.index,
      dict,
      streamStored: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
    });
    TOKEN.lastIndex = endStream + 9;
    const endObj = TOKEN.exec(text);
    cursor = endObj && endObj[0] === "endobj" ? endObj.index + 6 : endStream + 9;
  }
  return found;
}

export function readPdfStructure(bytes: Uint8Array): PdfStructure {
  const text = decodeLatin(bytes);
  const scanned = scanObjects(text);

  const eofCount = (text.match(/%%EOF/g) ?? []).length;
  const startxrefs = [...text.matchAll(/startxref\s+(\d+)/g)].map((m) => Number(m[1]));
  const trailerSpans = [...text.matchAll(/trailer\b/g)].map((m) => ({
    at: m.index,
    dict: readDictAt(text, m.index),
  }));
  const trailers = trailerSpans.map((s) => s.dict);

  const objects: PdfObjectRecord[] = scanned.map((o) => {
    const streamStored = o.streamStored;
    const claimsCompression = streamStored !== undefined && isFlate(o.dict);
    const inflated = claimsCompression ? inflate(streamStored!) : null;
    const stream = claimsCompression ? (inflated ?? streamStored!) : streamStored;
    return {
      num: o.num,
      gen: o.gen,
      offset: o.offset,
      dict: o.dict,
      stream,
      streamStored,
      // A dictionary that says `/FlateDecode` over bytes that are not a deflate
      // is either damage or a hand-poked file, and either way the text below it
      // is the raw payload: `streamTextIsRaw` is what tells a caller not to
      // trust a literal it finds there.
      inflateFailed: claimsCompression && inflated === null,
      text: stream === undefined ? o.dict : `${o.dict}\n${decodeLatin(stream)}`,
    };
  });

  // The newest table is the one the *last* `startxref` points at; a reader that
  // follows only the first one sees the file as it was before the last save.
  // `/Prev` then walks backwards, because a PDF 1.5 update often restates only
  // the numbers it changed and everything else lives in the older table.
  const newestXref = startxrefs.length
    ? startxrefs[startxrefs.length - 1]
    : text.lastIndexOf("xref");
  const chain: PdfTable[] = [];
  const seenStarts = new Set<number>();
  for (let at = newestXref; at >= 0 && !seenStarts.has(at);) {
    seenStarts.add(at);
    const table = readTableAt(text, objects, trailerSpans, at);
    if (!table) break;
    chain.push(table);
    const prev = /\/Prev\s+(\d+)/.exec(table.dict);
    at = prev ? Number(prev[1]) : -1;
  }
  const newest = chain[0];
  const xref = newest ? newest.rows : [];
  const tableKind = newest ? newest.kind : "absent";

  // Newest statement about a number wins — including "this slot is free", which
  // is exactly what an editor writes over the offset it abandoned.
  const claims = new Map<number, XrefRow>();
  for (const table of chain) {
    for (const row of table.rows) if (!claims.has(row.num)) claims.set(row.num, row);
  }
  const live = new Map<number, number>();
  for (const [num, row] of claims) if (row.kind === "n") live.set(num, row.value);

  const orphaned =
    tableKind === "absent" ? [] : objects.filter((o) => live.get(o.num) !== o.offset);

  // Object streams: the modern writer's default, where most dictionaries live
  // inside one deflated payload instead of at their own offsets. Expanding them
  // into records is what lets the metadata and reference scans see a LibreOffice
  // or Google-Docs PDF at all. They are records without a position — `offset` is
  // `-1` — which is also why they are absent from `orphaned`: the orphan rule
  // compares byte offsets, and a member has none to lose.
  const memberRecords: PdfObjectRecord[] = [];
  const memberNums = new Set<number>();
  const objStmContainers = new Set<number>();
  for (const o of objects) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const count = /\/N\s+(\d+)/.exec(o.dict);
    const first = /\/First\s+(\d+)/.exec(o.dict);
    if (!count || !first) continue;
    objStmContainers.add(o.num);
    const payload = decodeLatin(o.stream ?? new Uint8Array());
    const base = Number(first[1]);
    const pairs = payload.slice(0, base).trim().split(/\s+/).map(Number);
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const end = pairs[i + 3] ?? payload.length - base;
      const body = payload.slice(base + pairs[i + 1], base + end);
      memberRecords.push({
        num: pairs[i],
        gen: 0,
        offset: -1,
        dict: readDictAt(body, 0),
        inObjStm: o.num,
        text: body,
      });
    }
  }
  const objStmMembers = [...memberRecords.map((o) => o.num)];
  for (const [num, row] of claims)
    if (row.kind === "c" && !memberRecords.some((o) => o.num === num)) objStmMembers.push(num);
  for (const num of objStmMembers) memberNums.add(num);

  // Reachability is built from dictionaries only: `/Contents 8 0 R` and
  // `/Font << /F1 5 0 R >>` are structure, while an operand inside a content
  // stream is not a reference and must not keep a replaced object alive.
  // `/Root` and `/Info` both live in the trailer of a classic file and in the
  // cross-reference stream of a modern one, so the newest table is asked first —
  // and `/Info` is asked too, because nothing else points at it: a walk seeded
  // only with `/Root` would call the `/Info` object of every pristine PDF
  // "unreferenced", which is precisely the false positive this list exists to
  // keep honest.
  const rootSource = newest?.dict ?? trailers.at(-1) ?? "";
  const seeds = [...rootSource.matchAll(/\/(?:Root|Info)\s+(\d+)\s+\d+\s+R/g)].map((m) =>
    Number(m[1]),
  );
  const reached = new Set<number>();
  const queue = seeds.length ? seeds : [1];
  const dictByNum = new Map([...objects, ...memberRecords].map((o) => [o.num, o.dict] as const));
  while (queue.length) {
    const num = queue.shift()!;
    if (reached.has(num)) continue;
    reached.add(num);
    for (const m of (dictByNum.get(num) ?? "").matchAll(/(\d+)\s+\d+\s+R\b/g)) {
      const target = Number(m[1]);
      if ((live.has(target) || memberNums.has(target)) && !reached.has(target)) queue.push(target);
    }
  }
  // Two kinds of object are live, unreachable from the seeds, and completely
  // normal: the cross-reference stream (it *is* the index, and a type-1 row
  // describes itself) and an `/ObjStm` container, which the reader reaches
  // through its members' type-2 rows rather than through any dictionary.
  const structural = new Set<number>([...objStmContainers]);
  for (const table of chain) if (table.num !== undefined) structural.add(table.num);
  const unreferencedFromRoot = [...live.keys()]
    .filter((num) => num !== 0 && !reached.has(num) && !structural.has(num))
    .sort((a, b) => a - b);

  const dicts = [...objects, ...memberRecords].map((o) => o.dict);
  const metadata = [...objects, ...memberRecords].filter(
    (o) => /\/Subtype\s*\/XML/.test(o.dict) || /\/Type\s*\/Metadata/.test(o.dict),
  );
  const xmpText = metadata.map((o) => decodeLatin(o.stream ?? new Uint8Array())).join("\n");

  return {
    version: (/^%PDF-([\d.]+)/.exec(text) ?? [])[1] ?? "",
    eofCount,
    startxrefs,
    trailers,
    xref,
    tableKind,
    tableChain: chain.length,
    live,
    objects,
    orphaned,
    unreferencedFromRoot,
    producers: fieldLiterals(dicts, "/Producer"),
    creators: fieldLiterals(dicts, "/Creator"),
    creationDates: fieldLiterals(dicts, "/CreationDate"),
    modDates: fieldLiterals(dicts, "/ModDate"),
    baseFonts: [
      ...new Set(
        (dicts.join(" ").match(/\/BaseFont\s*\/[\w.+-]+/g) ?? []).map((s) =>
          s.slice(s.lastIndexOf("/") + 1),
        ),
      ),
    ],
    objStmMembers,
    xmp: {
      present: metadata.length > 0,
      documentIds: [...xmpText.matchAll(/xmpMM:DocumentID="([^"]*)"/g)].map((m) => m[1]),
      instanceIds: [...xmpText.matchAll(/xmpMM:InstanceID="([^"]*)"/g)].map((m) => m[1]),
      createDates: [...xmpText.matchAll(/xmp:CreateDate="([^"]*)"/g)].map((m) => m[1]),
      modifyDates: [...xmpText.matchAll(/xmp:ModifyDate="([^"]*)"/g)].map((m) => m[1]),
      tools: [...xmpText.matchAll(/xmp:CreatorTool="([^"]*)"/g)].map((m) => m[1]),
    },
  };
}

/** The object numbers a viewer would render: live and referenced from `/Root`. */
export function liveObjectNums(structure: PdfStructure): number[] {
  return [...structure.live.keys()]
    .filter((num) => !structure.orphaned.some((o) => o.num === num))
    .sort();
}

/** Literals inside everything the newest table no longer points at. */
export function orphanedLiterals(structure: PdfStructure): string[] {
  return structure.orphaned.flatMap((o) => literalStrings(o.text)).filter(Boolean);
}

/**
 * The `(…)` operand of every `Tj` in a live content stream, in draw order.
 * Comparing this against `orphanedLiterals` is the orphan check: same key,
 * different value, one of them invisible.
 */
export function showTexts(structure: PdfStructure): string[] {
  const out: string[] = [];
  for (const o of structure.objects) {
    if (o.stream === undefined || !/BT\b/.test(o.text)) continue;
    if (structure.live.get(o.num) !== o.offset) continue;
    for (const block of o.text.matchAll(/BT\s([\s\S]*?)\sET/g)) {
      const tj = /(\((?:[^()\\]|\\.)*\))\s*Tj/.exec(block[1]);
      if (tj) out.push(...literalStrings(tj[1]));
    }
  }
  return out;
}
