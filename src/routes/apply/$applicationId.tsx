import { createFileRoute, Link } from "@tanstack/react-router";
import { CandidatePortalShell } from "@/components/candidate-portal-shell";
import { ScreenChat } from "@/components/screen-chat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StageChip } from "@/components/status-chip";
import { WORK_MODE_LABEL } from "@/lib/recruiting/constants";
import { usePortalApplicationQuery } from "@/lib/recruiting/query";
import type { PortalApplication } from "@/lib/recruiting/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/apply/$applicationId")({ component: PortalApplicationPage });

function PortalApplicationPage() {
  const { applicationId } = Route.useParams();
  const { data, isPending, error } = usePortalApplicationQuery(applicationId);

  return (
    <CandidatePortalShell>
      {isPending ? (
        <div className="pt-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="mt-6 h-72 rounded-2xl" />
        </div>
      ) : error || !data ? (
        <p className="pt-10 text-sm text-danger">
          We could not find that application.{" "}
          <Link to="/jobs" className="underline">
            Browse open roles
          </Link>
        </p>
      ) : (
        <ApplicationView data={data} />
      )}
    </CandidatePortalShell>
  );
}

function ApplicationView({ data }: { data: PortalApplication }) {
  const steps = [
    { id: "received", label: "Received" },
    { id: "screening", label: "Written screen" },
    { id: "complete", label: "Under review" },
  ] as const;
  const active = steps.findIndex((s) => s.id === data.stage);

  return (
    <div className="flex flex-col gap-8 pt-6 pb-[env(safe-area-inset-bottom)]">
      <header className="vetta-enter">
        <p className="text-xs text-muted">
          <Link to="/jobs" className="hover:text-fg">
            Open roles
          </Link>
          <span className="mx-2 text-subtle">/</span>
          {data.role.companyName}
        </p>
        <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3.2rem)] leading-[0.95] tracking-tight">
          {data.stage === "complete" ? "You’re in review." : data.role.title}
        </h1>
        <p className="mt-3 text-sm text-muted">
          {data.candidateName} · {data.email}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <StageChip stage={data.role.companyStage} />
          <span>
            {data.role.location} · {WORK_MODE_LABEL[data.role.workMode]}
          </span>
        </div>
      </header>

      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={cn(
              "rounded-xl px-4 py-3 text-sm",
              i <= active ? "bg-elevated text-fg" : "bg-surface text-subtle",
            )}
          >
            <span className="font-mono text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <p className="mt-1">{step.label}</p>
          </li>
        ))}
      </ol>

      {data.stage === "received" ? (
        <div className="rounded-2xl bg-surface p-6 shadow-[var(--shadow-border)]">
          <p className="font-display text-2xl">The desk is reading you.</p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
            Vetta is ranking the resume against this JD. Your written screen will appear here as a conversation —
            usually under a minute. We’ll remind you by email or WhatsApp if it sits.
          </p>
          <div className="vetta-shimmer mt-6 h-1.5 rounded-full bg-elevated" />
        </div>
      ) : null}

      {data.stage === "screening" && data.questions && data.questions.length > 0 ? <ScreenChat data={data} /> : null}

      {data.stage === "complete" ? (
        <div className="flex flex-col gap-6">
          {data.transcript.length > 0 ? <ScreenChat data={data} /> : (
            <div className="rounded-2xl bg-surface p-6 shadow-[var(--shadow-border)]">
              <p className="font-display text-2xl">Submitted. A human still owns the next step.</p>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
                Your resume is ranked, the written screen is in evaluation, and a client pack — if the desk drafts one —
                waits in the recruiter’s approval queue.
              </p>
            </div>
          )}
          <Button asChild variant="secondary">
            <Link to="/jobs">Browse other roles</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
