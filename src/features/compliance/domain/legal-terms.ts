/**
 * Pure domain legal terms & statutory texts for Vetta SaaS.
 * Zero IO, zero side effects.
 */

export interface LegalDocument {
  id: "terms" | "dpa" | "candidate_privacy" | "anti_scraping";
  title: string;
  subtitle: string;
  lastUpdated: string;
  governingLaw: string;
  sections: Array<{
    heading: string;
    content: string;
    bullets?: string[];
  }>;
}

export const SAAS_TERMS_OF_SERVICE: LegalDocument = {
  id: "terms",
  title: "Vetta Enterprise SaaS Terms of Service & Master Subscription Agreement",
  subtitle: "Governing software subscription, fair use, data rights, and service commitments.",
  lastUpdated: "November 2026",
  governingLaw: "Republic of India (Courts of Bengaluru & Data Protection Board of India)",
  sections: [
    {
      heading: "1. Service Subscription & Scope of License",
      content:
        "Vetta provides an AI-assisted talent evaluation, ranking, and preboarding SaaS platform. We grant you a non-exclusive, non-transferable, subscription-based license to access and utilize the platform in accordance with your organization's subscription tier. You retain 100% ownership of your proprietary job descriptions and candidate evaluation criteria.",
    },
    {
      heading: "2. Statutory DPDP Roles: Data Fiduciary vs. Data Processor",
      content:
        "Under the Digital Personal Data Protection Act, 2023 (DPDP Act) and DPDP Rules (2025/2026):",
      bullets: [
        "Your Organization operates as the 'Data Fiduciary' under Section 2(i), holding sole authority over candidate hiring decisions and recruitment purposes.",
        "Vetta operates strictly as the 'Data Processor' under Section 2(k), processing candidate data, resumes, and evaluation traces solely under your lawful mandate.",
        "Both parties agree to execute and abide by the incorporated Data Processing Addendum (DPA) as mandated by Rule 4 of the DPDP Rules.",
      ],
    },
    {
      heading: "3. Prohibition on Unlawful Mass Scraping",
      content:
        "You expressly agree not to ingest, upload, or process candidate data harvested through automated, unconsented scraping of public websites, social profiles, or unauthorized directories. All candidate profiles must hold traceable sourcing provenance complying with Section 4 of the DPDP Act.",
    },
    {
      heading: "4. AI Ranking Integrity & Human Decision Rights",
      content:
        "Vetta's automated models produce rank scores and candidate evidence cards solely as advisory decision support for human recruiters and hiring managers. No employment adverse action or rejection is finalized without human review and confirmation.",
    },
    {
      heading: "5. Intellectual Property & Zero LLM Training on Your Resumes",
      content:
        "Vetta warrants that candidate resumes, proprietary evaluation notes, and salary signals uploaded to your private workspace will NEVER be used to train public foundation models or shared with competing organizations. Models running per-tenant are isolated strictly to your organization.",
    },
    {
      heading: "6. Limitation of Liability & Statutory Penalty Protection",
      content:
        "To the maximum extent permitted by applicable Indian law, Vetta maintains reasonable technical safeguards (including row-level isolation, access ring buffers, and 72-hour breach response procedures) to prevent personal data breaches under DPDP Section 8(6).",
    },
  ],
};

export const DATA_PROCESSING_ADDENDUM: LegalDocument = {
  id: "dpa",
  title: "DPDP Act (2023) Data Processing Addendum (DPA)",
  subtitle: "Statutory processor contract pursuant to Rule 4 and Substantive Duties of the DPDP Rules.",
  lastUpdated: "November 2026 (Rule 4 Standard)",
  governingLaw: "Digital Personal Data Protection Act, 2023 & DPBI Directives",
  sections: [
    {
      heading: "1. Mandate & Purpose Limitation (Section 8)",
      content:
        "Vetta shall process digital personal data solely on behalf of the Data Fiduciary and strictly for the specified purpose of evaluating candidates for active roles, scheduling screens, and calculating renege hazard. Vetta shall not retain or process such data for any secondary commercial purpose.",
    },
    {
      heading: "2. Reasonable Security Safeguards (Section 8(6))",
      content:
        "Vetta implements and maintains verifiable technical and organizational measures:",
      bullets: [
        "Multi-store tenant isolation ensuring no cross-organization leakage.",
        "Zero-retention model gateway (no_store: true) for external inference providers.",
        "Encrypted transmission (TLS 1.3) and secure database storage.",
        "Active monitoring against anomalous bulk exfiltration or automated scraping.",
      ],
    },
    {
      heading: "3. 72-Hour Personal Data Breach Intimation Protocol",
      content:
        "In the event of a confirmed personal data breach affecting digital personal data, Vetta shall notify the Data Fiduciary's Grievance Officer within 24 hours to enable statutory reporting to the Data Protection Board of India (DPBI) and affected Data Principals within the mandatory 72-hour window under Section 8(6).",
    },
    {
      heading: "4. Automated Purpose Retention & Hard Purge (Section 8(7))",
      content:
        "Upon expiration of the organization's configured retention policy (default: 180 to 365 days) or upon candidate consent withdrawal, Vetta's automated garbage collector performs a cryptographic hard purge of raw documents, text derivations, embeddings, and caches, minting an immutable Erasure Receipt storing only a SHA-256 subject reference hash (zero PII).",
    },
    {
      heading: "5. Data Principal Rights Fulfillment (Sections 11–14)",
      content:
        "Vetta provides built-in mechanisms to enable the Data Fiduciary to fulfill candidate rights requests within the statutory 30-day SLA:",
      bullets: [
        "Right to Access: Automated candidate data summary and third-party disclosure export.",
        "Right to Correction & Erasure: Real-time candidate withdrawal and profile correction.",
        "Right to Grievance Redressal: Direct ticketing workflow routed to designated Grievance Redressal Officer.",
        "Right to Nominate: Authorized nominee capture in case of death or incapacity under Section 14.",
      ],
    },
  ],
};

export const CANDIDATE_PRIVACY_NOTICE: LegalDocument = {
  id: "candidate_privacy",
  title: "Candidate Privacy & Rule 4 Itemized Consent Notice",
  subtitle: "Clear, itemized notice accompanying job application and evaluation.",
  lastUpdated: "November 2026",
  governingLaw: "Section 6 of the DPDP Act, 2023 & Rule 4 of the DPDP Rules",
  sections: [
    {
      heading: "1. Notice of Data Collection & Purpose Specification",
      content:
        "When you apply for a job or submit your resume, the prospective employer (as Data Fiduciary) and Vetta (as Data Processor) collect and process the following itemized categories of digital personal data:",
      bullets: [
        "Resume & Work History: Evaluated solely to rank role fit, match experience, and draft interview discussion guides.",
        "Contact Information (Email, Phone, Location): Used to coordinate interview schedules, share updates, and provide portal access.",
        "Notice Period & Compensation Signals: Evaluated to assess preboarding timeline and prevent joining friction.",
        "Credential Certificates: Inspected through digital verification checks to validate authenticity.",
      ],
    },
    {
      heading: "2. Your Statutory Rights as a Data Principal",
      content:
        "Under Sections 11, 12, 13, and 14 of the DPDP Act 2023, you hold the following non-waivable rights:",
      bullets: [
        "Right to Access: You may request a complete summary of personal data processed and third-party disclosures.",
        "Right to Withdraw Consent: You can withdraw consent at any time via your candidate portal link with immediate effect.",
        "Right to Erasure: Withdrawing consent triggers cryptographic hard purge of your resume and evaluations.",
        "Right to Grievance Redressal: You can raise complaints directly to the employer's designated Grievance Officer.",
        "Right to Nominate: You may designate a nominee to exercise your data rights in the event of death or incapacity.",
      ],
    },
    {
      heading: "3. Automated Assessment & Human Decisions",
      content:
        "AI algorithms evaluate resume relevance and verify evidence citations. However, all shortlist, interview, and hiring decisions are made solely by human recruiters and hiring managers. No candidate is rejected automatically without human review.",
    },
    {
      heading: "4. Multilingual Notice Availability",
      content:
        "Pursuant to Rule 4, this notice is available in English and any of the 22 languages specified in the Eighth Schedule to the Constitution of India upon request through the candidate portal.",
    },
  ],
};

export const ANTI_SCRAPING_SOURCING_POLICY: LegalDocument = {
  id: "anti_scraping",
  title: "Vetta Anti-Scraping & Lawful Sourcing Policy",
  subtitle: "Statutory provenance standards to eliminate mass web scraping penalties.",
  lastUpdated: "November 2026",
  governingLaw: "Section 4 & 6 of the DPDP Act, 2023",
  sections: [
    {
      heading: "1. Strict Prohibition on Unconsented Mass Scraping",
      content:
        "The Digital Personal Data Protection Act, 2023 strictly prohibits the automated scraping and processing of publicly available personal data without verifiable consent or lawful mandate. Ingesting mass-scraped resumes without prior consent creates severe corporate liability (up to ₹50 Crore under Schedule 1).",
    },
    {
      heading: "2. Verified Sourcing Provenance Tiers",
      content:
        "All candidate profiles entering the Vetta platform are tagged with a verifiable provenance source:",
      bullets: [
        "Direct Portal: Candidate applied voluntarily via company career page with explicit Rule 4 consent.",
        "Recruiter Mandate: Candidate was sourced directly through affirmative outreach, referral, or client engagement with documented consent.",
        "Agency Verified: Candidate was submitted by a contracted recruitment agency holding verified representation consent.",
        "Unverified Scrape: Profiles identified as harvested without consent are automatically quarantined and blocked from client export.",
      ],
    },
    {
      heading: "3. Recruiter Certification & Audit Defense",
      content:
        "By uploading resumes to Vetta, the recruiter certifies that the profiles have been lawfully obtained and that the candidate has agreed to or been formally notified of the recruitment evaluation.",
    },
  ],
};

export function getLegalDocument(type: LegalDocument["id"]): LegalDocument {
  switch (type) {
    case "terms":
      return SAAS_TERMS_OF_SERVICE;
    case "dpa":
      return DATA_PROCESSING_ADDENDUM;
    case "candidate_privacy":
      return CANDIDATE_PRIVACY_NOTICE;
    case "anti_scraping":
      return ANTI_SCRAPING_SOURCING_POLICY;
  }
}
