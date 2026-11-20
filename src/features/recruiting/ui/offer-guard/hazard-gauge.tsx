import { ShieldAlert, ShieldCheck, AlertTriangle, Flame } from "lucide-react";
import type { IntentState, RiskTier } from "../../domain/types";
import { cn } from "@/shared/utils";

interface HazardGaugeProps {
  score: number;
  riskTier: RiskTier;
  intentState: IntentState;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function HazardGauge({
  score,
  riskTier,
  intentState,
  size = "md",
  className,
}: HazardGaugeProps) {
  const rounded = Math.round(score);

  const tierStyles = {
    low: {
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      icon: ShieldCheck,
      label: "Low Risk",
      badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    },
    moderate: {
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
      icon: AlertTriangle,
      label: "Moderate (Wavering)",
      badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
    high: {
      color: "text-orange-500",
      bg: "bg-orange-500/10",
      border: "border-orange-500/20",
      icon: ShieldAlert,
      label: "High (Counteroffer Risk)",
      badgeClass: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    },
    critical: {
      color: "text-rose-500",
      bg: "bg-rose-500/15",
      border: "border-rose-500/30",
      icon: Flame,
      label: "Critical (Imminent Renege)",
      badgeClass: "bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse",
    },
  }[riskTier];

  const Icon = tierStyles.icon;

  const stateLabels: Record<IntentState, string> = {
    committed: "Solidly Committed",
    wavering: "Passive Shopping",
    counteroffered: "Counteroffer Active",
    imminent_renege: "Imminent Ghost Risk",
    joined: "Successfully Joined",
    reneged: "Reneged / Backed Out",
  };

  if (size === "sm") {
    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border",
            tierStyles.badgeClass,
          )}
        >
          <Icon className="size-3" />
          <span>{rounded}% Hazard</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all",
        tierStyles.bg,
        tierStyles.border,
        className,
      )}
    >
      <div className="relative flex items-center justify-center">
        {/* SVG Circular Ring */}
        <svg className="size-28 -rotate-90">
          <circle
            cx="56"
            cy="56"
            r="46"
            className="stroke-muted/20"
            strokeWidth="9"
            fill="transparent"
          />
          <circle
            cx="56"
            cy="56"
            r="46"
            className={cn("transition-all duration-700 ease-out", tierStyles.color)}
            strokeWidth="9"
            strokeDasharray={289}
            strokeDashoffset={289 - (289 * rounded) / 100}
            strokeLinecap="round"
            fill="transparent"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-3xl font-bold tracking-tight text-fg">{rounded}%</span>
          <span className="text-[10px] uppercase tracking-wider text-muted font-medium">Hazard</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center gap-1">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border",
            tierStyles.badgeClass,
          )}
        >
          <Icon className="size-3.5" />
          {tierStyles.label}
        </span>
        <span className="text-xs text-muted font-medium">
          State: <strong className="text-fg">{stateLabels[intentState]}</strong>
        </span>
      </div>
    </div>
  );
}
