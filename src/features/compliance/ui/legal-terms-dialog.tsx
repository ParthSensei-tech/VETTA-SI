import { useState, type ReactNode, type MouseEvent } from "react";
import { ShieldCheck, Scale, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  getLegalDocument,
  type LegalDocument,
} from "@/features/compliance/domain/legal-terms";

export interface LegalTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: LegalDocument["id"];
}

export function LegalTermsDialog({
  open,
  onOpenChange,
  documentId,
}: LegalTermsDialogProps) {
  const doc = getLegalDocument(documentId);

  const getDocIcon = () => {
    switch (documentId) {
      case "terms":
        return <FileText className="size-5 text-blue-600 dark:text-blue-400" />;
      case "dpa":
        return <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />;
      case "candidate_privacy":
        return <Scale className="size-5 text-indigo-600 dark:text-indigo-400" />;
      case "anti_scraping":
        return <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="border-b border-border/60 pb-4">
          <div className="flex items-center gap-2 mb-1">
            {getDocIcon()}
            <Badge variant="outline" className="text-[10px] tracking-wider uppercase font-semibold text-blue-600 dark:text-blue-400 border-blue-500/30">
              Statutory Legal Notice
            </Badge>
            <Badge variant="success" className="text-[10px]">
              DPDP Act 2023 Compliant
            </Badge>
          </div>
          <DialogTitle className="text-xl font-bold leading-tight text-fg">
            {doc.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted">
            {doc.subtitle}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted">
            <span><strong>Governing Law:</strong> {doc.governingLaw}</span>
            <span>•</span>
            <span><strong>Standard:</strong> {doc.lastUpdated}</span>
          </div>
        </DialogHeader>

        {/* Scrollable Document Body */}
        <div className="flex-1 overflow-y-auto pr-2 py-4 space-y-5 text-xs text-muted leading-relaxed">
          {doc.sections.map((section, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border/40 bg-surface/40 p-4 transition-colors hover:border-border/80"
            >
              <h4 className="font-semibold text-fg text-sm mb-2 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-500 inline-block" />
                {section.heading}
              </h4>
              <p className="text-muted leading-relaxed mb-2.5">
                {section.content}
              </p>
              {section.bullets && section.bullets.length > 0 && (
                <ul className="space-y-1.5 pl-2 mt-2">
                  {section.bullets.map((bullet, bIdx) => (
                    <li key={bIdx} className="flex items-start gap-2 text-fg/90">
                      <CheckCircle2 className="size-3.5 mt-0.5 shrink-0 text-emerald-500" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3.5 text-[11px] text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-1">🛡️ Statutory Notice & Penalty Protection</p>
            <p>
              This document is formally incorporated into the Vetta SaaS platform terms to satisfy Rule 4 of the Digital Personal Data Protection Rules and safeguard both platform and client organizations against statutory penalties (up to ₹250 Crore per incident).
            </p>
          </div>
        </div>

        {/* Dialog Actions */}
        <div className="pt-3 border-t border-border/60 flex items-center justify-between">
          <span className="text-[11px] text-muted">
            Authorized Digital Copy • Vetta SaaS Platform
          </span>
          <Button
            type="button"
            variant="default"
            className="cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            I Understand & Acknowledge
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface LegalLinkProps {
  docId: LegalDocument["id"];
  children?: ReactNode;
  className?: string;
}

/**
 * Reusable blue ink link that triggers the full readable legal terms dialog.
 * Intercepts click events so clicking the link doesn't trigger parent label/checkbox toggles.
 */
export function LegalLink({ docId, children, className = "" }: LegalLinkProps) {
  const [open, setOpen] = useState(false);
  const defaultLabel = getLegalDocument(docId).title;

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline cursor-pointer font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors ${className}`}
        title={`Read ${defaultLabel}`}
      >
        {children ?? defaultLabel}
      </button>
      <LegalTermsDialog
        open={open}
        onOpenChange={setOpen}
        documentId={docId}
      />
    </>
  );
}

export function TermsOfServiceLink({ children, className }: { children?: ReactNode; className?: string }) {
  return <LegalLink docId="terms" className={className}>{children ?? "Terms & Conditions"}</LegalLink>;
}

export function DpaLink({ children, className }: { children?: ReactNode; className?: string }) {
  return <LegalLink docId="dpa" className={className}>{children ?? "Data Processing Addendum (DPA)"}</LegalLink>;
}

export function CandidatePrivacyNoticeLink({ children, className }: { children?: ReactNode; className?: string }) {
  return <LegalLink docId="candidate_privacy" className={className}>{children ?? "Candidate Privacy & DPDP Notice"}</LegalLink>;
}

export function AntiScrapingPolicyLink({ children, className }: { children?: ReactNode; className?: string }) {
  return <LegalLink docId="anti_scraping" className={className}>{children ?? "Anti-Scraping & Sourcing Mandate"}</LegalLink>;
}
