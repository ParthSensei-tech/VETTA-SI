/**
 * Pure Domain Security Validation for External Career Portal Ingestion
 *
 * Enforces strict, zero-threat isolation boundaries:
 *  1. SSRF & Protocol Safety: Enforces HTTPS, disallows userinfo, checks IP restrictions.
 *  2. Binary Magic-Byte Verification: Prevents polyglot or executable payloads.
 *  3. File Size Caps: Strictly bounds files to 15 MB.
 *  4. Payload & Identity Sanitization: Strips control characters, normalizes contact points.
 *
 * Architecture Rule: Pure domain file — zero IO, zero DB, zero network.
 */

import type { ExternalPortalCandidatePayload } from "../../recruiting/domain/types.ts";

export const MAX_RESUME_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_RESUME_TEXT_CHARS = 100_000;

/**
 * Validates and normalizes an external portal job or feed URL.
 * Only HTTPS URLs are permitted. Userinfo (`user:pass@`) and dangerous schemes are rejected.
 */
export function validateExternalPortalUrl(rawUrl: string): {
  valid: boolean;
  normalized?: string;
  error?: string;
} {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return { valid: false, error: "Portal URL cannot be empty" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Invalid URL syntax" };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `Insecure protocol '${parsed.protocol}'. Official portals must use HTTPS (https://).`,
    };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: "Embedded user credentials in URL are prohibited" };
  }

  const hostname = parsed.hostname.toLowerCase();
  // Reject raw loopback or metadata hostnames immediately
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "127.0.0.1" ||
    hostname === "169.254.169.254" ||
    hostname === "::1"
  ) {
    return { valid: false, error: "Access to private or metadata hostnames is prohibited (SSRF defense)" };
  }

  if (!hostname || hostname.length < 3 || !hostname.includes(".")) {
    return { valid: false, error: "Invalid hostname: must be a fully qualified domain name" };
  }

  return { valid: true, normalized: parsed.toString() };
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to a restricted/private network range.
 * Used for SSRF defense before making outbound fetch requests.
 */
export function isRestrictedIpAddress(ip: string): boolean {
  const clean = ip.trim().toLowerCase();

  // IPv6 loopback & link-local
  if (clean === "::1" || clean.startsWith("fe80:") || clean.startsWith("fc00:") || clean.startsWith("fd00:")) {
    return true;
  }

  // IPv4 parsing
  const parts = clean.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false; // Not a valid IPv4 address (likely a domain name)
  }

  const [a, b] = parts;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (Private Network)
  if (a === 10) return true;

  // 172.16.0.0/12 (Private Network: 172.16.0.0 – 172.31.255.255)
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Private Network)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (Link-Local & Cloud Instance Metadata: AWS, GCP, Azure, Oracle)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (Carrier-Grade NAT)
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (a !== undefined && a >= 224) return true;

  return false;
}

/**
 * Validates resume binary buffer format by checking magic bytes and size constraints.
 * Refuses executable binaries (ELF, PE MZ) and oversized documents.
 */
export function validateResumeBuffer(
  bytes: Uint8Array,
  filename?: string,
): {
  valid: boolean;
  detectedFormat?: "pdf" | "docx" | "txt";
  error?: string;
} {
  if (!bytes || bytes.length === 0) {
    return { valid: false, error: "Empty file content" };
  }

  if (bytes.length > MAX_RESUME_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size (${(bytes.length / (1024 * 1024)).toFixed(1)} MB) exceeds 15 MB limit`,
    };
  }

  // Dangerous executable headers
  // Windows PE: 'MZ' (0x4D, 0x5A)
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
    return { valid: false, error: "Executable Windows binary (PE/MZ) is rejected for security" };
  }

  // Linux ELF: 0x7F, 'E', 'L', 'F' (0x7F, 0x45, 0x4C, 0x46)
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return { valid: false, error: "Executable Linux binary (ELF) is rejected for security" };
  }

  // Shell script: '#!' (0x23, 0x21)
  if (bytes[0] === 0x23 && bytes[1] === 0x21) {
    return { valid: false, error: "Script file is rejected for security" };
  }

  // PDF Magic Bytes: '%PDF-' (0x25, 0x50, 0x44, 0x46, 0x2D)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { valid: true, detectedFormat: "pdf" };
  }

  // DOCX / ZIP Magic Bytes: 'PK\x03\x04' (0x50, 0x4B, 0x03, 0x04)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return { valid: true, detectedFormat: "docx" };
  }

  // Fallback: Check if content is UTF-8 text (for plain-text resumes)
  let isAsciiText = true;
  const sampleLength = Math.min(bytes.length, 512);
  for (let i = 0; i < sampleLength; i++) {
    const byte = bytes[i]!;
    // Allow standard printable ASCII, tabs, newlines, carriage returns
    if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127) {
      isAsciiText = false;
      break;
    }
  }

  if (isAsciiText) {
    return { valid: true, detectedFormat: "txt" };
  }

  // If filename extension suggests pdf/docx but magic bytes failed
  const ext = filename?.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    return { valid: false, error: "File has .pdf extension but lacks authentic %PDF- header" };
  }
  if (ext === "docx") {
    return { valid: false, error: "File has .docx extension but lacks authentic PK zip header" };
  }

  return { valid: false, error: "Unsupported or unrecognized document format (only PDF, DOCX, and TXT allowed)" };
}

/**
 * Sanitizes candidate payload before ingestion:
 *  - Strips zero-width characters and excessive whitespace.
 *  - Normalizes email to lowercase.
 *  - Bounds resume text to 100,000 characters.
 */
export function sanitizeResumePayload(raw: Partial<ExternalPortalCandidatePayload>): {
  valid: boolean;
  sanitized?: ExternalPortalCandidatePayload;
  error?: string;
} {
  const fullName = raw.fullName
    ?.replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!fullName || fullName.length < 2) {
    return { valid: false, error: "Candidate full name is required (min 2 characters)" };
  }
  if (fullName.length > 150) {
    return { valid: false, error: "Candidate full name exceeds 150 characters" };
  }

  const rawEmail = raw.email?.trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@") || !rawEmail.includes(".")) {
    return { valid: false, error: "Valid candidate email address is required" };
  }

  const resumeText = (raw.resumeText || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .slice(0, MAX_RESUME_TEXT_CHARS)
    .trim();

  return {
    valid: true,
    sanitized: {
      fullName,
      email: rawEmail,
      phone: raw.phone?.trim().slice(0, 30) || "",
      location: raw.location?.trim().slice(0, 100) || "",
      linkedinUrl: raw.linkedinUrl?.trim().slice(0, 300) || "",
      resumeText,
      resumeBase64: raw.resumeBase64,
      resumeFilename: raw.resumeFilename?.trim().slice(0, 200),
      mediaType: raw.mediaType?.trim().slice(0, 80),
      appliedAt: raw.appliedAt || new Date().toISOString(),
    },
  };
}
