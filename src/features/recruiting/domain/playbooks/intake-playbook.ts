/**
 * Job Intake Analysis Playbook
 * 
 * Codifies senior recruiter intuition on founder intake calls:
 * - Separates actual production must-haves from generic HR wishlists
 * - Extracts unwritten team velocity cues (fast/scrappy product vs corporate enterprise)
 * - Identifies non-negotiable architectural dealbreakers
 */

export interface IntakeAnalysisResult {
  roleCore: string;
  hardMustHaves: string[];
  negotiableNiceToHaves: string[];
  unwrittenCulturePace: "high_velocity_startup" | "structured_scaleup" | "legacy_enterprise";
  dealbreakers: string[];
  compCeilingFixedLpa: number | null;
  recommendedSourcingPitch: string;
}

export function analyzeJobIntake(transcriptOrNotes: string): IntakeAnalysisResult {
  const lower = transcriptOrNotes.toLowerCase();

  // 1. Culture / Pace Detection
  let pace: "high_velocity_startup" | "structured_scaleup" | "legacy_enterprise" = "high_velocity_startup";
  if (/enterprise|governance|compliance|process-heavy|large team|matrix/i.test(lower)) {
    pace = "legacy_enterprise";
  } else if (/series b|scaleup|scaling|growth stage|100\+|cross-functional/i.test(lower)) {
    pace = "structured_scaleup";
  } else if (/scrappy|seed|series a|fast|ship fast|zero to one|0 to 1|own it|wear many hats/i.test(lower)) {
    pace = "high_velocity_startup";
  }

  // 2. Dealbreakers
  const dealbreakers: string[] = [];
  if (/no\s*(it\s*)?service\s*(firms?|compan(y|ies))|product\s*(only|experience)|reject\s*(it\s*)?service/i.test(lower)) {
    dealbreakers.push("Prefers pure product engineering background (reject pure IT services maintenance)");
  }
  if (/frequent switch(er)?|job hopper|stable only|minimum 2 years/i.test(lower)) {
    dealbreakers.push("Tenure stability: at least 1.5–2 years per role unless startup ceased operations");
  }
  if (/hands-on|must code|write code daily|no pure manager/i.test(lower)) {
    dealbreakers.push("100% hands-on coding required (no pure architecture or people-manager profiles)");
  }
  if (/hybrid mandatory|in-office|no remote/i.test(lower)) {
    dealbreakers.push("Physical presence: strictly hybrid/onsite in city of role");
  }

  // 3. Compensation Ceiling Extraction
  let compCeilingFixedLpa: number | null = null;
  const ceilingMatch = lower.match(/(budget|max|ceiling|upto|stretch upto|cap)\s*(is|of)?\s*(\d+(\.\d+)?)\s*(lpa|lakh|lac)/i);
  if (ceilingMatch) {
    compCeilingFixedLpa = parseFloat(ceilingMatch[3]!);
  }

  // 4. Hard Must-Haves Extraction
  const mustHaves: string[] = [];
  const lines = transcriptOrNotes.split(/\n+/);
  for (const line of lines) {
    const l = line.trim();
    if (/must\s*have|dealbreaker|non-negotiable|required|core tech/i.test(l)) {
      mustHaves.push(l.replace(/^[-*•0-9.]+\s*/, ""));
    }
  }
  if (mustHaves.length === 0) {
    // Fallback heuristic from keywords
    if (/golang|go\b/i.test(lower)) mustHaves.push("Production Go / Golang microservices");
    if (/kafka|distributed streaming/i.test(lower)) mustHaves.push("Distributed event streaming (Kafka / Flink)");
    if (/postgres|sql optimization/i.test(lower)) mustHaves.push("Relational database internals & indexing (PostgreSQL)");
  }

  // 5. Recommended Sourcing Pitch
  const recommendedSourcingPitch = `Direct engineering ownership with founders at ${pace.replace(/_/g, " ")}. Zero bureaucracy, hands-on production impact, verified fixed base of ₹${compCeilingFixedLpa ?? "market"} LPA.`;

  return {
    roleCore: transcriptOrNotes.slice(0, 160).trim(),
    hardMustHaves: mustHaves.slice(0, 6),
    negotiableNiceToHaves: [
      "Familiarity with Kubernetes/IaC",
      "Prior exposure to high-growth startup environment",
    ],
    unwrittenCulturePace: pace,
    dealbreakers,
    compCeilingFixedLpa,
    recommendedSourcingPitch,
  };
}
