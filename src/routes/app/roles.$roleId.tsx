import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Link2 } from "lucide-react";
import { BatchIngestDialog } from "@/components/batch-ingest-dialog";
import { ExportSlateDialog } from "@/components/export-slate-dialog";
import { RubricEditor } from "@/components/rubric-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NightQueue } from "@/components/night-queue";
import { Textarea } from "@/components/ui/textarea";
import { CandidatePanel } from "@/components/candidate-panel";
import { EmptyState } from "@/components/empty-state";
import { PipelineChip, ScoreChip, StageChip } from "@/components/status-chip";
import { StaleBanner } from "@/components/provenance-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ingestResume, rerankStaleApplications } from "@/lib/recruiting/api";
import { errorMessage, queryKeys, useRoleBatchesQuery, useRoleQuery } from "@/lib/recruiting/query";
import { cn, initials } from "@/shared/utils";

export const Route = createFileRoute("/app/roles/$roleId")({ component: RoleWorkspace });

function RoleWorkspace() {
  const { roleId } = Route.useParams();
  const { data, isPending, error } = useRoleQuery(roleId);
  const batchesQuery = useRoleBatchesQuery(roleId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [resumeText, setResumeText] = useState("");
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
        <div className="flex flex-wrap gap-2">
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
            >
              <Link2 className="size-4" />
              Share apply link
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => setExportOpen(true)}
            disabled={applications.length === 0}
          >
            <FileSpreadsheet className="size-4" />
            Export
          </Button>
          <Button variant="secondary" onClick={() => setBatchOpen(true)}>
            Drop resumes
          </Button>
          <Button onClick={() => setIngestOpen(true)}>Add one</Button>
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
                      {app.isStale && (
                        <span className="text-[10px] text-warn font-medium">⚠ stale</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div>{selected ? <CandidatePanel application={selected} roleId={role.id} /> : null}</div>
        </div>
      )}

      <Dialog open={ingestOpen} onOpenChange={setIngestOpen}>
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
            className="min-h-64 text-sm"
          />
          <div className="flex justify-end">
            <Button
              disabled={ingestMut.isPending || resumeText.trim().length < 40}
              onClick={() => ingestMut.mutate()}
            >
              {ingestMut.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <BatchIngestDialog open={batchOpen} onOpenChange={setBatchOpen} roleId={roleId} />
      <ExportSlateDialog open={exportOpen} onOpenChange={setExportOpen} roleId={roleId} />
    </div>
  );
}
