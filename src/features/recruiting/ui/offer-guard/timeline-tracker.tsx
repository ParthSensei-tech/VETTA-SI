import { CheckCircle2, Clock, AlertCircle, FileCheck, Gift, Users, Flag } from "lucide-react";
import type { PreboardingOffer } from "../../domain/types";
import { cn } from "@/shared/utils";

interface TimelineTrackerProps {
  offer: PreboardingOffer;
  className?: string;
}

export function TimelineTracker({ offer, className }: TimelineTrackerProps) {
  const acceptedMs = new Date(offer.offerAcceptedDate).getTime();
  const joiningMs = new Date(offer.targetJoiningDate).getTime();
  const nowMs = Date.now();

  const totalDays = offer.totalNoticeDays || 60;
  const daysServed = Math.max(0, Math.min(totalDays, Math.round((nowMs - acceptedMs) / (1000 * 60 * 60 * 24))));
  const daysRemaining = Math.max(0, totalDays - daysServed);
  const percentComplete = Math.min(100, Math.round((daysServed / totalDays) * 100));

  const phases = [
    {
      title: "Phase 1: Resignation",
      window: "Day 1–10",
      description: "Official resignation proof & acknowledgment",
      completed: offer.resignationSubmitted,
      icon: FileCheck,
      danger: !offer.resignationSubmitted && daysServed >= 10,
    },
    {
      title: "Phase 2: Tech & Buddy",
      window: "Day 11–30",
      description: "Team bonding, peer buddy call & swag dispatch",
      completed: Boolean(offer.buddyAssignedName && offer.swagDispatched),
      icon: Users,
      danger: false,
    },
    {
      title: "Phase 3: Danger Zone",
      window: "Day 31–60",
      description: "Counteroffer defense & mid-notice pulse check",
      completed: daysServed > 60 && offer.hazardScore < 50,
      icon: AlertCircle,
      danger: offer.hazardScore >= 56 && daysServed >= 30,
    },
    {
      title: "Phase 4: Countdown",
      window: "Final 15 Days",
      description: "Laptop provisioning, BGV clearance & Day 1 readiness",
      completed: offer.bgvDocumentsSubmitted && daysRemaining <= 7,
      icon: Flag,
      danger: !offer.bgvDocumentsSubmitted && daysRemaining <= 10,
    },
  ];

  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg tracking-tight">Notice Period Progress</h3>
          <p className="text-xs text-muted">
            {daysServed} days served · <strong className="text-fg">{daysRemaining} days remaining</strong> until Target Day 1
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-elevated px-3 py-1 font-mono text-xs font-semibold text-fg border border-border">
            {percentComplete}% of Notice Served
          </span>
          {daysRemaining <= 14 ? (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-400 border border-amber-500/30">
              <Clock className="size-3.5" />
              Final Stretch
            </span>
          ) : null}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-bg border border-border/60">
        <div
          className={cn(
            "h-full transition-all duration-500",
            offer.hazardScore >= 75
              ? "bg-rose-500"
              : offer.hazardScore >= 50
                ? "bg-amber-500"
                : "bg-primary",
          )}
          style={{ width: `${percentComplete}%` }}
        />
      </div>

      {/* 4-Phase Milestone Cards */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {phases.map((p, idx) => {
          const Icon = p.icon;
          return (
            <div
              key={idx}
              className={cn(
                "flex flex-col justify-between rounded-xl border p-3 text-left transition-all",
                p.danger
                  ? "border-rose-500/40 bg-rose-500/5 text-rose-400"
                  : p.completed
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                    : "border-border/60 bg-elevated/40 text-muted",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider">{p.window}</span>
                {p.completed ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : p.danger ? (
                  <AlertCircle className="size-4 text-rose-500 animate-pulse" />
                ) : (
                  <Icon className="size-4 text-muted" />
                )}
              </div>
              <div className="mt-2">
                <p className="text-xs font-semibold text-fg">{p.title}</p>
                <p className="mt-0.5 text-[11px] leading-tight text-muted">{p.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
