import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import { cancelIngestBatch, getIngestBatch, tickMyQueue } from "@/lib/recruiting/batch";
import { errorMessage, queryKeys } from "@/lib/recruiting/query";
import type { IngestBatch, IngestJobStatus } from "@/lib/recruiting/types";
import { cn } from "@/shared/utils";

function isActive(status: IngestBatch["status"]) {
  return status === "queued" || status === "running";
}

function pct(batch: IngestBatch): number {
  if (batch.totalCount <= 0) return 0;
  const done = batch.rankedCount + batch.failedCount;
  return Math.round((done / batch.totalCount) * 100);
}

function statusCopy(batch: IngestBatch): string {
  if (batch.status === "queued") return "Starting soon";
  if (batch.status === "running") {
    const remaining = Math.max(0, batch.totalCount - batch.rankedCount - batch.failedCount);
    return remaining > 0 ? `Working through ${remaining} more` : "Finishing up";
  }
  if (batch.status === "cancelled") return "Stopped";
  if (batch.status === "failed") return "Could not read files";
  return "Ready to review";
}

export function NightQueue({
  batches,
  roleId,
  showRoleLink = false,
}: {
  batches: IngestBatch[];
  roleId?: string;
  showRoleLink?: boolean;
}) {
  const qc = useQueryClient();
  const active = batches.filter((b) => isActive(b.status));
  const recent = batches.slice(0, 4);
  const focus = active[0] ?? recent[0] ?? null;

  const detail = useQuery({
    queryKey: ["ingest-batch", focus?.id],
    queryFn: () => getIngestBatch({ data: { batchId: focus!.id } }),
    enabled: Boolean(focus?.id),
    refetchInterval: focus && isActive(focus.status) ? 1500 : false,
  });

  useEffect(() => {
    if (active.length === 0) return;
    let cancelled = false;
    const pulse = async () => {
      try {
        await tickMyQueue();
        if (cancelled) return;
        if (roleId) {
          void qc.invalidateQueries({ queryKey: queryKeys.role(roleId) });
          void qc.invalidateQueries({ queryKey: queryKeys.batches(roleId) });
        }
        void qc.invalidateQueries({ queryKey: queryKeys.allBatches });
        void qc.invalidateQueries({ queryKey: queryKeys.workspace });
        void qc.invalidateQueries({ queryKey: queryKeys.talent });
      } catch {
        /* queue tick is best-effort */
      }
    };
    void pulse();
    const timer = window.setInterval(() => void pulse(), 2800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active.length, qc, roleId]);

  const cancelMut = useMutation({
    mutationFn: (batchId: string) => cancelIngestBatch({ data: { batchId } }),
    onSuccess: () => {
      toast.message("Stopped queued files. Anything already ranking will finish.");
      void qc.invalidateQueries({ queryKey: queryKeys.allBatches });
      if (roleId) void qc.invalidateQueries({ queryKey: queryKeys.batches(roleId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (recent.length === 0) return null;

  const jobs = detail.data?.jobs ?? [];

  return (
    <section className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted uppercase">In progress</p>
          <h2 className="mt-1 font-display text-2xl tracking-tight">
            {active.length > 0 ? "Sorting resumes for you" : "Latest drop"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Drop a zip at 11pm. The queue keeps ranking while you sleep.
          </p>
        </div>
        {focus && isActive(focus.status) ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={cancelMut.isPending}
            onClick={() => cancelMut.mutate(focus.id)}
          >
            Cancel rest
          </Button>
        ) : null}
      </div>

      <ul className="mt-5 flex flex-col gap-4">
        {recent.map((batch) => (
          <li key={batch.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate">{batch.sourceName || "Batch drop"}</p>
                <p className="text-xs text-muted">
                  {showRoleLink ? (
                    <Link
                      to="/app/roles/$roleId"
                      params={{ roleId: batch.roleId }}
                      className="hover:text-fg"
                    >
                      {batch.roleTitle} · {batch.companyName}
                    </Link>
                  ) : (
                    statusCopy(batch)
                  )}
                  {showRoleLink ? ` · ${statusCopy(batch)}` : null}
                </p>
              </div>
              <p className="font-mono text-xs tabular-nums text-subtle">
                {batch.rankedCount}/{batch.totalCount} ranked
                {batch.failedCount ? ` · ${batch.failedCount} failed` : ""}
              </p>
            </div>
            <Progress value={pct(batch)} />
          </li>
        ))}
      </ul>

      {jobs.length > 0 ? (
        <ul className="mt-4 max-h-48 overflow-auto rounded-xl bg-bg/50 px-3 py-2">
          {jobs.slice(0, 40).map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
              <span className="min-w-0 truncate text-muted">{job.filename}</span>
              <span className={cn("shrink-0 font-mono tabular-nums", jobTone(job.status))}>
                {jobLabel(job.status, job.rankScore, job.error)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function jobLabel(status: IngestJobStatus, score: number | null, error: string): string {
  if (status === "ranking") return "Ranking";
  if (status === "queued") return "Queued";
  if (status === "failed") return error ? `Failed` : "Failed";
  if (score != null) return String(score);
  return "Done";
}

function jobTone(status: IngestJobStatus): string {
  if (status === "failed") return "text-danger";
  if (status === "ranking") return "text-warn";
  if (status === "completed") return "text-success";
  return "text-subtle";
}
