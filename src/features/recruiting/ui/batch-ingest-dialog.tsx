import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { FileArchive, FileSpreadsheet, FileText, Upload } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { appendIngestItems, createIngestBatch } from "@/features/ingest/api/batch";
import { MAX_ITEMS, chunkItems, prepareBatchFiles, sourceLabel } from "@/features/ingest/domain/batch-client";
import { errorMessage, queryKeys } from "@/features/recruiting/api/query";
import { AntiScrapingPolicyLink } from "@/features/compliance/ui/legal-terms-dialog";
import { cn } from "@/shared/utils";

const ACCEPT = ".pdf,.docx,.txt,.md,.zip,.csv,.xlsx";

export function BatchIngestDialog({
  open,
  onOpenChange,
  roleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId: string;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "uploading">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sourcingConfirmed, setSourcingConfirmed] = useState(false);

  const busy = phase !== "idle";

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const next = Array.from(list);
    setFiles((prev) => {
      const names = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of next) {
        const key = `${f.name}:${f.size}`;
        if (!names.has(key)) merged.push(f);
      }
      return merged;
    });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const enqueueMut = useMutation({
    mutationFn: async () => {
      if (files.length === 0) throw new Error("Choose files first");
      setPhase("preparing");
      const prepared = await prepareBatchFiles(files);
      if (prepared.items.length === 0) {
        throw new Error(prepared.skipped[0] || "No readable resumes in that drop");
      }
      const batch = await createIngestBatch({
        data: { roleId, sourceName: sourceLabel(files, prepared.items.length) },
      });
      setPhase("uploading");
      const chunks = chunkItems(prepared.items, 4);
      setProgress({ done: 0, total: prepared.items.length });
      let added = 0;
      const parseErrors: string[] = [];
      for (const chunk of chunks) {
        const result = await appendIngestItems({
          data: {
            batchId: batch.id,
            // A real file, so the document store may be consulted for it. This is
            // an intent signal, not a permission: the workspace's own retention
            // setting is read server-side, and an org that has not turned it on
            // keeps nothing no matter what this call says.
            captureBytes: true,
            items: chunk.map((item) => ({
              filename: item.filename,
              contentBase64: item.contentBase64,
            })),
          },
        });
        added += result.added;
        parseErrors.push(...result.errors);
        setProgress({
          done: Math.min(prepared.items.length, added + parseErrors.length),
          total: prepared.items.length,
        });
      }
      return { added, skipped: prepared.skipped, parseErrors, total: prepared.items.length };
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: queryKeys.batches(roleId) });
      void qc.invalidateQueries({ queryKey: queryKeys.allBatches });
      void qc.invalidateQueries({ queryKey: queryKeys.role(roleId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
      setFiles([]);
      setPhase("idle");
      onOpenChange(false);
      const extra = [...result.skipped, ...result.parseErrors].slice(0, 3);
      toast.success(`Queued ${result.added} resume${result.added === 1 ? "" : "s"}`, {
        description:
          extra.length > 0
            ? extra.join(" · ")
            : "Ranking runs in the background. Leave it overnight if the drop is large.",
      });
    },
    onError: (e) => {
      setPhase("idle");
      toast.error(errorMessage(e));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Drop resumes</DialogTitle>
          <DialogDescription>
            PDF, Word, zip, or a spreadsheet. We sort them in the background — you review when
            ready.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors duration-150",
            dragging ? "border-accent bg-elevated" : "border-border bg-bg/40 hover:bg-elevated/60",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <Upload className="size-5 text-muted" />
          <p className="text-sm">Drop a zip, CSV, Excel, or resume files</p>
          <p className="text-xs text-subtle">
            PDF · DOCX · TXT · ZIP · CSV · XLSX · up to {MAX_ITEMS} per drop
          </p>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />

        {files.length > 0 ? (
          <ul className="flex max-h-40 flex-col gap-1 overflow-auto text-sm">
            {files.map((file) => (
              <li key={`${file.name}:${file.size}`} className="flex items-center gap-2 text-muted">
                <FileGlyph name={file.name} />
                <span className="min-w-0 flex-1 truncate text-fg">{file.name}</span>
                <span className="font-mono text-xs text-subtle">{sizeLabel(file.size)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {busy ? (
          <p className="text-sm text-muted">
            {phase === "preparing"
              ? "Unpacking files…"
              : `Parsing ${progress.done} / ${progress.total}`}
          </p>
        ) : null}

        {files.length > 0 && !busy && (
          <div className="rounded-xl border border-border/70 bg-surface/40 p-3 text-xs text-muted">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border text-primary cursor-pointer"
                checked={sourcingConfirmed}
                onChange={(e) => setSourcingConfirmed(e.target.checked)}
              />
              <span className="leading-relaxed">
                I certify these {files.length} candidate files were lawfully gathered via direct applications, client mandates, or verified agency agreements per our{" "}
                <AntiScrapingPolicyLink className="font-semibold text-blue-600 dark:text-blue-400" /> (DPDP Act 2023 anti-mass scraping standard).
              </span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {files.length > 0 && !busy ? (
            <button
              type="button"
              className="text-sm text-muted hover:text-fg cursor-pointer"
              onClick={() => {
                setFiles([]);
                setSourcingConfirmed(false);
              }}
            >
              Clear
            </button>
          ) : (
            <span />
          )}
          <Button
            disabled={busy || files.length === 0 || !sourcingConfirmed}
            onClick={() => enqueueMut.mutate()}
            className="cursor-pointer"
          >
            {busy ? "Queuing…" : "Parse and queue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FileGlyph({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) return <FileArchive className="size-4 shrink-0" />;
  if (lower.endsWith(".csv") || lower.endsWith(".xlsx"))
    return <FileSpreadsheet className="size-4 shrink-0" />;
  return <FileText className="size-4 shrink-0" />;
}

function sizeLabel(size: number): string {
  if (size > 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
