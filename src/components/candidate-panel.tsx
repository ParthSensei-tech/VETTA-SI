import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { PipelineChip, ScoreChip } from "@/shared/components/status-chip";
import { ProvenanceChip, ProvenanceDetail } from "@/components/provenance-badge";
import {
  generateAsyncScreen,
  prepareClientPack,
  rerankApplication,
  saveScreenAnswers,
  updateApplication,
} from "@/lib/recruiting/api";
import { FIT_LABEL, KNOWLEDGE_LABEL } from "@/lib/recruiting/constants";
import { copyText } from "@/lib/recruiting/links";
import { errorMessage, queryKeys } from "@/lib/recruiting/query";
import { recordOutcome } from "@/lib/recruiting/outcome-api";
import { getScreenInvite, recordScreenReminder } from "@/lib/recruiting/screen-session";
import type { Application, PipelineStatus } from "@/lib/recruiting/types";
import { cn } from "@/shared/utils";

const MOVES: Array<{ status: PipelineStatus; label: string }> = [
  { status: "shortlisted", label: "Shortlist" },
  { status: "hold", label: "Hold" },
  { status: "rejected", label: "Out" },
];

const OUTCOMES: Array<{ kind: string; label: string }> = [
  { kind: "interview_pass", label: "Passed interview" },
  { kind: "interview_fail", label: "Failed interview" },
  { kind: "offer_yes", label: "Offer" },
  { kind: "offer_drop", label: "Offer drop" },
  { kind: "joined", label: "Joined" },
  { kind: "join_no", label: "Did not join" },
  { kind: "retained_90", label: "Stayed 90 days" },
  { kind: "left_90", label: "Left before 90" },
];

export function CandidatePanel({
  application,
  roleId,
}: {
  application: Application;
  roleId: string;
}) {
  const qc = useQueryClient();
  const { candidate, rank, screen } = application;
  const [notes, setNotes] = useState(application.recruiterNotes);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const a of screen?.answers ?? []) map[a.question_id] = a.answer;
    return map;
  });

  useEffect(() => {
    setNotes(application.recruiterNotes);
    const map: Record<string, string> = {};
    for (const a of screen?.answers ?? []) map[a.question_id] = a.answer;
    setAnswers(map);
  }, [application.id, application.recruiterNotes, screen?.id, screen?.updatedAt, screen?.answers]);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: queryKeys.role(roleId) });
    void qc.invalidateQueries({ queryKey: queryKeys.workspace });
    void qc.invalidateQueries({ queryKey: queryKeys.approvals });
    void qc.invalidateQueries({ queryKey: queryKeys.talent });
  }

  const statusMut = useMutation({
    mutationFn: async (pipelineStatus: PipelineStatus) => {
      await updateApplication({ data: { applicationId: application.id, pipelineStatus } });
      // Feed per-org ranking: shortlist / out become learning labels
      const label =
        pipelineStatus === "shortlisted"
          ? "shortlist"
          : pipelineStatus === "rejected"
            ? "reject"
            : pipelineStatus === "hold"
              ? "hold"
              : null;
      if (label) {
        try {
          const { submitRankLabel } = await import("@/lib/recruiting/labels");
          await submitRankLabel({ data: { applicationId: application.id, label } });
        } catch {
          /* labels table may not exist until migration */
        }
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success("Updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const notesMut = useMutation({
    mutationFn: () =>
      updateApplication({ data: { applicationId: application.id, recruiterNotes: notes } }),
    onSuccess: () => {
      invalidate();
      toast.success("Notes saved");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rerankMut = useMutation({
    mutationFn: () => rerankApplication({ data: { applicationId: application.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Re-ranked");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const outcomeMut = useMutation({
    mutationFn: (kind: string) =>
      recordOutcome({
        data: {
          applicationId: application.id,
          kind: kind as "joined",
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Outcome saved. The quality model updated.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const screenMut = useMutation({
    mutationFn: () => generateAsyncScreen({ data: { applicationId: application.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Async screen drafted");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const evalMut = useMutation({
    mutationFn: () => {
      if (!screen) throw new Error("No screen");
      return saveScreenAnswers({
        data: {
          screenId: screen.id,
          answers: screen.questions.map((q) => ({
            question_id: q.id,
            answer: answers[q.id] ?? "",
          })),
          evaluate: true,
        },
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Screen evaluated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const packMut = useMutation({
    mutationFn: () => prepareClientPack({ data: { applicationId: application.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Client pack queued for human approval");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const inviteMut = useMutation({
    mutationFn: () => getScreenInvite({ data: { applicationId: application.id } }),
    onSuccess: async (invite) => {
      const ok = await copyText(invite.screenUrl);
      toast.success(ok ? "Candidate screen link copied" : invite.screenUrl);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remindMut = useMutation({
    mutationFn: (channel: "email" | "whatsapp" | "copy") =>
      recordScreenReminder({ data: { applicationId: application.id, channel } }),
    onSuccess: (invite, channel) => {
      invalidate();
      if (channel === "email") window.location.href = invite.mailto;
      if (channel === "whatsapp" && invite.whatsappUrl) window.open(invite.whatsappUrl, "_blank");
      if (channel === "copy") void copyText(invite.screenUrl);
      toast.success("Reminder logged");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const screenStarted = Boolean(screen?.startedAt || (screen?.transcript.length ?? 0) > 1);
  const screenDone = Boolean(screen?.completedAt || screen?.status === "evaluated");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-wide text-muted uppercase">
              {candidate.currentTitle}
              {candidate.currentCompany ? ` · ${candidate.currentCompany}` : ""}
            </p>
            <h2 className="font-display text-3xl font-medium tracking-tight">
              {candidate.fullName}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {[
                candidate.location,
                candidate.email,
                candidate.yearsExperience != null ? `${candidate.yearsExperience} yrs` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {application.source === "portal" ? (
              <p className="mt-1 text-xs text-subtle">Applied via candidate portal</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <ScoreChip score={application.rankScore} />
            <PipelineChip status={application.pipelineStatus} />
            <ProvenanceChip provenance={application.provenance} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {MOVES.map((m) => (
            <Button
              key={m.status}
              size="sm"
              variant={application.pipelineStatus === m.status ? "default" : "secondary"}
              disabled={statusMut.isPending}
              onClick={() => statusMut.mutate(m.status)}
            >
              {m.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={rerankMut.isPending}
            onClick={() => rerankMut.mutate()}
          >
            {rerankMut.isPending ? "Ranking…" : "Re-rank"}
          </Button>
        </div>
      </header>

      {rank ? (
        <section className="grid gap-4">
          <div className="rounded-2xl bg-elevated p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="font-display text-xl">Ranking</h3>
              <p className="text-sm text-muted">
                {FIT_LABEL[rank.level]} ·{" "}
                <span className="font-mono tabular-nums">{rank.score}</span>
              </p>
            </div>
            <ProvenanceDetail
              provenance={application.provenance}
              onRerank={() => rerankMut.mutate()}
              isReranking={rerankMut.isPending}
            />
            <p className="text-sm leading-relaxed text-fg/90 mt-2">{rank.summary}</p>
            {rank.explain ? (
              <div className="mt-4 grid gap-3">
                <p className="text-sm leading-relaxed">{rank.explain.en}</p>
                <p className="text-sm leading-relaxed text-muted">{rank.explain.hi}</p>
                {rank.explain.pShortlist != null ? (
                  <p className="text-xs text-subtle">
                    Calibrated shortlist chance {rank.explain.pShortlist}% · {rank.explain.samples}{" "}
                    decisions
                    {rank.explain.brier != null ? ` · error ${rank.explain.brier}` : ""}
                  </p>
                ) : (
                  <p className="text-xs text-subtle">
                    Probability unlocks after {12 - Math.min(12, rank.explain.samples)} more
                    shortlist or reject calls.
                  </p>
                )}
              </div>
            ) : null}
            {rank.outcome ? (
              <p className="mt-3 text-xs text-subtle">
                {rank.outcome.ready
                  ? `Quality · interview ${rank.outcome.interview ?? "—"}% · offer ${rank.outcome.offer ?? "—"}% · join ${rank.outcome.join ?? "—"}% · stay 90 days ${rank.outcome.retain90 ?? "—"}%`
                  : `Quality model is learning. Interview ${rank.outcome.samples.interview}/8, offer ${rank.outcome.samples.offer}/8, join ${rank.outcome.samples.join}/8, stay ${rank.outcome.samples.retain90}/8.`}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {OUTCOMES.map((o) => (
                <Button
                  key={o.kind}
                  size="sm"
                  variant="outline"
                  disabled={outcomeMut.isPending}
                  onClick={() => outcomeMut.mutate(o.kind)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            {rank.match?.hardGates && rank.match.hardGates.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-danger">
                {rank.match.hardGates.map((g) => (
                  <li key={g}>· {g}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {rank.match?.dimensions && rank.match.dimensions.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                Match dimensions
              </h4>
              <ul className="flex flex-col gap-2">
                {rank.match.dimensions.map((d) => (
                  <li key={d.id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted">{d.label}</span>
                        <span className="font-mono tabular-nums text-subtle">{d.score}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-accent/80"
                          style={{ width: `${Math.max(4, Math.min(100, d.score))}%` }}
                        />
                      </div>
                      {d.note ? (
                        <p className="mt-0.5 truncate text-[11px] text-subtle">{d.note}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {rank.match.roleFamily ? (
                <p className="mt-2 text-[11px] text-subtle">
                  Role: {rank.match.roleFamily}
                  {rank.match.resumeFamily ? ` · Resume: ${rank.match.resumeFamily}` : ""}
                  {rank.match.familyAligned === false ? " · not aligned" : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {rank.stack_match.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                Skills
              </h4>
              <div className="flex flex-wrap gap-2">
                {rank.stack_match.map((s) => (
                  <span
                    key={s.skill}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs",
                      s.level === "strong" && "bg-success/15 text-success",
                      s.level === "partial" && "bg-warn/15 text-warn",
                      s.level === "missing" && "bg-danger/15 text-danger",
                    )}
                  >
                    {s.skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <ListBlock
              title="Evidence"
              items={rank.evidence.map((e) => `${e.claim}${e.quote ? ` — “${e.quote}”` : ""}`)}
            />
            <ListBlock title="Gaps" items={rank.gaps} />
            <ListBlock title="Risks" items={rank.risks} />
            <div className="rounded-2xl border border-border p-4">
              <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                India context
              </h4>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <Row k="Location" v={rank.india.location_fit.replace("_", " ")} />
                <Row k="Early-stage" v={rank.india.early_stage_fit} />
                <Row
                  k="Notice"
                  v={
                    rank.india.notice_period_days != null
                      ? `${rank.india.notice_period_days} days`
                      : "Unknown"
                  }
                />
                <Row
                  k="CTC"
                  v={
                    rank.india.current_ctc_lakh != null || rank.india.expected_ctc_lakh != null
                      ? `${rank.india.current_ctc_lakh ?? "?"} → ${rank.india.expected_ctc_lakh ?? "?"} LPA`
                      : "Unknown"
                  }
                />
              </dl>
              {rank.india.notes ? (
                <p className="mt-3 text-sm text-muted">{rank.india.notes}</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-5">
          <p className="text-sm text-muted">
            Not ranked yet. Rank now scores this resume against the JD. Uses configured AI providers
            (Groq, Gemini, Ollama, OpenAI, xAI) with automatic fallback to local evidence ranking.
          </p>
          <Button
            className="mt-3"
            size="sm"
            disabled={rerankMut.isPending}
            onClick={() => rerankMut.mutate()}
          >
            {rerankMut.isPending ? "Ranking…" : "Rank now"}
          </Button>
        </div>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl">Async screen</h3>
            {screen ? (
              <p className="mt-1 text-xs text-muted">
                {screenDone
                  ? "Completed"
                  : screenStarted
                    ? "In progress"
                    : screen.openedAt
                      ? "Opened"
                      : "Not opened"}{" "}
                · completion is the metric
                {screen.lastRemindedAt ? ` · reminded` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!screen ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={screenMut.isPending}
                onClick={() => screenMut.mutate()}
              >
                {screenMut.isPending ? "Drafting…" : "Generate questions"}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={inviteMut.isPending}
                  onClick={() => inviteMut.mutate()}
                >
                  Copy screen link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remindMut.isPending}
                  onClick={() => remindMut.mutate("email")}
                >
                  Remind email
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remindMut.isPending || !candidate.phone}
                  onClick={() => remindMut.mutate("whatsapp")}
                >
                  Remind WhatsApp
                </Button>
              </>
            )}
          </div>
        </div>
        {screen ? (
          <div className="flex flex-col gap-4">
            {screen.transcript.length > 0 ? (
              <div className="flex max-h-80 flex-col gap-2 overflow-auto rounded-2xl border border-border p-4">
                {screen.transcript.map((t) => (
                  <p key={t.id} className="text-sm leading-relaxed">
                    <span className="text-xs text-subtle">
                      {t.role === "agent" ? "Vetta" : "Candidate"} ·{" "}
                    </span>
                    {t.text}
                  </p>
                ))}
              </div>
            ) : null}
            {screen.questions.map((q, i) => (
              <div key={q.id} className="rounded-2xl border border-border p-4">
                <p className="text-xs text-muted">
                  {String(i + 1).padStart(2, "0")} · {q.time_minutes} min ·{" "}
                  {KNOWLEDGE_LABEL[q.kind]} · {q.intent}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{q.prompt}</p>
                {q.follow_ups[0] ? (
                  <p className="mt-2 text-xs text-subtle">Follow-up: {q.follow_ups[0].prompt}</p>
                ) : null}
                <Textarea
                  className="mt-3 min-h-24"
                  placeholder="Paste the candidate’s written answer"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex justify-end">
              <Button disabled={evalMut.isPending} onClick={() => evalMut.mutate()}>
                {evalMut.isPending ? "Evaluating…" : "Evaluate screen"}
              </Button>
            </div>
            {screen.status === "evaluated" ? (
              <div className="rounded-2xl bg-elevated p-5">
                <p className="text-sm font-medium">
                  {screen.evaluation.verdict}
                  {screen.evaluation.score != null ? (
                    <span className="ml-2 font-mono tabular-nums text-muted">
                      {screen.evaluation.score}
                    </span>
                  ) : null}
                </p>
                <p className="mt-2 text-sm text-muted">{screen.evaluation.notes}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Generate a written screen: practical work, basics, common sense, and follow-ups.
            Candidates get a mobile conversation — you can still paste answers here.
          </p>
        )}
      </section>

      <section className="grid gap-3">
        <Label>Private recruiter notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-24" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={notesMut.isPending}
            onClick={() => notesMut.mutate()}
          >
            Save notes
          </Button>
          <Button size="sm" disabled={packMut.isPending || !rank} onClick={() => packMut.mutate()}>
            {packMut.isPending ? "Drafting pack…" : "Prepare client pack"}
          </Button>
        </div>
        <p className="text-xs text-subtle">
          Client packs never send themselves. They wait in Approvals until a human stamps them.
        </p>
        {application.pendingApprovalId ? (
          <p className="text-xs text-warn">A pack is already waiting for approval.</p>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 font-display text-xl">Resume</h3>
        <pre className="max-h-80 overflow-auto rounded-2xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">
          {candidate.resumeText}
        </pre>
      </section>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-border p-4">
      <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{title}</h4>
      <ul className="flex flex-col gap-2 text-sm leading-relaxed">
        {items.map((item) => (
          <li key={item} className="text-fg/90">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-subtle">{k}</dt>
      <dd className="capitalize">{v}</dd>
    </>
  );
}
