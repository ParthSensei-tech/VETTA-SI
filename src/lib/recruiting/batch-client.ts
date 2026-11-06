import { unzipSync } from "fflate";

export type PreparedUpload = {
  filename: string;
  contentBase64: string;
  size: number;
};

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_ITEMS = 200;
const INNER_EXTS = /\.(pdf|docx|txt|md|csv|xlsx)$/i;

function basename(path: string): string {
  return path.replace(/^.*[/\\]/, "");
}

function shouldSkip(path: string): boolean {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (!lower || lower.endsWith("/")) return true;
  if (lower.includes("__macosx/") || lower.includes("/.")) return true;
  const base = basename(lower);
  return base.startsWith(".") || base === "thumbs.db";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  return bytesToBase64(buffer);
}

export async function prepareBatchFiles(files: File[]): Promise<{
  items: PreparedUpload[];
  skipped: string[];
}> {
  const items: PreparedUpload[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const name = file.name || "upload";
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let unzipped: Record<string, Uint8Array>;
        try {
          unzipped = unzipSync(bytes);
        } catch {
          if (file.size > MAX_FILE_BYTES) {
            skipped.push(`${name} (too large)`);
            continue;
          }
          items.push({
            filename: name,
            contentBase64: bytesToBase64(bytes),
            size: bytes.byteLength,
          });
          continue;
        }
        let found = 0;
        for (const [path, data] of Object.entries(unzipped)) {
          if (shouldSkip(path) || !INNER_EXTS.test(path)) continue;
          if (!data || data.byteLength === 0) continue;
          if (data.byteLength > MAX_FILE_BYTES) {
            skipped.push(`${basename(path)} (too large)`);
            continue;
          }
          items.push({
            filename: `${basename(name)} / ${basename(path)}`,
            contentBase64: bytesToBase64(data),
            size: data.byteLength,
          });
          found += 1;
          if (items.length >= MAX_ITEMS) break;
        }
        if (found === 0) skipped.push(`${name} (no PDF, Word, text, CSV, or Excel files)`);
      } else if (INNER_EXTS.test(lower) || lower.endsWith(".zip")) {
        if (file.size > MAX_FILE_BYTES) {
          skipped.push(`${name} (too large)`);
          continue;
        }
        items.push({ filename: name, contentBase64: await fileToBase64(file), size: file.size });
      } else {
        skipped.push(`${name} (unsupported type)`);
      }
    } catch {
      skipped.push(`${name} (unreadable)`);
    }
    if (items.length >= MAX_ITEMS) {
      skipped.push("Stopped at 200 files — drop another batch for the rest.");
      break;
    }
  }

  return { items, skipped };
}

export function chunkItems<T>(items: T[], size = 20): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function sourceLabel(files: File[], itemCount: number): string {
  if (files.length === 1) return files[0]!.name;
  return `${files.length} files · ${itemCount} resumes`;
}
