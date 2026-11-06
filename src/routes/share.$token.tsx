import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientCardView } from "@/components/client-card-view";
import { CandidatePortalShell } from "@/components/candidate-portal-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicShareQuery } from "@/lib/recruiting/query";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/share/$token")({ component: SharePage });

function SharePage() {
  const { token } = Route.useParams();
  const { data, isPending, error } = usePublicShareQuery(token);

  return (
    <CandidatePortalShell>
      {isPending ? (
        <div className="pt-8">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="mt-6 h-80 rounded-2xl" />
        </div>
      ) : error || !data ? (
        <p className="pt-10 text-sm text-danger">
          This client page is invalid.{" "}
          <Link to="/" className="underline">
            Back
          </Link>
        </p>
      ) : (
        <article className="flex flex-col gap-10 pt-6 print:pt-0">
          <header className="vetta-enter">
            <p className="text-xs tracking-[0.18em] text-muted uppercase">Client page · Vetta</p>
            <h1 className="mt-3 font-display text-[clamp(2rem,4.5vw,3.4rem)] leading-[0.95] tracking-tight">
              {data.companyName}
            </h1>
            <p className="mt-2 font-display text-2xl text-muted">{data.roleTitle}</p>
            <p className="mt-3 text-sm text-muted">
              {data.location} · {data.workMode} · {data.candidates.length} on the slate
            </p>
            {data.message ? (
              <p className="mt-5 max-w-2xl text-sm leading-relaxed">{data.message}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2 print:hidden">
              <Button type="button" onClick={() => window.print()}>
                Save PDF
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const md = [
                    `# ${data.companyName} · ${data.roleTitle}`,
                    "",
                    ...data.candidates.map(
                      (c, i) =>
                        `## ${i + 1}. ${c.candidateName}\n${c.card?.summary || c.rankSummary || ""}`,
                    ),
                  ].join("\n");
                  try {
                    await navigator.clipboard.writeText(md);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Copy Notion markdown
              </Button>
            </div>
          </header>

          <section>
            <h2 className="mb-3 font-display text-2xl">Ranked slate</h2>
            <div className="overflow-x-auto rounded-2xl bg-surface shadow-[var(--shadow-border)]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Candidate</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Fit</th>
                    <th className="px-4 py-3 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidates.map((c, i) => (
                    <tr key={c.applicationId} className="border-t border-border">
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-3">
                        <p>{c.candidateName}</p>
                        <p className="text-xs text-muted">{c.headline}</p>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">{c.rankScore ?? "—"}</td>
                      <td className="px-4 py-3">{c.fitLabel}</td>
                      <td className="px-4 py-3 text-muted">{c.location || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {data.candidates.map((c, i) => (
              <div key={c.applicationId} className={cn(i === 0 && "lg:col-span-2")}>
                {c.card ? (
                  <ClientCardView card={c.card} />
                ) : (
                  <article className="rounded-2xl bg-elevated p-6">
                    <h3 className="font-display text-2xl">{c.candidateName}</h3>
                    <p className="text-sm text-muted">{c.headline}</p>
                    <p className="mt-4 text-sm leading-relaxed">{c.rankSummary}</p>
                  </article>
                )}
              </div>
            ))}
          </section>

          <p className="text-xs text-subtle">
            Prepared in Vetta. A human stamped this before it left the desk.
          </p>
        </article>
      )}
    </CandidatePortalShell>
  );
}
