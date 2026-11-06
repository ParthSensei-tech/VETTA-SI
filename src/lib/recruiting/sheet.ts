import type { ShareView } from "./types";
import { toBase64 } from "./pdf";

export async function shareToXlsx(view: ShareView): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vetta";
  wb.created = new Date(view.exportedAt);

  const slate = wb.addWorksheet("Ranked slate", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  slate.columns = [
    { header: "Rank", key: "rank", width: 8 },
    { header: "Candidate", key: "name", width: 24 },
    { header: "Headline", key: "headline", width: 32 },
    { header: "Score", key: "score", width: 10 },
    { header: "Fit", key: "fit", width: 18 },
    { header: "Location", key: "location", width: 16 },
    { header: "Summary", key: "summary", width: 60 },
    { header: "Highlights", key: "highlights", width: 48 },
    { header: "Watchouts", key: "watchouts", width: 36 },
    { header: "Interview probes", key: "probes", width: 40 },
    { header: "Screen", key: "screen", width: 28 },
  ];
  slate.getRow(1).font = { bold: true, color: { argb: "FFF2F0EA" } };
  slate.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C1C18" } };
  view.candidates.forEach((c, i) => {
    slate.addRow({
      rank: i + 1,
      name: c.candidateName,
      headline: c.headline || [c.currentTitle, c.currentCompany].filter(Boolean).join(" · "),
      score: c.rankScore,
      fit: c.fitLabel,
      location: c.location,
      summary: c.card?.summary || c.rankSummary,
      highlights: (c.card?.highlights ?? []).join(" · "),
      watchouts: (c.card?.watchouts ?? []).join(" · "),
      probes: (c.card?.interview_probes ?? []).join(" · "),
      screen: c.screenVerdict,
    });
  });

  const cards = wb.addWorksheet("Client cards");
  cards.columns = [
    { header: "Field", key: "field", width: 20 },
    { header: "Value", key: "value", width: 80 },
  ];
  view.candidates.forEach((c) => {
    const card = c.card;
    cards.addRow({ field: "Candidate", value: c.candidateName });
    cards.addRow({ field: "Headline", value: card?.headline || c.headline });
    cards.addRow({ field: "Fit", value: card?.fit_label || c.fitLabel });
    cards.addRow({ field: "Summary", value: card?.summary || c.rankSummary });
    cards.addRow({ field: "Highlights", value: (card?.highlights ?? []).join("\n") });
    cards.addRow({ field: "Watchouts", value: (card?.watchouts ?? []).join("\n") });
    cards.addRow({ field: "Interview probes", value: (card?.interview_probes ?? []).join("\n") });
    cards.addRow({ field: "Location", value: card?.location || c.location });
    cards.addRow({ field: "Availability", value: card?.availability || "" });
    cards.addRow({ field: "", value: "" });
  });

  const meta = wb.addWorksheet("Cover");
  meta.columns = [
    { header: "Key", key: "k", width: 22 },
    { header: "Value", key: "v", width: 70 },
  ];
  meta.addRows([
    { k: "Company", v: view.companyName },
    { k: "Role", v: view.roleTitle },
    { k: "Stage", v: view.companyStage },
    { k: "Location", v: view.location },
    { k: "Mode", v: view.workMode },
    { k: "Note", v: view.message },
    { k: "Candidates", v: String(view.candidates.length) },
    { k: "Exported", v: view.exportedAt },
    { k: "Source", v: "Vetta · human-gated slate" },
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export async function shareToXlsxBase64(
  view: ShareView,
): Promise<{ filename: string; base64: string }> {
  const bytes = await shareToXlsx(view);
  const slug = `${view.companyName}-${view.roleTitle}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48);
  return { filename: `${slug || "vetta-slate"}.xlsx`, base64: toBase64(bytes) };
}

export function shareToNotionMarkdown(view: ShareView): string {
  const lines: string[] = [
    `# ${view.companyName} · ${view.roleTitle}`,
    "",
    `> ${view.location} · ${view.workMode} · ${view.candidates.length} on the slate`,
    "",
  ];
  if (view.message) {
    lines.push(view.message, "");
  }
  lines.push("## Ranked slate", "");
  lines.push("| # | Candidate | Score | Fit | Location |", "|---|---|---|---|---|");
  view.candidates.forEach((c, i) => {
    lines.push(
      `| ${i + 1} | ${c.candidateName} | ${c.rankScore ?? "—"} | ${c.fitLabel} | ${c.location || "—"} |`,
    );
  });
  lines.push("");
  view.candidates.forEach((c) => {
    const card = c.card;
    lines.push(`## ${c.candidateName}`);
    lines.push("");
    lines.push(`*${card?.headline || c.headline}* · ${card?.fit_label || c.fitLabel}`);
    lines.push("");
    if (card?.summary || c.rankSummary) lines.push(card?.summary || c.rankSummary, "");
    if (card?.highlights?.length) {
      lines.push("**Highlights**");
      card.highlights.forEach((h) => lines.push(`- ${h}`));
      lines.push("");
    }
    if (card?.watchouts?.length) {
      lines.push("**Watchouts**");
      card.watchouts.forEach((w) => lines.push(`- ${w}`));
      lines.push("");
    }
    if (card?.interview_probes?.length) {
      lines.push("**Interview probes**");
      card.interview_probes.forEach((w) => lines.push(`- ${w}`));
      lines.push("");
    }
  });
  lines.push("---", "_Prepared in Vetta. A human stamped this before it left the desk._");
  return lines.join("\n");
}
