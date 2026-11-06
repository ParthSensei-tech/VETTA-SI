import { Badge } from "@/components/ui/badge";
import type { RankProvenance } from "@/lib/recruiting/types";
import { cn } from "@/lib/utils";

/** Compact provenance chip for candidate cards in list views. */
export function ProvenanceChip({ provenance }: { provenance: RankProvenance | null }) {
  if (!provenance) return null;
  return (
    <Badge
      variant={provenance.isLocal ? "outline" : "solid"}
      className={cn("gap-1", provenance.isStale && "border-warn/50 bg-warn/10 text-warn")}
    >
      {provenance.isLocal ? "⚙ Local" : `🤖 ${provenance.provider}`}
      {provenance.rubricVersion != null && (
        <span className="ml-0.5 text-[10px] opacity-70">v{provenance.rubricVersion}</span>
      )}
    </Badge>
  );
}

/** Full provenance detail block for the candidate detail panel. */
export function ProvenanceDetail({
  provenance,
  onRerank,
  isReranking,
}: {
  provenance: RankProvenance | null;
  onRerank?: () => void;
  isReranking?: boolean;
}) {
  if (!provenance) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Engine badge */}
      <Badge
        variant={provenance.isLocal ? "outline" : "solid"}
        className={cn(
          "gap-1",
          provenance.isLocal && "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
          !provenance.isLocal &&
            "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
        )}
      >
        {provenance.isLocal ? (
          <>⚙ {provenance.fallback ? "Local (fallback)" : "Local · routed choice"}</>
        ) : (
          <>
            🤖 LLM · {provenance.provider} / {provenance.model}
          </>
        )}
      </Badge>

      {/* Why a cloud arm was not used — the router's own reason, not a generic error. */}
      {provenance.isLocal && provenance.fallback && provenance.fallbackReason && (
        <Badge variant="warn" className="gap-1 text-[10px]">
          {provenance.originalProvider ? `${provenance.originalProvider} failed: ` : ""}
          {provenance.fallbackReason}
        </Badge>
      )}

      {/* Rubric version */}
      {provenance.rubricVersion != null && (
        <Badge variant="outline" className="gap-1 text-[10px]">
          Rubric v{provenance.rubricVersion}
        </Badge>
      )}

      {/* Stale warning */}
      {provenance.isStale && (
        <Badge variant="warn" className="gap-1.5">
          <span>⚠️ Stale</span>
          {provenance.staleReason && (
            <span className="text-[10px] opacity-70">{provenance.staleReason}</span>
          )}
        </Badge>
      )}

      {/* Re-rank CTA when stale */}
      {provenance.isStale && onRerank && (
        <button
          type="button"
          disabled={isReranking}
          onClick={onRerank}
          className={cn(
            "inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5",
            "text-[11px] font-medium text-accent hover:bg-accent/20",
            "transition-colors disabled:opacity-50",
          )}
        >
          {isReranking ? "Re-ranking…" : "↻ Re-rank now"}
        </button>
      )}
    </div>
  );
}

/** Stale count banner shown at role level when any applications are stale */
export function StaleBanner({
  staleCount,
  onRerankAll,
  isReranking,
}: {
  staleCount: number;
  onRerankAll?: () => void;
  isReranking?: boolean;
}) {
  if (staleCount === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3">
      <span className="text-sm text-warn font-medium">
        ⚠️ {staleCount} candidate{staleCount !== 1 ? "s" : ""} scored on an outdated rubric
      </span>
      {onRerankAll && (
        <button
          type="button"
          disabled={isReranking}
          onClick={onRerankAll}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1",
            "bg-warn/15 text-[12px] font-medium text-warn hover:bg-warn/25",
            "transition-colors disabled:opacity-50",
          )}
        >
          {isReranking ? "Re-ranking all…" : `↻ Re-rank ${staleCount}`}
        </button>
      )}
    </div>
  );
}
