import { Buffer } from "node:buffer";
import { unzipSync } from "fflate";

const MAX_CHARS = 40000;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200;
const MIN_RESUME_CHARS = 40;

export function clipResume(text: string): string {
  const cleaned = text
    .replaceAll("\u0000", "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (cleaned.length <= MAX_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_CHARS)}\n\n[truncated]`;
}

function basename(path: string): string {
  return path.replace(/^.*[/\\]/, "");
}

function extOf(name: string): string {
  const base = basename(name).toLowerCase();
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i) : "";
}

function shouldSkipPath(path: string): boolean {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (!lower || lower.endsWith("/")) return true;
  if (lower.includes("__macosx/") || lower.includes("/.")) return true;
  const base = basename(lower);
  if (base.startsWith(".") || base === "thumbs.db" || base === "desktop.ini") return true;
  return false;
}

const RESUME_EXTS = new Set([".pdf", ".docx", ".txt", ".md", ".csv", ".xlsx"]);

function isSupportedName(path: string): boolean {
  return RESUME_EXTS.has(extOf(path));
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return String(result.text ?? "");
    } finally {
      await parser.destroy?.();
    }
  } catch {
    throw new Error("Corrupted or unreadable PDF file");
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return String(result.value ?? "");
  } catch {
    throw new Error("Corrupted or invalid DOCX file");
  }
}

function extractPlain(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === "," || ch === "\t" || ch === ";") {
      row.push(cell.trim());
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const NAME_HEADERS = new Set(["name", "full_name", "candidate", "candidate_name", "applicant"]);
const EMAIL_HEADERS = new Set(["email", "email_id", "mail"]);
const PHONE_HEADERS = new Set(["phone", "mobile", "tel", "whatsapp"]);
const LOCATION_HEADERS = new Set(["location", "city", "base", "current_location"]);
const LINKEDIN_HEADERS = new Set(["linkedin", "linkedin_url", "linkedin_profile"]);
const TITLE_HEADERS = new Set(["title", "current_title", "role", "designation"]);
const COMPANY_HEADERS = new Set(["company", "current_company", "employer", "org"]);
const RESUME_HEADERS = new Set([
  "resume",
  "resume_text",
  "cv",
  "cv_text",
  "profile",
  "bio",
  "notes",
  "summary",
  "about",
  "text",
]);

function pickHeader(headers: string[], set: Set<string>): number {
  return headers.findIndex((h) => set.has(h));
}

function rowsToResumes(
  filename: string,
  rows: string[][],
): Array<{ filename: string; resumeText: string }> {
  if (rows.length === 0) return [];
  const headerRow = rows[0]!.map(normalizeHeader);
  const hasHeader = headerRow.some(
    (h) =>
      NAME_HEADERS.has(h) || EMAIL_HEADERS.has(h) || RESUME_HEADERS.has(h) || TITLE_HEADERS.has(h),
  );
  const headers = hasHeader ? headerRow : headerRow.map((_, i) => `col_${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  const nameIdx = pickHeader(headers, NAME_HEADERS);
  const emailIdx = pickHeader(headers, EMAIL_HEADERS);
  const phoneIdx = pickHeader(headers, PHONE_HEADERS);
  const locIdx = pickHeader(headers, LOCATION_HEADERS);
  const liIdx = pickHeader(headers, LINKEDIN_HEADERS);
  const titleIdx = pickHeader(headers, TITLE_HEADERS);
  const companyIdx = pickHeader(headers, COMPANY_HEADERS);
  const resumeIdx = pickHeader(headers, RESUME_HEADERS);
  const out: Array<{ filename: string; resumeText: string }> = [];

  body.forEach((cols, index) => {
    const get = (idx: number) => (idx >= 0 ? (cols[idx] ?? "").trim() : "");
    const name = get(nameIdx);
    const email = get(emailIdx);
    const resumeCol = get(resumeIdx);
    const parts: string[] = [];
    if (name) parts.push(name);
    if (email) parts.push(email);
    if (get(phoneIdx)) parts.push(get(phoneIdx));
    if (get(locIdx)) parts.push(get(locIdx));
    if (get(liIdx)) parts.push(get(liIdx));
    if (get(titleIdx) || get(companyIdx)) {
      parts.push([get(titleIdx), get(companyIdx)].filter(Boolean).join(" · "));
    }
    if (resumeCol) {
      parts.push("", resumeCol);
    } else {
      const rest = headers
        .map((h, i) => {
          const v = (cols[i] ?? "").trim();
          if (!v) return "";
          if (i === nameIdx || i === emailIdx) return "";
          return `${h.replace(/_/g, " ")}: ${v}`;
        })
        .filter(Boolean);
      if (rest.length) parts.push("", rest.join("\n"));
    }
    const resumeText = clipResume(parts.join("\n"));
    if (resumeText.length < MIN_RESUME_CHARS) return;
    const label = name || email || `row-${index + 1}`;
    const safe =
      label
        .replace(/[^\w.\- ]+/g, "")
        .trim()
        .slice(0, 60) || `row-${index + 1}`;
    out.push({ filename: `${basename(filename)} · ${safe}`, resumeText });
  });
  return out;
}

async function extractXlsx(bytes: Uint8Array): Promise<string[][]> {
  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as never);
    const sheet = wb.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cellText(cell.value));
      });
      if (cells.some((c) => c.trim())) rows.push(cells.map((c) => c.trim()));
    });
    return rows;
  } catch {
    throw new Error("Corrupted or invalid Excel spreadsheet");
  }
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as {
      text?: unknown;
      result?: unknown;
      hyperlink?: unknown;
      richText?: Array<{ text?: string }>;
    };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? "").join("");
    if (typeof v.text === "string") return v.text;
    if (v.result != null) return cellText(v.result);
    if (typeof v.hyperlink === "string") return v.hyperlink;
  }
  return "";
}

function unzipEntries(bytes: Uint8Array): Array<{ filename: string; bytes: Uint8Array }> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new Error("Corrupted or invalid zip archive");
  }
  const entries: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const [path, data] of Object.entries(unzipped)) {
    if (shouldSkipPath(path) || !isSupportedName(path)) continue;
    if (!data || data.byteLength === 0 || data.byteLength > MAX_FILE_BYTES) continue;
    entries.push({ filename: path, bytes: data });
    if (entries.length >= MAX_ZIP_ENTRIES) break;
  }
  return entries;
}

async function extractSingle(filename: string, bytes: Uint8Array): Promise<string> {
  const ext = extOf(filename);
  if (ext === ".pdf" || bytes[0] === 0x25) return extractPdf(bytes);
  if (ext === ".docx") return extractDocx(bytes);
  return extractPlain(bytes);
}

export type ParsedResume = { filename: string; resumeText: string };

export async function parseUploadToResumes(
  filename: string,
  bytes: Uint8Array,
): Promise<ParsedResume[]> {
  const ext = extOf(filename);
  const name = basename(filename) || "upload";

  if (bytes.byteLength === 0) return [];
  if (bytes.byteLength > MAX_FILE_BYTES && ext !== ".zip" && !looksLikeZip(bytes)) {
    throw new Error(`${name} is larger than 6 MB`);
  }

  if (ext === ".zip" || (ext === "" && looksLikeZip(bytes))) {
    const inner = unzipEntries(bytes);
    const out: ParsedResume[] = [];
    for (const entry of inner) {
      try {
        const nested = await parseUploadToResumes(entry.filename, entry.bytes);
        out.push(...nested);
      } catch {
        /* skip unreadable entries; caller records coverage via counts */
      }
      if (out.length >= MAX_ZIP_ENTRIES) break;
    }
    return out;
  }

  if (ext === ".csv") {
    return rowsToResumes(name, parseCsv(extractPlain(bytes)));
  }
  if (ext === ".xlsx") {
    return rowsToResumes(name, await extractXlsx(bytes));
  }

  const text = clipResume(await extractSingle(name, bytes));
  if (text.length < MIN_RESUME_CHARS) {
    throw new Error(`Could not read enough text from ${name}`);
  }
  return [{ filename: name, resumeText: text }];
}

export function decodeBase64(contentBase64: string): Uint8Array {
  return new Uint8Array(Buffer.from(contentBase64, "base64"));
}
