/**
 * Counter-Offer Defense Playbook (Notice Period Hazard Mitigation)
 * 
 * Provides recruiters and candidates with data-backed defense strategies
 * against current-employer counter-offers during the 30-90 day Indian notice period.
 */

export interface CounterOfferRiskFactors {
  hikePercentage: number;
  currentTenureYears: number;
  relationshipWithManager: "strained" | "neutral" | "close";
  hasReceivedCounterOffer: boolean;
  counterOfferAmountLpa?: number;
}

export interface DefenseStrategyResult {
  riskTier: "low" | "medium" | "critical";
  defenseHeadline: string;
  psychologicalTalkingPoints: string[];
  resignationLetterTemplate: string;
  counterOfferRefusalScript: string;
}

export function generateCounterOfferDefense(factors: CounterOfferRiskFactors): DefenseStrategyResult {
  let riskTier: "low" | "medium" | "critical" = "medium";
  if (factors.hasReceivedCounterOffer || factors.relationshipWithManager === "close") {
    riskTier = "critical";
  } else if (factors.hikePercentage > 40 && factors.currentTenureYears > 3) {
    riskTier = "medium";
  } else {
    riskTier = "low";
  }

  const psychologicalTalkingPoints = [
    "Statistical Reality: Over 80% of software engineers who accept a retention counter-offer from their current company end up leaving within 6 to 9 months anyway.",
    "Trust Erosion: Once you resign, your current employer knows you are on the market. Future promotions and critical roadmap projects are often prioritized for 'loyal' team members.",
    "Root Causes Don't Change: A salary bump does not fix architectural technical debt, slow deployment cycles, or organizational bureaucracy.",
    "Why Only Now?: Ask yourself: if your current company valued you at this new number, why did it require a resignation letter to offer it to you?",
  ];

  const resignationLetterTemplate = [
    "Dear [Manager Name],",
    "",
    "Please accept this formal notification that I am resigning from my position as [Current Title] at [Company Name]. My last working day will be [Date, adhering to notice period].",
    "",
    "I have made a definitive commitment to pursue a new career milestone aligned with my long-term technical aspirations. I am fully committed to ensuring a smooth, comprehensive knowledge transfer over the coming weeks.",
    "",
    "Thank you for the support during my time with the team.",
    "",
    "Sincerely,",
    "[Candidate Name]",
  ].join("\n");

  const counterOfferRefusalScript = [
    `"I truly appreciate the team putting this counter-offer forward — it validates the work we've built together.`,
    `However, my decision to move is rooted in wanting to take on new technical architecture and high-velocity ownership that this new chapter uniquely provides.`,
    `I have given my word to the founders, and my decision is final. My entire focus now is on completing a clean handover so the team doesn't skip a beat."`,
  ].join(" ");

  return {
    riskTier,
    defenseHeadline:
      riskTier === "critical"
        ? "Active Retention Hazard Detected: Immediate Founder Bonding Call Required"
        : "Standard Notice Period Hazard Defense",
    psychologicalTalkingPoints,
    resignationLetterTemplate,
    counterOfferRefusalScript,
  };
}
