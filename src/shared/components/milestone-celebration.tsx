import { useState, type ReactNode } from "react";
import { CheckCircle2, Sparkles, X, ArrowRight } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

export interface MilestoneCelebrationProps {
  title: string;
  description: string;
  badge?: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  className?: string;
}

/**
 * Peak-End Rule UX Primitive
 *
 * Celebrates key user journey climaxes (Batch ingest finished, candidate hired,
 * workspace activated) to leave a lasting, positive memory of accomplishment.
 */
export function MilestoneCelebration({
  title,
  description,
  badge = "Milestone Achieved",
  primaryAction,
  onDismiss,
  className,
}: MilestoneCelebrationProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    onDismiss?.();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-lime-400/40 bg-gradient-to-r from-lime-950/40 via-surface to-surface p-5 shadow-[0_12px_32px_-12px_rgba(198,244,50,0.35)] backdrop-blur-md transition-all duration-300 animate-in fade-in zoom-in-95",
        className,
      )}
    >
      {/* Radiant ambient glow */}
      <div
        className="pointer-events-none absolute -top-12 -left-12 size-36 rounded-full bg-lime-400/15 blur-2xl"
        aria-hidden="true"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-lime-400/20 text-lime-400 shadow-lime ring-1 ring-lime-400/40">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-lime-400/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-lime-400 uppercase">
                <CheckCircle2 className="size-3" />
                {badge}
              </span>
            </div>
            <h4 className="mt-1 font-display text-lg tracking-tight text-fg">{title}</h4>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {primaryAction && (
            <Button size="sm" onClick={primaryAction.onClick} className="gap-1.5 shadow-lime">
              {primaryAction.label}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss milestone"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-fg transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
