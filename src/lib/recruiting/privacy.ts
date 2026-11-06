/**
 * What Vetta is allowed to do with a person, and what a deletion must touch.
 * No names, no sample resumes.
 */

export const NOTICE_VERSION = "2026-10";

export const PURPOSES = [
  {
    id: "recruitment_evaluation",
    label: "Evaluate this application",
    detail: "Read the resume, rank fit, and run the written screen for this role.",
    askOnApply: true,
    requiredOnApply: true,
    employerInstructionOk: true,
  },
  {
    id: "client_disclosure",
    label: "Share a card with the hiring company",
    detail:
      "Name, headline, and the approved card can leave this workspace on a link that expires.",
    askOnApply: true,
    requiredOnApply: false,
    employerInstructionOk: true,
  },
  {
    id: "voice_prescreen",
    label: "Turn a voice answer into text",
    detail: "A voice note is transcribed on this machine. The audio is not stored.",
    askOnApply: true,
    requiredOnApply: false,
    employerInstructionOk: false,
  },
  {
    id: "model_improvement",
    label: "Let this company's ranker learn from the decision",
    detail:
      "Only the private model for this company. The resume is not sent out to train a public model.",
    askOnApply: true,
    requiredOnApply: false,
    employerInstructionOk: true,
  },
] as const;

export type PurposeId = (typeof PURPOSES)[number]["id"];

export const PRIVACY_STORES = [
  "candidates",
  "applications",
  "screens",
  "approvals",
  "ingest_jobs",
  "rank_cache",
  "embeddings",
  "rank_labels",
  "rank_feedback",
  "rank_traces",
  "shadow_comparisons",
  "eval_cases",
  "outcome_events",
  "screen_reminders",
  "client_shares",
  "audit_events",
  "consent_records",
  "provider_disclosures",
  "embed_seen",
] as const;

export type PrivacyStore = (typeof PRIVACY_STORES)[number];

export function purposeById(id: string): (typeof PURPOSES)[number] | undefined {
  return PURPOSES.find((p) => p.id === id);
}

export function withdrawalEffect(purpose: PurposeId): "erase" | "shares" | "voice" | "learning" {
  if (purpose === "recruitment_evaluation") return "erase";
  if (purpose === "client_disclosure") return "shares";
  if (purpose === "voice_prescreen") return "voice";
  return "learning";
}

export function purposeDenied(id: PurposeId): string {
  const purpose = purposeById(id);
  if (id === "voice_prescreen") {
    return "Voice answers need a separate yes. Type the answer, or grant voice on the application page.";
  }
  if (id === "client_disclosure") {
    return "This person has not agreed to be shared with the hiring company.";
  }
  if (id === "model_improvement") {
    return "This person has not agreed to be used for model learning.";
  }
  return purpose ? `Processing is stopped for “${purpose.label}”.` : "Processing is stopped.";
}

/**
 * A grant row wins over a missing row. A withdrawal wins over the legacy
 * assumption we use for resumes uploaded before this notice existed.
 */
export function basisAllows(args: {
  purpose: PurposeId;
  rows: Array<{ granted: boolean; basis: string }>;
  employerCoversClientShare: boolean;
  employerCoversModelTraining: boolean;
}): boolean {
  const purpose = purposeById(args.purpose);
  if (!purpose) return false;
  const relevant = args.rows;
  if (relevant.some((row) => row.granted && row.basis === "consent")) return true;
  const employer = relevant.some((row) => row.granted && row.basis === "employer_instruction");
  if (employer && purpose.employerInstructionOk) {
    if (args.purpose === "client_disclosure" && !args.employerCoversClientShare) return false;
    if (args.purpose === "model_improvement" && !args.employerCoversModelTraining) return false;
    return true;
  }
  if (relevant.length > 0) return false;
  if (args.purpose === "recruitment_evaluation") return true;
  if (args.purpose === "client_disclosure") return args.employerCoversClientShare;
  return false;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable reference for an erasure receipt. Not the person's id. */
export async function subjectRef(orgId: string, subjectId: string): Promise<string> {
  const hex = await sha256Hex(`${orgId}\0${subjectId}`);
  return hex.slice(0, 32);
}

export function stripShareCandidates<T extends { applicationId: string }>(
  candidates: T[],
  blockedApplicationIds: ReadonlySet<string>,
): { kept: T[]; removed: number } {
  const kept = candidates.filter((c) => !blockedApplicationIds.has(c.applicationId));
  return { kept, removed: candidates.length - kept.length };
}

/**
 * What we can honestly tell a person about each provider.
 * Chat calls are sent without a store flag. None of these vendors expose
 * a per-prompt delete API that this app can call without a paid contract.
 */
export function providerForgetResult(provider: string): {
  provider: string;
  status: "local_only" | "no_delete_api";
  detail: string;
} {
  if (provider === "ollama") {
    return {
      provider,
      status: "local_only",
      detail: "The model ran on this machine. The prompt was not sent to a vendor.",
    };
  }
  return {
    provider,
    status: "no_delete_api",
    detail:
      "The call did not ask the vendor to store the prompt. That vendor has no per-prompt delete API, so the prompt cannot be pulled back. Vetta does not keep the prompt text.",
  };
}
