import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useVerificationReportQuery } from "@/features/verification/api/query";
import type { ReportClaim, VerificationReportView } from "@/features/verification/domain/report";
import {
  claimNarrative,
  claimsInReportOrder,
  coverageSentence,
  headlineLabel,
  headlineTone,
  kindLabel,
  undisclosedArms,
  verdictLabel,
  verdictTone,
  type BadgeTone,
} from "@/features/verification/ui/verdict-presentation";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Progress } from "@/shared/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";

/**
 * The evidence behind the chip.
 *
 * This panel is the product. A verdict nobody can open is an accusation with no
 * defence, so every row here answers the three questions a recruiter is asked
 * afterwards: what was claimed, in whose words, and what checked it. The quote
 * is the document's own text, verbatim — the extraction path refuses an
 * ungrounded claim, which is what lets this panel promise that no sentence in
 * it was invented.
 *
 * The list at the bottom is the other half of the promise. An arm that was
 * capped by the plan, that needs the original file, or that the engine has not
 * built yet is named with its reason, because "we did not look at that" is
 * information the buyer is entitled to and the candidate will otherwise find
 * out first.
 */
export function VerificationReport({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  const query = useVerificationReportQuery(open ? applicationId : null);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm" title="Open the verification ledger">
          <ShieldCheck className="size-4" />
          Verification
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Claim verification</SheetTitle>
          <SheetDescription>
            Every checkable claim in this document, what it rested on, and what we could not reach.
            Verification is displayed only: it did not change this candidate's score.
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 py-5">
          {query.isPending ? <Skeleton className="h-40 rounded-2xl" /> : null}
          {query.isError ? (
            <p className="text-sm text-danger">The ledger could not be read. Try again.</p>
          ) : null}
          {query.data ? <ReportBody view={query.data} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReportBody({ view }: { view: VerificationReportView }) {
  const { verdict, job, claims, coverage } = view;
  const arms = undisclosedArms(claims);
  const headline = verdict?.headline ?? "none";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {headline !== "none" ? (
            <Badge variant={toneOrOutline(headlineTone(headline))}>{headlineLabel(headline)}</Badge>
          ) : null}
          {job && (job.status === "queued" || job.status === "running") ? (
            <Badge variant="outline">Checking…</Badge>
          ) : null}
          {job?.status === "failed" ? (
            <Badge variant="warn">Could not finish — {job.error || "verification failed"}</Badge>
          ) : null}
        </div>
        <Progress value={Math.round(coverage.ratio * 100)} />
        <p className="text-xs text-muted">
          {coverageSentence(coverage)}
          {claims.length > coverage.claims
            ? ` · ${claims.length - coverage.claims} not checkable`
            : ""}
        </p>
      </section>

      {claims.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing in this document can be checked against arithmetic, dates or a registry yet. That
          is a statement about the engine's reach, not about the candidate.
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          {claimsInReportOrder(claims).map((claim) => (
            <ClaimRow key={claim.claimId} claim={claim} />
          ))}
        </section>
      )}

      {arms.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
            What we could not check
          </h2>
          <ul className="flex flex-col gap-1.5">
            {arms.map((arm) => (
              <li key={arm.id} className="flex items-start justify-between gap-3 text-sm">
                <span>{arm.label}</span>
                <span className="shrink-0 text-xs text-subtle">{arm.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function toneOrOutline(tone: BadgeTone | null): "success" | "warn" | "danger" | "outline" {
  return tone === "success" || tone === "warn" || tone === "danger" ? tone : "outline";
}

function ClaimRow({ claim }: { claim: ReportClaim }) {
  const said = claimNarrative(claim);
  return (
    <article className="rounded-2xl bg-elevated/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={toneOrOutline(verdictTone(claim.verdict))}>
          {verdictLabel(claim.verdict)}
        </Badge>
        <span className="text-xs text-muted">{kindLabel(claim.kind)}</span>
        {claim.definitive ? null : (
          <span
            className="text-[10px] text-subtle"
            title="No check registered as decisive reached this, so it is a suspicion, not a finding."
          >
            not decisive
          </span>
        )}
      </div>
      <p className="mt-2 text-sm">{claim.statement}</p>
      <blockquote className="mt-1 border-l-2 border-border pl-2 font-mono text-[11px] text-muted">
        {claim.quote}
      </blockquote>
      {said ? <p className="mt-2 text-xs text-muted">{said}</p> : null}
      {claim.cappedFrom ? (
        <p className="mt-1 text-xs text-warn">
          Capped from {claim.cappedFrom}: the check that disagreed is not registered as decisive.
        </p>
      ) : null}
    </article>
  );
}
