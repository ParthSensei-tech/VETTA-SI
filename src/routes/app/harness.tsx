import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FIT_LABEL } from "@/lib/recruiting/constants";
import {
  getEvalRun,
  promoteHarnessPrompt,
  runHarnessEval,
  saveHarnessPrompt,
  setHarnessShadow,
} from "@/lib/recruiting/harness/harness-api";
import { errorMessage, queryKeys, useHarnessQuery } from "@/lib/recruiting/query";
import type { EvalRun, FitLevel } from "@/lib/recruiting/types";
import { cn, formatRelative } from "@/shared/utils";

export const Route = createFileRoute("/app/harness")({ component: HarnessPage });

function HarnessPage() {
  const { data, isPending, error } = useHarnessQuery();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [promptBody, setPromptBody] = useState("");
  const [activeRun, setActiveRun] = useState<EvalRun | null>(null);

  useEffect(() => {
    const cand = data?.prompts.find((p) => p.id === data.settings.candidatePromptId);
    if (cand) setPromptBody(cand.body);
  }, [data?.settings.candidatePromptId, data?.prompts]);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: queryKeys.harness });
  }

  const evalMut = useMutation({
    mutationFn: (input: { kind: "production" | "candidate"; engine: "local" | "live" }) =>
      runHarnessEval({ data: input }),
    onSuccess: (run) => {
      invalidate();
      setActiveRun(run);
      setTab("overview");
      toast.success(run.gatePassed ? "Eval passed the gate" : "Eval held by the gate");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const shadowMut = useMutation({
    mutationFn: (enabled: boolean) => setHarnessShadow({ data: { enabled } }),
    onSuccess: () => {
      invalidate();
      toast.success("Shadow mode updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const saveMut = useMutation({
    mutationFn: () => saveHarnessPrompt({ data: { body: promptBody, name: "Candidate" } }),
    onSuccess: () => {
      invalidate();
      toast.success("Candidate prompt saved — run eval before it can ship");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const promoteMut = useMutation({
    mutationFn: () => promoteHarnessPrompt(),
    onSuccess: () => {
      invalidate();
      toast.success("Candidate is now production");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const detailMut = useMutation({
    mutationFn: (runId: string) => getEvalRun({ data: { runId } }),
    onSuccess: (run) => setActiveRun(run),
    onError: (e) => toast.error(errorMessage(e)),
  });

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
    return <p className="text-sm text-danger">Could not load the harness.</p>;
  }

  const last = data.runs[0];
  const prod = data.prompts.find((p) => p.id === data.settings.productionPromptId);
  const cand = data.prompts.find((p) => p.id === data.settings.candidatePromptId);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Constraint</p>
          <h1 className="font-display text-4xl tracking-tight">Harness</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Not self-improving AGI. A fixed eval set, a scorer, traces, shadow ranks, and a
            regression gate so a prompt or model change cannot ship if agreement drops.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={evalMut.isPending}
            onClick={() => evalMut.mutate({ kind: "production", engine: "local" })}
          >
            {evalMut.isPending ? "Scoring…" : "Run production eval"}
          </Button>
          <Button
            disabled={evalMut.isPending}
            onClick={() => evalMut.mutate({ kind: "candidate", engine: "local" })}
          >
            Score candidate
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Agreement"
          value={pct(data.stats.lastAgreementPct)}
          hint="vs human labels on the frozen set"
        />
        <Stat
          label="False shortlist"
          value={last ? `${last.falseShortlistRate}%` : "—"}
          hint="Model yes / human no"
          warn={Boolean(last && last.falseShortlistRate > data.settings.maxFalseShortlistPct)}
        />
        <Stat
          label="Gate"
          value={gateLabel(data.stats.lastGatePassed)}
          hint={last?.gateReason || "Run eval to lock a baseline"}
        />
        <Stat
          label="Shadow disagreements"
          value={String(data.stats.shadowDisagreements)}
          hint={data.settings.shadowEnabled ? "Candidate ranks in the background" : "Shadow is off"}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="eval">Eval set</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="traces">Traces</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-6">
          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-display text-2xl">Last run</h2>
                {last ? (
                  <span className="font-mono text-xs text-muted">
                    {last.kind} · {last.engine} · {last.promptHash}
                  </span>
                ) : null}
              </div>
              {activeRun?.cases?.length ? (
                <RunCases run={activeRun} />
              ) : last ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm leading-relaxed text-muted">{last.gateReason}</p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <Mini k="Agree" v={`${last.agreeCount}/${last.labeledCount}`} />
                    <Mini k="p50" v={last.p50LatencyMs != null ? `${last.p50LatencyMs} ms` : "—"} />
                    <Mini k="False reject" v={`${last.falseRejectRate}%`} />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={detailMut.isPending}
                    onClick={() => detailMut.mutate(last.id)}
                  >
                    Show case scores
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  No eval yet. Run production eval on the frozen JDs and resumes to set a baseline.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-2xl bg-elevated p-5">
                <h3 className="font-display text-xl">Shadow mode</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  When a live resume is ranked, the candidate prompt also ranks in the background on
                  the local evidence engine. Pipeline is unchanged. Compare, then promote only if
                  the gate passes.
                </p>
                <Button
                  className="mt-4"
                  size="sm"
                  variant={data.settings.shadowEnabled ? "default" : "secondary"}
                  disabled={shadowMut.isPending}
                  onClick={() => shadowMut.mutate(!data.settings.shadowEnabled)}
                >
                  {data.settings.shadowEnabled ? "Shadow on" : "Shadow off"}
                </Button>
              </div>
              <div className="rounded-2xl border border-border p-5">
                <h3 className="font-display text-xl">Floors</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Mini k="Min agreement" v={`${data.settings.minAgreementPct}%`} />
                  <Mini k="Max false shortlist" v={`${data.settings.maxFalseShortlistPct}%`} />
                  <Mini k="Production hash" v={data.stats.productionHash || "—"} />
                  <Mini k="Candidate hash" v={data.stats.candidateHash || "—"} />
                </dl>
              </div>
            </div>
          </section>

          {data.runs.length > 0 ? (
            <section>
              <h2 className="mb-3 font-display text-2xl">Run history</h2>
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-border text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">Kind</th>
                      <th className="px-4 py-3 font-medium">Agree</th>
                      <th className="px-4 py-3 font-medium">False SL</th>
                      <th className="px-4 py-3 font-medium">p50</th>
                      <th className="px-4 py-3 font-medium">Gate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-muted">{formatRelative(r.createdAt)}</td>
                        <td className="px-4 py-3">
                          {r.kind} · {r.engine}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums">{r.agreementPct}%</td>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {r.falseShortlistRate}%
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {r.p50LatencyMs != null ? `${r.p50LatencyMs}ms` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <GateChip passed={r.gatePassed} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="eval">
          <p className="mb-4 max-w-2xl text-sm text-muted">
            Frozen JDs, resumes, and human labels. Labels from the desk (“Was this right?”) land
            here too. The set does not change when a model does.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Case</th>
                  <th className="px-4 py-3 font-medium">Seat</th>
                  <th className="px-4 py-3 font-medium">Human</th>
                  <th className="px-4 py-3 font-medium">Last rank</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {data.cases.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3">
                      <p className="text-fg">{c.title}</p>
                      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{c.notes}</p>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {c.roleTitle}
                      <span className="block text-xs">{c.companyName}</span>
                    </td>
                    <td className="px-4 py-3">{FIT_LABEL[c.humanLabel]}</td>
                    <td className="px-4 py-3">
                      {c.lastPredicted ? (
                        <span className={cn(c.lastAgree ? "text-success" : "text-danger")}>
                          {FIT_LABEL[c.lastPredicted]}
                          {c.lastAgree ? " · agree" : " · miss"}
                        </span>
                      ) : (
                        <span className="text-subtle">Not scored</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {c.source === "gold" ? "Gold" : "Label"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="prompts" className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border p-5">
            <p className="text-xs tracking-wide text-muted uppercase">Production</p>
            <h2 className="mt-1 font-display text-2xl">{prod?.name ?? "Production"}</h2>
            <p className="mt-1 font-mono text-xs text-subtle">{prod?.hash}</p>
            <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-elevated p-4 text-xs leading-relaxed text-muted">
              {prod?.body ?? "—"}
            </pre>
          </div>
          <div className="rounded-2xl border border-border p-5">
            <p className="text-xs tracking-wide text-muted uppercase">Candidate</p>
            <h2 className="mt-1 font-display text-2xl">{cand?.name ?? "Candidate"}</h2>
            <p className="mt-1 font-mono text-xs text-subtle">{cand?.hash}</p>
            <Textarea
              className="mt-4 min-h-64 font-mono text-xs"
              value={promptBody}
              onChange={(e) => setPromptBody(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate()}
              >
                Save candidate
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={evalMut.isPending}
                onClick={() => evalMut.mutate({ kind: "candidate", engine: "local" })}
              >
                Score against eval set
              </Button>
              <Button size="sm" disabled={promoteMut.isPending} onClick={() => promoteMut.mutate()}>
                Promote if gate passes
              </Button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Promote is blocked unless the latest candidate eval clears agreement floor,
              false-shortlist cap, and does not drop versus production.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="traces" className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 font-display text-2xl">Rank traces</h2>
            <p className="mb-4 max-w-2xl text-sm text-muted">
              Every rank stores engine (Cloud / Ollama / Local), prompt hash, JD hash, resume hash,
              score, and latency. Production and shadow share a pair id.
            </p>
            {data.traces.length === 0 ? (
              <p className="text-sm text-muted">No traces yet. Rank a resume or run eval.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-border text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">Mode</th>
                      <th className="px-4 py-3 font-medium">Engine</th>
                      <th className="px-4 py-3 font-medium">Level</th>
                      <th className="px-4 py-3 font-medium">ms</th>
                      <th className="px-4 py-3 font-medium">Prompt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.traces.map((t) => (
                      <tr key={t.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-muted">{formatRelative(t.createdAt)}</td>
                        <td className="px-4 py-3">{t.mode}</td>
                        <td className="px-4 py-3">
                          {t.engine}
                          {t.fallback ? " · fallback" : ""}
                        </td>
                        <td className="px-4 py-3">
                          {t.level}
                          {t.score != null ? ` · ${t.score}` : ""}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums">{t.latencyMs ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{t.promptHash}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-display text-2xl">Human labels</h2>
            {data.labels.length === 0 ? (
              <p className="text-sm text-muted">
                Open a ranked candidate and answer “Was this right?”. That feeds the eval set.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {data.labels.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span>
                      Human {FIT_LABEL[l.humanLabel]}
                      {l.predictedLevel ? ` vs model ${l.predictedLevel.replace("_", " ")}` : ""}
                      <span className="text-muted"> · {l.verdict.replace("_", " ")}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {l.addedToEval ? "In eval set · " : ""}
                      {formatRelative(l.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-subtle">
        Live ranking uses configured AI providers (Groq, Gemini, Ollama, OpenAI, xAI) with automatic
        fallback to local evidence ranking. Eval runs on the local scorer unless you explicitly
        score the candidate against the live model.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
      <p
        className={cn(
          "mt-2 font-display text-3xl tabular-nums tracking-tight",
          warn && "text-danger",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{hint}</p>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="mt-0.5 font-mono text-xs break-all">{v}</dd>
    </div>
  );
}

function GateChip({ passed }: { passed: boolean | null }) {
  if (passed == null) return <span className="text-muted">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        passed ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
      )}
    >
      <ShieldCheck className="size-3" />
      {passed ? "Pass" : "Hold"}
    </span>
  );
}

function RunCases({ run }: { run: EvalRun }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{run.gateReason}</p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {run.cases?.map((c) => (
          <li
            key={c.caseId}
            className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
          >
            <span className="max-w-[18rem]">{c.title}</span>
            <span className={cn("text-xs", c.agree ? "text-success" : "text-danger")}>
              {FIT_LABEL[c.humanLabel as FitLevel]} → {FIT_LABEL[c.predictedLevel as FitLevel]}
              {c.falseShortlist ? " · false SL" : ""}
              {c.falseReject ? " · false reject" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function pct(n: number | null) {
  return n == null ? "—" : `${n}%`;
}

function gateLabel(passed: boolean | null) {
  if (passed == null) return "Unscored";
  return passed ? "Clear" : "Held";
}
