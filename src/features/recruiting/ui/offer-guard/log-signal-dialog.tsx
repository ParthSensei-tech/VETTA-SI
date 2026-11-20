import { useState } from "react";
import { PlusCircle, Activity, Clock, FileCheck, AlertTriangle, MessageSquare } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import type { SignalType } from "../../domain/types";

interface LogSignalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  candidateName: string;
  onLogSignal: (params: {
    offerId: string;
    signalType: SignalType;
    signalValue: number;
    notes?: string;
  }) => Promise<void>;
}

export function LogSignalDialog({
  open,
  onOpenChange,
  offerId,
  candidateName,
  onLogSignal,
}: LogSignalDialogProps) {
  const [signalType, setSignalType] = useState<SignalType>("response_latency");
  const [signalValue, setSignalValue] = useState<number>(2.0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const signalOptions = [
    {
      value: "response_latency",
      label: "Response Latency Drift",
      description: "Candidate takes significantly longer to reply to messages/calls",
      icon: Clock,
      defaultValue: 2.5,
    },
    {
      value: "resignation_milestone",
      label: "Resignation Proof Submitted",
      description: "Candidate shared formal resignation acceptance proof",
      icon: FileCheck,
      defaultValue: 1.0,
    },
    {
      value: "recruiter_sentiment",
      label: "Evasive Language / Sentiment",
      description: "Hedging replies, project handover delays, or family relocation excuses",
      icon: MessageSquare,
      defaultValue: 1.0,
    },
    {
      value: "counteroffer_hint",
      label: "Counteroffer Signal Detected",
      description: "Candidate mentioned retention discussion or competing interview",
      icon: AlertTriangle,
      defaultValue: 1.0,
    },
    {
      value: "doj_delay_request",
      label: "DOJ Delay Request",
      description: "Candidate requested to postpone Date of Joining (83% ghost correlation)",
      icon: Activity,
      defaultValue: 1.0,
    },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogSignal({
        offerId,
        signalType,
        signalValue,
        notes: notes.trim() || undefined,
      });
      setNotes("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-surface border-border">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
              <Activity className="size-4" />
            </span>
            <DialogTitle className="font-display text-xl">Log Pre-Boarding Signal</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted">
            Record interaction telemetry for <strong>{candidateName}</strong> to update the Bayesian
            hazard assessment in real time.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {/* Signal Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-fg">Signal Type</label>
            <div className="flex flex-col gap-1.5">
              {signalOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = signalType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setSignalType(opt.value as SignalType);
                      setSignalValue(opt.defaultValue);
                    }}
                    className={`flex items-start gap-2.5 rounded-xl p-2.5 text-left border transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10 text-fg"
                        : "border-border bg-elevated/40 text-muted hover:text-fg hover:border-border/80"
                    }`}
                  >
                    <Icon className={`size-4 mt-0.5 shrink-0 ${isSelected ? "text-primary" : "text-muted"}`} />
                    <div>
                      <p className="text-xs font-semibold text-fg">{opt.label}</p>
                      <p className="text-[11px] text-muted">{opt.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Signal Value Modifier if Latency */}
          {signalType === "response_latency" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-fg flex justify-between">
                <span>Latency Multiplier vs Baseline</span>
                <span className="font-mono text-primary font-bold">{signalValue}x</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.5"
                value={signalValue}
                onChange={(e) => setSignalValue(parseFloat(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted">
                <span>0.5x (Super responsive)</span>
                <span>1.0x (Normal)</span>
                <span>2.5x (Alarming delay)</span>
                <span>5.0x (Ghosting)</span>
              </div>
            </div>
          ) : null}

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-fg">Observation Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Took 36 hours to reply; candidate mentioned manager proposed an equity retention counter."
              rows={3}
              className="w-full rounded-xl border border-border bg-bg p-3 text-xs text-fg focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              className="h-9 text-xs"
            >
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={loading} className="h-9 text-xs">
              {loading ? "Updating Hazard..." : "Log & Update Model"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
