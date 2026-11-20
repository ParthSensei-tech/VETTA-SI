import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Lock,
  Scale,
  Shield,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";

export type LegalDocType = "candidate_notice" | "saas_dpa" | "anti_scraping";

export function TermsAndConditionsDialog({
  open,
  onOpenChange,
  defaultTab = "candidate_notice",
  companyName = "Vetta",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: LegalDocType;
  companyName?: string;
}) {
  const [tab, setTab] = useState<string>(defaultTab);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden border-border bg-bg shadow-2xl">
        <DialogHeader className="p-6 pb-3 border-b border-border bg-surface/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Scale className="size-4" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold tracking-tight">
                  Legal Terms, Conditions & Privacy Architecture
                </DialogTitle>
                <DialogDescription className="text-xs text-muted">
                  Digital Personal Data Protection Act, 2023 (DPDP Act) & DPDP Rules Statutory Standards
                </DialogDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[11px] font-mono">
              v2026.11-R4
            </Badge>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="pt-3">
            <TabsList className="grid w-full grid-cols-3 bg-surface/80 p-1 border border-border">
              <TabsTrigger value="candidate_notice" className="gap-2 text-xs">
                <UserCheck className="size-3.5" />
                Candidate Notice
              </TabsTrigger>
              <TabsTrigger value="saas_dpa" className="gap-2 text-xs">
                <FileText className="size-3.5" />
                SaaS DPA & Terms
              </TabsTrigger>
              <TabsTrigger value="anti_scraping" className="gap-2 text-xs">
                <Lock className="size-3.5" />
                Anti-Scraping Checklist
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs leading-relaxed text-muted">
          {/* TAB 1: Candidate Notice */}
          {tab === "candidate_notice" && (
            <div className="space-y-4 text-fg/90">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
                <h4 className="font-semibold text-sm text-fg flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-primary" />
                  Statutory Rule 4 Pre-Processing Candidate Notice
                </h4>
                <p className="mt-1 text-xs text-muted">
                  Under Rule 4 of the DPDP Rules, 2025/2026, job applicants must be provided with an itemized,
                  unambiguous notice specifying processing purposes, data categories, and statutory rights.
                </p>
              </div>

              <div className="space-y-3">
                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">1. Data Fiduciary & Processor Roles</h5>
                <p>
                  <strong>{companyName}</strong> acts as the <strong>Data Fiduciary</strong> deciding recruitment
                  criteria and employment selections. <strong>Vetta Platform</strong> operates as the <strong>Data Processor</strong> providing
                  resume parsing, AI matching evidence, and workflow management under strict contractual instruction.
                </p>

                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">2. Itemized Processing Purposes</h5>
                <ul className="list-disc list-inside space-y-1.5 pl-2">
                  <li>
                    <strong className="text-fg">Role Fit Evaluation (Mandatory)</strong>: Reading your resume, verifying skill qualifications,
                    and ranking match against the specific job description.
                  </li>
                  <li>
                    <strong className="text-fg">Hiring Team Sharing (Opt-in)</strong>: Disclosing your candidate card and interview scores to
                    authorized interviewers and hiring managers.
                  </li>
                  <li>
                    <strong className="text-fg">Authenticity Verification (Forensics)</strong>: Reviewing digital signatures and certificate
                    authenticity metadata on submitted credentials.
                  </li>
                </ul>

                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">3. Candidate (Data Principal) Statutory Rights</h5>
                <p>Pursuant to Sections 11–14 of the DPDP Act 2023, you hold the absolute right to:</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-border bg-surface/50 p-2.5">
                    <strong className="text-fg block">Right to Access (Sec. 11)</strong>
                    Request a full summary of personal data and AI ranking traces processed for your application.
                  </div>
                  <div className="rounded border border-border bg-surface/50 p-2.5">
                    <strong className="text-fg block">Right to Erasure (Sec. 12)</strong>
                    Withdraw your consent at any time without penalty, triggering a complete cryptographic hard purge.
                  </div>
                  <div className="rounded border border-border bg-surface/50 p-2.5">
                    <strong className="text-fg block">Grievance Redressal (Sec. 13)</strong>
                    Submit any complaint directly to our designated Grievance Redressal Officer with a guaranteed 30-day resolution.
                  </div>
                  <div className="rounded border border-border bg-surface/50 p-2.5">
                    <strong className="text-fg block">Right to Nominate (Sec. 14)</strong>
                    Designate an authorized representative to exercise rights on your behalf in the event of incapacity or death.
                  </div>
                </div>

                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">4. Grievance Escalation & DPBI Redressal</h5>
                <p>
                  If a grievance is unresolved within 30 days, you are entitled to file a complaint directly with the
                  <strong> Data Protection Board of India (DPBI)</strong> pursuant to Section 13(3) of the Act.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: SaaS DPA & Terms */}
          {tab === "saas_dpa" && (
            <div className="space-y-4 text-fg/90">
              <div className="rounded-lg border border-border bg-surface/50 p-3.5">
                <h4 className="font-semibold text-sm text-fg flex items-center gap-1.5">
                  <FileText className="size-4 text-primary" />
                  Enterprise Master Services Agreement — Data Processing Addendum (DPA)
                </h4>
                <p className="mt-1 text-xs text-muted">
                  Binds Vetta as a compliant Data Processor under the Digital Personal Data Protection Act, 2023.
                </p>
              </div>

              <div className="space-y-3">
                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">1. Purpose Limitation & Prohibitions</h5>
                <p>
                  Vetta shall process digital personal data solely to fulfill employer-mandated hiring instructions. Vetta explicitly agrees:
                </p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li><strong>Zero Foundation Model Training</strong>: Candidate resumes, personal details, or transcripts shall never be used to train public AI foundation models.</li>
                  <li><strong>Zero Commercial Data Brokering</strong>: Personal data is never sold, leased, or cross-monetized across different corporate tenants.</li>
                  <li><strong>Zero Unconsented Pooling</strong>: Resumes are kept strictly isolated within the customer's organization scope.</li>
                </ul>

                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">2. 72-Hour Personal Data Breach Protocol (Section 8(6))</h5>
                <p>
                  Vetta maintains real-time exfiltration anomaly monitors. Upon confirmation of any personal data breach, Vetta shall intone
                  the customer within 24 hours and prepare standardized statutory reports for filing with the <strong>Data Protection Board of India (DPBI)</strong> within
                  the mandatory 72-hour statutory window.
                </p>

                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">3. Automated Retention & Hard Purge (Section 8(7))</h5>
                <p>
                  Candidate data is subject to configurable retention policies (default: 180–365 days). Once the retention deadline lapses
                  or upon candidate withdrawal, Vetta's automated garbage collection engine executes a multi-store wipe (documents, text, embeddings,
                  and cache) and mints an immutable <strong>Erasure Receipt</strong> with SHA-256 reference hashes to defend the employer during regulatory audits.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: Anti-Scraping & Sourcing Checklist */}
          {tab === "anti_scraping" && (
            <div className="space-y-4 text-fg/90">
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3.5">
                <h4 className="font-semibold text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <Lock className="size-4" />
                  Statutory Anti-Scraping & Lawful Sourcing Declaration
                </h4>
                <p className="mt-1 text-xs text-muted">
                  Mass web scraping of personal profiles without verifiable consent creates strict liability under DPDP Section 4 & Section 6.
                </p>
              </div>

              <div className="space-y-3">
                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">Statutory Penalty Schedule (Schedule 1)</h5>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded border border-border p-2">
                    <span>Failure to take reasonable security safeguards (Sec. 8(6))</span>
                    <strong className="text-rose-600 dark:text-rose-400 font-mono">Up to ₹250 Crore</strong>
                  </div>
                  <div className="flex items-center justify-between rounded border border-border p-2">
                    <span>Failure to notify DPBI of Personal Data Breach (Sec. 8(6))</span>
                    <strong className="text-rose-600 dark:text-rose-400 font-mono">Up to ₹200 Crore</strong>
                  </div>
                  <div className="flex items-center justify-between rounded border border-border p-2">
                    <span>Unlawful processing without valid consent or mandate (Sec. 4 & 6)</span>
                    <strong className="text-amber-600 dark:text-amber-400 font-mono">Up to ₹50 Crore</strong>
                  </div>
                </div>

                <h5 className="font-semibold text-xs tracking-wider uppercase text-muted">Recruiter Sourcing Certification</h5>
                <p>
                  By uploading candidate resumes or ingesting batches into Vetta, the recruiter certifies:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 pl-2">
                  <li>Each profile was received via direct applicant submission, verified employee referral, or explicit employer recruitment mandate.</li>
                  <li>No profile was obtained via automated web scraping of public directories or unauthorized third-party exfiltration.</li>
                  <li>Candidates retain the right to receive the statutory Rule 4 notice upon initial communication.</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border bg-surface/30">
          <span className="text-[11px] text-muted">
            Governed by the Data Protection Board of India (DPBI)
          </span>
          <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
            I Understand & Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * LegalConsentCheckbox: Reusable checkbox component with inline blue clickable terms link
 */
export function LegalConsentCheckbox({
  id,
  checked,
  onChange,
  variant = "candidate_apply",
  companyName = "this company",
  disabled = false,
  className,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  variant?: "candidate_apply" | "recruiter_ingest" | "recruiter_export";
  companyName?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [defaultDoc, setDefaultDoc] = useState<LegalDocType>(
    variant === "candidate_apply"
      ? "candidate_notice"
      : variant === "recruiter_export"
        ? "saas_dpa"
        : "anti_scraping",
  );

  function openTerms(doc: LegalDocType, e?: React.MouseEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setDefaultDoc(doc);
    setModalOpen(true);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="flex items-start gap-2.5 cursor-pointer text-xs leading-relaxed text-fg select-none">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-4 rounded border-border accent-primary cursor-pointer shrink-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="text-muted">
          {variant === "candidate_apply" && (
            <>
              I agree to the{" "}
              <button
                type="button"
                onClick={(e) => openTerms("saas_dpa", e)}
                className="text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline"
              >
                Terms and Conditions
              </button>{" "}
              and acknowledge the statutory{" "}
              <button
                type="button"
                onClick={(e) => openTerms("candidate_notice", e)}
                className="text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline"
              >
                Rule 4 Candidate Privacy Notice
              </button>{" "}
              under the DPDP Act 2023. I understand I may withdraw consent or request erasure at any time.
            </>
          )}

          {variant === "recruiter_ingest" && (
            <>
              I certify that these candidate profiles were obtained under a lawful recruitment mandate or direct applicant submission, in compliance with the{" "}
              <button
                type="button"
                onClick={(e) => openTerms("anti_scraping", e)}
                className="text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline"
              >
                DPDP Anti-Scraping Sourcing Policy
              </button>{" "}
              and the{" "}
              <button
                type="button"
                onClick={(e) => openTerms("saas_dpa", e)}
                className="text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline"
              >
                Enterprise Terms of Service
              </button>.
            </>
          )}

          {variant === "recruiter_export" && (
            <>
              I certify that all candidates included in this slate have consented to client disclosure under{" "}
              <button
                type="button"
                onClick={(e) => openTerms("saas_dpa", e)}
                className="text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline"
              >
                DPDP Data Sharing Terms
              </button>{" "}
              and understand this share link carries statutory audit liability.
            </>
          )}
        </span>
      </label>

      {/* The big readable terms modal dialog */}
      <TermsAndConditionsDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        defaultTab={defaultDoc}
        companyName={companyName}
      />
    </div>
  );
}
