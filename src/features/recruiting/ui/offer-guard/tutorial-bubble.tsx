import { useState } from "react";
import { Sparkles, X, ChevronRight, HelpCircle, Check, Info } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import type { TutorialBubble as TutorialBubbleType } from "../../domain/offer-guard-hazard";

interface TutorialBubbleProps {
  bubbles: TutorialBubbleType[];
  dismissedMap?: Record<string, boolean>;
  onDismiss: (stepKey: string) => void;
  className?: string;
}

export function TutorialBubbleGuide({
  bubbles,
  dismissedMap = {},
  onDismiss,
  className,
}: TutorialBubbleProps) {
  const visibleBubbles = bubbles.filter((b) => !dismissedMap[b.id]);
  const [currentIndex, setCurrentIndex] = useState(0);

  if (visibleBubbles.length === 0) return null;

  const current = visibleBubbles[Math.min(currentIndex, visibleBubbles.length - 1)];

  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-fg shadow-lg backdrop-blur transition-all duration-200",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-primary/20 text-primary">
            <Sparkles className="size-4 animate-spin-slow" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-primary">
              Pre-Boarding Guide · Step {currentIndex + 1} of {visibleBubbles.length}
            </span>
            <h4 className="font-display text-sm font-semibold tracking-tight text-fg">
              {current.title}
            </h4>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(current.id)}
          className="rounded-lg p-1 text-muted hover:bg-elevated hover:text-fg transition-colors"
          title="Dismiss this tip"
        >
          <X className="size-4" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-muted">{current.body}</p>

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          {visibleBubbles.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === currentIndex ? "w-5 bg-primary" : "w-1.5 bg-muted/40",
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {visibleBubbles.length > 1 && currentIndex < visibleBubbles.length - 1 ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => setCurrentIndex((prev) => prev + 1)}
            >
              <span>Next tip</span>
              <ChevronRight className="size-3 ml-1" />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => onDismiss(current.id)}
          >
            <Check className="size-3 mr-1" />
            <span>Got it</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
