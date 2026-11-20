import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

export interface HitlGateProps {
  title: string;
  description: string;
  actionLabel: string;
  variant?: "warning" | "destructive" | "info";
  candidateName?: string;
  impactMetrics?: Array<{ label: string; value: string }>;
  onConfirm: () => void;
  onCancel?: () => void;
  isPending?: boolean;
  className?: string;
}

/**
 * Human-in-the-Loop (HITL) Sensitive Decision Gate
 *
 * Enforces human recruiter verification and explicit sign-off on sensitive actions:
 * - Candidate disqualification
 * - Client pack / dossier external dispatch
 * - Offer renegotiation & CTC concessions
 * - High-drift client taste recalibrations
 *
 * Prevents autonomous rogue actions and fulfills regulatory accountability requirements.
 */
export function HitlGate({
  title,
  description,
  actionLabel,
  variant = "warning",
  candidateName,
  impactMetrics,
  onConfirm,
  onCancel,
  isPending,
  className,
}: HitlGateProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isDestructive = variant === "destructive";
  const borderClass = isDestructive
    ? "border-rose-500/40 bg-gradient-to-r from-rose-950/30 via-surface to-surface"
    : "border-amber-500/40 bg-gradient-to-r from-amber-950/30 via-surface to-surface";
  const iconColor = isDestructive ? "text-rose-400" : "text-amber-400";
  const badgeColor = isDestructive
    ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
    : "bg-amber-500/15 text-amber-400 border-amber-500/30";

  return (
    <div
      role="alert"
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5 shadow-lg backdrop-blur-md transition-all duration-200",
        borderClass,
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className={cn("mt-0.5 rounded-xl border p-2", badgeColor)}>
            {isDestructive ? (
              <ShieldAlert className={cn("size-5", iconColor)} />
            ) : (
              <AlertTriangle className={cn("size-5", iconColor)} />
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", badgeColor)}>
                Human-in-the-Loop Sign-off
              </span>
              {candidateName ? (
                <span className="text-xs font-semibold text-fg">Target: {candidateName}</span>
              ) : null}
            </div>

            <h4 className="font-display text-base font-semibold text-fg">{title}</h4>
            <p className="max-w-xl text-xs leading-relaxed text-muted">{description}</p>

            {impactMetrics && impactMetrics.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-3">
                {impactMetrics.map((m) => (
                  <div
                    key={m.label}
                    className="flex flex-col rounded-lg border border-border/60 bg-elevated/40 px-2.5 py-1 text-left"
                  >
                    <span className="text-[10px] text-muted">{m.label}</span>
                    <span className="font-mono text-xs font-semibold text-fg">{m.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:self-center">
          {onCancel ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                setDismissed(true);
                onCancel();
              }}
              className="h-9 text-xs text-muted hover:text-fg"
            >
              Dismiss
            </Button>
          ) : null}

          <Button
            size="sm"
            variant={isDestructive ? "destructive" : "default"}
            disabled={isPending}
            onClick={onConfirm}
            className="h-9 gap-1.5 text-xs font-semibold shadow-md"
          >
            <CheckCircle2 className="size-3.5" />
            <span>{isPending ? "Executing…" : actionLabel}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
