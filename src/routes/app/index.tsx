import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NightQueue } from "@/components/night-queue";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StageChip } from "@/components/status-chip";
import { formatRelative } from "@/lib/utils";
import { useAllBatchesQuery, useWorkspaceQuery } from "@/lib/recruiting/query";

export const Route = createFileRoute("/app/")({ component: Desk });

function Desk() {
  const { data, isPending, error } = useWorkspaceQuery();
  const batchesQuery = useAllBatchesQuery();

  if (isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-sm text-danger">Could not load your desk.</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Desk</p>
          <h1 className="font-display text-4xl tracking-tight">Your roles</h1>
          <p className="mt-2 max-w-lg text-sm text-muted">
            Add a role, drop resumes. Ranking and shortlist prep run in the background. You only
            review and approve what goes to the client.
          </p>
          <p className="mt-2 max-w-lg text-xs text-muted">
            {data.domainModel.ready
              ? `India hiring model is on · ${data.domainModel.docs} documents learned · ${data.domainModel.metrics} live market figures${data.domainModel.rankSteps ? ` · ${data.domainModel.rankSteps} of your decisions` : ""}`
              : "India hiring model is learning from the resumes and roles you add, plus public hiring reports. Scores use it once it has seen enough."}
          </p>
        </div>
        <Button asChild>
          <Link to="/app/roles/new">
            <Plus className="size-4" />
            New role
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open roles" value={data.stats.openRoles} />
        <Stat label="People ranked" value={data.stats.rankedCandidates} />
        <Stat
          label="Waiting for you"
          value={data.stats.awaitingApproval}
          warn={data.stats.awaitingApproval > 0}
        />
        <Stat label="Sent this week" value={data.stats.sentThisWeek} />
      </section>

      {batchesQuery.data && batchesQuery.data.length > 0 ? (
        <NightQueue batches={batchesQuery.data} showRoleLink />
      ) : null}

      {data.pendingApprovals.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-2xl">Needs your eye</h2>
            <Link to="/app/approvals" className="text-sm text-muted hover:text-fg">
              See all
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {data.pendingApprovals.slice(0, 4).map((a) => (
              <li key={a.id}>
                <Link
                  to="/app/approvals"
                  className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{a.candidateName}</p>
                    <p className="truncate text-xs text-muted">
                      {a.roleTitle} · {a.companyName}
                    </p>
                  </div>
                  <span className="text-xs text-warn">Review</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-2xl">Roles</h2>
        {data.roles.length === 0 ? (
          <EmptyState
            title="Start with one role"
            body="Create a role with the real job. Then drop resumes — Vetta ranks them quietly in the background."
            action={
              <Button asChild>
                <Link to="/app/roles/new">Create role</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {data.roles.map((role) => (
              <li key={role.id}>
                <Link
                  to="/app/roles/$roleId"
                  params={{ roleId: role.id }}
                  className="flex h-full flex-col gap-3 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)] transition-shadow duration-150 hover:shadow-[var(--shadow-border-hover)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted">{role.companyName}</p>
                      <h3 className="font-display text-xl leading-tight">{role.title}</h3>
                    </div>
                    <StageChip stage={role.companyStage} />
                  </div>
                  <p className="text-sm text-muted">
                    {role.location} · {role.workMode}
                  </p>
                  <div className="mt-auto flex items-center justify-between text-xs text-subtle">
                    <span>
                      {role.candidateCount} people
                      {role.shortlistCount ? ` · ${role.shortlistCount} shortlisted` : ""}
                      {role.pendingApprovals ? ` · ${role.pendingApprovals} to review` : ""}
                    </span>
                    <ArrowRight className="size-4" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.recentActivity.length > 0 ? (
        <section>
          <h2 className="mb-3 font-display text-2xl">Recent</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {data.recentActivity.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-muted">
                <span className="truncate">
                  {friendlyAction(e.action)}
                  {e.meta.name ? ` · ${String(e.meta.name)}` : ""}
                  {e.meta.title ? ` · ${String(e.meta.title)}` : ""}
                </span>
                <span className="shrink-0 text-xs text-subtle">{formatRelative(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function friendlyAction(action: string): string {
  const map: Record<string, string> = {
    ranked: "Ranked",
    ingested: "Received",
    deepen_top: "Refined shortlist",
    status: "Updated",
    approved: "Approved",
    sent: "Sent to client",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-3xl tabular-nums ${warn ? "text-warn" : "text-fg"}`}>
        {value}
      </p>
    </div>
  );
}
