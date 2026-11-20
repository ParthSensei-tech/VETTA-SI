import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Layers,
  Percent,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Badge } from "@/shared/components/ui/badge";
import { MobileActionBar } from "@/shared/components/action-bar";
import { getAgencyMetricsOverview } from "@/features/analytics/api/agency-metrics-api";
import { cn } from "@/shared/utils";

export const Route = createFileRoute("/app/agency-metrics")({
  component: AgencyMetricsPage,
});

function AgencyMetricsPage() {
  const { data, isPending, error, refetch, isRefetching } = useQuery({
    queryKey: ["agency-metrics-overview"],
    queryFn: () => getAgencyMetricsOverview(),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-surface p-6 text-danger">
        Failed to load agency operational metrics.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10 pb-16">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs tracking-[0.18em] text-muted uppercase">The YC Model · Service-as-Software</p>
            <span className="rounded-full bg-lime-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-lime-400 border border-lime-500/30">
              India 2027 Calibrated
            </span>
          </div>
          <h1 className="mt-1 font-display text-4xl tracking-tight text-fg">Agency Performance & Auto-Tuning</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Live telemetry measuring operational leverage, client taste calibration, and unit economics
            against traditional staffing agency benchmarks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={isRefetching}
            onClick={() => refetch()}
            className="gap-1.5 text-xs text-muted hover:text-fg"
          >
            <RefreshCw className={cn("size-3.5", isRefetching && "animate-spin")} />
            <span>{isRefetching ? "Refreshing…" : "Sync Live Events"}</span>
          </Button>
          <Button asChild size="default" className="soft-lime font-semibold">
            <Link to="/app/roles/new">Add New Role</Link>
          </Button>
        </div>
      </header>

      {/* Top Strip: Financial Software Leverage */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="flex flex-col justify-between rounded-2xl border border-lime-400/30 bg-gradient-to-br from-lime-950/25 via-surface to-surface p-5 shadow-[0_4px_20px_-4px_rgba(198,244,50,0.15)]">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Gross Margin</span>
            <Coins className="size-4 text-lime-400" />
          </div>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-lime-400">
            {data.financials.grossMarginPct}%
          </p>
          <p className="mt-1 text-[11px] text-muted">Software economics (vs 30% legacy agency)</p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-5">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Avg Placement Fee</span>
            <TrendingUp className="size-4 text-accent" />
          </div>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-fg">
            ₹{data.financials.averagePlacementFeeInrLakh}L
          </p>
          <p className="mt-1 text-[11px] text-muted">Contingency fee on ₹25–35 LPA roles</p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-5">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Compute / Placement</span>
            <Cpu className="size-4 text-accent" />
          </div>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-fg">
            ₹{data.financials.averageComputeCostInr.toLocaleString("en-IN")}
          </p>
          <p className="mt-1 text-[11px] text-muted">&lt; 1% of revenue (zero token waste)</p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-5">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Active Roles</span>
            <Users className="size-4 text-accent" />
          </div>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-fg">
            {data.totalRoles}
          </p>
          <p className="mt-1 text-[11px] text-muted">{data.totalCandidates} candidates screened</p>
        </div>
      </section>

      {/* The 8 YC Core Metrics */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl tracking-tight">The 8 AI-Native Vital Signs</h2>
          <p className="text-xs text-muted">
            Benchmarked against human-labor recruitment agencies in the Indian tech market.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {data.metrics.map((m) => (
            <div
              key={m.key}
              className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-5 transition-all hover:border-fg/20 hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted border border-border">
                    {m.target2027}
                  </span>
                  <span className="text-[10px] font-bold text-lime-400 capitalize">
                    {m.status}
                  </span>
                </div>

                <h3 className="mt-2.5 font-display text-base font-semibold leading-tight text-fg">
                  {m.label}
                </h3>

                <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-fg">
                  {m.currentValue}
                </p>

                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                  <span className="text-subtle">Legacy Agency:</span>
                  <span className="line-through text-rose-400/80">{m.legacyBenchmark}</span>
                </div>
              </div>

              <p className="mt-4 border-t border-border/50 pt-2.5 text-[11px] leading-relaxed text-muted">
                {m.interpretation}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Real-Time Auto-Tuning Loops */}
      <section className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-2xl tracking-tight">Live Model Auto-Tuning Loops</h2>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
              Active Feedback Loop
            </span>
          </div>
          <p className="text-xs text-muted">
            How operational events continuously adjust vector weights, hazard decay, and forensics filters.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Card 1: Client Taste Loop */}
          <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-fg">Client Taste Calibration</span>
                <span className="rounded-full bg-lime-500/15 px-2 py-0.5 text-[10px] font-bold text-lime-400 border border-lime-500/30">
                  {data.autoTuning.tasteModelTuning.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">The YC Perfectly Wedge</p>

              <div className="mt-4 flex flex-col gap-2 rounded-xl bg-elevated/40 p-3 border border-border/50 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Calibrated Feedback:</span>
                  <span className="font-bold text-fg">{data.autoTuning.tasteModelTuning.calibratedSamples} events</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Repellent Weight:</span>
                  <span className="font-bold text-lime-400">{data.autoTuning.tasteModelTuning.penaltyMultiplier}</span>
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted">
              {data.autoTuning.tasteModelTuning.description}
            </p>
          </div>

          {/* Card 2: Offer Guard Notice Hazard */}
          <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-fg">Notice Hazard Decay (Offer Guard)</span>
                <span className="rounded-full bg-lime-500/15 px-2 py-0.5 text-[10px] font-bold text-lime-400 border border-lime-500/30">
                  {data.autoTuning.offerGuardHazardTuning.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">Indian 60–90 Day Notice Shield</p>

              <div className="mt-4 flex flex-col gap-2 rounded-xl bg-elevated/40 p-3 border border-border/50 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Active Monitored Offers:</span>
                  <span className="font-bold text-fg">{data.autoTuning.offerGuardHazardTuning.activeMonitoredOffers} offers</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Hazard Decay Weight:</span>
                  <span className="font-bold text-lime-400">{data.autoTuning.offerGuardHazardTuning.hazardAlertWeight}</span>
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted">
              {data.autoTuning.offerGuardHazardTuning.description}
            </p>
          </div>

          {/* Card 3: Forensic & Proxy Verification */}
          <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-fg">Anti-Cheat & Forensics</span>
                <span className="rounded-full bg-lime-500/15 px-2 py-0.5 text-[10px] font-bold text-lime-400 border border-lime-500/30">
                  {data.autoTuning.forensicFilterTuning.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">Byte-Level + Speech Latency</p>

              <div className="mt-4 flex flex-col gap-2 rounded-xl bg-elevated/40 p-3 border border-border/50 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Resumes Forensically Audited:</span>
                  <span className="font-bold text-fg">{data.autoTuning.forensicFilterTuning.resumesScreened} profiles</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Byte Catch Rate:</span>
                  <span className="font-bold text-lime-400">{data.autoTuning.forensicFilterTuning.anomalyCatchRate}</span>
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted">
              {data.autoTuning.forensicFilterTuning.description}
            </p>
          </div>
        </div>
      </section>

      {/* Fitts's Law Mobile Thumb Zone Action Bar */}
      <MobileActionBar>
        <span className="text-xs font-medium text-muted">
          8 YC Metrics Active · {data.financials.grossMarginPct}% Margin
        </span>
        <Button asChild size="default" className="soft-lime font-semibold">
          <Link to="/app">Go to Desk</Link>
        </Button>
      </MobileActionBar>
    </div>
  );
}
