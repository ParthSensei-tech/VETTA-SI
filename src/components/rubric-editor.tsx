/**
 * Founder-facing rubric: LLM drafts, human confirms.
 * Not a blank-canvas builder — edit 5–8 criteria + hard constraints.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { scanCriterionText, validateCriteria } from "@/lib/recruiting/rubric-guardrails";
import {
  generateRoleRubric,
  getActiveRubric,
  saveRubricEdits,
} from "@/lib/recruiting/rubric-api";
import type {
  CriterionKind,
  CriterionWeight,
  HardConstraints,
  RubricCriterion,
  RubricVersion,
} from "@/lib/recruiting/rubric-types";
import { DEFAULT_HARD_CONSTRAINTS } from "@/lib/recruiting/rubric-types";
import { errorMessage } from "@/lib/recruiting/query";
import { cn } from "@/lib/utils";

function newLocalId() {
  return crypto.randomUUID();
}

export function RubricEditor({ roleId }: { roleId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["rubric", roleId],
    queryFn: () => getActiveRubric({ data: { roleId } }),
  });

  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [hard, setHard] = useState<HardConstraints>(DEFAULT_HARD_CONSTRAINTS);
  const [versionMeta, setVersionMeta] = useState<Pick<
    RubricVersion,
    "version" | "status" | "source"
  > | null>(null);

  useEffect(() => {
    if (query.data) {
      setCriteria(query.data.criteria);
      setHard(query.data.hardConstraints);
      setVersionMeta({
        version: query.data.version,
        status: query.data.status,
        source: query.data.source,
      });
    }
  }, [query.data]);

  const locked = versionMeta?.status === "locked";
  // Locked still allows creating a *new* version (not silent edit).
  const canEdit = true;

  const genMut = useMutation({
    mutationFn: () => generateRoleRubric({ data: { roleId } }),
    onSuccess: (r) => {
      setCriteria(r.criteria);
      setHard(r.hardConstraints);
      setVersionMeta({ version: r.version, status: r.status, source: r.source });
      void qc.invalidateQueries({ queryKey: ["rubric", roleId] });
      toast.success("Rubric drafted from the job — review and confirm");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveRubricEdits({
        data: {
          roleId,
          criteria: criteria.map((c) => ({
            id: c.id,
            name: c.name,
            weight: c.weight,
            kind: c.kind,
            strongEvidence: c.strongEvidence,
          })),
          hardConstraints: hard,
          activate: true,
        },
      }),
    onSuccess: (res) => {
      setCriteria(res.rubric.criteria);
      setHard(res.rubric.hardConstraints);
      setVersionMeta({
        version: res.rubric.version,
        status: res.rubric.status,
        source: res.rubric.source,
      });
      void qc.invalidateQueries({ queryKey: ["rubric", roleId] });
      void qc.invalidateQueries({ queryKey: ["role", roleId] });
      toast.success(
        res.rerankTriggered
          ? `Rubric v${res.rubric.version} active — re-ranking candidates`
          : `Rubric v${res.rubric.version} confirmed`,
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const guard = validateCriteria(criteria);

  const updateCriterion = (id: string, patch: Partial<RubricCriterion>) => {
    setCriteria((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  if (query.isPending && !versionMeta) {
    return <p className="text-sm text-muted">Loading rubric…</p>;
  }

  return (
    <section className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Match rubric</p>
          <h2 className="mt-1 font-display text-2xl tracking-tight">What “fit” means for this seat</h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            We draft 5–8 criteria from the job. You edit the wording — you don’t build from a blank
            page. City, notice, and pay are hard constraints (filter or flag), not part of the score
            blend.
          </p>
          {versionMeta ? (
            <p className="mt-2 text-xs text-subtle">
              Version {versionMeta.version}
              {versionMeta.status === "locked" ? " · locked (shortlist stamped)" : ` · ${versionMeta.status}`}
              {versionMeta.source ? ` · ${versionMeta.source}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={genMut.isPending} onClick={() => genMut.mutate()}>
            {genMut.isPending ? "Drafting…" : criteria.length ? "Re-draft from JD" : "Draft from JD"}
          </Button>
          {criteria.length > 0 ? (
            <Button disabled={saveMut.isPending || !guard.ok} onClick={() => saveMut.mutate()}>
              {saveMut.isPending
                ? "Saving…"
                : locked
                  ? "Save as new version"
                  : "Confirm rubric"}
            </Button>
          ) : null}
        </div>
      </div>

      {criteria.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted">No rubric yet. Draft one from this job description.</p>
          <Button className="mt-4" disabled={genMut.isPending} onClick={() => genMut.mutate()}>
            {genMut.isPending ? "Drafting…" : "Draft rubric"}
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {guard.blocks.length > 0 ? (
            <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              <p className="font-medium">Blocked criteria</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {guard.blocks.map((b, i) => (
                  <li key={i}>{b.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {guard.warns.length > 0 ? (
            <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
              <p className="font-medium">Fairness check</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {guard.warns.slice(0, 4).map((w, i) => (
                  <li key={i}>{w.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="flex flex-col gap-4">
            {criteria.map((c, idx) => {
              const hits = scanCriterionText(c.name, c.strongEvidence);
              return (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-xl border border-border p-4",
                    hits.some((h) => h.severity === "block") && "border-danger/50",
                  )}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-subtle">Criterion {idx + 1}</span>
                    {canEdit && criteria.length > 5 ? (
                      <button
                        type="button"
                        className="text-xs text-muted hover:text-danger"
                        onClick={() => setCriteria((list) => list.filter((x) => x.id !== c.id))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={c.name}
                        onChange={(e) => updateCriterion(c.id, { name: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Weight</Label>
                      <div className="mt-1 flex gap-1">
                        {(["high", "medium", "low"] as CriterionWeight[]).map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => updateCriterion(c.id, { weight: w })}
                            className={cn(
                              "rounded-lg px-3 py-1.5 text-xs capitalize",
                              c.weight === w ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
                            )}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Type</Label>
                      <div className="mt-1 flex gap-1">
                        {(["must", "nice"] as CriterionKind[]).map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => updateCriterion(c.id, { kind: k })}
                            className={cn(
                              "rounded-lg px-3 py-1.5 text-xs",
                              c.kind === k ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
                            )}
                          >
                            {k === "must" ? "Must-have" : "Nice-to-have"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs">What strong evidence looks like</Label>
                      <Textarea
                        value={c.strongEvidence}
                        onChange={(e) => updateCriterion(c.id, { strongEvidence: e.target.value })}
                        className="mt-1 min-h-20 text-sm"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {criteria.length < 8 ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                setCriteria((list) => [
                  ...list,
                  {
                    id: newLocalId(),
                    name: "New criterion",
                    weight: "medium",
                    kind: "nice",
                    strongEvidence: "Describe what strong evidence looks like on a resume.",
                  },
                ])
              }
            >
              Add criterion
            </Button>
          ) : null}

          <div className="rounded-xl border border-border p-4">
            <h3 className="font-display text-lg">Hard constraints</h3>
            <p className="mt-1 text-xs text-muted">
              These filter or flag candidates. They are not blended into the match score.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">City / location</Label>
                <Input
                  value={hard.city}
                  onChange={(e) => setHard((h) => ({ ...h, city: e.target.value }))}
                  className="mt-1"
                  placeholder="Bengaluru — leave blank for any"
                />
              </div>
              <div>
                <Label className="text-xs">Max notice (days)</Label>
                <Input
                  type="number"
                  value={hard.noticeMaxDays ?? ""}
                  onChange={(e) =>
                    setHard((h) => ({
                      ...h,
                      noticeMaxDays: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Comp min (LPA)</Label>
                <Input
                  type="number"
                  value={hard.compMinLpa ?? ""}
                  onChange={(e) =>
                    setHard((h) => ({
                      ...h,
                      compMinLpa: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Comp max (LPA)</Label>
                <Input
                  type="number"
                  value={hard.compMaxLpa ?? ""}
                  onChange={(e) =>
                    setHard((h) => ({
                      ...h,
                      compMaxLpa: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={hard.strictFilter}
                onChange={(e) => setHard((h) => ({ ...h, strictFilter: e.target.checked }))}
              />
              Strict filter (exclude instead of only flag)
            </label>
          </div>

          {locked ? (
            <p className="text-xs text-muted">
              This rubric is locked because a shortlist was stamped. Saving creates a{" "}
              <strong>new version</strong> and re-ranks — it does not rewrite old shortlists.
            </p>
          ) : (
            <p className="text-xs text-subtle">
              After candidates are scored, edits create a new version and re-rank. Old shortlists keep
              the version they were scored on.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
