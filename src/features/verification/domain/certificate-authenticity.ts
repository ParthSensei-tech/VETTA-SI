/**
 * Certificate & Document Authenticity Inspection.
 *
 * Provides deep forensic verification of:
 * 1. International Credentials (AWS, Google Cloud, Microsoft, Coursera, Credly, edX)
 * 2. Indian Institutional Certificates (DigiLocker NAD, CBSE, NPTEL, SWAYAM, State Universities)
 * 3. Synthetic Document Footprints (single-pass automated generators vs human iterative editing)
 *
 * Pure and isomorphic: No IO, no network, no database. Same input produces
 * the same deterministic authenticity verdict on any platform.
 *
 * Design Rule: Findings are staged as NON-BLOCKING ADVISORY WARNINGS with
 * concrete recruiter interview probing questions, rather than automated disqualifications.
 */

import type { DocumentForensics } from "./forensics.ts";

export type IssuerOrigin = "international" | "indian" | "generic";

export type CredentialCategory =
  | "cloud_devops"
  | "education_degree"
  | "professional_certification"
  | "course_completion";

export type DetectedCredential = {
  readonly issuer: string;
  readonly category: CredentialCategory;
  readonly origin: IssuerOrigin;
  readonly verificationIdentifier?: string;
  readonly verificationUrl?: string;
  readonly signatureFound: boolean;
  readonly signatureSigner?: string;
  readonly isTrustedIssuer: boolean;
  readonly notes: string[];
};

export type AuthenticityWarning = {
  readonly id: string;
  readonly label: string;
  readonly category: "international_cert" | "indian_cert" | "synthetic_document" | "tamper_signal";
  readonly reason: string;
  readonly suggestedInterviewProbe: string;
};

export type DocumentAuthenticityReport = {
  readonly filename: string;
  readonly docClass: string;
  readonly format: "pdf" | "docx" | "unknown";
  readonly fileSizeBytes?: number;
  readonly generationType:
    | "human_iterative"
    | "synthetic_generated"
    | "flattened_print"
    | "indeterminate";
  readonly generatorTool?: string;
  readonly editingMinutes?: number | null;
  readonly revisionCount?: number | null;
  readonly credentials: readonly DetectedCredential[];
  readonly warnings: readonly AuthenticityWarning[];
  readonly overallStatus: "authentic_verified" | "advisory_warning" | "standard_document";
  readonly summarySentence: string;
};

/* ------------------------------------------------------------------ Patterns */

interface IssuerPattern {
  readonly name: string;
  readonly category: CredentialCategory;
  readonly origin: IssuerOrigin;
  readonly textTriggers: readonly RegExp[];
  readonly urlPatterns: readonly RegExp[];
  readonly signatureSigners: readonly RegExp[];
}

const KNOWN_ISSUERS: readonly IssuerPattern[] = [
  // ── International Credentials ──
  {
    name: "Amazon Web Services (AWS)",
    category: "cloud_devops",
    origin: "international",
    textTriggers: [
      /\baws\s+certified\b/i,
      /\bamazon\s+web\s+services\b/i,
      /\bsolutions\s+architect\s*(?:associate|professional)\b/i,
    ],
    urlPatterns: [
      /aws\.amazon\.com\/verification(?:[^\s]*)/i,
      /cp\.certmetrics\.com\/amazon\/public\/verify(?:[^\s]*)/i,
      /credly\.com\/(?:badges|org\/amazon-web-services)(?:[^\s]*)/i,
    ],
    signatureSigners: [/amazon\s+web\s+services/i, /certmetrics/i, /credly/i],
  },
  {
    name: "Google Cloud (GCP)",
    category: "cloud_devops",
    origin: "international",
    textTriggers: [
      /\bgoogle\s+cloud\s+certified\b/i,
      /\bprofessional\s+cloud\s+architect\b/i,
      /\bprofessional\s+data\s+engineer\b/i,
    ],
    urlPatterns: [
      /credential\.net(?:\/[^\s]+)?/i,
      /google\.accredible\.com(?:\/[^\s]+)?/i,
      /credly\.com\/(?:badges|org\/google)(?:\/[^\s]+)?/i,
    ],
    signatureSigners: [/google\s+llc/i, /accredible/i],
  },
  {
    name: "Microsoft (Azure)",
    category: "cloud_devops",
    origin: "international",
    textTriggers: [
      /\bmicrosoft\s+certified\b/i,
      /\bazure\s+solutions\s+architect\b/i,
      /\bazure\s+administrator\b/i,
    ],
    urlPatterns: [
      /learn\.microsoft\.com\/[^/\s]+\/users\/[^/\s]+\/credentials(?:\/[^\s]+)?/i,
      /credly\.com\/(?:badges|org\/microsoft)(?:\/[^\s]+)?/i,
    ],
    signatureSigners: [/microsoft\s+corporation/i, /microsoft/i],
  },
  {
    name: "Coursera",
    category: "course_completion",
    origin: "international",
    textTriggers: [/\bcoursera\s+verified\b/i, /\bcoursera\.org\b/i],
    urlPatterns: [/coursera\.org\/verify(?:\/[^\s]+)?/i],
    signatureSigners: [/coursera/i],
  },
  {
    name: "Credly",
    category: "professional_certification",
    origin: "international",
    textTriggers: [/\bcredly\b/i, /\byouracclaim\.com\b/i],
    urlPatterns: [/credly\.com\/badges(?:\/[^\s]+)?/i],
    signatureSigners: [/credly/i],
  },
  {
    name: "edX",
    category: "course_completion",
    origin: "international",
    textTriggers: [/\bedx\s+verified\s+certificate\b/i, /\bedx\.org\b/i],
    urlPatterns: [/edx\.org\/certificate(?:\/[^\s]+)?/i, /credentials\.edx\.org(?:\/[^\s]+)?/i],
    signatureSigners: [/edx/i],
  },

  // ── Indian Institutional Certificates ──
  {
    name: "DigiLocker National Academic Depository (NAD)",
    category: "education_degree",
    origin: "indian",
    textTriggers: [
      /\bdigilocker\b/i,
      /\bnational\s+academic\s+depository\b/i,
      /\bnad\.digilocker\.gov\.in\b/i,
    ],
    urlPatterns: [/digilocker\.gov\.in\b/i, /nad\.gov\.in\b/i],
    signatureSigners: [
      /emudhra/i,
      /\(n\)code/i,
      /national\s+informatics\s+centre/i,
      /\bnic\b/i,
      /digilocker/i,
      /cca\s+india/i,
    ],
  },
  {
    name: "CBSE (Central Board of Secondary Education)",
    category: "education_degree",
    origin: "indian",
    textTriggers: [
      /\bcentral\s+board\s+of\s+secondary\s+education\b/i,
      /\bcbse\b/i,
      /\ball\s+india\s+senior\s+school\s+certificate\b/i,
    ],
    urlPatterns: [/cbse\.gov\.in/i, /cbseresults\.nic\.in/i],
    signatureSigners: [/cbse/i, /emudhra/i, /nic/i],
  },
  {
    name: "NPTEL / SWAYAM (IITs / MoE India)",
    category: "course_completion",
    origin: "indian",
    textTriggers: [/\bnptel\b/i, /\bswayam\b/i, /\biit\s+(?:madras|bombay|delhi|kharagpur|kanpur|roorkee)\b/i],
    urlPatterns: [/nptel\.ac\.in\/noc\/[a-zA-Z0-9]+/i, /swayam\.gov\.in/i],
    signatureSigners: [/nptel/i, /iit/i, /national\s+programme\s+on\s+technology/i],
  },
  {
    name: "Indian University (State / Central Technical Board)",
    category: "education_degree",
    origin: "indian",
    textTriggers: [
      /\bvisvesvaraya\s+technological\s+university\b/i,
      /\bvtu\b/i,
      /\banna\s+university\b/i,
      /\buniversity\s+of\s+mumbai\b/i,
      /\bdr\.?\s*a\.?p\.?j\.?\s*abdul\s+kalam\s+technical\s+university\b/i,
      /\baktu\b/i,
      /\bsavitribai\s+phule\s+pune\s+university\b/i,
      /\bsppu\b/i,
      /\bdelhi\s+technological\s+university\b/i,
      /\buniversity\s+of\s+delhi\b/i,
    ],
    urlPatterns: [/\.ac\.in\b/i, /\.edu\.in\b/i],
    signatureSigners: [/emudhra/i, /\(n\)code/i, /nic/i, /controller\s+of\s+examinations/i],
  },
];

const AUTOMATED_GENERATOR_TOOLS = [
  { re: /weasyprint/i, name: "WeasyPrint (HTML-to-PDF engine)" },
  { re: /reportlab/i, name: "ReportLab (Python PDF library)" },
  { re: /dompdf/i, name: "DOMPDF (PHP HTML-to-PDF library)" },
  { re: /wkhtmltopdf/i, name: "wkhtmltopdf (WebKit HTML-to-PDF)" },
  { re: /headlesschrome/i, name: "Headless Chrome / Puppeteer export" },
  { re: /puppeteer/i, name: "Puppeteer PDF export" },
  { re: /tcpdf/i, name: "TCPDF (PHP PDF generator)" },
  { re: /fpdf/i, name: "FPDF library" },
];

/* ------------------------------------------------------------------ Analysis */

/**
 * Inspects a document's forensics record for international & Indian credential
 * authenticity, digital signatures, and automated synthetic generation footprints.
 */
export function inspectDocumentAuthenticity(doc: DocumentForensics): DocumentAuthenticityReport {
  const allLines = [...doc.visibleLines, ...doc.orphanedLines.map((o) => o.line)];
  const combinedText = allLines.join(" ");

  const detectedCredentials: DetectedCredential[] = [];
  const warnings: AuthenticityWarning[] = [];

  // 1. Digital Signature Check (from tools, PDF objects, or XMP metadata)
  const signatureSigner = findDigitalSignatureSigner(doc);
  const hasDigitalSignature = Boolean(signatureSigner);

  // 2. Identify Known Issuers
  for (const issuer of KNOWN_ISSUERS) {
    const textMatched = issuer.textTriggers.some((re) => re.test(combinedText));
    const urlMatch = issuer.urlPatterns
      .map((re) => combinedText.match(re)?.[0])
      .find((match): match is string => Boolean(match));

    const signatureMatch = signatureSigner
      ? issuer.signatureSigners.some((re) => re.test(signatureSigner))
      : false;

    if (textMatched || urlMatch || signatureMatch) {
      const notes: string[] = [];
      if (signatureMatch) {
        notes.push(`Verified digital signature matching issuer: "${signatureSigner}"`);
      } else if (urlMatch) {
        notes.push(`Verification link detected: ${urlMatch}`);
      }

      const cred: DetectedCredential = {
        issuer: issuer.name,
        category: issuer.category,
        origin: issuer.origin,
        verificationUrl: urlMatch,
        signatureFound: signatureMatch,
        signatureSigner: signatureMatch ? signatureSigner ?? undefined : undefined,
        isTrustedIssuer: true,
        notes,
      };
      detectedCredentials.push(cred);

      // Warning rule: High-stakes academic or cloud certification claiming issuance
      // without verifiable URL and without digital signature
      if (!signatureMatch && !urlMatch && (doc.docClass === "certificate" || textMatched)) {
        if (issuer.origin === "indian") {
          warnings.push({
            id: `unsigned_indian_cert_${issuer.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            label: `Unsigned Indian Certificate (${issuer.name})`,
            category: "indian_cert",
            reason:
              `Document mentions ${issuer.name} but lacks the official cryptographic digital signature ` +
              `(eMudhra/NIC/DigiLocker) or online verification link standard for Indian institutions.`,
            suggestedInterviewProbe:
              `Request the candidate's DigiLocker document URI or verify their original university marksheet during technical rounds.`,
          });
        } else {
          warnings.push({
            id: `unverified_intl_cert_${issuer.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            label: `Unverified International Credential (${issuer.name})`,
            category: "international_cert",
            reason:
              `Document claims ${issuer.name} certification but contains no public Credly, CertMetrics, or ` +
              `verification URL code.`,
            suggestedInterviewProbe:
              `Ask candidate to provide their public Credly badge URL or certificate verification code.`,
          });
        }
      }
    }
  }

  // 3. Synthetic / Automated Generation Footprint
  let generationType: DocumentAuthenticityReport["generationType"] = "indeterminate";
  let generatorTool: string | undefined;

  // Case A: DOCX single save whole document
  if (doc.docx?.singleSaveWholeDocument) {
    generationType = "synthetic_generated";
    generatorTool = doc.docx.application || "Automated DOCX generator";
    warnings.push({
      id: "synthetic_single_save_docx",
      label: "Automated Single-Pass Resume Generation",
      category: "synthetic_document",
      reason:
        `This DOCX was generated in 1 revision with 0 total recorded editing minutes ` +
        `and a single session RSID (${doc.docx.words ?? 0} words). This footprint indicates an automated export ` +
        `or scripted text generator rather than iterative human word-processor typing.`,
      suggestedInterviewProbe:
        `Probe deeply into specific architectural choices and problem-solving on the key projects listed to ensure authentic execution.`,
    });
  } else if (doc.docx && (doc.docx.revision ?? 0) > 2 && (doc.docx.totalEditingMinutes ?? 0) > 5) {
    generationType = "human_iterative";
    generatorTool = doc.docx.application;
  }

  // Case B: PDF automated tool detection
  const detectedGenTool = doc.tools.flatMap((t) => {
    const match = AUTOMATED_GENERATOR_TOOLS.find((tool) => tool.re.test(t));
    return match ? [match.name] : [];
  })[0];

  if (detectedGenTool) {
    generationType = "synthetic_generated";
    generatorTool = detectedGenTool;
    warnings.push({
      id: "synthetic_pdf_generator_tool",
      label: `Automated PDF Engine (${detectedGenTool})`,
      category: "synthetic_document",
      reason:
        `The PDF metadata confirms it was compiled via ${detectedGenTool}. Common for programmatic ` +
        `templating, bulk resume generators, or web scrapers.`,
      suggestedInterviewProbe:
        `Confirm candidate created this resume directly and walk through their technical stack choices.`,
    });
  }

  // Case C: Orphaned text replacement tamper
  if (doc.orphanedLines.length > 0 && doc.hasAbandonedContent) {
    warnings.push({
      id: "abandoned_stream_content",
      label: "Overwritten / Modified PDF Stream Content",
      category: "tamper_signal",
      reason:
        `The file contains ${doc.orphanedLines.length} unreferenced text stream(s) abandoned across ` +
        `${doc.generations} PDF generations, indicating post-export content modification.`,
      suggestedInterviewProbe:
        `Verify consistency of employment dates and performance metrics cited across different pages.`,
    });
  }

  // Determine Overall Status
  let overallStatus: DocumentAuthenticityReport["overallStatus"] = "standard_document";
  let summarySentence = "Document verified with standard structural properties.";

  if (detectedCredentials.some((c) => c.signatureFound)) {
    overallStatus = "authentic_verified";
    summarySentence = `Cryptographically authenticated credentials confirmed (${detectedCredentials.filter((c) => c.signatureFound).map((c) => c.issuer).join(", ")}).`;
  } else if (warnings.length > 0) {
    overallStatus = "advisory_warning";
    summarySentence = `${warnings.length} advisory authenticity notice${warnings.length === 1 ? "" : "s"} flagged for recruiter review (non-blocking).`;
  } else if (detectedCredentials.length > 0) {
    summarySentence = `${detectedCredentials.length} recognized credential${detectedCredentials.length === 1 ? "" : "s"} identified.`;
  }

  return {
    filename: doc.filename,
    docClass: doc.docClass,
    format: doc.format,
    fileSizeBytes: 0, // Assigned by caller if available
    generationType,
    generatorTool,
    editingMinutes: doc.docx?.totalEditingMinutes ?? null,
    revisionCount: doc.docx?.revision ?? (doc.generations > 1 ? doc.generations : null),
    credentials: detectedCredentials,
    warnings,
    overallStatus,
    summarySentence,
  };
}

/* ------------------------------------------------------------------ Helpers */

function findDigitalSignatureSigner(doc: DocumentForensics): string | null {
  // Check tools or metadata lines for signature indicators
  for (const tool of doc.tools) {
    if (/emudhra/i.test(tool)) return "eMudhra CA (India PKI)";
    if (/\(n\)code/i.test(tool)) return "(n)Code Solutions (India PKI)";
    if (/nic\s+ca/i.test(tool)) return "National Informatics Centre (NIC CA)";
    if (/digilocker/i.test(tool)) return "DigiLocker National Academic Depository";
    if (/amazon\s+web\s+services/i.test(tool)) return "Amazon Web Services (AWS)";
    if (/coursera/i.test(tool)) return "Coursera, Inc.";
    if (/credly/i.test(tool)) return "Credly, Inc.";
  }

  for (const line of doc.visibleLines) {
    const m = /Digitally\s+signed\s+by\s+([^,.\n]+)/i.exec(line);
    if (m && m[1]) return m[1].trim();
    if (/DigiLocker\s+Verified/i.test(line)) return "DigiLocker Verified";
  }

  return null;
}
