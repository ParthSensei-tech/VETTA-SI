import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSearch, ShieldAlert } from "lucide-react";
import {
  setDocumentStoreRetention,
} from "@/features/verification/api/verification-api";
import { useDocumentStoreQuery, verificationQueryKeys } from "@/features/verification/api/query";
import { MAX_RETENTION_DAYS } from "@/features/verification/domain/documents";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";

/**
 * The workspace's decision about holding other people's files.
 *
 * Tier A checks run on extracted text, so a recruiter who never opens this panel
 * still gets a verdict — what they cannot get is a check on the *file*: whether it
 * was saved over an older version, whether the tool that wrote it existed in the
 * month the document claims, whether the certificate is somebody else's page
 * reprinted. Those need bytes, and bytes are the one thing a hiring product should
 * not keep quietly.
 *
 * So this is a privacy control, not a feature toggle, and it says so in the order
 * the sentences come: what is kept, for how long, what is never kept at all, and
 * what the verdict still reads after the file is gone. Turning it off is a purge
 * in the same click, because a switch that only stops the *next* upload is not
 * what "stop keeping our resumes" means.
 *
 * Nothing here changes a score or re-runs a check, and the counts come from the
 * server's view of this org rather than anything the browser remembers.
 */
export function DocumentStorePanel() {
  const query = useDocumentStoreQuery();
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: (byteRetention: boolean) =>
      setDocumentStoreRetention({ data: { byteRetention } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: verificationQueryKeys.store });
    },
  });

  if (query.isPending) return <Skeleton className="h-24 rounded-2xl" />;
  if (query.isError || !query.data) {
    // Silent, on purpose: the slate still ranks, still chips, still shortlists
    // with the store unreadable. Telling the recruiter that the shelf could not
    // be read is honest, but an error banner where nothing is broken is its own
    // kind of noise, and the panel comes back on the next render.
    return null;
  }

  const store = query.data;
  const held = store.counts.stored;
  const refused = store.counts.refused;
  const purged = store.counts.purged;

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-elevated">
          <FileSearch className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Document forensics</h3>
          <p className="mt-1 text-xs text-muted">
            {store.byteRetention
              ? `Originals are kept for up to ${store.retentionDays} days so byte-level checks can re-read them. The file is deleted on the clock; the checks it explained stay readable.`
              : `Byte-level checks cannot run: this workspace keeps the text it parsed, not the file it came from.`}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
            <ShieldAlert className="size-3.5 shrink-0" />
            Identity documents — Aadhaar, PAN, passport, licence — are never stored, even here, and
            never hashed.
          </p>
          {held + purged + refused > 0 ? (
            <p className="mt-2 text-[11px] text-muted">
              {held} file{held === 1 ? "" : "s"} held
              {purged ? ` · ${purged} purged on the clock` : ""}
              {refused ? ` · ${refused} identity document${refused === 1 ? "" : "s"} refused` : ""}
              {held > 0 ? ` · ${formatBytes(store.bytesHeld)} on disk` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mut.isPending ? (
            <Button variant="secondary" size="sm" disabled>
              {store.byteRetention ? "Deleting…" : "Turning on…"}
            </Button>
          ) : store.byteRetention ? (
            <Button variant="secondary" size="sm" onClick={() => mut.mutate(false)}>
              Stop and delete held files
            </Button>
          ) : (
            <Button size="sm" onClick={() => mut.mutate(true)}>
              Keep originals for {MAX_RETENTION_DAYS} days
            </Button>
          )}
        </div>
      </div>
      {mut.isError ? (
        <p className="mt-2 text-xs text-danger">
          {(mut.error as Error).message || "That did not save. Try again."}
        </p>
      ) : null}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const mb = bytes / 1_048_576;
  if (mb >= 1) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}
