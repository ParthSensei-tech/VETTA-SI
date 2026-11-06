import { createHash } from "node:crypto";

/** Stable SHA-256 hex of normalized text (trim + collapse inner whitespace for role fields). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashResumeText(resumeText: string): string {
  return sha256Hex(resumeText.replace(/\r\n/g, "\n").trim());
}

export function hashRolePayload(role: {
  companyName: string;
  companyStage: string;
  title: string;
  location: string;
  workMode: string;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
}): string {
  const norm = (s?: string) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const list = (arr?: string[]) =>
    [...(arr || [])]
      .map((x) => norm(x))
      .filter(Boolean)
      .sort()
      .join("|");
  const payload = [
    norm(role.companyName),
    norm(role.companyStage),
    norm(role.title),
    norm(role.location),
    norm(role.workMode),
    norm(role.compensationBand),
    list(role.stack),
    list(role.mustHaves),
    list(role.niceToHaves),
    norm(role.jdText),
  ].join("\n");
  return sha256Hex(payload);
}

/**
 * Deterministic SHA-256 hash of a rubric's criteria and hard constraints.
 * Changes whenever weights, criteria text, kinds, or constraints change.
 */
export function computeRubricHash(
  criteria: Array<{ id?: string; name: string; weight: string; kind: string; strongEvidence?: string }>,
  hardConstraints?: Record<string, unknown>,
): string {
  const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const sortedCriteria = [...criteria]
    .map((c) => `${norm(c.name)}:${norm(c.weight)}:${norm(c.kind)}:${norm(c.strongEvidence || "")}`)
    .sort()
    .join(";;");
  const hc = hardConstraints ? JSON.stringify(hardConstraints, Object.keys(hardConstraints).sort()) : "";
  return sha256Hex(`${sortedCriteria}\n${hc}`);
}

export function cacheKey(parts: {
  userId: string;
  resumeHash: string;
  roleHash: string;
  mode: string;
  rubricHash?: string | null;
}): string {
  return `${parts.userId}:${parts.resumeHash}:${parts.roleHash}:${parts.mode}`;
}
