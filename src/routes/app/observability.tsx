import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Layers,
  ListRestart,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  acknowledgeAlertAction,
  getObservabilityOverview,
  getRouterOverview,
  resolveAlertAction,
  retryFailedQueueJobs,
} from "@/lib/recruiting/observability-api";
import {
  formatCostCents,
  formatCostInr,
  formatCostRupees,
  formatCostSideBySide,
  formatCostUsd,
  USD_TO_INR_RATE,
} from "@/lib/observability/cost";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/observability")({
  component: ObservabilityPage,
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function ObservabilityPage() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tab, setTab] = useState("overview");
  const [accessFilter, setAccessFilter] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ["observability-summary"],
    queryFn: () => getObservabilityOverview(),
    refetchInterval: autoRefresh ? 8000 : false,
  });

  const { data: router } = useQuery({
    queryKey: ["router-overview"],
    queryFn: () => getRouterOverview(),
    enabled: tab === "cost",
    refetchInterval: autoRefresh ? 15000 : false,
  });

  const retryMut = useMutation({
    mutationFn: (input: { jobId?: string; batchId?: string }) =>
      retryFailedQueueJobs({ data: input }),
    onSuccess: (res) => {
      toast.success(`Queued ${res.retriedCount} job(s) for re-processing`);
      void qc.invalidateQueries({ queryKey: ["observability-summary"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to retry jobs");
    },
  });

  const ackAlertMut = useMutation({
    mutationFn: (alertId: string) => acknowledgeAlertAction({ data: { alertId } }),
    onSuccess: () => {
      toast.success("Alert acknowledged");
      void qc.invalidateQueries({ queryKey: ["observability-summary"] });
    },
  });

  const resolveAlertMut = useMutation({
    mutationFn: (alertId: string) => resolveAlertAction({ data: { alertId } }),
    onSuccess: () => {
      toast.success("Alert marked as resolved");
      void qc.invalidateQueries({ queryKey: ["observability-summary"] });
    },
  });

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const firingAlerts = data?.alerts.filter((a) => a.status === "firing") ?? [];
  const criticalAlerts = firingAlerts.filter((a) => a.severity === "critical");

  const filteredAccessLogs = (data?.accessLogs ?? []).filter((log) => {
    if (onlyErrors && log.status_code < 400) return false;
    if (accessFilter.trim()) {
      const q = accessFilter.toLowerCase();
      return (
        log.path.toLowerCase().includes(q) ||
        log.method.toLowerCase().includes(q) ||
        log.ip.toLowerCase().includes(q) ||
        String(log.status_code).includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header with Title and Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">System Observability</h1>
            <Badge variant="outline" className="text-xs font-mono">
              Live Telemetry
            </Badge>
          </div>
          <p className="text-sm text-muted">
            Errors, latency percentiles, per-task model cost, queue health, failed jobs, and
            alerting.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "gap-1.5 text-xs",
              autoRefresh && "text-emerald-500 border-emerald-500/30",
            )}
          >
            <Clock className="size-3.5" />
            {autoRefresh ? "Auto-refresh: On (8s)" : "Auto-refresh: Off"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
          {data?.queueHealth.failedCount ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => retryMut.mutate({})}
              disabled={retryMut.isPending}
              className="gap-1.5 text-xs bg-red-600 hover:bg-red-700 text-white"
            >
              <ListRestart className="size-3.5" />
              Retry {data.queueHealth.failedCount} Failed Jobs
            </Button>
          ) : null}
        </div>
      </div>

      {/* Critical Alert Banner if firing */}
      {firingAlerts.length > 0 && (
        <div
          className={cn(
            "rounded-xl border p-4 transition-all",
            criticalAlerts.length > 0
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertOctagon className="mt-0.5 size-5 shrink-0" />
              <div>
                <div className="font-semibold">
                  {firingAlerts.length} System Alert{firingAlerts.length > 1 ? "s" : ""} Firing
                </div>
                <div className="mt-1 text-xs opacity-90">
                  {firingAlerts.map((a) => a.title).join(" • ")}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTab("alerts")}
              className="text-xs shrink-0 bg-bg"
            >
              View Alerts
            </Button>
          </div>
        </div>
      )}

      {/* 6 Key Telemetry Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Errors & Rate */}
        <Card className="bg-surface/50 border-border">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium">
              <span>Errors (15m)</span>
              <ShieldAlert className="size-3.5 text-muted" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{data?.errors.total ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className={cn(
                  "font-semibold",
                  (data?.errors.ratePercent ?? 0) > 5 ? "text-red-500" : "text-emerald-500",
                )}
              >
                {data?.errors.ratePercent ?? 0}%
              </span>
              <span>error rate</span>
            </div>
          </CardContent>
        </Card>

        {/* Latency P50 / P95 */}
        <Card className="bg-surface/50 border-border">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium">
              <span>Latency (P95)</span>
              <ArrowUpDown className="size-3.5 text-muted" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{data?.latency.p95Ms ?? 0}ms</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span>p50:</span>
              <span className="font-semibold text-fg">{data?.latency.p50Ms ?? 0}ms</span>
              <span className="opacity-60">({data?.latency.sampleCount ?? 0} samples)</span>
            </div>
          </CardContent>
        </Card>

        {/* Model Cost */}
        <Card className="bg-surface/50 border-border">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium">
              <span>Model Spend (USD / INR)</span>
              <Coins className="size-3.5 text-muted" />
            </CardDescription>
            <CardTitle className="text-xl font-bold font-mono flex items-baseline gap-1.5 flex-wrap">
              <span>${(data?.modelCosts.totalCostUsd ?? 0).toFixed(2)}</span>
              <span className="text-xs font-normal text-muted">
                ({formatCostInr(data?.modelCosts.totalCostInr ?? 0)})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-1.5 text-xs text-muted flex-wrap">
              <span className="text-emerald-500 font-semibold">
                +${(data?.modelCosts.savingsUsd ?? 0).toFixed(2)} (
                {formatCostInr(data?.modelCosts.savingsInr ?? 0)})
              </span>
              <span>saved (local)</span>
            </div>
          </CardContent>
        </Card>

        {/* Queue Age */}
        <Card className="bg-surface/50 border-border">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium">
              <span>Max Queue Age</span>
              <Clock className="size-3.5 text-muted" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {data?.queueHealth.oldestAgeMs ? formatDuration(data.queueHealth.oldestAgeMs) : "0s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span>Avg wait:</span>
              <span className="font-semibold text-fg">
                {formatDuration(data?.queueHealth.avgAgeMs ?? 0)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Failed Jobs */}
        <Card className="bg-surface/50 border-border">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium">
              <span>Failed Jobs</span>
              <AlertTriangle className="size-3.5 text-muted" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              <span className={cn((data?.queueHealth.failedCount ?? 0) > 0 && "text-red-500")}>
                {data?.queueHealth.failedCount ?? 0}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className="font-semibold text-fg">{data?.queueHealth.pendingCount ?? 0}</span>
              <span>pending in queue</span>
            </div>
          </CardContent>
        </Card>

        {/* Active Alerts */}
        <Card className="bg-surface/50 border-border">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium">
              <span>Alert Status</span>
              <Activity className="size-3.5 text-muted" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {firingAlerts.length === 0 ? (
                <span className="text-emerald-500 text-lg flex items-center gap-1">
                  <CheckCircle2 className="size-5" /> Healthy
                </span>
              ) : (
                <span className="text-amber-500">{firingAlerts.length} Active</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-xs text-muted">{data?.alertRules.length ?? 0} rules evaluated</div>
          </CardContent>
        </Card>
      </div>

      {/* Deep-Dive Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 bg-surface/50 p-1 border border-border">
          <TabsTrigger value="overview" className="gap-2 text-xs">
            <Activity className="size-3.5" />
            Alerts & Rules
          </TabsTrigger>
          <TabsTrigger value="cost" className="gap-2 text-xs">
            <Coins className="size-3.5" />
            Model Costs
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-2 text-xs">
            <Layers className="size-3.5" />
            Queue & Jobs
          </TabsTrigger>
          <TabsTrigger value="latency" className="gap-2 text-xs">
            <Cpu className="size-3.5" />
            Latency & Errors
          </TabsTrigger>
          <TabsTrigger value="access" className="gap-2 text-xs">
            <Clock className="size-3.5" />
            Access Logs
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Alerts & Rules */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Active Alerts List */}
            <Card className="border-border bg-surface/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Active Firing Alerts</span>
                  <Badge variant="outline">{firingAlerts.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Automated condition triggers monitoring system health.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {firingAlerts.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted">
                    <CheckCircle2 className="mx-auto size-8 text-emerald-500/70 mb-2" />
                    All alert conditions healthy. No firing alerts.
                  </div>
                ) : (
                  firingAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={cn(
                        "rounded-lg border p-3.5 space-y-2",
                        alert.severity === "critical"
                          ? "border-red-500/30 bg-red-500/5"
                          : "border-amber-500/30 bg-amber-500/5",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn(
                              alert.severity === "critical"
                                ? "bg-red-500 text-white"
                                : "bg-amber-500 text-white",
                            )}
                          >
                            {alert.severity}
                          </Badge>
                          <span className="font-semibold text-sm">{alert.title}</span>
                        </div>
                        <span className="text-xs text-muted">
                          {new Date(alert.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted">{alert.message}</p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs font-mono opacity-80">
                          Current: {alert.current_value} (Limit: {alert.threshold_value})
                        </span>
                        <div className="flex gap-2">
                          {alert.status === "firing" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => ackAlertMut.mutate(alert.id)}
                              disabled={ackAlertMut.isPending}
                              className="h-7 text-xs"
                            >
                              Acknowledge
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => resolveAlertMut.mutate(alert.id)}
                            disabled={resolveAlertMut.isPending}
                            className="h-7 text-xs"
                          >
                            Resolve
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Configured Alert Rules */}
            <Card className="border-border bg-surface/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Alert Rules & Thresholds</span>
                  <Badge variant="outline">{data?.alertRules.length ?? 0} Rules</Badge>
                </CardTitle>
                <CardDescription>
                  Evaluated automatically during queue runs and model operations.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data?.alertRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-start justify-between rounded-lg border border-border/60 bg-surface/40 p-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg">{rule.rule_name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                          {rule.severity}
                        </Badge>
                      </div>
                      <p className="text-muted">{rule.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-semibold">
                        {rule.id === "cost_spike"
                          ? `$${rule.threshold}`
                          : rule.id === "queue_lag_high"
                            ? `${rule.threshold}s`
                            : rule.id === "error_rate_high"
                              ? `${rule.threshold}%`
                              : rule.id === "latency_p95_high"
                                ? `${rule.threshold}ms`
                                : rule.threshold}
                      </div>
                      <div className="text-muted text-[10px]">window: {rule.window_minutes}m</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Model Costs Breakdown */}
        <TabsContent value="cost" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Total Tokens Processed</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono">
                  {(data?.modelCosts.totalTokens ?? 0).toLocaleString()}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">
                Across {data?.modelCosts.totalCalls ?? 0} model invocations
              </CardContent>
            </Card>

            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">
                  Total Spend (USD / Cents / Rupees)
                </CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-emerald-500 flex items-baseline gap-2 flex-wrap">
                  <span>${(data?.modelCosts.totalCostUsd ?? 0).toFixed(4)}</span>
                  <span className="text-base text-emerald-600 dark:text-emerald-400 font-semibold">
                    ({formatCostInr(data?.modelCosts.totalCostInr ?? 0)})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted flex items-center gap-1.5 flex-wrap font-mono">
                <span>{formatCostCents(data?.modelCosts.totalCostCents ?? 0)}</span>
                <span>•</span>
                <span>{formatCostInr(data?.modelCosts.totalCostInr ?? 0)}</span>
                <span className="text-[10px] text-muted opacity-80">
                  (side by side multi-currency)
                </span>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Cost Saved via Local/Ollama</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-cyan-500 flex items-baseline gap-2 flex-wrap">
                  <span>${(data?.modelCosts.savingsUsd ?? 0).toFixed(2)}</span>
                  <span className="text-base text-cyan-600 dark:text-cyan-400 font-semibold">
                    ({formatCostInr(data?.modelCosts.savingsInr ?? 0)})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">
                Versus equivalent commercial rates (${(data?.modelCosts.savingsUsd ?? 0).toFixed(2)}{" "}
                • {formatCostInr(data?.modelCosts.savingsInr ?? 0)})
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* By Task Type */}
            <Card className="border-border bg-surface/30">
              <CardHeader>
                <CardTitle className="text-base">Cost by Recruiting Task</CardTitle>
                <CardDescription>
                  Token usage and compute cost per business capability standing in USD, Cents, and
                  INR.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(data?.modelCosts.byTask ?? {}).length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted">
                    No model tasks recorded yet.
                  </div>
                ) : (
                  Object.entries(data?.modelCosts.byTask ?? {}).map(([task, stats]) => (
                    <div
                      key={task}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/40 p-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold uppercase tracking-wider text-[11px] text-fg">
                          {task}
                        </div>
                        <div className="text-muted text-[11px]">
                          {stats.count} calls • {stats.tokens.toLocaleString()} tokens
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <div className="font-semibold text-fg flex items-baseline justify-end gap-1.5 flex-wrap">
                          <span>{formatCostUsd(stats.costUsd)}</span>
                          <span className="text-xs text-emerald-500 font-medium">
                            ({formatCostInr(stats.costInr ?? stats.costUsd * USD_TO_INR_RATE)})
                          </span>
                        </div>
                        <div className="text-muted text-[10px]">
                          {formatCostCents(stats.costCents)} •{" "}
                          {formatCostInr(stats.costInr ?? stats.costUsd * USD_TO_INR_RATE)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* By Provider */}
            <Card className="border-border bg-surface/30">
              <CardHeader>
                <CardTitle className="text-base">Cost by Model Provider</CardTitle>
                <CardDescription>
                  Distribution across Groq, Gemini, OpenAI, Ollama, xAI, and Local with
                  multi-currency breakdown.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(data?.modelCosts.byProvider ?? {}).length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted">
                    No provider calls recorded yet.
                  </div>
                ) : (
                  Object.entries(data?.modelCosts.byProvider ?? {}).map(([provider, stats]) => (
                    <div
                      key={provider}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/40 p-3 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {provider}
                        </Badge>
                        <span className="text-muted text-[11px]">
                          {stats.count} calls ({stats.tokens.toLocaleString()} tok)
                        </span>
                      </div>
                      <div className="text-right font-mono">
                        <div className="font-semibold text-fg flex items-baseline justify-end gap-1.5 flex-wrap">
                          <span>{formatCostUsd(stats.costUsd)}</span>
                          <span className="text-xs text-emerald-500 font-medium">
                            ({formatCostInr(stats.costInr ?? stats.costUsd * USD_TO_INR_RATE)})
                          </span>
                        </div>
                        <div className="text-muted text-[10px]">
                          {formatCostCents(stats.costCents)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Which arm the router picks per task, and what it is allowed to spend */}
          <Card className="border-border bg-surface/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted" />
                Model Routing
              </CardTitle>
              <CardDescription>
                Every AI task is routed to the arm that does it for the fewest tokens, the least
                money and the least time. Quality is only traded away on a task the harness has
                already proved a cheap arm agrees with.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="font-mono">
                  {router?.budgetInr
                    ? `cap ${formatCostRupees(router.budgetInr)} / day • ${formatCostRupees(router.remainingInr ?? 0)} left`
                    : "no daily cap set"}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {router?.callsToday ?? 0} calls today
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono",
                    (router?.degradedToday ?? 0) > 0 ? "text-amber-500" : "text-muted",
                  )}
                >
                  {router?.degradedToday ?? 0} degraded routes
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {router?.ollamaUp ? "Ollama up" : "Ollama down"}
                </Badge>
              </div>

              <div className="text-xs text-muted">
                Harness-proven arms (only these trade quality for cost on a critical task):{" "}
                {router?.gates?.length
                  ? router.gates.map((g) => (
                      <Badge
                        key={`${g.task}:${g.engine}`}
                        variant="outline"
                        className="mr-1 font-mono text-[11px]"
                      >
                        {g.task} via {g.engine}
                      </Badge>
                    ))
                  : "none yet — run an eval"}
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {(router?.arms ?? []).map((arm) => (
                  <div
                    key={arm.armId}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/40 p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono font-semibold text-[11px] text-fg">
                          {arm.armId}
                        </span>
                        {arm.free && (
                          <Badge variant="outline" className="text-[10px] text-emerald-500">
                            free
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted text-[11px]">
                        {arm.kind}
                        {arm.eligible ? " • eligible" : ` • ${arm.whyNot}`}
                      </div>
                    </div>
                    <div className="text-right font-mono text-[11px]">
                      <div className="text-fg">
                        {arm.callsToday} call{arm.callsToday === 1 ? "" : "s"}
                      </div>
                      <div className="text-muted">
                        {formatCostRupees(arm.costTodayInr)} • {arm.avgLatencyMs}ms
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Queue & Failed Jobs */}
        <TabsContent value="queue" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Pending Queue Depth</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono">
                  {data?.queueHealth.pendingCount ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">Awaiting worker pickup</CardContent>
            </Card>
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Processing Now</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-cyan-500">
                  {data?.queueHealth.processingCount ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">Active worker concurrency</CardContent>
            </Card>
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Completed Jobs</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-emerald-500">
                  {data?.queueHealth.completedCount ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">Successfully parsed & ranked</CardContent>
            </Card>
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Job Failure Rate</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-red-500">
                  {data?.queueHealth.failureRatePercent ?? 0}%
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">
                {data?.queueHealth.failedCount ?? 0} failed jobs total
              </CardContent>
            </Card>
          </div>

          {/* Failed Jobs Table */}
          <Card className="border-border bg-surface/30">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Failed Ingest Jobs & Dead-Letter Queue</CardTitle>
                <CardDescription>
                  Jobs that exceeded retry bounds or encountered unreadable inputs.
                </CardDescription>
              </div>
              {data?.failedJobs.length ? (
                <Button
                  size="sm"
                  onClick={() => retryMut.mutate({})}
                  disabled={retryMut.isPending}
                  className="text-xs gap-1.5"
                >
                  <ListRestart className="size-3.5" />
                  Retry All
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {data?.failedJobs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted">
                  <CheckCircle2 className="mx-auto size-8 text-emerald-500/70 mb-2" />
                  No failed jobs. Ingest queue processing cleanly.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border/80 text-muted font-medium">
                        <th className="py-2.5 px-3">Job ID</th>
                        <th className="py-2.5 px-3">Filename</th>
                        <th className="py-2.5 px-3">Error Reason</th>
                        <th className="py-2.5 px-3">Attempts</th>
                        <th className="py-2.5 px-3">Failed At</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {data?.failedJobs.map((job) => (
                        <tr key={job.id} className="hover:bg-surface/50 font-mono">
                          <td className="py-2.5 px-3 text-[11px]">{job.id.slice(0, 8)}...</td>
                          <td className="py-2.5 px-3 font-sans font-medium">{job.filename}</td>
                          <td className="py-2.5 px-3 text-red-500 font-sans text-xs">
                            {job.error || "Execution failed"}
                          </td>
                          <td className="py-2.5 px-3">{job.attempts}</td>
                          <td className="py-2.5 px-3 text-muted text-[11px]">
                            {new Date(job.updated_at).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retryMut.mutate({ jobId: job.id })}
                              disabled={retryMut.isPending}
                              className="h-7 text-xs font-sans"
                            >
                              Retry
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Latency & Errors */}
        <TabsContent value="latency" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Average Latency</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono">
                  {data?.latency.avgMs ?? 0}ms
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">Across all requests</CardContent>
            </Card>
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">P50 (Median)</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-emerald-500">
                  {data?.latency.p50Ms ?? 0}ms
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">50% of requests faster than</CardContent>
            </Card>
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">P95 Latency</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-amber-500">
                  {data?.latency.p95Ms ?? 0}ms
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">95% of requests faster than</CardContent>
            </Card>
            <Card className="border-border bg-surface/30">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">P99 Latency</CardDescription>
                <CardTitle className="text-2xl font-bold font-mono text-red-500">
                  {data?.latency.p99Ms ?? 0}ms
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted">Tail latency upper bound</CardContent>
            </Card>
          </div>

          {/* Recent Errors List */}
          <Card className="border-border bg-surface/30">
            <CardHeader>
              <CardTitle className="text-base">Recent Errors & Trace Failures</CardTitle>
              <CardDescription>
                Aggregated from HTTP status codes ≥ 400 and AI provider errors.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.errors.recent.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted">
                  <CheckCircle2 className="mx-auto size-8 text-emerald-500/70 mb-2" />
                  No errors recorded in this observation window.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data?.errors.recent.map((err) => (
                    <div
                      key={err.id}
                      className="flex items-start justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-fg flex items-center gap-2">
                          <span className="text-red-500 font-mono">[{err.source}]</span>
                          <span>{err.message}</span>
                        </div>
                      </div>
                      <span className="text-muted font-mono text-[11px] shrink-0">
                        {new Date(err.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: Access Logs */}
        <TabsContent value="access" className="space-y-4">
          <Card className="border-border bg-surface/30">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Live HTTP Access Logs</CardTitle>
                  <CardDescription>
                    Real-time request log with duration, status codes, and IP addresses.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted" />
                    <Input
                      placeholder="Filter path..."
                      value={accessFilter}
                      onChange={(e) => setAccessFilter(e.target.value)}
                      className="h-8 pl-8 text-xs bg-surface"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant={onlyErrors ? "destructive" : "outline"}
                    onClick={() => setOnlyErrors(!onlyErrors)}
                    className="h-8 text-xs"
                  >
                    {onlyErrors ? "Errors Only (Active)" : "Errors Only"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredAccessLogs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted">
                  No access logs matching filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border/80 text-muted font-medium font-mono">
                        <th className="py-2 px-3">Method</th>
                        <th className="py-2 px-3">Path</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Latency</th>
                        <th className="py-2 px-3">Client IP</th>
                        <th className="py-2 px-3 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono">
                      {filteredAccessLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-surface/50">
                          <td className="py-2 px-3 font-semibold">
                            <span
                              className={cn(
                                log.method === "GET" && "text-blue-500",
                                log.method === "POST" && "text-emerald-500",
                                log.method === "DELETE" && "text-red-500",
                                log.method === "PATCH" && "text-amber-500",
                              )}
                            >
                              {log.method}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-fg font-sans">{log.path}</td>
                          <td className="py-2 px-3">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-mono",
                                log.status_code < 300
                                  ? "text-emerald-500 border-emerald-500/30"
                                  : log.status_code < 400
                                    ? "text-blue-500 border-blue-500/30"
                                    : "text-red-500 border-red-500/30 bg-red-500/5",
                              )}
                            >
                              {log.status_code}
                            </Badge>
                          </td>
                          <td className="py-2 px-3">{log.duration_ms}ms</td>
                          <td className="py-2 px-3 text-muted text-[11px]">
                            {log.ip || "127.0.0.1"}
                          </td>
                          <td className="py-2 px-3 text-right text-muted text-[11px]">
                            {new Date(log.created_at).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
