import { createFileRoute, Link } from "@tanstack/react-router";
import { CandidatePortalShell } from "@/shared/components/candidate-portal-shell";
import { ScreenChat } from "@/features/recruiting/ui/screen-chat";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StageChip } from "@/shared/components/status-chip";
import { WORK_MODE_LABEL } from "@/features/recruiting/domain/constants";
import { useScreenTokenQuery } from "@/features/recruiting/api/query";

export const Route = createFileRoute("/screen/$token")({ component: ScreenByToken });

function ScreenByToken() {
  const { token } = Route.useParams();
  const { data, isPending, error } = useScreenTokenQuery(token);

  return (
    <CandidatePortalShell>
      {isPending ? (
        <div className="pt-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="mt-6 h-80 rounded-2xl" />
        </div>
      ) : error || !data ? (
        <p className="pt-10 text-sm text-danger">
          This screen link is invalid.{" "}
          <Link to="/jobs" className="underline">
            Browse open roles
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-8 pt-4 pb-[env(safe-area-inset-bottom)]">
          <header>
            <p className="text-xs text-muted">{data.role.companyName}</p>
            <h1 className="mt-2 font-display text-[clamp(1.8rem,5vw,2.8rem)] leading-[0.95] tracking-tight">
              {data.role.title}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {data.candidateName} · {data.email}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              <StageChip stage={data.role.companyStage} />
              <span>
                {data.role.location} · {WORK_MODE_LABEL[data.role.workMode]}
              </span>
            </div>
          </header>
          {data.stage === "received" ? (
            <div className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <p className="font-display text-2xl">The desk is still drafting your questions.</p>
              <p className="mt-2 text-sm text-muted">
                Refresh in a moment — this page updates when the screen is ready.
              </p>
              <div className="vetta-shimmer mt-6 h-1.5 rounded-full bg-elevated" />
            </div>
          ) : (
            <ScreenChat data={data} token={token} />
          )}
        </div>
      )}
    </CandidatePortalShell>
  );
}
