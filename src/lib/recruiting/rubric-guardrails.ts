/**
 * Guardrails: block or warn criteria that encode protected attributes or pedigree proxies.
 * DPDP + fairness — founders edit LLM drafts; they cannot freely add discriminatory rules.
 */

export type GuardrailHit = {
  severity: "block" | "warn";
  field: "name" | "strongEvidence";
  pattern: string;
  reason: string;
};

const BLOCK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(gender|male|female|woman|man only|women only)\b/i, reason: "Gender is a protected attribute and cannot be a hiring criterion." },
  { re: /\b(age|under\s*\d{2}|over\s*\d{2}|young|older candidates?)\b/i, reason: "Age-based criteria are not allowed." },
  { re: /\b(caste|brahmin|dalit|sc\/st|obc)\b/i, reason: "Caste is a protected attribute." },
  { re: /\b(religion|hindu|muslim|christian|sikh|jain)\b/i, reason: "Religion is a protected attribute." },
  { re: /\b(marital|married|unmarried|single mother)\b/i, reason: "Marital or family status cannot be a criterion." },
  { re: /\b(disability|able[- ]bodied)\b/i, reason: "Disability status cannot be used as a filter." },
];

const WARN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(iit|nit|bits|iim only|only iit)\b/i, reason: "Pedigree proxies (IIT/NIT/BITS/IIM-only) often encode bias. Prefer skills and ownership evidence." },
  { re: /\b(faang|google|meta|microsoft only|only faang)\b/i, reason: "Employer brand as a hard bar can miss strong early-stage talent. Prefer scope of work." },
  { re: /\b(tier[- ]?1 college|top college only)\b/i, reason: "College tier filters are weak predictors and fairness risks." },
  { re: /\b(english mother tongue|native english only)\b/i, reason: "Language fluency for the role is fine; mother-tongue requirements are not." },
];

export function scanCriterionText(name: string, strongEvidence: string): GuardrailHit[] {
  const hits: GuardrailHit[] = [];
  for (const { re, reason } of BLOCK_PATTERNS) {
    if (re.test(name)) hits.push({ severity: "block", field: "name", pattern: re.source, reason });
    if (re.test(strongEvidence)) hits.push({ severity: "block", field: "strongEvidence", pattern: re.source, reason });
  }
  for (const { re, reason } of WARN_PATTERNS) {
    if (re.test(name)) hits.push({ severity: "warn", field: "name", pattern: re.source, reason });
    if (re.test(strongEvidence)) hits.push({ severity: "warn", field: "strongEvidence", pattern: re.source, reason });
  }
  return hits;
}

export function validateCriteria(
  criteria: Array<{ name: string; strongEvidence: string }>,
): { ok: boolean; blocks: GuardrailHit[]; warns: GuardrailHit[] } {
  const blocks: GuardrailHit[] = [];
  const warns: GuardrailHit[] = [];
  for (const c of criteria) {
    for (const h of scanCriterionText(c.name, c.strongEvidence)) {
      if (h.severity === "block") blocks.push(h);
      else warns.push(h);
    }
  }
  return { ok: blocks.length === 0, blocks, warns };
}
