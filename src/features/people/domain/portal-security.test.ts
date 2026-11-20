import test from "node:test";
import assert from "node:assert/strict";
import {
  validateExternalPortalUrl,
  isRestrictedIpAddress,
  validateResumeBuffer,
  sanitizeResumePayload,
} from "./portal-security.ts";

test("Security: validateExternalPortalUrl enforces HTTPS and blocks SSRF targets", () => {
  // Valid HTTPS URLs
  const valid1 = validateExternalPortalUrl("https://careers.acmecorp.com/jobs/cloud-architect");
  assert.equal(valid1.valid, true);
  assert.equal(valid1.normalized, "https://careers.acmecorp.com/jobs/cloud-architect");

  const valid2 = validateExternalPortalUrl("https://jobs.google.com/feed?role=123");
  assert.equal(valid2.valid, true);

  // Insecure HTTP protocol rejected
  const http = validateExternalPortalUrl("http://careers.acmecorp.com/jobs/123");
  assert.equal(http.valid, false);
  assert.ok(http.error?.includes("HTTPS"));

  // Malicious / local / cloud metadata targets rejected
  const localhost = validateExternalPortalUrl("https://localhost/api/resumes");
  assert.equal(localhost.valid, false);
  assert.ok(localhost.error?.includes("SSRF"));

  const loopback = validateExternalPortalUrl("https://127.0.0.1:8080/feed");
  assert.equal(loopback.valid, false);
  assert.ok(loopback.error?.includes("SSRF"));

  const awsMetadata = validateExternalPortalUrl("https://169.254.169.254/latest/meta-data");
  assert.equal(awsMetadata.valid, false);
  assert.ok(awsMetadata.error?.includes("SSRF"));

  // Embedded credentials rejected
  const creds = validateExternalPortalUrl("https://admin:pass@careers.acme.com/jobs");
  assert.equal(creds.valid, false);
  assert.ok(creds.error?.includes("credentials"));
});

test("Security: isRestrictedIpAddress catches internal CIDR blocks", () => {
  // Loopback
  assert.equal(isRestrictedIpAddress("127.0.0.1"), true);
  assert.equal(isRestrictedIpAddress("127.1.2.3"), true);
  assert.equal(isRestrictedIpAddress("::1"), true);

  // RFC1918 Private ranges
  assert.equal(isRestrictedIpAddress("10.0.0.1"), true);
  assert.equal(isRestrictedIpAddress("10.255.255.254"), true);
  assert.equal(isRestrictedIpAddress("172.16.0.5"), true);
  assert.equal(isRestrictedIpAddress("172.31.255.1"), true);
  assert.equal(isRestrictedIpAddress("192.168.1.1"), true);
  assert.equal(isRestrictedIpAddress("192.168.0.254"), true);

  // Cloud Instance Metadata
  assert.equal(isRestrictedIpAddress("169.254.169.254"), true);

  // Public IP addresses allowed
  assert.equal(isRestrictedIpAddress("142.250.190.46"), false); // Google
  assert.equal(isRestrictedIpAddress("1.1.1.1"), false); // Cloudflare
  assert.equal(isRestrictedIpAddress("8.8.8.8"), false); // Google DNS
});

test("Security: validateResumeBuffer checks magic bytes and size constraints", () => {
  // Authentic PDF magic bytes: '%PDF-1.4...'
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const pdfCheck = validateResumeBuffer(pdfBytes, "resume.pdf");
  assert.equal(pdfCheck.valid, true);
  assert.equal(pdfCheck.detectedFormat, "pdf");

  // Authentic DOCX magic bytes: 'PK\x03\x04...'
  const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
  const docxCheck = validateResumeBuffer(docxBytes, "cv.docx");
  assert.equal(docxCheck.valid, true);
  assert.equal(docxCheck.detectedFormat, "docx");

  // Authentic ASCII plain text
  const textBytes = new TextEncoder().encode("Candidate Resume\nSkills: Go, TypeScript, PostgreSQL");
  const textCheck = validateResumeBuffer(textBytes, "resume.txt");
  assert.equal(textCheck.valid, true);
  assert.equal(textCheck.detectedFormat, "txt");

  // Executable binary rejected (Windows PE 'MZ')
  const peBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
  const peCheck = validateResumeBuffer(peBytes, "malicious.pdf");
  assert.equal(peCheck.valid, false);
  assert.ok(peCheck.error?.includes("Executable Windows binary"));

  // Executable binary rejected (Linux ELF)
  const elfBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02]);
  const elfCheck = validateResumeBuffer(elfBytes, "payload.exe");
  assert.equal(elfCheck.valid, false);
  assert.ok(elfCheck.error?.includes("Executable Linux binary"));

  // Oversized file rejected
  const oversized = new Uint8Array(16 * 1024 * 1024); // 16 MB
  const sizeCheck = validateResumeBuffer(oversized, "huge.pdf");
  assert.equal(sizeCheck.valid, false);
  assert.ok(sizeCheck.error?.includes("exceeds 15 MB"));
});

test("Sanitization: sanitizeResumePayload cleans and validates candidate inputs", () => {
  const result = sanitizeResumePayload({
    fullName: "  Priya \u200B Sharma  ",
    email: "PRIYA.SHARMA@EXAMPLE.COM  ",
    phone: " +91 98765 43210 ",
    location: "Bengaluru",
    resumeText: "Experienced Cloud Architect with AWS and Kubernetes.",
  });

  assert.equal(result.valid, true);
  assert.equal(result.sanitized?.fullName, "Priya Sharma");
  assert.equal(result.sanitized?.email, "priya.sharma@example.com");
  assert.equal(result.sanitized?.phone, "+91 98765 43210");

  // Rejects invalid email
  const badEmail = sanitizeResumePayload({ fullName: "Priya", email: "invalid-email" });
  assert.equal(badEmail.valid, false);

  // Rejects missing name
  const badName = sanitizeResumePayload({ fullName: " ", email: "test@example.com" });
  assert.equal(badName.valid, false);
});
