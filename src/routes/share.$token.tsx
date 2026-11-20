import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, MessageSquare, ThumbsDown, ThumbsUp, XCircle } from "lucide-react";
import { ClientCardView } from "@/features/recruiting/ui/client-card-view";
import { CandidatePortalShell } from "@/shared/components/candidate-portal-shell";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { Label } from "@/shared/components/ui/label";
import { usePublicShareQuery } from "@/features/recruiting/api/query";
import { submitClientCandidateFeedback } from "@/features/ranking/api/taste-api";
import type { TasteCategory } from "@/features/ranking/domain/taste-types";
import { cn } from "@/shared/utils";

export const Route = createFileRoute("/share/$token")({ component: SharePage });

function SharePage() {
  const { token } = Route.useParams();
  const { data, isPending, error } = usePublicShareQuery(token);

  return (
    <CandidatePortalShell>
      {isPending ? (
        <div className="pt-8">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="mt-6 h-80 rounded-2xl" />
        </div>
      ) : error || !data ? (
        <p className="pt-10 text-sm text-danger">
          This client page is invalid.{" "}
          <Link to="/" className="underline">
            Back
          </Link>
        </p>
      ) : (
        <article className="flex flex-col gap-10 pt-6 print:pt-0">
          <header className="vetta-enter">
            <p className="text-xs tracking-[0.18em] text-muted uppercase">Client page · Vetta</p>
            <h1 className="mt-3 font-display text-[clamp(2rem,4.5vw,3.4rem)] leading-[0.95] tracking-tight">
              {data.companyName}
            </h1>
            <p className="mt-2 font-display text-2xl text-muted">{data.roleTitle}</p>
            <p className="mt-3 text-sm text-muted">
              {data.location} · {data.workMode} · {data.candidates.length} on the slate
            </p>
            {data.message ? (
              <p className="mt-5 max-w-2xl text-sm leading-relaxed">{data.message}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2 print:hidden">
              <Button type="button" onClick={() => window.print()}>
                Save PDF
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const md = [
                    `# ${data.companyName} · ${data.roleTitle}`,
                    "",
                    ...data.candidates.map(
                      (c, i) =>
                        `## ${i + 1}. ${c.candidateName}\n${c.card?.summary || c.rankSummary || ""}`,
                    ),
                  ].join("\n");
                  try {
                    await navigator.clipboard.writeText(md);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Copy Notion markdown
              </Button>
            </div>
          </header>

          <section>
            <h2 className="mb-3 font-display text-2xl">Ranked slate</h2>
            <div className="overflow-x-auto rounded-2xl bg-surface shadow-[var(--shadow-border)]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Candidate</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Fit</th>
                    <th className="px-4 py-3 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidates.map((c, i) => (
                    <tr key={c.applicationId} className="border-t border-border">
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-3">
                        <p>{c.candidateName}</p>
                        <p className="text-xs text-muted">{c.headline}</p>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">{c.rankScore ?? "—"}</td>
                      <td className="px-4 py-3">{c.fitLabel}</td>
                      <td className="px-4 py-3 text-muted">{c.location || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {data.candidates.map((c, i) => (
              <div key={c.applicationId} className={cn("flex flex-col gap-2", i === 0 && "lg:col-span-2")}>
                {c.card ? (
                  <ClientCardView card={c.card} />
                ) : (
                  <article className="rounded-2xl bg-elevated p-6">
                    <h3 className="font-display text-2xl">{c.candidateName}</h3>
                    <p className="text-sm text-muted">{c.headline}</p>
                    <p className="mt-4 text-sm leading-relaxed">{c.rankSummary}</p>
                  </article>
                )}
                {/* YC Perfectly Taste Learning: Client Reaction Strip */}
                <ClientCandidateActionStrip
                  shareToken={token}
                  candidateId={c.applicationId}
                  applicationId={c.applicationId}
                  candidateName={c.candidateName}
                />
              </div>
            ))}
          </section>

          <p className="text-xs text-subtle">
            Prepared in Vetta. A human stamped this before it left the desk.
          </p>
        </article>
      )}
    </CandidatePortalShell>
  );
}

function ClientCandidateActionStrip({
  shareToken,
  candidateId,
  applicationId,
  candidateName,
}: {
  shareToken: string;
  candidateId: string;
  applicationId?: string;
  candidateName: string;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCategory, setRejectCategory] = useState<TasteCategory>("tech_depth");
  const [rejectNotes, setRejectNotes] = useState("");
  const [status, setStatus] = useState<"interview" | "rejected" | null>(null);

  const feedbackMut = useMutation({
    mutationFn: (args: {
      action: "interview" | "reject";
      category: TasteCategory;
      notes?: string;
    }) =>
      submitClientCandidateFeedback({
        data: {
          shareToken,
          candidateId,
          applicationId,
          action: args.action,
          category: args.category,
          notes: args.notes,
        },
      }),
    onSuccess: (_, vars) => {
      setStatus(vars.action === "interview" ? "interview" : "rejected");
      setRejectOpen(false);
      toast.success(
        vars.action === "interview"
          ? `Interview requested for ${candidateName}. Taste model calibrated!`
          : `Feedback recorded for ${candidateName}. Taste profile updated!`,
      );
    },
    onError: (err: any) => {
      toast.error(err.message || "Could not record feedback");
    },
  });

  if (status === "interview") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="size-4" />
        <span>Interview Requested · Recruiter notified to coordinate</span>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-surface px-4 py-2.5 text-xs font-medium text-muted border border-border">
        <XCircle className="size-4 text-warn" />
        <span>Passed on Candidate · Preference recorded in hiring taste model</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface/70 px-4 py-2.5 backdrop-blur-sm">
        <span className="text-xs font-medium text-muted">Hiring Manager Decision:</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={feedbackMut.isPending}
            onClick={() => setRejectOpen(true)}
            className="h-8 gap-1.5 text-xs text-muted hover:text-rose-400 hover:bg-rose-500/10"
          >
            <ThumbsDown className="size-3.5" />
            <span>Pass with reason</span>
          </Button>
          <Button
            size="sm"
            disabled={feedbackMut.isPending}
            onClick={() =>
              feedbackMut.mutate({
                action: "interview",
                category: "culture_pace",
                notes: "Requesting interview slate slot",
              })
            }
            className="h-8 gap-1.5 text-xs soft-lime text-primary-foreground font-semibold"
          >
            <ThumbsUp className="size-3.5" />
            <span>Request interview</span>
          </Button>
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pass on {candidateName}</DialogTitle>
            <DialogDescription>
              Your feedback immediately trains the matching model so future candidates better match your team's bar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label className="text-xs">Primary reason</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "tech_depth", label: "Lacks tech depth" },
                  { id: "culture_pace", label: "Too corporate / slow" },
                  { id: "ctc_gap", label: "CTC expectation high" },
                  { id: "service_firm_bias", label: "Prefers product-led" },
                  { id: "notice_too_long", label: "Notice period too long" },
                  { id: "autonomy", label: "Needs more ownership" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRejectCategory(item.id as TasteCategory)}
                    className={cn(
                      "rounded-lg border p-2 text-left text-xs transition-colors",
                      rejectCategory === item.id
                        ? "border-accent bg-accent/15 text-accent-fg font-medium"
                        : "border-border text-muted hover:border-fg/30 hover:text-fg",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reject-note" className="text-xs">Specific notes (optional)</Label>
              <Textarea
                id="reject-note"
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="e.g. Looked good on paper but we need someone with heavy production Kafka experience."
                className="min-h-20 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={feedbackMut.isPending}
                onClick={() =>
                  feedbackMut.mutate({
                    action: "reject",
                    category: rejectCategory,
                    notes: rejectNotes,
                  })
                }
              >
                {feedbackMut.isPending ? "Recording…" : "Submit & train model"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
