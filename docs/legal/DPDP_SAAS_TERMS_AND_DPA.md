# VETTA RECRUITING PLATFORM
## ENTERPRISE SAAS MASTER SERVICES AGREEMENT & DATA PROCESSING ADDENDUM (DPA)
**Pursuant to the Digital Personal Data Protection Act, 2023 (DPDP Act) and the DPDP Rules (2025/2026/2027)**

*Document Version:* 2026.11-R4  
*Effective Date:* 13 November 2026 (Rule 4 Compliance) | Substantive Obligations: 13 May 2027  
*Governing Jurisdiction:* Republic of India (under the jurisdiction of the Data Protection Board of India - DPBI)

---

## 1. Statutory Context & Legal Roles

### 1.1 Parties and Statutory Classification
1. **The Customer ("Client" / "Employer")** acts as the **Data Fiduciary** under Section 2(i) of the DPDP Act. The Client determines the purpose and means of processing personal data, defines hiring criteria, and makes final employment decisions.
2. **Vetta Platform ("Vetta" / "Service Provider")** acts as the **Data Processor** under Section 2(k) of the DPDP Act, engaged under a valid contract to process digital personal data exclusively on behalf of and under the documented instructions of the Data Fiduciary.
3. **Candidate ("Job Applicant")** is the **Data Principal** under Section 2(j) of the DPDP Act.

> [!IMPORTANT]
> **Direct Hosted Portal Exception**: When Vetta hosts open job listings directly for candidate self-registration on `/jobs`, Vetta operates as an independent Data Fiduciary for the intake stage, presenting statutory Rule 4 notices before transferring processing to the prospective employer.

---

## 2. Rule 4 Compliance: Notice & Consent Architecture

### 2.1 Pre-Processing Notice Obligations (Section 6 & Rule 4)
Under Rule 4 of the DPDP Rules, every request for candidate consent must accompany or be preceded by an itemized notice stating:
1. The specific, itemized personal data collected (resume, contact details, evaluation scores, compensation expectations).
2. The exact purpose for processing each item (screening, ranking, interview coordination, background verification).
3. The manner in which the Data Principal may exercise rights (access, correction, erasure, nomination).
4. The procedure for filing a complaint with the Data Protection Board of India (DPBI).
5. The identity and contact details of the Data Protection Officer / Grievance Redressal Officer.

### 2.2 Multilingual Availability
Notice must be made available to candidates in English and any of the 22 languages specified in the Eighth Schedule to the Constitution of India upon request. Vetta provides automated localization for Eighth Schedule languages on all candidate-facing forms.

### 2.3 Sourcing Provenance & Strict Ban on Mass Web Scraping
- **Section 4 & 6 Mandate**: Processing personal data without explicit consent or valid legal mandate is strictly unlawful.
- **Scraping Prohibition**: The Client agrees **never** to ingest unconsented bulk scraped data from public social networks or third-party databases into the Vetta platform.
- Any profile marked as `unverified_scrape` triggers an automated platform block preventing client export or candidate card generation until verified candidate outreach consent is recorded.

---

## 3. Purpose Limitation & Automated Retention Limits (Section 8(7))

### 3.1 Purpose Specification
Vetta shall process personal data solely for candidate evaluation, ranking evidence generation, and hiring workflow management. Vetta shall never:
1. Use candidate resumes or personal data to train public foundation models.
2. Sell, barter, or transfer candidate data to unauthorized third parties.
3. Repurpose rejected candidate data for cross-client talent pooling without explicit affirmative consent.

### 3.2 Automated Retention & Hard Purge
- Pursuant to Section 8(7) of the DPDP Act, personal data must be erased as soon as the specified purpose is no longer served.
- Vetta provides configurable retention schedules (default: 180 to 365 days).
- Upon expiry of the retention window or upon candidate withdrawal of consent, Vetta's automated garbage collection engine executes a **cryptographic hard purge**:
  - Raw document bytes (.pdf, .docx) are overwritten and deleted.
  - Derived resume text and embeddings are purged from vector indexes.
  - LLM traces and cache entries are evicted.
  - An immutable **Erasure Receipt** is minted storing only a cryptographic hash (`subjectRef: SHA-256(orgId || candidateId)`), preserving no PII while establishing verifiable audit defense.

---

## 4. Personal Data Breach Management & DPBI Reporting (Section 8(6))

### 4.1 72-Hour Statutory Breach Protocol
In the event of a personal data breach affecting digital personal data processed by Vetta:
1. **Immediate Notification**: Vetta shall notify the Client's designated Grievance Officer within **24 hours** of confirming an incident.
2. **Statutory DPBI Filing**: Under Rule 4 and substantive breach regulations, the Data Fiduciary must submit a formal Intimation of Personal Data Breach to the **Data Protection Board of India (DPBI)** within **72 hours** of detection.
3. **Candidate Intimation**: If the breach creates a risk of harm to candidates, an individualized notification must be dispatched to each affected candidate specifying the nature of the breach, compromised categories, and recommended safety steps.

---

## 5. Candidate (Data Principal) Rights & Grievance Redressal

Pursuant to Sections 11, 12, 13, and 14 of the DPDP Act:

| Right | Statutory Section | Vetta Platform Control | SLA Window |
|---|---|---|---|
| **Right to Access Information** | Section 11 | Automated Candidate Data Summary export detailing processed data & third-party AI disclosures | ≤ 30 days |
| **Right to Correction & Erasure** | Section 12 | One-click profile update or complete right-to-be-forgotten withdrawal | Real-time / ≤ 72h |
| **Right to Grievance Redressal** | Section 13 | Dedicated in-app DSAR ticketing system routing directly to designated DPO | ≤ 30 days |
| **Right to Nominate** | Section 14 | Candidate ability to designate an authorized nominee in case of death/incapacity | Immediate capture |

---

## 6. Statutory Penalty Prevention Matrix (Schedule 1)

This matrix maps statutory maximum financial penalties under the DPDP Act 2023 directly to Vetta's technical safeguards:

```
+------------------------------------------------------------------------------------------------------------------+
| DPDP Act Violation & Statutory Maximum Penalty             | Vetta Platform Technical Safeguards                 |
+------------------------------------------------------------------------------------------------------------------+
| 1. Failure to take reasonable security safeguards to        | • Pure-core verification firewall                   |
|    prevent personal data breach (Section 8(6))              | • Row-level tenant isolation (RLS / org_id scope)   |
|    MAX PENALTY: ₹250 CRORE (~$30M USD)                      | • LLM provider zero-retention (no_store: true)      |
|                                                             | • Ring-buffer access anomaly monitoring             |
+------------------------------------------------------------------------------------------------------------------+
| 2. Failure to notify Board and affected Data Principals     | • Automated 72-hour DPBI Incident Report Generator  |
|    of personal data breach (Section 8(6))                   | • Incident severity classifier (critical/high)      |
|    MAX PENALTY: ₹200 CRORE (~$24M USD)                      | • Candidate bulk notification queue                 |
+------------------------------------------------------------------------------------------------------------------+
| 3. Processing unconsented candidate data or unlawful mass   | • Sourcing Provenance Engine (flags scrapes)        |
|    scraping (Section 4 & 6)                                 | • Rule 4 itemized consent ledger with versioning    |
|    MAX PENALTY: ₹50 CRORE (~$6M USD)                        | • Real-time consent check before client disclosure  |
+------------------------------------------------------------------------------------------------------------------+
| 4. Failure to erase data upon purpose expiration or        | • Automated cron retention garbage collector        |
|    withdrawal (Section 8(7))                                | • Cryptographic Erasure Receipts (SHA-256 ref)      |
|    MAX PENALTY: ₹50 CRORE (~$6M USD)                        | • Multi-store cascading wipe (vector, cache, files) |
+------------------------------------------------------------------------------------------------------------------+
| 5. Failure to resolve candidate grievances or respect       | • DSAR candidate rights portal                      |
|    nomination (Sections 11-14)                              | • 30-day statutory SLA countdown timer              |
|    MAX PENALTY: ₹50 CRORE (~$6M USD)                        | • In-country Grievance Redressal Officer credential |
+------------------------------------------------------------------------------------------------------------------+
```

---

## 7. Execution and Audit Acceptance

By signing the Data Processing Addendum in the Vetta Observability / Compliance Center, the authorized officer certifies that:
1. The Client's hiring workflows adhere to the purpose limitations stated herein.
2. The Client has designated a qualified Grievance Redressal Officer accessible to candidates.
3. The Client shall not input unconsented scraped data into the platform.

*For questions regarding this DPA or statutory DPBI compliance, contact: `legal-compliance@vetta.ai`.*
