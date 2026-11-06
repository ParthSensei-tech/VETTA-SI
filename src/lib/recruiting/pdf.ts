import type { ShareView } from "./types";

function latin(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/₹/g, "Rs ")
    .replace(/[^\t\n\r\x20-\x7e]/g, "?");
}

function wrap(text: string, width: number): string[] {
  const words = latin(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function pdfEscape(text: string): string {
  return latin(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function shareToPdf(view: ShareView): Uint8Array {
  const lines: Array<{ size: number; text: string }> = [];
  lines.push({ size: 18, text: view.title || `${view.companyName} · ${view.roleTitle}` });
  lines.push({ size: 11, text: `${view.companyName} · ${view.roleTitle} · ${view.location}` });
  lines.push({ size: 10, text: `Exported ${new Date(view.exportedAt).toLocaleString("en-IN")}` });
  if (view.message) {
    lines.push({ size: 10, text: "" });
    for (const l of wrap(view.message, 92)) lines.push({ size: 10, text: l });
  }
  view.candidates.forEach((c, i) => {
    lines.push({ size: 10, text: "" });
    lines.push({ size: 14, text: `${String(i + 1).padStart(2, "0")}. ${c.candidateName}` });
    lines.push({
      size: 10,
      text: `${c.headline || c.currentTitle}  |  score ${c.rankScore ?? "—"}  |  ${c.fitLabel}`,
    });
    if (c.rankSummary) for (const l of wrap(c.rankSummary, 92)) lines.push({ size: 10, text: l });
    const card = c.card;
    if (card) {
      if (card.summary) for (const l of wrap(card.summary, 92)) lines.push({ size: 10, text: l });
      card.highlights.forEach((h) => {
        for (const l of wrap(`- ${h}`, 90)) lines.push({ size: 10, text: l });
      });
      if (card.watchouts.length) {
        lines.push({ size: 10, text: "Watchouts" });
        card.watchouts.forEach((w) => {
          for (const l of wrap(`- ${w}`, 90)) lines.push({ size: 10, text: l });
        });
      }
    }
  });
  lines.push({ size: 9, text: "" });
  lines.push({ size: 9, text: "Vetta  |  Human-gated shortlist. Nothing here was auto-sent." });

  const pageHeight = 842;
  const pageWidth = 595;
  const margin = 48;
  const pages: string[][] = [];
  let y = pageHeight - margin;
  let current: string[] = [];
  for (const line of lines) {
    const leading = line.size === 18 ? 26 : line.size === 14 ? 20 : 14;
    if (y - leading < margin) {
      pages.push(current);
      current = [];
      y = pageHeight - margin;
    }
    current.push(`BT /F1 ${line.size} Tf 48 ${y} Td (${pdfEscape(line.text)}) Tj ET`);
    y -= leading;
  }
  pages.push(current);

  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push(`2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages.length} >> endobj`);
  pages.forEach((ops, i) => {
    const pageObj = 3 + i * 2;
    const contentObj = pageObj + 1;
    const stream = ops.join("\n");
    objects.push(
      `${pageObj} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> /Contents ${contentObj} 0 R >> endobj`,
    );
    objects.push(
      `${contentObj} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    );
  });
  const fontId = 3 + pages.length * 2;
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += `${obj}\n`;
  }
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(body);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
