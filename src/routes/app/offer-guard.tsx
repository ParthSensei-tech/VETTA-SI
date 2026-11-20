import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  Activity,
  Users,
  Clock,
  Sparkles,
  ArrowRight,
  TrendingDown,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { EmptyState } from "@/shared/components/empty-state";
import { MilestoneCelebration } from "@/shared/components/milestone-celebration";
import { toast } from "sonner";
import {
  getOfferGuardDashboard,
  getOfferInterventions,
  recordSignal,
  resolveOffer,
  executePlaybook,
  fetchSilverMedalists,
  triggerSilverMedalistStandby,
  fetchTutorialProgress,
  dismissTutorialBubble,
} from "@/features/recruiting/api/offer-guard-api";
import { HazardGauge } from "@/features/recruiting/ui/offer-guard/hazard-gauge";
import { TimelineTracker } from "@/features/recruiting/ui/offer-guard/timeline-tracker";
import { PlaybookCard } from "@/features/recruiting/ui/offer-guard/playbook-card";
import { TutorialBubbleGuide } from "@/features/recruiting/ui/offer-guard/tutorial-bubble";
import { SilverMedalistDrawer } from "@/features/recruiting/ui/offer-guard/silver-medalist-drawer";
import { LogSignalDialog } from "@/features/recruiting/ui/offer-guard/log-signal-dialog";
import { getTutorialBubbles } from "@/features/recruiting/domain/offer-guard-hazard";
import type { PreboardingOffer, SignalType } from "@/features/recruiting/domain/types";

export const Route = createFileRoute("/app/offer-guard")({ component: OfferGuardPage });

function OfferGuardPage() {
  const qc = useQueryClient();

  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [logSignalOpen, setLogSignalOpen] = useState(false);
  const [silverMedalistOpen, setSilverMedalistOpen] = useState(false);

  // Queries
  const { data: dashboard, isPending, error } = useQuery({
    queryKey: ["offer-guard", "dashboard"],
    queryFn: () => getOfferGuardDashboard(),
  });

  const { data: tutorialProgress } = useQuery({
    queryKey: ["offer-guard", "tutorial-progress"],
    queryFn: () => fetchTutorialProgress(),
  });

  const selectedOffer = dashboard?.offers.find((o) => o.id === selectedOfferId) || dashboard?.offers[0] || null;

  const { data: interventions = [] } = useQuery({
    queryKey: ["offer-guard", "interventions", selectedOffer?.id],
    queryFn: () => (selectedOffer ? getOfferInterventions({ data: { offerId: selectedOffer.id } }) : Promise.resolve([])),
    enabled: Boolean(selectedOffer),
  });

  const { data: silverMedalists = [] } = useQuery({
    queryKey: ["offer-guard", "silver-medalists", selectedOffer?.roleId, selectedOffer?.candidateId],
    queryFn: () =>
      selectedOffer
        ? fetchSilverMedalists({
            data: { roleId: selectedOffer.roleId, currentCandidateId: selectedOffer.candidateId },
          })
        : Promise.resolve([]),
    enabled: Boolean(selectedOffer),
  });

  // Mutations
  const logSignalMut = useMutation({
    mutationFn: (params: { offerId: string; signalType: SignalType; signalValue: number; notes?: string }) =>
      recordSignal({ data: params }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-guard"] });
      toast.success("Signal logged & hazard model recalculated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to log signal"),
  });

  const executePlaybookMut = useMutation({
    mutationFn: (params: { interventionId: string; status: "in_progress" | "completed" | "dismissed"; outcomeNotes?: string }) =>
      executePlaybook({ data: params }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-guard"] });
      toast.success("Playbook updated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update playbook"),
  });

  const warmStandbyMut = useMutation({
    mutationFn: (silverMedalistAppId: string) =>
      triggerSilverMedalistStandby({
        data: { offerId: selectedOffer!.id, silverMedalistAppId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-guard"] });
      toast.success("Silver Medalist warm standby activated!");
    },
    onError: (err: any) => toast.error(err.message || "Failed to activate standby"),
  });

  const dismissBubbleMut = useMutation({
    mutationFn: (stepKey: string) => dismissTutorialBubble({ data: { stepKey } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-guard", "tutorial-progress"] });
    },
  });

  const resolveMut = useMutation({
    mutationFn: (resolution: "joined" | "reneged") =>
      resolveOffer({ data: { offerId: selectedOffer!.id, resolution } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["offer-guard"] });
      if (result.feeDrafted) {
        toast.success("Joined. The success fee is drafted — we will send the invoice, not a surprise debit.");
      } else if (result.feeReason) {
        toast.success(`Joined. ${result.feeReason}`);
      } else {
        toast.success("Offer marked reneged.");
      }
    },
    onError: (err: any) => toast.error(err.message || "Failed to close out this offer"),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (error || !dashboard) {
    return <p className="text-sm text-danger">Failed to load Offer Guard dashboard.</p>;
  }

  const activePhase = !dashboard.offers.length
    ? "empty_state"
    : selectedOffer?.hazardScore && selectedOffer.hazardScore >= 75
      ? "red_alert"
      : selectedOffer?.hazardScore && selectedOffer.hazardScore >= 50
        ? "amber_alert"
        : "monitoring";

  const tutorialBubbles = getTutorialBubbles(activePhase);

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs tracking-[0.18em] text-muted uppercase">Retention & Pre-Boarding</p>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500 border border-amber-500/30">
              Pro Engine
            </span>
          </div>
          <h1 className="mt-1 font-display text-4xl tracking-tight text-fg">Offer Guard</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Offer-to-Joining Dropout Prevention & Early Warning System. Solves the 65–80 day Indian
            notice period crisis using continuous Bayesian hazard tracking and proactive retention
            playbooks.
          </p>
        </div>
      </header>

      {/* Metric Cards */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Active Offers Monitored"
          value={dashboard.activeOffers}
          icon={Users}
        />
        <StatCard
          label="Placement Fees Protected"
          value={`₹${(dashboard.totalFeeProtected / 100000).toFixed(1)}L`}
          icon={ShieldCheck}
          highlight
        />
        <StatCard
          label="Avg Notice Period"
          value={`${dashboard.avgNoticeDays} Days`}
          icon={Clock}
        />
        <StatCard
          label="Joining Ratio (30d)"
          value={`${dashboard.joiningRatioThisMonth}%`}
          icon={TrendingDown}
          warn={dashboard.joiningRatioThisMonth < 70}
        />
      </section>

      {/* Contextual Step-by-Step Tutorial / Bubble Guide */}
      <TutorialBubbleGuide
        bubbles={tutorialBubbles}
        dismissedMap={tutorialProgress}
        onDismiss={(stepKey) => dismissBubbleMut.mutate(stepKey)}
      />

      {/* Offers & Details View */}
      {dashboard.offers.length === 0 ? (
        <EmptyState
          title="No active offers in pre-boarding yet"
          body="When a candidate accepts an offer, start tracking their notice period here. We will continuously monitor interaction telemetry, compute counteroffer risk, and guide you through retention milestones."
          action={
            <Button asChild>
              <Link to="/app">Go to Roles Desk</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(300px,380px)_1fr]">
          {/* Left: Offers Master List */}
          <aside className="flex flex-col gap-2 rounded-2xl bg-surface p-3 border border-border">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                Active Pre-Boarding Candidates ({dashboard.offers.length})
              </span>
            </div>

            <ul className="flex flex-col gap-1.5">
              {dashboard.offers.map((offer) => {
                const isSelected = selectedOffer?.id === offer.id;
                return (
                  <li key={offer.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedOfferId(offer.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left border transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-fg"
                          : "border-border/60 bg-elevated/40 text-muted hover:text-fg hover:border-border"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold truncate text-fg">
                            {offer.candidateName}
                          </p>
                          {offer.silverMedalistWarmed ? (
                            <span className="rounded-full bg-rose-500/15 px-1.5 py-0.2 text-[9px] font-bold text-rose-400 border border-rose-500/30">
                              Standby Active
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted truncate">
                          {offer.roleTitle} · {offer.companyName}
                        </p>
                        <p className="mt-1 text-[11px] font-mono text-muted">
                          DOJ: {new Date(offer.targetJoiningDate).toLocaleDateString("en-IN")} ({offer.totalNoticeDays}d notice)
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <HazardGauge
                          score={offer.hazardScore}
                          riskTier={offer.riskTier}
                          intentState={offer.intentState}
                          size="sm"
                        />
                        <span className="text-[10px] font-mono text-muted">
                          ₹{(offer.placementFee / 100000).toFixed(1)}L fee
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Right: Selected Offer Detail & Playbook Action Center */}
          {selectedOffer ? (
            <div className="flex flex-col gap-6">
              {/* Peak-End Rule: Milestone Celebration on Successful Join */}
              {selectedOffer.resolution === "joined" ? (
                <MilestoneCelebration
                  title="Candidate Joined Successfully!"
                  description={`${selectedOffer.candidateName} has officially joined as ${selectedOffer.roleTitle} at ${selectedOffer.companyName}. Protected placement fee of ₹${(selectedOffer.placementFee / 100000).toFixed(2)}L has been secured.`}
                  badge="Peak Milestone Achieved"
                />
              ) : null}

              {/* Header Card */}
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-2xl font-bold tracking-tight text-fg">
                      {selectedOffer.candidateName}
                    </h2>
                    <span className="rounded-full bg-elevated px-2.5 py-0.5 text-xs font-semibold text-muted border border-border">
                      {selectedOffer.roleTitle}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Offered CTC: <strong className="text-fg">₹{(selectedOffer.offeredCtc / 100000).toFixed(1)}L</strong> ({selectedOffer.hikePercentage}% hike) · Placement Fee Protected: <strong className="text-primary font-mono">₹{(selectedOffer.placementFee / 100000).toFixed(2)}L</strong>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setLogSignalOpen(true)}
                    className="h-9 text-xs"
                  >
                    <Activity className="size-3.5 mr-1 text-primary" />
                    <span>Log Signal</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSilverMedalistOpen(true)}
                    className="h-9 text-xs border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                  >
                    <Users className="size-3.5 mr-1" />
                    <span>Silver Medalist ({silverMedalists.length})</span>
                  </Button>

                  {selectedOffer.resolution === "active" ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={resolveMut.isPending}
                        onClick={() => resolveMut.mutate("joined")}
                        className="h-9 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      >
                        <CheckCircle2 className="size-3.5 mr-1" />
                        <span>Mark joined</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={resolveMut.isPending}
                        onClick={() => resolveMut.mutate("reneged")}
                        className="h-9 text-xs text-muted hover:text-rose-400"
                      >
                        <XCircle className="size-3.5 mr-1" />
                        <span>Reneged</span>
                      </Button>
                    </>
                  ) : (
                    <span className="rounded-full bg-elevated px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted border border-border">
                      {selectedOffer.resolution}
                      {selectedOffer.resolvedAt
                        ? ` · ${new Date(selectedOffer.resolvedAt).toLocaleDateString("en-IN")}`
                        : ""}
                    </span>
                  )}
                </div>
              </div>

              {/* Hazard Gauge & Timeline Grid */}
              <div className="grid gap-6 md:grid-cols-[220px_1fr]">
                <HazardGauge
                  score={selectedOffer.hazardScore}
                  riskTier={selectedOffer.riskTier}
                  intentState={selectedOffer.intentState}
                />
                <TimelineTracker offer={selectedOffer} />
              </div>

              {/* Prescriptive Playbooks Section */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-display text-lg tracking-tight">Prescriptive Action Playbooks</h3>
                    <p className="text-xs text-muted">
                      Tailored recruiter intervention scripts generated by the hazard engine to prevent ghosting.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3">
                  {interventions.map((intervention) => (
                    <PlaybookCard
                      key={intervention.id}
                      playbook={{
                        key: intervention.playbookKey,
                        title: intervention.actionSummary.split(":")[0] || intervention.playbookKey.replace(/_/g, " "),
                        urgency: selectedOffer.hazardScore >= 75 ? "critical" : selectedOffer.hazardScore >= 50 ? "high" : "medium",
                        rationale: "Early recruiter intervention during the notice period reduces final dropout rate by over 60%.",
                        suggestedAction: intervention.actionSummary,
                      }}
                      existingIntervention={intervention}
                      onExecute={async (status, outcomeNotes) => {
                        await executePlaybookMut.mutateAsync({
                          interventionId: intervention.id,
                          status,
                          outcomeNotes,
                        });
                      }}
                      onTriggerSilverMedalist={() => setSilverMedalistOpen(true)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Modals & Drawers */}
      {selectedOffer ? (
        <>
          <LogSignalDialog
            open={logSignalOpen}
            onOpenChange={setLogSignalOpen}
            offerId={selectedOffer.id}
            candidateName={selectedOffer.candidateName || "Candidate"}
            onLogSignal={async (params) => {
              await logSignalMut.mutateAsync(params);
            }}
          />

          <SilverMedalistDrawer
            open={silverMedalistOpen}
            onOpenChange={setSilverMedalistOpen}
            offerId={selectedOffer.id}
            roleTitle={selectedOffer.roleTitle || "Role"}
            candidateName={selectedOffer.candidateName || "Candidate"}
            candidates={silverMedalists}
            onWarmCandidate={async (silverMedalistAppId) => {
              await warmStandbyMut.mutateAsync(silverMedalistAppId);
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  highlight = false,
  warn = false,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`flex flex-col justify-between rounded-2xl border p-4 transition-colors ${
        warn
          ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
          : highlight
            ? "border-primary/40 bg-primary/5 text-fg"
            : "border-border bg-surface text-fg"
      }`}
    >
      <div className="flex items-center justify-between text-muted">
        <span className="text-xs font-medium">{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="mt-2 font-display text-2xl font-bold tracking-tight text-fg">{value}</p>
    </div>
  );
}
