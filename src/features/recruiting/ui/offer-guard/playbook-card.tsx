import { useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Play, MessageSquare, ExternalLink } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import type { PreboardingIntervention, PlaybookRecommendation } from "../../domain/types";

interface PlaybookCardProps {
  playbook: PlaybookRecommendation;
  existingIntervention?: PreboardingIntervention;
  onExecute: (status: "in_progress" | "completed" | "dismissed", notes?: string) => Promise<void>;
  onTriggerSilverMedalist?: () => void;
  className?: string;
}

export function PlaybookCard({
  playbook,
  existingIntervention,
  onExecute,
  onTriggerSilverMedalist,
  className,
}: PlaybookCardProps) {
  const [loading, setLoading] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const status = existingIntervention?.status || "recommended";

  const urgencyColors = {
    critical: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    low: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  }[playbook.urgency];

  async function handleStatus(newStatus: "in_progress" | "completed" | "dismissed") {
    setLoading(true);
    try {
      await onExecute(newStatus, notes.trim() || undefined);
      setShowNotes(false);
      setNotes("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 transition-all duration-150",
        status === "completed"
          ? "border-emerald-500/30 bg-emerald-500/5 opacity-80"
          : status === "in_progress"
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-surface hover:border-border/80",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider border",
              urgencyColors,
            )}
          >
            {playbook.urgency} Urgency
          </span>
          <span className="text-xs text-muted font-medium">
            Status:{" "}
            <strong
              className={cn(
                "capitalize",
                status === "completed"
                  ? "text-emerald-400"
                  : status === "in_progress"
                    ? "text-primary"
                    : "text-muted",
              )}
            >
              {status.replace("_", " ")}
            </strong>
          </span>
        </div>

        {status === "completed" ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
            <CheckCircle2 className="size-3.5" />
            Completed
          </span>
        ) : null}
      </div>

      <div>
        <h4 className="font-display text-base font-semibold text-fg tracking-tight">
          {playbook.title}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-muted">{playbook.rationale}</p>
      </div>

      {/* Suggested Action Box */}
      <div className="rounded-lg border border-border/70 bg-elevated/70 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-fg mb-1">
          <MessageSquare className="size-3.5 text-primary" />
          <span>Recommended Recruiter Script / Action:</span>
        </div>
        <p className="text-xs italic text-fg/90 leading-relaxed font-sans">
          "{playbook.suggestedAction}"
        </p>
      </div>

      {/* Notes / Outcome field */}
      {showNotes && status !== "completed" ? (
        <div className="flex flex-col gap-2 pt-1">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Log outcome of this recruiter touchpoint or candidate feedback..."
            rows={2}
            className="w-full rounded-lg border border-border bg-bg p-2 text-xs text-fg focus:border-primary focus:outline-none"
          />
        </div>
      ) : null}

      {/* Actions */}
      {status !== "completed" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            {playbook.key === "silver_medalist_warm" && onTriggerSilverMedalist ? (
              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs bg-rose-600 hover:bg-rose-500 text-white"
                onClick={onTriggerSilverMedalist}
              >
                <span>Warm Silver Medalist</span>
                <ExternalLink className="size-3 ml-1.5" />
              </Button>
            ) : null}

            {status !== "in_progress" ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={loading}
                className="h-8 text-xs"
                onClick={() => handleStatus("in_progress")}
              >
                <Play className="size-3 mr-1" />
                <span>Start Playbook</span>
              </Button>
            ) : null}

            <Button
              size="sm"
              variant="default"
              disabled={loading}
              className="h-8 text-xs"
              onClick={() => {
                if (!showNotes) {
                  setShowNotes(true);
                } else {
                  handleStatus("completed");
                }
              }}
            >
              <CheckCircle2 className="size-3 mr-1" />
              <span>{showNotes ? "Save & Mark Done" : "Complete Action"}</span>
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            className="h-8 text-xs text-muted hover:text-fg"
            onClick={() => handleStatus("dismissed")}
          >
            Dismiss
          </Button>
        </div>
      ) : existingIntervention?.outcomeNotes ? (
        <p className="text-xs text-muted">
          Outcome: <span className="text-fg">{existingIntervention.outcomeNotes}</span>
        </p>
      ) : null}
    </div>
  );
}
