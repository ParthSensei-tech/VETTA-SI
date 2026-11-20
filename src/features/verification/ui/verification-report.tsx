import { useState } from "react";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  FileText,
  HelpCircle,
  Info,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useVerificationReportQuery } from "@/features/verification/api/query";
import type {
  ReportClaim,
  VerificationReportView,
  RawForensicInspectionView,
} from "@/features/verification/domain/report";
import type {
  DocumentAuthenticityReport,
  AuthenticityWarning,
  DetectedCredential,
} from "@/features/verification/domain/certificate-authenticity";
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
import { Progress } from "@/shared/components/ui/progress";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";

/**
 * Verification Report & Candidate Drawer.
 *
 * First represents the Raw Forensic Inspection & Authenticity Report tab
 * (International credentials, Indian institutional certificates, digital signatures,
 * synthetic document footprint, and 4-use free quota tracking).
 *
 * Second tab represents the Claim-by-Claim Verification Ledger.
 *
 * Any detected anomalies are staged as NON-BLOCKING ADVISORY WARNINGS with
 * concrete recruiter interview probes.
 */
export function VerificationReport({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  const query = useVerificationReportQuery(open ? applicationId : null);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm" title="Open candidate authenticity & verification report">
          <ShieldCheck className="size-4" />
          Verification & Forensics
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Candidate Authenticity & Claim Verification</SheetTitle>
          <SheetDescription>
            Deep forensic document inspection and claim verification ledger.
            Advisory warnings do not hinder or alter candidate ranking — all findings are staged for human-in-the-loop review.
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 py-5">
          {query.isPending ? <Skeleton className="h-40 rounded-2xl" /> : null}
          {query.isError ? (
            <p className="text-sm text-danger">The verification ledger could not be read. Try again.</p>
          ) : null}
          {query.data ? <ReportBody view={query.data} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReportBody({ view }: { view: VerificationReportView }) {
  const { verdict, job, claims, coverage, forensics } = view;
  const arms = undisclosedArms(claims);
  const headline = verdict?.headline ?? "none";

  return (
    <div className="flex flex-col gap-5">
      {/* Top Status Header */}
      <section className="flex flex-col gap-2 rounded-xl bg-surface p-3.5 border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {headline !== "none" ? (
              <Badge variant={toneOrOutline(headlineTone(headline))}>{headlineLabel(headline)}</Badge>
            ) : null}
            {job && (job.status === "queued" || job.status === "running") ? (
              <Badge variant="outline">Checking…</Badge>
            ) : null}
            {job?.status === "failed" ? (
              <Badge variant="warn">Verification incomplete — {job.error || "job failed"}</Badge>
            ) : null}
          </div>
          {forensics?.quota ? (
            <span className="font-mono text-xs text-muted">
              {forensics.quota.plan === "paid" ? (
                <span className="text-success font-medium">Enterprise Paid Plan (Unlimited)</span>
              ) : (
                <span>
                  Quota: {forensics.quota.usesSpent} / {forensics.quota.freeQuota} free checks used
                </span>
              )}
            </span>
          ) : null}
        </div>
        <Progress value={Math.round(coverage.ratio * 100)} />
        <p className="text-xs text-muted">
          {coverageSentence(coverage)}
          {claims.length > coverage.claims ? ` · ${claims.length - coverage.claims} not checkable` : ""}
        </p>
      </section>

      {/* Tabs: Forensic Inspection is the first / default tab */}
      <Tabs defaultValue="forensics" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="forensics" className="flex items-center gap-2">
            <FileSearch className="size-4" />
            Raw Forensics & Authenticity
          </TabsTrigger>
          <TabsTrigger value="claims" className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            Claim Verification ({claims.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Raw Forensics & Authenticity ── */}
        <TabsContent value="forensics" className="space-y-5">
          {forensics ? (
            <ForensicsTabContent forensics={forensics} />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              <FileSearch className="mx-auto size-8 text-muted/60" />
              <p className="mt-2 font-medium">Document Bytes Not Retained</p>
              <p className="mt-1 text-xs">
                Raw byte-level forensics are inactive for this workspace. Originals must be retained under workspace settings to enable digital signature and synthetic inspection.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: Claim Verification ── */}
        <TabsContent value="claims" className="space-y-4">
          {claims.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing in this document can be checked against arithmetic, dates or a registry yet. That is a statement about the engine's reach, not about the candidate.
            </p>
          ) : (
            <section className="flex flex-col gap-3">
              {claimsInReportOrder(claims).map((claim) => (
                <ClaimRow key={claim.claimId} claim={claim} />
              ))}
            </section>
          )}

          {arms.length > 0 ? (
            <section className="flex flex-col gap-2 pt-2">
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                What we could not check
              </h3>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ForensicsTabContent({ forensics }: { forensics: RawForensicInspectionView }) {
  const { quota, documents } = forensics;

  return (
    <div className="space-y-4">
      {/* 4-Use Free Quota Indicator */}
      <div className="rounded-xl border border-border bg-surface/70 p-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="size-4 text-accent" />
            <span className="text-xs font-medium">Authenticity Analysis Quota</span>
          </div>
          <Badge variant={quota.plan === "paid" || quota.entitled ? "success" : "warn"}>
            {quota.plan === "paid"
              ? "Paid Plan Active"
              : quota.entitled
                ? `${quota.usesLeft} Free Checks Remaining`
                : "Free Allowance Spent (4/4)"}
          </Badge>
        </div>
        <p className="mt-1.5 text-xs text-muted leading-relaxed">
          {quota.reason}
        </p>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted">No uploaded documents were retained for deep byte inspection.</p>
      ) : (
        documents.map((doc, idx) => (
          <DocumentForensicCard key={idx} doc={doc} />
        ))
      )}
    </div>
  );
}

function DocumentForensicCard({ doc }: { doc: DocumentAuthenticityReport }) {
  return (
    <article className="rounded-xl border border-border bg-elevated/30 p-4 space-y-4">
      {/* File Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-accent" />
          <h4 className="text-sm font-semibold">{doc.filename}</h4>
          <Badge variant="outline" className="text-[10px] uppercase">
            {doc.docClass || doc.format}
          </Badge>
        </div>
        <Badge
          variant={
            doc.overallStatus === "authentic_verified"
              ? "success"
              : doc.overallStatus === "advisory_warning"
                ? "warn"
                : "outline"
          }
        >
          {doc.overallStatus === "authentic_verified"
            ? "Authentic Verified"
            : doc.overallStatus === "advisory_warning"
              ? "Advisory Notices"
              : "Standard Document"}
        </Badge>
      </div>

      {/* Generation Footprint */}
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-surface p-2.5 border border-border/50">
          <span className="text-muted block text-[10px]">Generation Type</span>
          <span className="font-medium capitalize mt-0.5 block">
            {doc.generationType.replace(/_/g, " ")}
          </span>
        </div>
        <div className="rounded-lg bg-surface p-2.5 border border-border/50">
          <span className="text-muted block text-[10px]">Authoring Tool</span>
          <span className="font-medium truncate mt-0.5 block" title={doc.generatorTool ?? "Standard"}>
            {doc.generatorTool ?? "Standard Word Processor"}
          </span>
        </div>
        <div className="rounded-lg bg-surface p-2.5 border border-border/50 col-span-2 sm:col-span-1">
          <span className="text-muted block text-[10px]">Editing Life</span>
          <span className="font-medium mt-0.5 block">
            {doc.editingMinutes !== null && doc.editingMinutes !== undefined
              ? `${doc.editingMinutes} mins (${doc.revisionCount ?? 1} revs)`
              : doc.revisionCount
                ? `${doc.revisionCount} revisions`
                : "Single generation"}
          </span>
        </div>
      </div>

      {/* Recognized Credentials (International & Indian) */}
      {doc.credentials.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-muted uppercase tracking-wider flex items-center gap-1.5">
            <Award className="size-3.5" />
            Detected Credentials & Institutional Certifications ({doc.credentials.length})
          </h5>
          <div className="space-y-2">
            {doc.credentials.map((cred, i) => (
              <CredentialRow key={i} cred={cred} />
            ))}
          </div>
        </div>
      )}

      {/* Staged Advisory Warnings (Non-Blocking) */}
      {doc.warnings.length > 0 && (
        <div className="space-y-2 pt-1">
          <h5 className="text-xs font-medium text-warn uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 text-warn" />
            Advisory Authenticity Warnings ({doc.warnings.length})
          </h5>
          <p className="text-[11px] text-muted">
            These staged warnings highlight items to verify during interviews. They do not block the candidate or alter scores.
          </p>
          <div className="space-y-2.5">
            {doc.warnings.map((w, idx) => (
              <WarningRow key={idx} warning={w} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function CredentialRow({ cred }: { cred: DetectedCredential }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface/80 p-3 text-xs space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-medium text-fg">{cred.issuer}</span>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {cred.origin === "indian" ? "Indian Institutional" : "International Credential"}
          </Badge>
          {cred.signatureFound ? (
            <Badge variant="success" className="text-[10px] flex items-center gap-1">
              <CheckCircle2 className="size-3" />
              Digitally Signed
            </Badge>
          ) : cred.verificationUrl ? (
            <Badge variant="success" className="text-[10px] flex items-center gap-1">
              <CheckCircle2 className="size-3" />
              URL Verified
            </Badge>
          ) : (
            <Badge variant="warn" className="text-[10px]">
              Unverified Link
            </Badge>
          )}
        </div>
      </div>
      {cred.signatureSigner && (
        <p className="text-[11px] text-muted font-mono">
          Signer: {cred.signatureSigner}
        </p>
      )}
      {cred.verificationUrl && (
        <div className="flex items-center gap-1 text-[11px] text-accent truncate">
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">{cred.verificationUrl}</span>
        </div>
      )}
    </div>
  );
}

function WarningRow({ warning }: { warning: AuthenticityWarning }) {
  return (
    <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-warn flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" />
          {warning.label}
        </span>
        <span className="text-[10px] uppercase font-mono text-muted tracking-wide">
          {warning.category.replace(/_/g, " ")}
        </span>
      </div>
      <p className="text-muted leading-relaxed">{warning.reason}</p>
      {warning.suggestedInterviewProbe && (
        <div className="rounded-md border border-accent/20 bg-accent/5 p-2.5 text-[11px] text-fg">
          <span className="font-semibold text-accent block mb-1 flex items-center gap-1">
            <HelpCircle className="size-3" />
            Suggested Recruiter Interview Probe:
          </span>
          <p className="italic text-muted">{warning.suggestedInterviewProbe}</p>
        </div>
      )}
    </div>
  );
}

function toneOrOutline(tone: BadgeTone | null): "success" | "warn" | "danger" | "outline" {
  return tone === "success" || tone === "warn" || tone === "danger" ? tone : "outline";
}

function ClaimRow({ claim }: { claim: ReportClaim }) {
  const said = claimNarrative(claim);
  return (
    <article className="rounded-xl bg-elevated/40 p-3 border border-border/50">
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
