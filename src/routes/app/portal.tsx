import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  HelpCircle,
  Layers,
  Link2,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import {
  getAutonomousPortalConfig,
  updateAutonomousPortalConfig,
  getHitlQueue,
  submitHitlDecision,
  simulateAtsRelayPing,
} from "@/lib/recruiting/autonomous-portal-api";
import { formatRelative, cn } from "@/lib/utils";
import type {
  AutonomousPortal,
  HitlDecision,
  HitlCheckpointType,
} from "@/lib/recruiting/types";

export const Route = createFileRoute("/app/portal")({ component: AutonomousPortalManagement });

function AutonomousPortalManagement() {
  const [activeTab, setActiveTab] = useState<"connect" | "hitl" | "settings" | "simulator">("connect");
  const [selectedChannel, setSelectedChannel] = useState<"career_portal" | "embed_widget" | "ats_webhook" | "direct_drop">("career_portal");

  // Portal config query
  const portalQuery = useQuery({
    queryKey: ["autonomous-portal-config"],
    queryFn: () => getAutonomousPortalConfig(),
  });

  // HITL decisions query
  const hitlQuery = useQuery({
    queryKey: ["hitl-queue"],
    queryFn: () => getHitlQueue({ data: {} }),
    refetchInterval: 10_000,
  });

  if (portalQuery.isPending || hitlQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (portalQuery.isError || !portalQuery.data) {
    return <p className="text-sm text-danger">Could not load autonomous portal configuration.</p>;
  }

  const { portal, guides } = portalQuery.data;
  const currentGuide = guides[selectedChannel] || guides.career_portal;
  const pendingCount = hitlQuery.data?.pendingCount ?? 0;

  return (
    <div className="flex flex-col gap-8 pb-16">
      {/* 1. Header & Tier Comparison Banner */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <Sparkles className="size-3.5" />
                Premium Feature
              </span>
              <span className="text-xs text-muted">Tier Status: Active</span>
            </div>
            <h1 className="mt-2 font-display text-4xl tracking-tight">
              Autonomous Career Portal & Ingestion Engine
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Replaces slow, keyword-parsing legacy ATS (Workday, Taleo) with an agentic multi-stage retrieval architecture and strict Human-in-the-Loop decision checkpoints.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/portal/${portal.slug}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
                <Globe className="size-4" />
                View Public Portal
                <ExternalLink className="size-3" />
              </a>
            </Button>
            <Button asChild size="sm">
              <Link to="/app">
                <Layers className="size-4" />
                Back to Desk (Freemium Drop)
              </Link>
            </Button>
          </div>
        </div>

        {/* Freemium vs Premium Indicator Box */}
        <div className="grid gap-4 rounded-2xl border border-border bg-surface p-4 text-xs md:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-elevated/40 p-3">
            <CheckCircle2 className="size-4 shrink-0 text-muted" />
            <div>
              <p className="font-semibold text-fg">Freemium Tier (Always Preserved)</p>
              <p className="mt-0.5 text-muted">
                Manual resume folder drop & paste inside Desk. Single-batch instant match without portal infrastructure.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <Zap className="size-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold text-fg">Premium Tier (Active on this Workspace)</p>
              <p className="mt-0.5 text-muted">
                Self-service candidate career portal, dynamic missing-info intake, legacy ATS webhook relay, and strict Human-in-the-Loop safeguards.
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Top-level Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-4 md:w-auto md:inline-flex">
          <TabsTrigger value="connect" className="gap-2">
            <Link2 className="size-4" />
            Client Connection & Helping Steps
          </TabsTrigger>
          <TabsTrigger value="hitl" className="gap-2">
            <ShieldCheck className="size-4" />
            Human-in-the-Loop Queue
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Sliders className="size-4" />
            Portal & Policy Settings
          </TabsTrigger>
          <TabsTrigger value="simulator" className="gap-2">
            <Webhook className="size-4" />
            ATS Webhook Simulator
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* TAB 1: CLIENT CONNECTION WIZARD & HELPING STEPS */}
      {activeTab === "connect" && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-2xl">Connect Your Hiring Workflows Easily</h2>
            <p className="text-sm text-muted">
              Choose how your company connects to the Autonomous Ingestion Engine. Follow the frictionless helping steps provided for each option below.
            </p>
          </div>

          {/* Option Selector Cards */}
          <div className="grid gap-3 md:grid-cols-4">
            {(["career_portal", "embed_widget", "ats_webhook", "direct_drop"] as const).map((channelKey) => {
              const guide = guides[channelKey];
              const isSelected = selectedChannel === channelKey;
              return (
                <button
                  key={channelKey}
                  type="button"
                  onClick={() => setSelectedChannel(channelKey)}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all",
                    isSelected
                      ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                      : "border-border bg-surface hover:border-primary/40",
                  )}
                >
                  <span className="rounded-md bg-elevated px-2 py-0.5 text-[10px] font-semibold text-muted">
                    {guide?.badge || "Option"}
                  </span>
                  <p className="font-semibold text-fg">{guide?.title || channelKey}</p>
                  <p className="line-clamp-2 text-xs text-muted">{guide?.description}</p>
                </button>
              );
            })}
          </div>

          {/* Active Option Helping Steps Card */}
          {currentGuide && (
            <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      {currentGuide.badge}
                    </span>
                    <h3 className="font-display text-xl">{currentGuide.title}</h3>
                  </div>
                  <p className="mt-1 text-sm text-muted">{currentGuide.description}</p>
                </div>

                {selectedChannel === "career_portal" && (
                  <Button asChild variant="secondary" size="sm">
                    <a href={`/portal/${portal.slug}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
                      Live Portal: /portal/{portal.slug}
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                )}
              </div>

              {/* Trade-offs & Pros/Cons */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Why choose this option
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
                    {currentGuide.tradeOffs.pros.map((pro, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        <span>{pro}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Things to keep in mind
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
                    {currentGuide.tradeOffs.cons.map((con, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
                        <span>{con}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Step-by-Step Helping Guide */}
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-semibold tracking-wide text-fg uppercase">
                  Frictionless Helping Steps:
                </h4>
                <div className="grid gap-4 md:grid-cols-3">
                  {currentGuide.steps.map((st) => (
                    <div
                      key={st.stepNumber}
                      className="flex flex-col gap-2 rounded-xl border border-border bg-elevated/40 p-4"
                    >
                      <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {st.stepNumber}
                      </div>
                      <p className="text-sm font-semibold text-fg">{st.instruction}</p>
                      <p className="text-xs leading-relaxed text-muted">{st.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Copyable Snippets / Configurations */}
              {currentGuide.copySnippet && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg p-4 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">{currentGuide.copySnippet.label}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={async () => {
                        const snippet = currentGuide.copySnippet?.code
                          .replace("{PORTAL_URL}", `${window.location.origin}/portal/${portal.slug}`)
                          .replace("{WEBHOOK_RELAY_URL}", `${window.location.origin}/api/ats-relay?secret=${portal.webhookSecret}`);
                        if (snippet) {
                          await navigator.clipboard.writeText(snippet);
                          toast.success("Snippet copied to clipboard");
                        }
                      }}
                    >
                      <Copy className="size-3" />
                      Copy Code
                    </Button>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface p-3 text-fg">
                    {currentGuide.copySnippet.code
                      .replace("{PORTAL_URL}", `${typeof window !== "undefined" ? window.location.origin : ""}/portal/${portal.slug}`)
                      .replace("{WEBHOOK_RELAY_URL}", `${typeof window !== "undefined" ? window.location.origin : ""}/api/ats-relay?secret=${portal.webhookSecret}`)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: STRICT HUMAN-IN-THE-LOOP (HITL) DECISION QUEUE */}
      {activeTab === "hitl" && (
        <HitlQueueManager checkpoints={hitlQuery.data?.checkpoints || []} refetch={hitlQuery.refetch} />
      )}

      {/* TAB 3: PORTAL & STRICT HITL POLICY SETTINGS */}
      {activeTab === "settings" && (
        <PortalSettingsEditor portal={portal} refetch={portalQuery.refetch} />
      )}

      {/* TAB 4: LEGACY ATS SIMULATOR */}
      {activeTab === "simulator" && (
        <AtsSimulator portalId={portal.id} onComplete={() => hitlQuery.refetch()} />
      )}
    </div>
  );
}

// ============================================================================
// HITL QUEUE MANAGER
// ============================================================================

function HitlQueueManager({
  checkpoints,
  refetch,
}: {
  checkpoints: HitlDecision[];
  refetch: () => void;
}) {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const filtered = checkpoints.filter((c) => (filter === "pending" ? c.status === "pending" : true));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Strict Human-in-the-Loop Review Center</h2>
          <p className="text-sm text-muted">
            The autonomous engine stops and requests human judgment for critical forks: high-fit interview approvals, unstated requirement probes, and rejection confirmations.
          </p>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="pending">Pending Review ({checkpoints.filter((c) => c.status === "pending").length})</TabsTrigger>
            <TabsTrigger value="all">Full Audit History</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={filter === "pending" ? "All checkpoints are clear" : "No decisions recorded"}
          body="When applicants pass multi-stage retrieval, candidates requiring human sign-off will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((cp) => (
            <HitlCheckpointCard key={cp.id} checkpoint={cp} onDecided={refetch} />
          ))}
        </div>
      )}
    </section>
  );
}

function HitlCheckpointCard({
  checkpoint,
  onDecided,
}: {
  checkpoint: HitlDecision;
  onDecided: () => void;
}) {
  const [reviewerNote, setReviewerNote] = useState("");

  const decideMut = useMutation({
    mutationFn: (decision: "approved" | "rejected" | "clarification_requested") =>
      submitHitlDecision({
        data: {
          checkpointId: checkpoint.id,
          decision,
          reviewerNotes: reviewerNote,
        },
      }),
    onSuccess: (_, decision) => {
      toast.success(
        decision === "approved"
          ? "Checkpoint approved — candidate advanced"
          : decision === "rejected"
            ? "Candidate rejection confirmed"
            : "Clarification requested",
      );
      onDecided();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Decision failed"),
  });

  const badgeConfig: Record<HitlCheckpointType, { label: string; color: string; icon: any }> = {
    shortlist_interview: { label: "Interview Sign-Off", color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", icon: Sparkles },
    missing_info_probe: { label: "Missing Info Intake", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400", icon: HelpCircle },
    candidate_rejection: { label: "Rejection Safeguard", color: "bg-rose-500/15 text-rose-600 dark:text-rose-400", icon: ShieldAlert },
    rubric_approval: { label: "Rubric Calibration", color: "bg-sky-500/15 text-sky-600 dark:text-sky-400", icon: Sliders },
  };

  const badge = badgeConfig[checkpoint.checkpointType] || badgeConfig.shortlist_interview;
  const isPending = checkpoint.status === "pending";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", badge.color)}>
              <badge.icon className="size-3.5" />
              {badge.label}
            </span>
            <span className="text-xs text-muted">
              {checkpoint.roleTitle} · {formatRelative(checkpoint.createdAt)}
            </span>
          </div>
          <h3 className="font-display text-xl text-fg">{checkpoint.candidateName}</h3>
        </div>

        <div className="flex items-center gap-2">
          {checkpoint.aiScore != null && (
            <div className="flex items-center gap-1.5 rounded-lg bg-elevated px-3 py-1 font-mono text-sm font-bold">
              <span>Score:</span>
              <span className={checkpoint.aiScore >= 75 ? "text-emerald-500" : "text-amber-500"}>
                {checkpoint.aiScore}/100
              </span>
            </div>
          )}
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider",
              isPending ? "bg-amber-500/15 text-amber-500" : "bg-elevated text-muted",
            )}
          >
            {checkpoint.status}
          </span>
        </div>
      </div>

      {/* AI Grounded Summary */}
      <div className="rounded-xl border border-border/60 bg-elevated/40 p-3.5 text-xs text-fg">
        <p className="font-semibold text-muted">Agent Recommendation: {checkpoint.aiRecommendation.toUpperCase()}</p>
        <p className="mt-1 leading-relaxed">{checkpoint.evidenceSummary}</p>
      </div>

      {/* Missing Requirements or Probes */}
      {checkpoint.missingRequirements.length > 0 && (
        <div className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold text-muted">Unstated Items Checked:</span>
          <div className="flex flex-wrap gap-1.5">
            {checkpoint.missingRequirements.map((req, i) => (
              <span key={i} className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
                {req}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Candidate Intake Responses (if submitted) */}
      {checkpoint.candidateResponses.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-xs">
          <span className="font-semibold text-fg">Candidate Interactive Intake Responses:</span>
          {checkpoint.candidateResponses.map((res, i) => (
            <div key={i} className="rounded-lg bg-elevated p-2">
              <p className="font-medium text-muted">{res.question}</p>
              <p className="mt-0.5 font-semibold text-fg">{res.answer}</p>
            </div>
          ))}
        </div>
      )}

      {/* Action Decision Form (Only for Pending Checkpoints) */}
      {isPending ? (
        <div className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${checkpoint.id}`} className="text-xs text-muted">
              Human Reviewer Stamp & Calibration Note (Optional):
            </Label>
            <Input
              id={`note-${checkpoint.id}`}
              placeholder="e.g. Approved: Verified backend ledger scale. Proceeding to Round 1 interview."
              value={reviewerNote}
              onChange={(e) => setReviewerNote(e.target.value)}
              className="text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate("rejected")}
            >
              <XCircle className="size-4" />
              Reject Candidate
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate("clarification_requested")}
            >
              <HelpCircle className="size-4" />
              Request Clarification Probe
            </Button>

            <Button
              size="sm"
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate("approved")}
            >
              <CheckCircle2 className="size-4" />
              Approve for Interview
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted">
          <span>Decided by: {checkpoint.reviewerId || "Hiring Manager"}</span>
          <span>Decision: {checkpoint.reviewerDecision || checkpoint.status}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PORTAL & POLICY SETTINGS EDITOR
// ============================================================================

function PortalSettingsEditor({
  portal,
  refetch,
}: {
  portal: AutonomousPortal;
  refetch: () => void;
}) {
  const [slug, setSlug] = useState(portal.slug);
  const [portalName, setPortalName] = useState(portal.portalName);
  const [headline, setHeadline] = useState(portal.headline);
  const [description, setDescription] = useState(portal.description);
  const [hitlPolicy, setHitlPolicy] = useState(portal.hitlPolicy);
  const [threshold, setThreshold] = useState(portal.autoShortlistThreshold);
  const [requireRejection, setRequireRejection] = useState(portal.requireHumanRejection);
  const [interactiveIntake, setInteractiveIntake] = useState(portal.interactiveIntakeEnabled);

  const saveMut = useMutation({
    mutationFn: () =>
      updateAutonomousPortalConfig({
        data: {
          portalId: portal.id,
          slug,
          portalName,
          headline,
          description,
          hitlPolicy,
          autoShortlistThreshold: Number(threshold),
          requireHumanRejection: requireRejection,
          interactiveIntakeEnabled: interactiveIntake,
        },
      }),
    onSuccess: () => {
      toast.success("Autonomous Portal settings saved");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl">Autonomous Ingestion & HITL Policies</h2>
        <p className="text-sm text-muted">
          Configure how candidate ingestion operates and fine-tune where human approval is strictly required.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Portal Company Name</Label>
            <Input value={portalName} onChange={(e) => setPortalName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Subpath Careers Slug (/portal/[slug])</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
            <p className="text-xs text-muted">Public URL: {typeof window !== "undefined" ? window.location.origin : ""}/portal/{slug}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Candidate Portal Headline</Label>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Portal Description</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-elevated/40 p-5">
          <h3 className="font-display text-lg">Strict Human-in-the-Loop Policies</h3>

          <div className="flex flex-col gap-1.5">
            <Label>HITL Governance Mode</Label>
            <select
              value={hitlPolicy}
              onChange={(e) => setHitlPolicy(e.target.value as any)}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-fg"
            >
              <option value="strict">Strict (Human approval required on ALL shortlists, probes, and rejections)</option>
              <option value="balanced">Balanced (Human approval on shortlists and low-confidence edge cases)</option>
              <option value="autonomous">Autonomous (Auto-shortlists high scores, only flags anomalies)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <Label>Interview Shortlist Threshold</Label>
              <span className="font-mono font-bold text-primary">{threshold}/100</span>
            </div>
            <input
              type="range"
              min={60}
              max={90}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="accent-primary"
            />
            <p className="text-xs text-muted">Candidates scoring above this threshold trigger the Interview Sign-Off gate.</p>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              <p className="text-sm font-medium">Rejection Safeguard</p>
              <p className="text-xs text-muted">Prevent black-box rejections without explicit human confirmation.</p>
            </div>
            <input
              type="checkbox"
              checked={requireRejection}
              onChange={(e) => setRequireRejection(e.target.checked)}
              className="size-4 accent-primary"
            />
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              <p className="text-sm font-medium">Dynamic Missing-Info Candidate Intake</p>
              <p className="text-xs text-muted">Prompt candidates for unstated notice period and CTC during submission.</p>
            </div>
            <input
              type="checkbox"
              checked={interactiveIntake}
              onChange={(e) => setInteractiveIntake(e.target.checked)}
              className="size-4 accent-primary"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          Save Policy Settings
        </Button>
      </div>
    </section>
  );
}

// ============================================================================
// ATS SIMULATOR (WORKDAY / TALEO / GREENHOUSE TESTER)
// ============================================================================

function AtsSimulator({
  portalId,
  onComplete,
}: {
  portalId: string;
  onComplete: () => void;
}) {
  const [ats, setAts] = useState<"workday" | "taleo" | "greenhouse" | "lever">("workday");
  const [candidateName, setCandidateName] = useState("Kiran Rao");
  const [candidateEmail, setCandidateEmail] = useState("kiran.rao@example.com");
  const [roleTitle, setRoleTitle] = useState("Senior Backend Engineer");

  const simMut = useMutation({
    mutationFn: () =>
      simulateAtsRelayPing({
        data: {
          portalId,
          ats,
          candidateName,
          candidateEmail,
          roleTitle,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.message);
      onComplete();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Simulation failed"),
  });

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl">Legacy ATS Webhook Relay Simulator</h2>
        <p className="text-sm text-muted">
          Simulate an applicant arriving from Workday, Taleo, Greenhouse, or Lever to observe multi-stage retrieval and strict Human-in-the-Loop checkpoint routing in real-time.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Simulated Source ATS</Label>
          <select
            value={ats}
            onChange={(e) => setAts(e.target.value as any)}
            className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-fg"
          >
            <option value="workday">Workday Recruiting (REST Webhook Relay)</option>
            <option value="taleo">Oracle Taleo Enterprise</option>
            <option value="greenhouse">Greenhouse Harvest API</option>
            <option value="lever">Lever Webhooks</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Target Role Title</Label>
          <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Candidate Name</Label>
          <Input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Candidate Email</Label>
          <Input value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <p className="text-xs text-muted">
          This test runs real-time two-tower pgvector semantic search and routes through the HITL gate.
        </p>
        <Button onClick={() => simMut.mutate()} disabled={simMut.isPending} className="gap-2">
          <Rocket className="size-4" />
          {simMut.isPending ? "Simulating Ingestion..." : "Run Simulated Ingestion Test"}
        </Button>
      </div>
    </section>
  );
}
