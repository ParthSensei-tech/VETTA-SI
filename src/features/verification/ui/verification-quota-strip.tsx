import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { setVerificationPlan } from "@/features/verification/api/verification-api";
import { useVerificationQuotaQuery, verificationQueryKeys } from "@/features/verification/api/query";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { formatCostInr } from "@/platform/observability/cost";

/**
 * What the paid half of this feature costs the workspace, and what it has used.
 *
 * The strip exists because the ladder now has two rungs and a recruiter cannot
 * see the difference from a verdict: a report that ran the byte arms and a report
 * that fell back to the free ladder both look complete, and only the list of
 * arms under "what we could not check" says which happened. So the commercial
 * state is shown where the work is read, in the workspace's own words, with the
 * numbers taken from the server's meter rather than anything the browser counts.
 *
 * Two things it deliberately does not do.
 *
 * 1. **It does not take money.** Nothing in this product bills. The button
 *    records that an agreement exists outside it, which is what switches the
 *    checks that need the original file on for the reports after it — and the
 *    sentence next to the button keeps saying that, because a control labelled
 *    "Subscribe" that charges nobody is a dark pattern.
 * 2. **It does not offer an allowance.** The number of free reports a workspace
 *    was granted is read from the meter and is not an input here; a page that
 *    could set it is a page that could set it to endless.
 *
 * The cost line is measured, not quoted: it is what the reports that ran
 * actually cost to produce, summed out of the charges. For the checks that read
 * the file the honest answer is ₹0.00, and it is shown as that rather than as
 * the price list for a lookup the engine has not made.
 */
export function VerificationQuotaStrip() {
  const query = useVerificationQuotaQuery();
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: (plan: "free" | "paid") => setVerificationPlan({ data: { plan } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: verificationQueryKeys.quota });
    },
  });

  if (query.isPending) return <Skeleton className="h-20 rounded-2xl" />;
  if (query.isError || !query.data) {
    // Same silence as the file shelf: the meter being unreadable changes no
    // verdict and blocks no rank, and an error banner here would be the one
    // thing a recruiter could mistake for the feature being down.
    return null;
  }

  const quota = query.data;

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-elevated">
          <Gauge className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Fake-document checks</h3>
          <p className="mt-1 text-xs text-muted">{quota.reason}</p>
          <p className="mt-2 text-[11px] text-subtle">
            {quota.plan === "paid"
              ? `Plan active · every candidate report runs the checks that read the original file, and is charged as it is produced.`
              : `Free reports used: ${quota.usesSpent} of ${quota.freeQuota}. A report is one candidate's whole document, not one claim, so a long résumé is not a longer bill.`}
            {quota.measuredCostPaise > 0
              ? ` Measured cost so far: ${formatCostInr(quota.measuredCostPaise / 100)}.`
              : ` Measured cost so far: ${formatCostInr(0)} — the checks that read the file cost the pool CPU and nothing else.`}
          </p>
        </div>
        {quota.plan === "paid" ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => mut.mutate("free")}>
              Drop the recorded plan
            </Button>
          </div>
        ) : !quota.entitled ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              disabled={mut.isPending}
              onClick={() => mut.mutate("paid")}
              title="Marks that this workspace has an agreement outside Vetta. Nothing is charged here."
            >
              {mut.isPending ? "Recording…" : "Record an existing plan"}
            </Button>
          </div>
        ) : null}
      </div>
      {mut.isError ? (
        <p className="mt-2 text-xs text-danger">
          {(mut.error as Error).message || "That did not save. Try again."}
        </p>
      ) : null}
    </section>
  );
}
