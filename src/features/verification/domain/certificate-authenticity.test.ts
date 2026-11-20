import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  inspectDocumentAuthenticity,
  type DocumentAuthenticityReport,
} from "./certificate-authenticity.ts";
import type { DocumentForensics } from "./forensics.ts";

function mockDoc(overrides: Partial<DocumentForensics>): DocumentForensics {
  return {
    format: "pdf",
    docClass: "certificate",
    filename: "sample.pdf",
    visibleLines: [],
    orphanedLines: [],
    generations: 1,
    tableChain: 1,
    lineage: { documentIds: [], instanceIds: [] },
    tools: [],
    createdMonth: "2024-01",
    statedMonth: "2024-01",
    createdInstant: "2024-01-01-00-00-00",
    modifiedInstant: "2024-01-01-00-00-00",
    anachronisms: [],
    baseFonts: [],
    hasAbandonedContent: false,
    docx: null,
    grades: [],
    readError: "",
    ...overrides,
  };
}

describe("Certificate & Document Authenticity Inspection", () => {
  test("Detects International Credentials with verification URL (e.g. AWS & Coursera)", () => {
    const doc = mockDoc({
      visibleLines: [
        "AWS Certified Solutions Architect Associate",
        "Verification code: https://cp.certmetrics.com/amazon/public/verify/ABC123XYZ",
      ],
      filename: "aws-certificate.pdf",
    });

    const report = inspectDocumentAuthenticity(doc);
    assert.equal(report.credentials.length, 1);
    assert.equal(report.credentials[0].issuer, "Amazon Web Services (AWS)");
    assert.equal(report.credentials[0].origin, "international");
    assert.equal(
      report.credentials[0].verificationUrl,
      "cp.certmetrics.com/amazon/public/verify/ABC123XYZ",
    );
    // Verified URL prevents advisory warning
    assert.equal(report.warnings.length, 0);
  });

  test("Flags unverified International Credential with advisory warning and interview probe", () => {
    const doc = mockDoc({
      visibleLines: ["AWS Certified Solutions Architect Associate", "Issued: Jan 2024"],
      filename: "aws-certificate.pdf",
    });

    const report = inspectDocumentAuthenticity(doc);
    assert.equal(report.credentials.length, 1);
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].category, "international_cert");
    assert.match(report.warnings[0].reason, /contains no public Credly, CertMetrics/);
    assert.match(report.warnings[0].suggestedInterviewProbe, /public Credly badge URL/);
  });

  test("Detects Indian Institutional Certificates (DigiLocker NAD) with cryptographic signature", () => {
    const doc = mockDoc({
      visibleLines: [
        "National Academic Depository - DigiLocker",
        "Digitally signed by eMudhra Sub-CA",
        "Visvesvaraya Technological University (VTU) Bachelor of Engineering",
      ],
      tools: ["eMudhra CA (India PKI)"],
      filename: "vtu-marksheet.pdf",
    });

    const report = inspectDocumentAuthenticity(doc);
    assert.ok(report.credentials.some((c) => c.origin === "indian"));
    assert.equal(report.overallStatus, "authentic_verified");
    assert.equal(report.warnings.length, 0);
  });

  test("Flags unverified Indian Institutional Certificate with advisory warning", () => {
    const doc = mockDoc({
      visibleLines: [
        "Central Board of Secondary Education (CBSE)",
        "Senior School Certificate Examination",
      ],
      filename: "cbse-marksheet.pdf",
    });

    const report = inspectDocumentAuthenticity(doc);
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].category, "indian_cert");
    assert.match(report.warnings[0].reason, /lacks the official cryptographic digital signature/);
    assert.match(report.warnings[0].suggestedInterviewProbe, /DigiLocker document URI/);
  });

  test("Detects automated single-pass synthetic DOCX resume generation", () => {
    const doc = mockDoc({
      format: "docx",
      docClass: "resume",
      filename: "candidate-resume.docx",
      docx: {
        revision: 1,
        totalEditingMinutes: 0,
        rsidCount: 1,
        hasRevisionTable: true,
        trackChanges: false,
        application: "python-docx",
        words: 450,
        singleSaveWholeDocument: true,
      },
    });

    const report = inspectDocumentAuthenticity(doc);
    assert.equal(report.generationType, "synthetic_generated");
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].category, "synthetic_document");
    assert.match(report.warnings[0].reason, /0 total recorded editing minutes/);
    assert.match(report.warnings[0].suggestedInterviewProbe, /architectural choices/);
  });

  test("Detects automated PDF generation engines (e.g. WeasyPrint / ReportLab)", () => {
    const doc = mockDoc({
      format: "pdf",
      docClass: "resume",
      tools: ["WeasyPrint 57.0 (http://weasyprint.org/)"],
      filename: "resume.pdf",
    });

    const report = inspectDocumentAuthenticity(doc);
    assert.equal(report.generationType, "synthetic_generated");
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0].label, /WeasyPrint/);
  });
});
