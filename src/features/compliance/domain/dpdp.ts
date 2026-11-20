/**
 * DPDP Act (2023) & DPDP Rules (2026/2027) Compliance Domain Model.
 *
 * PURE CORE: Zero IO, zero database imports, zero network calls.
 * Implements statutory definitions, penalty risk calculations,
 * breach severity classification, DPBI report templates, and provenance validation.
 */

export const DPDP_RULES_RULE4_EFFECTIVE_DATE = "2026-11-13";
export const DPDP_SUBSTANTIVE_DUTIES_EFFECTIVE_DATE = "2027-05-13";
export const DPA_CURRENT_VERSION = "2026.11-R4";

/** Statutory maximum financial penalties under Schedule 1 of the DPDP Act 2023 */
export const STATUTORY_PENALTIES = {
  BREACH_SECURITY_SAFEGUARD_FAILURE: {
    section: "Section 8(6) & Schedule 1(1)",
    maxPenaltyInr: 2_500_000_000, // 250 Crores INR
    label: "Failure to take reasonable security safeguards to prevent personal data breach",
    formattedInr: "₹250 Crore",
  },
  BREACH_FAILURE_TO_NOTIFY: {
    section: "Section 8(6) & Schedule 1(2)",
    maxPenaltyInr: 2_000_000_000, // 200 Crores INR
    label: "Failure to notify Data Protection Board of India and affected Data Principals of breach",
    formattedInr: "₹200 Crore",
  },
  CHILD_DATA_VIOLATION: {
    section: "Section 9 & Schedule 1(3)",
    maxPenaltyInr: 2_000_000_000, // 200 Crores INR
    label: "Non-fulfillment of obligations in relation to children",
    formattedInr: "₹200 Crore",
  },
  DATA_FIDUCIARY_DUTIES_FAILURE: {
    section: "Sections 8, 11-14 & Schedule 1(4)",
    maxPenaltyInr: 500_000_000, // 50 Crores INR
    label: "Non-fulfillment of core statutory obligations of Data Fiduciary (Consent, Retention, Rights)",
    formattedInr: "₹50 Crore",
  },
} as const;

export type ProvenanceType =
  | "direct_portal"
  | "recruiter_mandate"
  | "agency_verified"
  | "unverified_scrape";

export type DsarRequestType =
  | "access_summary"
  | "correction"
  | "erasure"
  | "grievance"
  | "nomination";

export type BreachSeverity = "critical" | "high" | "medium" | "low";

/** Supported 22 Eighth Schedule Indian Languages for Rule 4 Multilingual Notices */
export const SUPPORTED_INDIAN_LANGUAGES = [
  { code: "en", name: "English", script: "Latin", default: true },
  { code: "hi", name: "Hindi (हिन्दी)", script: "Devanagari" },
  { code: "bn", name: "Bengali (বাংলা)", script: "Bengali" },
  { code: "te", name: "Telugu (తెలుగు)", script: "Telugu" },
  { code: "mr", name: "Marathi (मराठी)", script: "Devanagari" },
  { code: "ta", name: "Tamil (தமிழ்)", script: "Tamil" },
  { code: "gu", name: "Gujarati (ગુજરાતી)", script: "Gujarati" },
  { code: "kn", name: "Kannada (ಕನ್ನಡ)", script: "Kannada" },
  { code: "ml", name: "Malayalam (മലയാളം)", script: "Malayalam" },
  { code: "pa", name: "Punjabi (ਪੰਜਾਬੀ)", script: "Gurmukhi" },
  { code: "or", name: "Odia (ଓଡ଼ିଆ)", script: "Odia" },
  { code: "as", name: "Assamese (অসমীয়া)", script: "Bengali" },
  { code: "ur", name: "Urdu (اردو)", script: "Arabic" },
] as const;

export interface ComplianceAuditInput {
  dpaSigned: boolean;
  dpaSignedVersion?: string;
  totalCandidates: number;
  unconsentedCandidates: number;
  unverifiedScrapedCandidates: number;
  retentionDays: number;
  candidatesExceedingRetention: number;
  dpoConfigured: boolean;
  pendingDsarCount: number;
  overdueDsarCount: number;
  unresolvedBreachesCount: number;
}

export interface ComplianceScoreResult {
  overallScore: number; // 0 to 100
  tier: "COMPLIANT" | "GOOD" | "AT_RISK" | "NON_COMPLIANT";
  penaltyExposureTier: "NONE" | "LOW" | "ELEVATED" | "CRITICAL";
  maxPotentialPenaltyInr: number;
  breakdown: {
    dpaAndLegal: { score: number; max: number; status: "PASS" | "FAIL"; details: string };
    consentAndProvenance: { score: number; max: number; status: "PASS" | "WARN" | "FAIL"; details: string };
    retentionHygiene: { score: number; max: number; status: "PASS" | "WARN" | "FAIL"; details: string };
    candidateRightsAndDpo: { score: number; max: number; status: "PASS" | "WARN" | "FAIL"; details: string };
    securityAndSafeguards: { score: number; max: number; status: "PASS" | "WARN" | "FAIL"; details: string };
  };
  remediationActions: string[];
}

/**
 * Pure calculation of an organization's DPDP Act Compliance & Penalty Exposure Score.
 */
export function calculateComplianceScore(input: ComplianceAuditInput): ComplianceScoreResult {
  const actions: string[] = [];

  // Pillar 1: DPA & Legal (20 pts)
  let dpaScore = 0;
  let dpaStatus: "PASS" | "FAIL" = "FAIL";
  let dpaDetail = "Enterprise DPA (Data Processing Addendum) not yet executed.";
  if (input.dpaSigned) {
    dpaScore = 20;
    dpaStatus = "PASS";
    dpaDetail = `DPA executed under version ${input.dpaSignedVersion ?? DPA_CURRENT_VERSION}.`;
  } else {
    actions.push("Review and sign the DPDP Data Processing Addendum (DPA) to formalize processor duties.");
  }

  // Pillar 2: Consent & Sourcing Provenance (25 pts)
  let consentScore = 25;
  let consentStatus: "PASS" | "WARN" | "FAIL" = "PASS";
  let consentDetail = "All candidates have verified consent or lawful employer mandate.";

  if (input.totalCandidates > 0) {
    const unconsentedRatio = input.unconsentedCandidates / input.totalCandidates;
    const scrapedRatio = input.unverifiedScrapedCandidates / input.totalCandidates;

    if (input.unverifiedScrapedCandidates > 0) {
      consentScore -= Math.min(20, Math.ceil(scrapedRatio * 40));
      actions.push(
        `Eliminate mass-scraping liability: ${input.unverifiedScrapedCandidates} candidate(s) lack sourcing provenance. Verify outreach consent.`,
      );
    }
    if (unconsentedRatio > 0.05) {
      consentScore -= Math.min(10, Math.ceil(unconsentedRatio * 20));
      actions.push(`${input.unconsentedCandidates} active candidate(s) lack active consent record.`);
    }
    consentScore = Math.max(0, consentScore);

    if (consentScore < 12) {
      consentStatus = "FAIL";
      consentDetail = `${input.unverifiedScrapedCandidates} unverified scrapes and ${input.unconsentedCandidates} unconsented profiles detected.`;
    } else if (consentScore < 22) {
      consentStatus = "WARN";
      consentDetail = "Minor consent gaps detected in candidate pool.";
    }
  }

  // Pillar 3: Purpose Retention Hygiene (20 pts)
  let retentionScore = 20;
  let retentionStatus: "PASS" | "WARN" | "FAIL" = "PASS";
  let retentionDetail = "Retention limits enforced and candidate pool is current.";

  if (input.retentionDays > 730) {
    retentionScore -= 5;
    actions.push("Retention policy exceeds 2 years without explicit ongoing business justification.");
  }
  if (input.candidatesExceedingRetention > 0) {
    const penalty = Math.min(15, input.candidatesExceedingRetention * 2);
    retentionScore -= penalty;
    actions.push(
      `Trigger auto-retention purge: ${input.candidatesExceedingRetention} candidate(s) exceed the ${input.retentionDays}-day retention policy.`,
    );
  }
  retentionScore = Math.max(0, retentionScore);
  if (retentionScore < 10) {
    retentionStatus = "FAIL";
    retentionDetail = `${input.candidatesExceedingRetention} candidate(s) retained beyond legal limits.`;
  } else if (retentionScore < 18) {
    retentionStatus = "WARN";
    retentionDetail = "Retention auto-purge pending for some candidate records.";
  }

  // Pillar 4: Candidate Rights (DSAR) & DPO Readiness (20 pts)
  let rightsScore = 20;
  let rightsStatus: "PASS" | "WARN" | "FAIL" = "PASS";
  let rightsDetail = "Grievance Officer designated and DSAR requests handled within statutory SLA.";

  if (!input.dpoConfigured) {
    rightsScore -= 10;
    actions.push("Designate a Grievance Redressal / Data Protection Officer (DPO) as required by Section 8(9).");
  }
  if (input.overdueDsarCount > 0) {
    rightsScore -= 10;
    actions.push(`${input.overdueDsarCount} candidate rights request(s) exceeded the statutory 30-day SLA window!`);
  } else if (input.pendingDsarCount > 5) {
    rightsScore -= 4;
  }
  rightsScore = Math.max(0, rightsScore);
  if (rightsScore < 10) {
    rightsStatus = "FAIL";
    rightsDetail = "Grievance Redressal Officer missing or overdue DSAR requests detected.";
  } else if (rightsScore < 18) {
    rightsStatus = "WARN";
    rightsDetail = "Action needed on Grievance Officer details or pending candidate requests.";
  }

  // Pillar 5: Security & Breach Safeguards (15 pts)
  let secScore = 15;
  let secStatus: "PASS" | "WARN" | "FAIL" = "PASS";
  let secDetail = "No unresolved breach incidents or anomalous data exfiltration.";

  if (input.unresolvedBreachesCount > 0) {
    secScore = 0;
    secStatus = "FAIL";
    secDetail = `${input.unresolvedBreachesCount} unresolved personal data breach incident(s) detected!`;
    actions.push("IMMEDIATE: Address unresolved security incidents and comply with DPBI 72-hour reporting duty.");
  }

  const overallScore = dpaScore + consentScore + retentionScore + rightsScore + secScore;

  let tier: ComplianceScoreResult["tier"] = "COMPLIANT";
  if (overallScore < 50) tier = "NON_COMPLIANT";
  else if (overallScore < 70) tier = "AT_RISK";
  else if (overallScore < 88) tier = "GOOD";

  let penaltyExposureTier: ComplianceScoreResult["penaltyExposureTier"] = "NONE";
  let maxPotentialPenaltyInr = 0;

  if (input.unresolvedBreachesCount > 0) {
    penaltyExposureTier = "CRITICAL";
    maxPotentialPenaltyInr = STATUTORY_PENALTIES.BREACH_SECURITY_SAFEGUARD_FAILURE.maxPenaltyInr;
  } else if (input.unverifiedScrapedCandidates > 0 || !input.dpaSigned || input.overdueDsarCount > 0) {
    penaltyExposureTier = "ELEVATED";
    maxPotentialPenaltyInr = STATUTORY_PENALTIES.DATA_FIDUCIARY_DUTIES_FAILURE.maxPenaltyInr;
  } else if (overallScore < 85) {
    penaltyExposureTier = "LOW";
    maxPotentialPenaltyInr = 100_000_000; // 10 Cr directional
  }

  return {
    overallScore,
    tier,
    penaltyExposureTier,
    maxPotentialPenaltyInr,
    breakdown: {
      dpaAndLegal: { score: dpaScore, max: 20, status: dpaStatus, details: dpaDetail },
      consentAndProvenance: { score: consentScore, max: 25, status: consentStatus, details: consentDetail },
      retentionHygiene: { score: retentionScore, max: 20, status: retentionStatus, details: retentionDetail },
      candidateRightsAndDpo: { score: rightsScore, max: 20, status: rightsStatus, details: rightsDetail },
      securityAndSafeguards: { score: secScore, max: 15, status: secStatus, details: secDetail },
    },
    remediationActions: actions,
  };
}

/**
 * Classifies a security / personal data breach incident under DPDP Section 8(6).
 */
export function classifyBreachSeverity(opts: {
  affectedCandidatesCount: number;
  dataCategories: string[];
  isExfiltrationConfirmed: boolean;
}): {
  severity: BreachSeverity;
  requiresDpbiNotification: boolean;
  notificationDeadlineHours: number;
  reason: string;
} {
  const sensitiveCategories = ["resume_raw_bytes", "phone", "email", "compensation_signals", "interview_audio"];
  const containsSensitive = opts.dataCategories.some((c) => sensitiveCategories.includes(c));

  if (opts.affectedCandidatesCount >= 100 || (opts.isExfiltrationConfirmed && containsSensitive)) {
    return {
      severity: "critical",
      requiresDpbiNotification: true,
      notificationDeadlineHours: 72,
      reason: "High volume (>100) or confirmed exfiltration of sensitive recruitment data requires mandatory 72-hour DPBI reporting.",
    };
  }

  if (opts.affectedCandidatesCount >= 10 || containsSensitive) {
    return {
      severity: "high",
      requiresDpbiNotification: true,
      notificationDeadlineHours: 72,
      reason: "Sensitive personal data involved; formal notice to DPBI and affected candidates recommended under Section 8(6).",
    };
  }

  if (opts.affectedCandidatesCount > 0) {
    return {
      severity: "medium",
      requiresDpbiNotification: false,
      notificationDeadlineHours: 72,
      reason: "Low volume, non-exfiltrated incident contained internally. Review for Data Principal notification.",
    };
  }

  return {
    severity: "low",
    requiresDpbiNotification: false,
    notificationDeadlineHours: 0,
    reason: "Internal anomaly contained before any personal data exposure.",
  };
}

/**
 * Generates the standardized incident filing template for the Data Protection Board of India (DPBI).
 */
export function generateDpbiBreachReport(incident: {
  incidentId: string;
  orgName: string;
  detectedAtIso: string;
  affectedCount: number;
  dataCategories: string[];
  rootCause: string;
  containmentActions: string;
  dpoContact: { name: string; email: string; phone: string };
}): string {
  return `# FORM OF INTIMATION OF PERSONAL DATA BREACH
*(To the Data Protection Board of India under Section 8(6) of the Digital Personal Data Protection Act, 2023)*

**Incident Reference Number:** DPBI-${incident.incidentId.slice(0, 8).toUpperCase()}
**Reporting Entity (Data Fiduciary):** ${incident.orgName}
**Date & Time of Detection:** ${incident.detectedAtIso}

---

### 1. Nature and Extent of Personal Data Breach
- **Estimated Number of Data Principals Affected:** ${incident.affectedCount}
- **Categories of Personal Data Involved:** ${incident.dataCategories.join(", ")}
- **Initial Vector / Root Cause:** ${incident.rootCause}

### 2. Immediate Containment & Mitigation Measures Undertaken
${incident.containmentActions}

### 3. Measures Taken to Mitigate Harm to Affected Data Principals
- Individual email notices dispatched / prepared for affected candidates.
- Token revocation and credential rotation executed.
- Access endpoints restricted and forensic logs captured.

### 4. Details of Authorized Grievance Redressal / Data Protection Officer (DPO)
- **Name:** ${incident.dpoContact.name}
- **Email:** ${incident.dpoContact.email}
- **Phone:** ${incident.dpoContact.phone}

---
*Submitted pursuant to the statutory obligation under Rule 4 / Substantive Rules of the DPDP Act, 2023.*
`;
}

/**
 * Validates sourcing provenance and returns whether it triggers the Mass Scraping Ban warning.
 */
export function validateProvenance(provenance: ProvenanceType): {
  isCompliant: boolean;
  requiresOutreachConsent: boolean;
  riskNotice?: string;
} {
  if (provenance === "direct_portal") {
    return { isCompliant: true, requiresOutreachConsent: false };
  }
  if (provenance === "recruiter_mandate") {
    return { isCompliant: true, requiresOutreachConsent: false };
  }
  if (provenance === "agency_verified") {
    return { isCompliant: true, requiresOutreachConsent: false };
  }
  return {
    isCompliant: false,
    requiresOutreachConsent: true,
    riskNotice:
      "WARNING: Unverified scraped data lacks verifiable consent. DPDP Section 4 forbids processing unconsented scraped personal data for automated evaluation. Obtain candidate outreach consent prior to client sharing or ranking.",
  };
}

/**
 * Itemized Rule 4 Consent Notice specification for candidate portals.
 */
export function getRule4NoticeSpec(companyName: string) {
  return {
    fiduciaryName: companyName,
    purposes: [
      {
        id: "recruitment_evaluation",
        title: "Application Assessment & Ranking",
        description: "Review your resume, match skills against job requirements, and assess role fit.",
        required: true,
      },
      {
        id: "client_disclosure",
        title: "Sharing with Hiring Managers & Interviewers",
        description: "Share your candidate card and application details with hiring team members.",
        required: false,
      },
      {
        id: "document_forensics",
        title: "Document Authenticity Verification",
        description: "Run digital verification checks on submitted credential certificates and resume metadata.",
        required: false,
      },
    ],
    withdrawalRight:
      "You have the right to withdraw your consent at any time without penalty via your candidate portal link.",
    grievanceContact: "For privacy questions or rights requests, contact our designated Grievance Officer.",
  };
}
