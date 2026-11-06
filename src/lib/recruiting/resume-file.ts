import { unzipSync, strFromU8 } from "fflate";

const MAX_CHARS = 40000;

function clip(text: string): string {
  const cleaned = text.replaceAll("\u0000", "").replace(/[ \t]+\n/g, "\n").trim();
  if (cleaned.length <= MAX_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_CHARS)}\n\n[truncated]`;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const n = Math.min(doc.numPages, 20);
  for (let i = 1; i <= n; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ");
    if (line.trim()) pages.push(line);
  }
  const text = pages.join("\n\n").replace(/[ ]{2,}/g, " ");
  if (text.trim().length < 40) {
    throw new Error("Could not read text from that PDF. Paste the resume instead.");
  }
  return clip(text);
}

function extractDocx(buffer: ArrayBuffer): string {
  const unzipped = unzipSync(new Uint8Array(buffer));
  const xmlFile = unzipped["word/document.xml"];
  if (!xmlFile) throw new Error("That Word file has no readable document.xml");
  const xml = strFromU8(xmlFile);
  const text = xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<w:tab[^/]*\/>/g, "\t")
    .replace(/<w:br[^/]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 40) {
    throw new Error("Could not read text from that Word file. Paste the resume instead.");
  }
  return clip(text);
}

export async function extractResumeText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    const text = (await file.text()).trim();
    if (text.length < 40) throw new Error("That text file is too short to be a resume.");
    return clip(text);
  }
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  if (name.endsWith(".docx")) {
    return extractDocx(await file.arrayBuffer());
  }
  throw new Error("Upload a PDF, Word (.docx), or text resume.");
}

export function resumeFileLabel(file: File | null, chars: number): string {
  if (!file) return chars ? `${chars.toLocaleString("en-IN")} characters` : "No file yet";
  const size =
    file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return `${file.name} · ${size}`;
}
