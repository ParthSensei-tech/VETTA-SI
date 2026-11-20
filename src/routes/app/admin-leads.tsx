import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Inbox, MailOpen, RefreshCw, Search, Sparkles } from "lucide-react";
import {
  LEAD_STATUSES,
  listLeads,
  markLeadStatus,
  type Lead,
  type LeadStatus,
  type TeaserLead,
} from "@/features/marketing/api/leads-api";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/utils";

export const Route = createFileRoute("/app/admin-leads")({ component: AdminLeads });

const STATUS_STYLE: Record<LeadStatus, string> = {
  new: "text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/5",
  contacted: "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5",
  demo_booked: "text-violet-600 dark:text-violet-400 border-violet-500/30 bg-violet-500/5",
  won: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  lost: "text-muted border-border",
};

function day(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function OptIn({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <MailOpen className="size-3.5" />
      yes
    </span>
  ) : (
    <span className="text-muted">no</span>
  );
}

function AdminLeads() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"demo" | "teaser">("demo");
  const [filter, setFilter] = useState("");

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ["leads"],
    queryFn: () => listLeads(),
  });

  const mut = useMutation({
    mutationFn: (input: { leadId: string; status: LeadStatus }) =>
      markLeadStatus({ data: input }),
    onSuccess: () => {
      toast.success("Lead updated");
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update lead"),
  });

  const all = data?.leads ?? [];
  const allTeasers = data?.teasers ?? [];
  const query = filter.trim().toLowerCase();
  const matches = (fields: string[]) =>
    !query || fields.some((field) => field.toLowerCase().includes(query));

  const leads = all.filter((l) =>
    matches([l.email, l.name, l.company, l.status.replaceAll("_", " ")]),
  );
  const teasers = allTeasers.filter((t) => matches([t.email, t.name, t.company, t.roleTitle]));

  const funnel = data?.funnel;
  const open = all.filter((l) => l.status === "new" || l.status === "contacted");
  const optedIn = all.filter((l) => l.marketingOptIn).length;
  const teaserOptedIn = allTeasers.filter((t) => t.marketingOptIn).length;

  const stats =
    tab === "demo"
      ? [
          { label: "Workspaces", value: funnel?.orgs },
          { label: "Profiles completed", value: funnel?.signupProfile },
          { label: "First role opened", value: funnel?.firstRoleCreated },
          { label: "First shortlist seen", value: funnel?.firstShortlistViewed },
        ]
      : [
          { label: "Shortlist unlocks", value: funnel?.teaserShortlists },
          { label: "JD audits", value: funnel?.teaserJdAudits },
          { label: "Marketing opt-ins", value: teaserOptedIn },
          { label: "Workspaces", value: funnel?.orgs },
        ];

  const count = tab === "demo" ? all.length : allTeasers.length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Leads</p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">Who is trying to buy Vetta</h1>
          <p className="mt-1 text-sm text-muted">
            Every number here was written by product code — signup, first role, first shortlist.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted hover:text-fg cursor-pointer"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="inline-flex rounded-lg border border-border bg-surface p-1">
        {(
          [
            { key: "demo", label: "Demo requests", count: all.length },
            { key: "teaser", label: "Teaser unlocks", count: allTeasers.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer",
              tab === t.key ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
            )}
          >
            {t.key === "teaser" && <Sparkles className="size-3.5" />}
            {t.label}
            <span className={cn("tabular-nums", tab === t.key ? "opacity-70" : "text-muted/70")}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-2xl font-display tracking-tight">
              {isPending ? <Skeleton className="h-7 w-10" /> : (s.value ?? 0)}
            </div>
            <div className="mt-1 text-xs text-muted">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted" />
          <Input
            placeholder="Filter name, company, email…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 pl-8 text-xs"
          />
        </div>
        <p className="text-xs text-muted">
          {tab === "demo"
            ? `${optedIn} marketing opt-in${optedIn === 1 ? "" : "s"} · ${open.length} still open`
            : `${funnel?.teaserShortlists ?? 0} shortlist${funnel?.teaserShortlists === 1 ? "" : "s"} and ${
                funnel?.teaserJdAudits ?? 0
              } JD audit${funnel?.teaserJdAudits === 1 ? "" : "s"} handed over — the free half of the funnel`}
        </p>
      </div>

      {isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : tab === "teaser" ? (
        <TeaserTable teasers={teasers} total={count} />
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface py-14 text-center">
          <Inbox className="mx-auto size-8 text-muted" />
          <p className="mt-2 text-sm font-medium">No leads yet</p>
          <p className="mt-1 text-xs text-muted">
            They arrive from the demo form on the landing page and from /pricing.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted font-medium">
                <th className="py-2.5 px-3">Company</th>
                <th className="py-2.5 px-3">Contact</th>
                <th className="py-2.5 px-3">Opt-in</th>
                <th className="py-2.5 px-3">Received</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {leads.map((lead) => (
                <LeadRow key={lead.id} lead={lead} pending={mut.isPending} onStatus={(s) =>
                  mut.mutate({ leadId: lead.id, status: s })
                } />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Teaser leads have no status column, and that is the point: the ask was already
 * answered on the page, so this list is a queue to work, not a pipeline to
 * triage. The row links to the same teaser the founder saw, so the follow-up can
 * open with what we actually proved to them.
 */
function TeaserTable({ teasers, total }: { teasers: TeaserLead[]; total: number }) {
  if (teasers.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface py-14 text-center">
        <Sparkles className="mx-auto size-8 text-muted" />
        <p className="mt-2 text-sm font-medium">
          {total === 0 ? "No unlocks yet" : "Nothing matches that filter"}
        </p>
        <p className="mt-1 text-xs text-muted">
          {total === 0
            ? "Send /teaser to a founder with a live role — the shortlist on it is real, and so is the mask."
            : "Clear the filter to see the rest."}
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-muted font-medium">
            <th className="py-2.5 px-3">Founder</th>
            <th className="py-2.5 px-3">Contact</th>
            <th className="py-2.5 px-3">Asked for</th>
            <th className="py-2.5 px-3">Opt-in</th>
            <th className="py-2.5 px-3 text-right">Received</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {teasers.map((lead) => (
            <tr key={lead.id} className="hover:bg-surface/60">
              <td className="py-2.5 px-3">
                <div className="font-medium text-fg">{lead.company || "—"}</div>
                <div className="text-muted">{lead.name || "no name given"}</div>
              </td>
              <td className="py-2.5 px-3 text-muted">{lead.email}</td>
              <td className="py-2.5 px-3">
                {lead.roleId ? (
                  <Link
                    to="/teaser"
                    search={{ role: lead.roleId, email: "", tab: "live" }}
                    className="text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
                  >
                    {lead.roleTitle}
                  </Link>
                ) : (
                  <span className="text-muted">{lead.roleTitle}</span>
                )}
              </td>
              <td className="py-2.5 px-3">
                <OptIn value={lead.marketingOptIn} />
              </td>
              <td className="py-2.5 px-3 text-right text-muted">{day(lead.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeadRow({
  lead,
  pending,
  onStatus,
}: {
  lead: Lead;
  pending: boolean;
  onStatus: (s: LeadStatus) => void;
}) {
  return (
    <tr className="hover:bg-surface/60">
      <td className="py-2.5 px-3">
        <div className="font-medium text-fg">{lead.company || "—"}</div>
        <div className="text-muted">{lead.name || "no name given"}</div>
      </td>
      <td className="py-2.5 px-3 text-muted">{lead.email}</td>
      <td className="py-2.5 px-3">
        <OptIn value={lead.marketingOptIn} />
      </td>
      <td className="py-2.5 px-3 text-muted">{day(lead.createdAt)}</td>
      <td className="py-2.5 px-3 text-right">
        <select
          value={lead.status}
          disabled={pending}
          onChange={(e) => onStatus(e.target.value as LeadStatus)}
          className={cn(
            "h-7 cursor-pointer rounded-full border bg-transparent px-2 text-[11px] font-medium",
            STATUS_STYLE[lead.status],
          )}
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s} className="bg-bg text-fg">
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
