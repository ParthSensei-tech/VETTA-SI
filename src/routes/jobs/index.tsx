import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MapPin } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StageChip } from "@/components/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { EMPLOYMENT_LABEL, STAGE_LABEL, WORK_MODE_LABEL } from "@/lib/recruiting/constants";
import { useOpenJobsQuery } from "@/lib/recruiting/query";
import { formatRelative } from "@/shared/utils";

export const Route = createFileRoute("/jobs/")({ component: JobsIndex });

function JobsIndex() {
  const { data, isPending, error } = useOpenJobsQuery();

  return (
    <div className="flex flex-col gap-10 pt-6">
      <header className="vetta-enter max-w-2xl">
        <p className="text-xs tracking-[0.22em] text-muted uppercase">Candidate portal</p>
        <h1 className="mt-3 font-display text-[clamp(2.4rem,5vw,4.4rem)] leading-[0.95] tracking-tight">
          Apply once.
          <br />
          Get ranked against the seat.
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
          Open roles from Vetta recruiters. Upload a resume, add your details, and the desk starts
          parsing, ranking, and drafting a written screen — nothing is client-facing until a human
          stamps it.
        </p>
      </header>

      {isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-danger">Could not load open roles. Try again in a moment.</p>
      ) : !data?.length ? (
        <EmptyState
          title="No open roles yet"
          body="When a recruiter posts a seat in Vetta, it appears here. Check back, or ask the hiring team for their apply link."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.map((job, i) => (
            <li
              key={job.id}
              className="vetta-enter"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <Link
                to="/jobs/$roleId"
                params={{ roleId: job.id }}
                className="flex h-full flex-col gap-4 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)] transition-shadow duration-150 hover:shadow-[var(--shadow-border-hover)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted">{job.companyName}</p>
                    <h2 className="mt-1 font-display text-2xl leading-tight tracking-tight">
                      {job.title}
                    </h2>
                  </div>
                  <StageChip stage={job.companyStage} />
                </div>
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <MapPin className="size-3.5 shrink-0" />
                  {job.location || "Location flexible"} · {WORK_MODE_LABEL[job.workMode]} ·{" "}
                  {EMPLOYMENT_LABEL[job.employmentType]}
                </p>
                {job.stack.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {job.stack.slice(0, 5).map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-elevated px-2.5 py-1 text-xs text-muted"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-auto flex items-center justify-between text-xs text-subtle">
                  <span>
                    {STAGE_LABEL[job.companyStage]}
                    {job.compensationBand ? ` · ${job.compensationBand}` : ""}
                    {job.postedAt ? ` · ${formatRelative(job.postedAt)}` : ""}
                  </span>
                  <span className="inline-flex items-center gap-1 text-fg">
                    Apply
                    <ArrowRight className="size-3.5" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
