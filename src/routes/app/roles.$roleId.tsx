import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Link2, Globe, Sparkles, ShieldAlert, UploadCloud, MoreHorizontal, UserPlus } from "lucide-react";
import { BatchIngestDialog } from "@/features/recruiting/ui/batch-ingest-dialog";
import { ExportSlateDialog } from "@/features/recruiting/ui/export-slate-dialog";
import { ExternalPortalDialog } from "@/features/people/ui/external-portal-dialog";
import { RubricEditor } from "@/features/ranking/ui/rubric-editor";
import { Button } from "@/shared/components/ui/button";
import { MobileActionBar } from "@/shared/components/action-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { NightQueue } from "@/features/pipeline/ui/night-queue";
import { Textarea } from "@/shared/components/ui/textarea";
import { CandidatePanel } from "@/features/ranking/ui/candidate-panel";
import { EmptyState } from "@/shared/components/empty-state";
import { PipelineChip, ScoreChip, StageChip } from "@/shared/components/status-chip";
import { VerificationChip } from "@/features/verification/ui/verification-chip";
import { DocumentStorePanel } from "@/features/verification/ui/document-store-panel";
import { VerificationQuotaStrip } from "@/features/verification/ui/verification-quota-strip";
import { VerificationReport } from "@/features/verification/ui/verification-report";
import { useSlateVerdictsQuery, verificationQueryKeys } from "@/features/verification/api/query";
import { StaleBanner } from "@/features/ranking/ui/provenance-badge";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { ingestResume, rerankStaleApplications } from "@/features/recruiting/api/api";
import { AntiScrapingPolicyLink } from "@/features/compliance/ui/legal-terms-dialog";
import {
  errorMessage,
  queryKeys,
  useRoleBatchesQuery,
  useRoleQuery,
} from "@/features/recruiting/api/query";
import { cn, initials } from "@/shared/utils";

export const Route = createFileRoute("/app/roles/$roleId")({ component: RoleWorkspace });

function RoleWorkspace() {
  const { roleId } = Route.useParams();
  const { data, isPending, error } = useRoleQuery(roleId);
  const batchesQuery = useRoleBatchesQuery(roleId);
  // Verification is a second read of the same slate, on its own key: the rank
  // data and the verdict data come from different features and refresh on
  // different clocks, and a chip must not be able to invalidate a score.
  const verdictsQuery = useSlateVerdictsQuery(roleId);
  const verdictByApp = useMemo(
    () => new Map((verdictsQuery.data?.verdicts ?? []).map((v) => [v.applicationId, v])),
    [verdictsQuery.data],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [sourcingConfirmed, setSourcingConfirmed] = useState(false);
  const qc = useQueryClient();

  const selected = useMemo(
    () => data?.applications.find((a) => a.id === selectedId) ?? data?.applications[0] ?? null,
    [data, selectedId],
  );

  const ingestMut = useMutation({
    mutationFn: () => ingestResume({ data: { roleId, resumeText } }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: queryKeys.role(roleId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
      void qc.invalidateQueries({ queryKey: queryKeys.talent });
      void qc.invalidateQueries({ queryKey: verificationQueryKeys.slate(roleId) });
      setSelectedId(result.application.id);
      setResumeText("");
      setIngestOpen(false);
      toast.success(`${result.application.candidate.fullName} added`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const staleCount = data?.applications.filter((a) => a.isStale).length ?? 0;

  const rerankStaleMut = useMutation({
    mutationFn: () => rerankStaleApplications({ data: { roleId, topN: Math.min(staleCount, 50) } }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: queryKeys.role(roleId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
      toast.success(`Re-ranked ${result.deepened} stale candidates`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-danger">
        Role not found.{" "}
        <Link to="/app" className="underline">
          Back to desk
        </Link>
      </p>
    );
  }

  const { role, applications } = data;
  const screenSent = applications.filter((a) => a.screen).length;
  const screenDone = applications.filter(
    (a) => a.screen?.status === "evaluated" || a.screen?.completedAt,
  ).length;
  const screenRate = screenSent > 0 ? Math.round((screenDone / screenSent) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted">
            <Link to="/app" className="hover:text-fg">
              Desk
            </Link>
            <span className="mx-2 text-subtle">/</span>
            {role.companyName}
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-tight">{role.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <StageChip stage={role.companyStage} />
            <span>
              {role.location} · {role.workMode}
            </span>
            {role.compensationBand ? <span>· {role.compensationBand}</span> : null}
            {screenSent > 0 ? (
              <span className="font-mono tabular-nums">
                · screens {screenDone}/{screenSent} ({screenRate}%)
              </span>
            ) : null}
          </div>
        </div>
        {/* Hick's Law Action Strip: 1 Dominant Radiant Primary CTA, ≤3 Contextual Secondary CTAs, and Progressive Disclosure */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Dominant Primary Action CTA */}
          <Button
            variant="default"
            onClick={() => setBatchOpen(true)}
            className="gap-2 shadow-lime"
          >
            <UploadCloud className="size-4" />
            Upload resumes
          </Button>

          {/* Secondary Action 1: Share Apply Link (visible only when role is open) */}
          {role.status === "open" ? (
            <Button
              variant="secondary"
              onClick={async () => {
                const url = `${window.location.origin}/jobs/${role.id}`;
                try {
                  await navigator.clipboard.writeText(url);
                  toast.success("Apply link copied");
                } catch {
                  toast.message("Apply link", { description: url });
                }
              }}
              className="gap-1.5"
            >
              <Link2 className="size-4" />
              Share apply link
            </Button>
          ) : null}

          {/* Secondary Action 2: Career Portal Sync */}
          <Button
            variant="secondary"
            onClick={() => setPortalOpen(true)}
            className="gap-1.5"
          >
            <Globe className="size-4 text-amber-500" />
            Portal Ingest
          </Button>

          {/* Secondary Action 3: Export Slate (hidden via progressive disclosure if no candidates) */}
          {applications.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => setExportOpen(true)}
              className="gap-1.5"
            >
              <FileSpreadsheet className="size-4" />
              Export
            </Button>
          ) : null}

          {/* Overflow Menu for Auxiliary Tasks */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions" className="size-11">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setIngestOpen(true)} className="gap-2">
                <UserPlus className="size-4 text-muted" />
                <span>Paste single resume</span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/offer-guard" className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-accent" />
                  <span>Offer Guard Preboarding</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {batchesQuery.data && batchesQuery.data.length > 0 ? (
        <NightQueue batches={batchesQuery.data} roleId={roleId} />
      ) : null}

      <RubricEditor roleId={roleId} />

      <StaleBanner
        staleCount={staleCount}
        onRerankAll={() => rerankStaleMut.mutate()}
        isReranking={rerankStaleMut.isPending}
      />

      <VerificationQuotaStrip />

      <DocumentStorePanel />

      {applications.length === 0 ? (
        <EmptyState
          title="No one here yet"
          body="Drop a folder of resumes or paste one. Ranking runs in the background — come back to a sorted list."
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setBatchOpen(true)}>Drop resumes</Button>
              <Button variant="secondary" onClick={() => setIngestOpen(true)}>
                Paste one
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(260px,340px)_1fr]">
          <aside className="rounded-2xl bg-surface p-2 shadow-[var(--shadow-border)]">
            <p className="px-3 py-2 text-xs text-muted">
              {applications.length} people · sorted by fit
            </p>
            <ul className="flex flex-col gap-1">
              {applications.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(app.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150",
                      selected?.id === app.id ? "bg-elevated" : "hover:bg-elevated/60",
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bg text-[11px] font-medium">
                      {initials(app.candidate.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{app.candidate.fullName}</span>
                      <span className="block truncate text-xs text-muted">
                        {app.candidate.currentTitle || "—"}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <ScoreChip score={app.rankScore} />
                      <PipelineChip status={app.pipelineStatus} />
                      <VerificationChip verdict={verdictByApp.get(app.id)} />
                      {app.isStale && (
                        <span className="text-[10px] text-warn font-medium">⚠ stale</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="flex flex-col gap-3">
            {selected ? (
              <div className="flex justify-end">
                <VerificationReport applicationId={selected.id} />
              </div>
            ) : null}
            {selected ? <CandidatePanel application={selected} roleId={role.id} /> : null}
          </div>
        </div>
      )}

      <Dialog open={ingestOpen} onOpenChange={(open) => {
        setIngestOpen(open);
        if (!open) setSourcingConfirmed(false);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a resume</DialogTitle>
            <DialogDescription>
              Paste the full text. We sort them against this job automatically.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste resume text…"
            className="min-h-56 text-sm"
          />
          <div className="rounded-xl border border-border/70 bg-surface/40 p-3 text-xs text-muted">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border text-primary cursor-pointer"
                checked={sourcingConfirmed}
                onChange={(e) => setSourcingConfirmed(e.target.checked)}
              />
              <span className="leading-relaxed">
                I certify this profile complies with our{" "}
                <AntiScrapingPolicyLink className="font-semibold text-blue-600 dark:text-blue-400" /> and was obtained through direct application, client mandate, or lawful consent (DPDP Act 2023 compliant).
              </span>
            </label>
          </div>
          <div className="flex justify-end">
            <Button
              disabled={ingestMut.isPending || resumeText.trim().length < 40 || !sourcingConfirmed}
              onClick={() => ingestMut.mutate()}
              className="cursor-pointer"
            >
              {ingestMut.isPending ? "Adding…" : "Add Candidate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <BatchIngestDialog open={batchOpen} onOpenChange={setBatchOpen} roleId={roleId} />
      <ExportSlateDialog open={exportOpen} onOpenChange={setExportOpen} roleId={roleId} />
      <ExternalPortalDialog
        open={portalOpen}
        onOpenChange={setPortalOpen}
        roleId={roleId}
        roleTitle={role.title}
      />

      {/* Fitts's Law Mobile Thumb Zone Action Bar */}
      <MobileActionBar>
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-fg truncate">{role.title}</span>
          <span className="text-[11px] text-muted">
            {applications.length} candidates ranked
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => setBatchOpen(true)}
          className="gap-2 shadow-lime"
        >
          <UploadCloud className="size-4" />
          Upload resumes
        </Button>
      </MobileActionBar>
    </div>
  );
}
