import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { ClientCardView } from "@/components/client-card-view";
import { EmptyState } from "@/shared/components/empty-state";
import { SendToClientDialog } from "@/components/send-to-client-dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { decideApproval } from "@/lib/recruiting/api";
import { errorMessage, queryKeys, useApprovalsQuery } from "@/lib/recruiting/query";
import type { Approval, ApprovalStatus } from "@/lib/recruiting/types";
import { formatRelative } from "@/shared/utils";

export const Route = createFileRoute("/app/approvals")({ component: ApprovalsPage });

function ApprovalsPage() {
  const { data, isPending } = useApprovalsQuery();
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  if (isPending) {
    return <Skeleton className="h-64 rounded-2xl" />;
  }

  const items = (data ?? []).filter((a) => (filter === "pending" ? a.status === "pending" : true));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Gate</p>
          <h1 className="font-display text-4xl tracking-tight">Human approval</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Client-facing copy cannot leave this queue without a stamp. Edit if needed, then approve
            — send produces a live link, not just a status.
          </p>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "pending" | "all")}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title={filter === "pending" ? "Queue is clear" : "No packs yet"}
          body="Prepare a client pack from a ranked candidate. It will wait here until you approve it."
        />
      ) : (
        <ul className="flex flex-col gap-6">
          {items.map((a) => (
            <li key={a.id}>
              <ApprovalItem approval={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalItem({ approval }: { approval: Approval }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(approval.reviewerNote);
  const [summary, setSummary] = useState(approval.payload.summary);
  const [sendOpen, setSendOpen] = useState(false);

  const mut = useMutation({
    mutationFn: (decision: ApprovalStatus) =>
      decideApproval({
        data: {
          approvalId: approval.id,
          decision: decision as "approved" | "rejected" | "sent",
          reviewerNote: note,
          payload: { ...approval.payload, summary },
        },
      }),
    onSuccess: (_, decision) => {
      void qc.invalidateQueries({ queryKey: queryKeys.approvals });
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
      void qc.invalidateQueries({ queryKey: queryKeys.role(approval.roleId) });
      toast.success(decision === "sent" ? "Released to client view" : `Marked ${decision}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const preview = { ...approval.payload, summary };

  return (
    <article className="grid gap-4 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)] lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-muted">
            {approval.companyName} · {approval.roleTitle} · {formatRelative(approval.createdAt)}
          </p>
          <h2 className="font-display text-2xl">{approval.title}</h2>
          <p className="mt-1 text-xs tracking-wide text-muted uppercase">{approval.status}</p>
        </div>
        {approval.status === "pending" ? (
          <>
            <label className="flex flex-col gap-2">
              <span className="text-xs text-muted">Edit summary before you stamp</span>
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="min-h-32"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs text-muted">Internal note</span>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-20"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={mut.isPending} onClick={() => mut.mutate("approved")}>
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={mut.isPending}
                onClick={() => mut.mutate("rejected")}
              >
                Reject
              </Button>
            </div>
          </>
        ) : approval.status === "approved" ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSendOpen(true)}>Send to client</Button>
            <p className="self-center text-xs text-muted">
              Creates a shareable page, PDF, and optional email.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              {approval.status === "sent" ? "Released." : "Rejected."} {approval.reviewerNote}
            </p>
            {approval.status === "sent" ? (
              <Button variant="secondary" size="sm" onClick={() => setSendOpen(true)}>
                Share link again
              </Button>
            ) : null}
          </div>
        )}
        <Link
          to="/app/roles/$roleId"
          params={{ roleId: approval.roleId }}
          className="text-sm text-muted hover:text-fg"
        >
          Open role
        </Link>
      </div>
      <ClientCardView card={preview} />
      <SendToClientDialog open={sendOpen} onOpenChange={setSendOpen} approval={approval} />
    </article>
  );
}
