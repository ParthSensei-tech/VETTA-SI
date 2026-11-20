import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  FileText,
  Lock,
  RefreshCw,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  getOrgDpdpAudit,
  getOrgDsarQueue,
  getOrgBreachIncidents,
  getDpbiFilingText,
  resolveDsar,
  reportBreach,
  signDpaAgreement,
  triggerRetentionPurge,
  updateGrievanceOfficer,
} from "../api/dpdp-api.ts";
import { TermsOfServiceLink, DpaLink, AntiScrapingPolicyLink } from "./legal-terms-dialog";
import { cn } from "@/shared/utils";

export function DpdpComplianceCard() {
  const qc = useQueryClient();

  // Queries
  const auditQuery = useQuery({
    queryKey: ["dpdpAudit"],
    queryFn: () => getOrgDpdpAudit(),
  });

  const dsarQuery = useQuery({
    queryKey: ["dpdpDsarQueue"],
    queryFn: () => getOrgDsarQueue(),
  });

  const breachQuery = useQuery({
    queryKey: ["dpdpBreaches"],
    queryFn: () => getOrgBreachIncidents(),
  });

  // State
  const [dpaModalOpen, setDpaModalOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("Chief Legal Officer");

  const [dpoModalOpen, setDpoModalOpen] = useState(false);
  const [dpoName, setDpoName] = useState("");
  const [dpoEmail, setDpoEmail] = useState("");
  const [dpoPhone, setDpoPhone] = useState("");
  const [dpoAddress, setDpoAddress] = useState("");

  const [activeFiling, setActiveFiling] = useState<string | null>(null);

  // Mutations
  const signDpaMut = useMutation({
    mutationFn: () =>
      signDpaAgreement({
        data: { signerName, signerTitle },
      }),
    onSuccess: () => {
      toast.success("DPA signed successfully under DPDP Rule 4 standards.");
      setDpaModalOpen(false);
      qc.invalidateQueries({ queryKey: ["dpdpAudit"] });
    },
    onError: (err: Error) => toast.error(`Failed to sign DPA: ${err.message}`),
  });

  const updateDpoMut = useMutation({
    mutationFn: () =>
      updateGrievanceOfficer({
        data: {
          officerName: dpoName,
          officerEmail: dpoEmail,
          officerPhone: dpoPhone,
          physicalAddress: dpoAddress,
        },
      }),
    onSuccess: () => {
      toast.success("Grievance Redressal Officer credentials updated.");
      setDpoModalOpen(false);
      qc.invalidateQueries({ queryKey: ["dpdpAudit"] });
    },
    onError: (err: Error) => toast.error(`Failed to update DPO: ${err.message}`),
  });

  const purgeRetentionMut = useMutation({
    mutationFn: () => triggerRetentionPurge(),
    onSuccess: (res) => {
      toast.success(`Purge completed: ${res.purged} expired candidate profile(s) cryptographically erased.`);
      qc.invalidateQueries({ queryKey: ["dpdpAudit"] });
    },
    onError: (err: Error) => toast.error(`Purge failed: ${err.message}`),
  });

  const resolveDsarMut = useMutation({
    mutationFn: (args: { requestId: string; notes: string }) =>
      resolveDsar({
        data: {
          requestId: args.requestId,
          resolutionNotes: args.notes,
          status: "resolved",
        },
      }),
    onSuccess: () => {
      toast.success("Candidate rights request resolved.");
      qc.invalidateQueries({ queryKey: ["dpdpDsarQueue"] });
      qc.invalidateQueries({ queryKey: ["dpdpAudit"] });
    },
    onError: (err: Error) => toast.error(`Failed to resolve request: ${err.message}`),
  });

  const fetchFilingMut = useMutation({
    mutationFn: (incidentId: string) =>
      getDpbiFilingText({ data: { incidentId } }),
    onSuccess: (res) => setActiveFiling(res.filingText),
    onError: (err: Error) => toast.error(`Failed to generate filing: ${err.message}`),
  });

  if (auditQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-44 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const data = auditQuery.data;
  if (!data) return null;

  const { audit, stats, dpa, dpo } = data;

  const scoreColor =
    audit.overallScore >= 88
      ? "text-emerald-500"
      : audit.overallScore >= 70
        ? "text-amber-500"
        : "text-rose-500";

  return (
    <div className="space-y-6">
      {/* 1. Header Hero Card with Compliance Score and Penalty Shield */}
      <Card className="border-border bg-surface/50 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                <CardTitle className="text-xl font-semibold">
                  DPDP Act (2023) & Rules Compliance Center
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  Rule 4 Active (Nov 2026)
                </Badge>
              </div>
              <CardDescription className="mt-1 text-sm text-muted">
                Statutory Data Fiduciary & Data Processor safeguards, automated purpose retention,
                provenance anti-scraping firewall, and 72-hour DPBI breach reporting.
              </CardDescription>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-bg/80 px-4 py-2.5">
                <div>
                  <div className="text-[11px] font-medium tracking-wide uppercase text-muted">
                    Compliance Score
                  </div>
                  <div className={cn("text-2xl font-bold tracking-tight", scoreColor)}>
                    {audit.overallScore}
                    <span className="text-sm font-normal text-muted">/100</span>
                  </div>
                </div>
                <div
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full text-xs font-bold",
                    audit.overallScore >= 88
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : audit.overallScore >= 70
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                  )}
                >
                  {audit.tier}
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-border bg-bg/80 px-4 py-2.5">
                <div>
                  <div className="text-[11px] font-medium tracking-wide uppercase text-muted">
                    Statutory Penalty Exposure
                  </div>
                  <div className="flex items-center gap-1.5 font-semibold text-fg">
                    {audit.penaltyExposureTier === "NONE" ? (
                      <span className="text-emerald-600 dark:text-emerald-400">₹0 Risk</span>
                    ) : audit.penaltyExposureTier === "CRITICAL" ? (
                      <span className="text-rose-600 dark:text-rose-400">Up to ₹250 Cr</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">Up to ₹50 Cr</span>
                    )}
                  </div>
                </div>
                <Scale className="size-5 text-muted" />
              </div>
            </div>
          </div>
        </CardHeader>

        {/* Remediation Action Banner if any */}
        {audit.remediationActions.length > 0 && (
          <div className="mx-6 mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 shrink-0 text-amber-500" />
              <span>Recommended Compliance Actions:</span>
            </div>
            <ul className="mt-1.5 list-inside list-disc space-y-1 pl-1">
              {audit.remediationActions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <div className="flex items-center gap-6 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              <span>DPA Status: {stats.dpaSigned ? "Signed & Active" : "Unsigned"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              <span>Retention Policy: {stats.retentionDays} Days</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              <span>DPO / Grievance Officer: {stats.dpoConfigured ? dpo?.officerName : "Not Set"}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => purgeRetentionMut.mutate()}
              disabled={purgeRetentionMut.isPending}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              {purgeRetentionMut.isPending ? "Purging…" : "Run Auto-Purge GC"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => auditQuery.refetch()}
              disabled={auditQuery.isFetching}
            >
              <RefreshCw className={cn("mr-1.5 size-3.5", auditQuery.isFetching && "animate-spin")} />
              Re-Audit
            </Button>
          </div>
        </div>
      </Card>

      {/* 2. Grid of Core Pillars */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Pillar A: Enterprise DPA & SaaS Legalities */}
        <Card className="border-border bg-surface/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck className="size-4 text-primary" />
                <CardTitle className="text-base font-medium">Enterprise DPA Agreement</CardTitle>
              </div>
              <Badge variant={stats.dpaSigned ? "success" : "warn"} className="text-xs">
                {stats.dpaSigned ? "Executed" : "Pending Signature"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              SaaS Data Processing Addendum formally establishing Vetta as Data Processor under
              Rule 4, limiting processing solely to employer hiring instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {stats.dpaSigned ? (
              <div className="rounded-lg border border-border bg-bg/60 p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted">Agreement Version:</span>
                  <span className="font-medium">{dpa?.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Signed By:</span>
                  <span className="font-medium">{dpa?.signerName} ({dpa?.signerTitle ?? "Executive"})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Executed At:</span>
                  <span className="font-medium">{dpa?.agreedAt ? new Date(dpa.agreedAt).toLocaleDateString() : ""}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-3 text-muted">
                No active DPA signed for this organization. Executing the DPA ensures your workspace
                holds legal defense against statutory fiduciary violations.
              </div>
            )}
          </CardContent>
          <div className="border-t border-border p-4">
            <Dialog open={dpaModalOpen} onOpenChange={setDpaModalOpen}>
              <DialogTrigger asChild>
                <Button variant="default" size="sm" className="w-full">
                  <FileText className="mr-1.5 size-3.5" />
                  {stats.dpaSigned ? "Re-Sign / Review Terms" : "Sign Enterprise DPA"}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Sign Data Processing Addendum (DPA)</DialogTitle>
                  <DialogDescription>
                    Execute the DPDP Rule 4 Data Processing Addendum binding Vetta as Data Processor
                    under your organization's direct mandate.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="signerName" className="text-xs">Signer Full Name</Label>
                    <Input
                      id="signerName"
                      placeholder="e.g. Vikram Sarabhai"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signerTitle" className="text-xs">Corporate Title</Label>
                    <Input
                      id="signerTitle"
                      placeholder="e.g. Chief Legal Officer / HR Director"
                      value={signerTitle}
                      onChange={(e) => setSignerTitle(e.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">
                    By clicking Execute, you represent you hold legal authority to bind this entity to the
                    statutory terms outlined in the <DpaLink className="font-semibold text-blue-600 dark:text-blue-400">DPDP Data Processing Addendum</DpaLink> and <TermsOfServiceLink className="font-semibold text-blue-600 dark:text-blue-400">Master SaaS Agreement</TermsOfServiceLink>.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDpaModalOpen(false)}>Cancel</Button>
                  <Button
                    variant="default"
                    disabled={!signerName.trim() || signDpaMut.isPending}
                    onClick={() => signDpaMut.mutate()}
                  >
                    {signDpaMut.isPending ? "Executing…" : "Execute DPA"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </Card>

        {/* Pillar B: Grievance Redressal / DPO Credentials */}
        <Card className="border-border bg-surface/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="size-4 text-primary" />
                <CardTitle className="text-base font-medium">Grievance Redressal Officer</CardTitle>
              </div>
              <Badge variant={stats.dpoConfigured ? "success" : "warn"} className="text-xs">
                {stats.dpoConfigured ? "Designated" : "Action Required"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Section 8(9) mandatory statutory officer details published in candidate notices for
              privacy requests and grievance escalation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {stats.dpoConfigured ? (
              <div className="rounded-lg border border-border bg-bg/60 p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted">Officer Name:</span>
                  <span className="font-medium">{dpo?.officerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Email:</span>
                  <span className="font-medium">{dpo?.officerEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Contact Phone:</span>
                  <span className="font-medium">{dpo?.officerPhone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Physical Address:</span>
                  <span className="max-w-[180px] truncate font-medium">{dpo?.physicalAddress}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-3 text-muted">
                No Grievance Officer designated. Under Section 8(9), every Data Fiduciary must
                publish grievance contact credentials.
              </div>
            )}
          </CardContent>
          <div className="border-t border-border p-4">
            <Dialog open={dpoModalOpen} onOpenChange={setDpoModalOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  {stats.dpoConfigured ? "Edit DPO Credentials" : "Designate Grievance Officer"}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Grievance Redressal / Data Protection Officer</DialogTitle>
                  <DialogDescription>
                    Provide statutory contact credentials published on candidate application notices.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2 text-xs">
                  <div className="space-y-1">
                    <Label htmlFor="dpoName">Officer Name</Label>
                    <Input id="dpoName" value={dpoName} onChange={(e) => setDpoName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dpoEmail">Official Email</Label>
                    <Input id="dpoEmail" type="email" value={dpoEmail} onChange={(e) => setDpoEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dpoPhone">Direct Phone (with country code)</Label>
                    <Input id="dpoPhone" placeholder="+91-9876543210" value={dpoPhone} onChange={(e) => setDpoPhone(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dpoAddress">Physical Office Address in India</Label>
                    <Input id="dpoAddress" placeholder="Floor, Building, City, State, PIN" value={dpoAddress} onChange={(e) => setDpoAddress(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDpoModalOpen(false)}>Cancel</Button>
                  <Button
                    variant="default"
                    disabled={!dpoName || !dpoEmail || updateDpoMut.isPending}
                    onClick={() => updateDpoMut.mutate()}
                  >
                    Save Credentials
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </Card>

        {/* Pillar C: Provenance & Anti-Mass-Scraping Protection */}
        <Card className="border-border bg-surface/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-primary" />
                <CardTitle className="text-base font-medium">Sourcing Provenance & Anti-Scraping</CardTitle>
              </div>
              <Badge
                variant={stats.unverifiedScrapedCandidates > 0 ? "danger" : "success"}
                className="text-xs"
              >
                {stats.unverifiedScrapedCandidates > 0 ? "Scraping Alert" : "Clean Sourcing"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Verifies candidate acquisition channels. Section 4 forbids automated processing of
              scraped public resumes without express outreach consent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-bg/60 p-2.5">
                <span className="text-muted">Total Candidates:</span>
                <p className="text-lg font-bold">{stats.totalCandidates}</p>
              </div>
              <div className="rounded-lg border border-border bg-bg/60 p-2.5">
                <span className="text-muted">Unverified Scrapes:</span>
                <p className={cn("text-lg font-bold", stats.unverifiedScrapedCandidates > 0 ? "text-rose-500" : "text-emerald-500")}>
                  {stats.unverifiedScrapedCandidates}
                </p>
              </div>
            </div>
            {stats.unverifiedScrapedCandidates > 0 ? (
              <p className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400">
                Warning: {stats.unverifiedScrapedCandidates} profiles marked as unverified scrapes cannot
                be exported to client cards until affirmative outreach consent is recorded.
              </p>
            ) : (
              <p className="text-muted">
                All candidates in your pool were received via direct portal application, recruiter mandate,
                or verified agency intake.
              </p>
            )}
            <div className="pt-1 flex items-center justify-between text-[11px] text-muted border-t border-border/40">
              <span>Provenance Standard:</span>
              <AntiScrapingPolicyLink className="text-[11px] font-semibold text-blue-600 dark:text-blue-400" />
            </div>
          </CardContent>
        </Card>

        {/* Pillar D: Personal Data Breach Reporting (72h DPBI) */}
        <Card className="border-border bg-surface/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-primary" />
                <CardTitle className="text-base font-medium">72-Hour DPBI Breach Hub</CardTitle>
              </div>
              <Badge
                variant={stats.activeBreachesCount > 0 ? "danger" : "success"}
                className="text-xs"
              >
                {stats.activeBreachesCount > 0 ? "Active Incident" : "Zero Incidents"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Section 8(6) statutory incident tracking. Formats standard intimations to the Data
              Protection Board of India within the mandatory 72-hour window.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between rounded-lg border border-border bg-bg/60 p-3">
              <div>
                <span className="text-muted">Active Security Incidents:</span>
                <p className="text-base font-semibold">{stats.activeBreachesCount}</p>
              </div>
              <div>
                <span className="text-muted">DPBI Intimation SLA:</span>
                <p className="text-base font-semibold">72 Hours</p>
              </div>
            </div>
            {breachQuery.data && breachQuery.data.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="font-medium text-muted">Recent Incidents:</span>
                {breachQuery.data.slice(0, 2).map((inc) => (
                  <div key={inc.id} className="flex items-center justify-between rounded border border-border p-2">
                    <span className="truncate max-w-[180px]">{inc.title}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => fetchFilingMut.mutate(inc.id)}
                    >
                      View DPBI Filing
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 3. Candidate Rights (DSAR) Queue */}
      <Card className="border-border bg-surface/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">
                Data Principal Rights (DSAR) & Grievance Redressal Queue
              </CardTitle>
              <CardDescription className="text-xs">
                Candidate requests under Sections 11-14: Access Summary, Correction, Erasure, Grievance,
                and Nominee designation. Statutory SLA: 30 days.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              {dsarQuery.data?.length ?? 0} Total Requests
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {dsarQuery.data && dsarQuery.data.length > 0 ? (
            <div className="divide-y divide-border rounded-lg border border-border">
              {dsarQuery.data.map((req) => (
                <div key={req.id} className="flex flex-col gap-2 p-3 text-xs md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold uppercase tracking-wider text-primary">
                        {req.requestType.replace("_", " ")}
                      </span>
                      <Badge variant={req.status === "resolved" ? "default" : "outline"} className="text-[10px]">
                        {req.status}
                      </Badge>
                      {req.status === "pending" && (
                        <span className={cn("text-[11px] font-medium", req.daysRemaining <= 5 ? "text-rose-500 font-bold" : "text-muted")}>
                          {req.daysRemaining} days left in SLA
                        </span>
                      )}
                    </div>
                    <p className="text-muted">
                      From: <span className="font-medium text-fg">{req.subjectName ?? req.subjectEmail}</span> ({req.subjectEmail})
                    </p>
                    <p className="italic text-muted/90 max-w-xl">"{req.details}"</p>
                  </div>
                  {req.status === "pending" && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() =>
                        resolveDsarMut.mutate({
                          requestId: req.id,
                          notes: "Resolved and communicated to candidate via official DPO channel.",
                        })
                      }
                      disabled={resolveDsarMut.isPending}
                    >
                      Resolve Request
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted">
              No pending Data Principal rights requests in this organization.
            </div>
          )}
        </CardContent>
      </Card>

      {/* DPBI Intimation Modal */}
      <Dialog open={Boolean(activeFiling)} onOpenChange={(open) => !open && setActiveFiling(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Statutory DPBI Breach Intimation Report</DialogTitle>
            <DialogDescription>
              Filing template compliant with Section 8(6) of the Digital Personal Data Protection Act, 2023.
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded bg-muted/30 p-4 text-xs font-mono whitespace-pre-wrap">
            {activeFiling}
          </pre>
          <div className="flex justify-end pt-2">
            <Button variant="default" onClick={() => setActiveFiling(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
