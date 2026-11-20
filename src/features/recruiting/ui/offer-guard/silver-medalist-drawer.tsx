import { useState } from "react";
import { Copy, Check, Users, ShieldAlert, Sparkles, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { ScoreChip } from "@/shared/components/status-chip";
import { initials } from "@/shared/utils";

interface SilverMedalistDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  roleTitle: string;
  candidateName: string;
  candidates: Array<{
    id: string;
    candidateName: string;
    rankScore: number;
    headline: string;
    email: string;
  }>;
  onWarmCandidate: (silverMedalistAppId: string) => Promise<void>;
}

export function SilverMedalistDrawer({
  open,
  onOpenChange,
  offerId,
  roleTitle,
  candidateName,
  candidates,
  onWarmCandidate,
}: SilverMedalistDrawerProps) {
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(
    candidates[0]?.id || null,
  );
  const [copied, setCopied] = useState(false);
  const [warming, setWarming] = useState(false);
  const [warmedSuccess, setWarmedSuccess] = useState(false);

  const active = candidates.find((c) => c.id === selectedCandidate) || candidates[0];

  const templateMessage = active
    ? `Hi ${active.candidateName.split(" ")[0]},\n\nHope you're having a productive week! I wanted to check in regarding our ${roleTitle} role. Our team was very impressed by your background and project experience during evaluations.\n\nWe are planning our upcoming engineering allocations for next quarter and would love to reconnect for a brief 10-minute catchup on Thursday or Friday to see how your timeline is looking.\n\nWould you be open to a quick call?\n\nBest,\nRecruiting Team`
    : "";

  async function handleCopy() {
    if (!templateMessage) return;
    await navigator.clipboard.writeText(templateMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleWarm() {
    if (!active) return;
    setWarming(true);
    try {
      await onWarmCandidate(active.id);
      setWarmedSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
        setWarmedSuccess(false);
      }, 1500);
    } finally {
      setWarming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-surface border-border">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-rose-500/15 text-rose-400">
              <ShieldAlert className="size-4" />
            </span>
            <DialogTitle className="font-display text-xl">
              Silver Medalist Warm Standby Protocol
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted">
            The primary offer with <strong>{candidateName}</strong> is exhibiting elevated renege
            risk. Below are the top runner-up candidates from the original role evaluation. Warm
            them on standby to ensure zero calendar loss if a drop occurs.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted text-xs">
            No other ranked candidates available for this role.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[220px_1fr] pt-2">
            {/* Candidate Selector */}
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Ranked Runner-Ups
              </p>
              <ul className="flex flex-col gap-1.5">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedCandidate(c.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl p-2.5 text-left border transition-all ${
                        selectedCandidate === c.id
                          ? "border-primary bg-primary/10 text-fg"
                          : "border-border bg-elevated/40 text-muted hover:text-fg hover:border-border/80"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-bg text-[10px] font-medium">
                          {initials(c.candidateName)}
                        </span>
                        <div className="truncate">
                          <p className="text-xs font-semibold truncate text-fg">
                            {c.candidateName}
                          </p>
                          <p className="text-[10px] text-muted truncate">{c.headline}</p>
                        </div>
                      </div>
                      <ScoreChip score={c.rankScore} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Template & Action Card */}
            {active ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-elevated/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-fg">{active.candidateName}</h4>
                    <p className="text-xs text-muted">{active.email}</p>
                  </div>
                  <ScoreChip score={active.rankScore} />
                </div>

                <div className="rounded-lg border border-border/80 bg-bg p-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-border/60 mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary flex items-center gap-1">
                      <Sparkles className="size-3" />
                      Discrete Warm Touchpoint Template
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="text-xs text-muted hover:text-fg flex items-center gap-1 transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="size-3 text-emerald-400" />
                          <span className="text-emerald-400 text-[11px]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          <span className="text-[11px]">Copy Text</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap font-sans text-xs text-fg/90 leading-relaxed">
                    {templateMessage}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-muted max-w-[280px]">
                    Keeps the candidate warm without disclosing that another offer was extended.
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={warming || warmedSuccess}
                    onClick={handleWarm}
                    className="h-8 text-xs bg-rose-600 hover:bg-rose-500 text-white"
                  >
                    {warmedSuccess ? (
                      <>
                        <Check className="size-3 mr-1" />
                        <span>Standby Active</span>
                      </>
                    ) : (
                      <>
                        <Send className="size-3 mr-1" />
                        <span>{warming ? "Marking..." : "Activate Standby"}</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
