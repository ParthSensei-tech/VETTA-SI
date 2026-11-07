import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { EmptyState } from "@/shared/components/empty-state";
import { PipelineChip, ScoreChip } from "@/shared/components/status-chip";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useTalentQuery } from "@/features/recruiting/api/query";
import { initials } from "@/shared/utils";

export const Route = createFileRoute("/app/talent")({ component: TalentPage });

function TalentPage() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [notice, setNotice] = useState("");
  const [ctc, setCtc] = useState("");
  const [filters, setFilters] = useState({
    q: "",
    location: "",
    noticeMaxDays: null as number | null,
    ctcMaxLakh: null as number | null,
  });

  useEffect(() => {
    const t = setTimeout(() => {
      const noticeMaxDays = notice.trim() ? Number(notice) : null;
      const ctcMaxLakh = ctc.trim() ? Number(ctc) : null;
      setFilters({
        q: q.trim(),
        location: location.trim(),
        noticeMaxDays:
          noticeMaxDays != null && Number.isFinite(noticeMaxDays) ? noticeMaxDays : null,
        ctcMaxLakh: ctcMaxLakh != null && Number.isFinite(ctcMaxLakh) ? ctcMaxLakh : null,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q, location, notice, ctc]);

  const { data, isPending, isFetching } = useTalentQuery(filters);
  const rows = data?.rows ?? [];

  if (isPending) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Pool</p>
          <h1 className="font-display text-4xl tracking-tight">Talent</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {data?.mode === "fts+e5"
              ? "Matching words first, then meaning across English and Hindi."
              : "Matching words in the resume. Meaning search turns on once the language model is ready."}
            {isFetching ? " Updating…" : ""}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Words or meaning, English or Hindi"
          />
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City"
          />
          <Input
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder="Notice max (days)"
            inputMode="numeric"
          />
          <Input
            value={ctc}
            onChange={(e) => setCtc(e.target.value)}
            placeholder="CTC max (LPA)"
            inputMode="decimal"
          />
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No people yet"
          body="Candidates appear here after you ingest a resume against a role. Nothing is preloaded."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.candidate.id}
              className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] sm:flex-row sm:items-center"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-elevated text-xs">
                {initials(row.candidate.fullName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.candidate.fullName}</p>
                <p className="truncate text-xs text-muted">
                  {[
                    row.candidate.currentTitle,
                    row.candidate.currentCompany,
                    row.candidate.location,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.applications.map((a) => (
                  <Link
                    key={a.id}
                    to="/app/roles/$roleId"
                    params={{ roleId: a.roleId }}
                    className="inline-flex items-center gap-2 rounded-full bg-elevated px-3 py-1"
                  >
                    <span className="text-xs">{a.roleTitle}</span>
                    <ScoreChip score={a.rankScore} />
                    <PipelineChip status={a.pipelineStatus} />
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
