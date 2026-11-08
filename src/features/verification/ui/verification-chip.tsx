import type { SlateVerdict } from "@/features/verification/domain/report";
import { headlineLabel, headlineTone } from "@/features/verification/ui/verdict-presentation";
import { Badge } from "@/shared/components/ui/badge";

/**
 * One candidate's verification headline in the slate.
 *
 * Deliberately quieter than the score: the score is where this person ranks, and
 * this is whether the claims they made hold up. The two must not be confused on
 * the way to a decision, which is why the chip carries a coverage percentage
 * rather than a second number that could be read as one.
 *
 * No verdict renders nothing at all. A row that says "unverified" for everybody
 * the queue has not reached yet reads like a warning about the candidate.
 */
export function VerificationChip({ verdict }: { verdict: SlateVerdict | null | undefined }) {
  const tone = verdict ? headlineTone(verdict.headline) : null;
  if (!verdict || !tone) return null;
  const pct = Math.round(verdict.coverage * 100);
  return (
    <Badge
      variant={tone === "default" ? "outline" : tone}
      title={`${headlineLabel(verdict.headline)} · ${pct}% of this document's claims were checked against arithmetic, dates or a registry. Ranking is unaffected.`}
    >
      {headlineLabel(verdict.headline)}
      {verdict.counts.claims > 0 ? (
        <span className="ml-1 font-mono text-[10px] opacity-80 tabular-nums">{pct}%</span>
      ) : null}
    </Badge>
  );
}
