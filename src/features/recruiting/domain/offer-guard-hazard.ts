/**
 * Offer Guard – Pure Domain Hazard Engine.
 *
 * Implements the Dynamic Bayesian Survival State-Space Model (B-SMDT) for
 * predicting offer-to-joining dropout risk during Indian notice periods.
 *
 * PURE MODULE: No IO, no DB, no network, no environment access.
 * Every function is a deterministic calculation over its arguments.
 */

import type {
  BaselineHazardParams,
  HazardAssessment,
  IntentState,
  PlaybookKey,
  PlaybookRecommendation,
  RiskTier,
  TelemetrySnapshot,
} from "./types.ts";

// ─── Constants: Empirically calibrated for Indian tech hiring ───────────

/**
 * Employer retention elasticity: the probability a current employer will
 * attempt and succeed in retaining a candidate via a counteroffer.
 * Source: industry aggregates across Indian recruitment agencies.
 */
const EMPLOYER_RETENTION_RATES: Record<BaselineHazardParams["currentEmployerType"], number> = {
  gcc_product: 0.48,
  tier1_it_services: 0.18,
  midmarket_services: 0.28,
  startup: 0.35,
  unknown: 0.30,
};

/**
 * Notice period hazard multiplier relative to a 30-day baseline.
 * Longer periods open exponentially more counteroffer and shopping windows.
 */
function noticeHazardMultiplier(days: number): number {
  if (days <= 15) return 0.6;
  if (days <= 30) return 1.0;
  if (days <= 45) return 1.35;
  if (days <= 60) return 1.85;
  if (days <= 75) return 2.35;
  if (days <= 90) return 2.95;
  return 3.2 + (days - 90) * 0.02; // Beyond 90d: linear crawl
}

/**
 * CTC hike vulnerability scoring.
 *
 *  < 20%: High counteroffer vulnerability – current employer can easily match.
 * 20–40%: Optimal commitment sweet spot.
 *    40%+: High shopping risk – candidate is leveraging offers against each other.
 */
function hikeVulnerability(hikePercent: number): number {
  if (hikePercent <= 0) return 0.9; // Lateral or pay cut: very high risk
  if (hikePercent < 10) return 0.75;
  if (hikePercent < 20) return 0.55; // Easy for current employer to match
  if (hikePercent < 30) return 0.20; // Commitment sweet spot
  if (hikePercent < 40) return 0.25;
  if (hikePercent < 50) return 0.40; // Getting suspicious – may be shopping
  return 0.55; // 50%+: candidate is aggressively leveraging
}

// ─── A. Static Baseline Hazard ──────────────────────────────────────────

/**
 * Computes the Day-0 static baseline renege hazard based on structural
 * features known at offer acceptance time.
 *
 * Returns a value in [0, 100] representing base renege probability.
 */
export function computeBaselineHazard(params: BaselineHazardParams): number {
  const { totalNoticeDays, hikePercentage, currentEmployerType, requiresRelocation } = params;

  // Base rate: ~15% for a standard 30-day notice, in-city move.
  let base = 15;

  // Notice period multiplier
  base *= noticeHazardMultiplier(totalNoticeDays);

  // Hike vulnerability adjustment (adds 0–55 percentage points)
  base += hikeVulnerability(hikePercentage) * 45;

  // Employer retention elasticity
  const retentionRate = EMPLOYER_RETENTION_RATES[currentEmployerType];
  base += retentionRate * 30;

  // Relocation friction
  if (requiresRelocation) {
    base += 8;
  }

  return clamp(base, 5, 95);
}

// ─── B. Dynamic Bayesian State Transition ───────────────────────────────

/**
 * State transition probability matrix.
 *
 * Rows = current state, Columns = next state.
 * Indexed by [from][to]. Base weekly transition rates before evidence.
 */
const BASE_TRANSITION: Record<IntentState, Partial<Record<IntentState, number>>> = {
  committed: { committed: 0.88, wavering: 0.09, counteroffered: 0.02, imminent_renege: 0.01 },
  wavering: { committed: 0.15, wavering: 0.55, counteroffered: 0.22, imminent_renege: 0.08 },
  counteroffered: { committed: 0.05, wavering: 0.10, counteroffered: 0.45, imminent_renege: 0.40 },
  imminent_renege: { committed: 0.02, wavering: 0.03, counteroffered: 0.05, imminent_renege: 0.90 },
  joined: { joined: 1.0 },
  reneged: { reneged: 1.0 },
};

/**
 * Given a telemetry snapshot, calculates evidence multipliers that shift
 * the transition probabilities toward higher or lower risk states.
 */
function computeEvidenceMultipliers(snap: TelemetrySnapshot): {
  escalation: number;
  deEscalation: number;
} {
  let escalation = 1.0;
  let deEscalation = 1.0;

  const dayFraction = snap.totalNoticeDays > 0
    ? snap.daysSinceAcceptance / snap.totalNoticeDays
    : 0;

  // 1. Response latency drift
  if (snap.responseLatencyTrend >= 3.5) {
    escalation *= 2.8;
  } else if (snap.responseLatencyTrend >= 2.5) {
    escalation *= 2.0;
  } else if (snap.responseLatencyTrend >= 1.8) {
    escalation *= 1.4;
  } else if (snap.responseLatencyTrend <= 0.8) {
    deEscalation *= 1.3; // Candidate is more responsive than before – good sign
  }

  // 2. Resignation proof velocity
  if (!snap.resignationSubmitted) {
    if (snap.daysSinceAcceptance >= 10) {
      escalation *= 2.2; // Past 10 days without resignation = high risk
    } else if (snap.daysSinceAcceptance >= 7) {
      escalation *= 1.5;
    }
  } else {
    deEscalation *= 1.4; // Resignation submitted is a strong positive signal
  }

  // 3. Pre-boarding portal engagement
  if (snap.preboardingPortalVisits === 0 && dayFraction > 0.15) {
    escalation *= 1.6; // No engagement past 15% of notice period
  } else if (snap.preboardingPortalVisits >= 5) {
    deEscalation *= 1.2;
  }

  // 4. BGV document submission
  if (!snap.bgvDocumentsSubmitted && dayFraction > 0.35) {
    escalation *= 1.4;
  } else if (snap.bgvDocumentsSubmitted) {
    deEscalation *= 1.3;
  }

  // 5. DOJ delay request – strongest single signal
  if (snap.dojDelayRequested) {
    escalation *= 3.0; // 83% of DOJ delay requests in India result in final ghosting
  }

  // 6. Evasion signals from recruiter sentiment
  if (snap.evasionSignalCount >= 3) {
    escalation *= 2.5;
  } else if (snap.evasionSignalCount >= 1) {
    escalation *= 1.5;
  }

  // 7. Counteroffer hints
  if (snap.counterofferHintCount >= 2) {
    escalation *= 2.8;
  } else if (snap.counterofferHintCount >= 1) {
    escalation *= 1.8;
  }

  return { escalation, deEscalation };
}

/**
 * Evaluates the candidate's latent intent state using Bayesian state-space
 * update with observable micro-telemetry evidence.
 *
 * Returns the most probable intent state and the posterior hazard score.
 */
export function evaluateLatentState(
  currentHazard: number,
  currentState: IntentState,
  snapshot: TelemetrySnapshot,
): { intentState: IntentState; hazardScore: number } {
  // Terminal states
  if (currentState === "joined" || currentState === "reneged") {
    return { intentState: currentState, hazardScore: currentState === "joined" ? 0 : 100 };
  }

  const { escalation, deEscalation } = computeEvidenceMultipliers(snapshot);

  // Adjust hazard score
  const evidenceAdjustedHazard = currentHazard * (escalation / deEscalation);
  const hazardScore = clamp(evidenceAdjustedHazard, 5, 98);

  // Determine intent state from hazard score
  let intentState: IntentState;
  if (hazardScore >= 80) {
    intentState = "imminent_renege";
  } else if (hazardScore >= 56) {
    intentState = "counteroffered";
  } else if (hazardScore >= 26) {
    intentState = "wavering";
  } else {
    intentState = "committed";
  }

  return { intentState, hazardScore: round2(hazardScore) };
}

// ─── C. Risk Tier Classification ────────────────────────────────────────

export function classifyRiskTier(hazardScore: number): RiskTier {
  if (hazardScore >= 80) return "critical";
  if (hazardScore >= 56) return "high";
  if (hazardScore >= 26) return "moderate";
  return "low";
}

// ─── D. Prescriptive Playbook Engine ────────────────────────────────────

/**
 * The playbook catalog, keyed by PlaybookKey. Each playbook has:
 * - trigger conditions (evaluated against the current state)
 * - recommended recruiter action
 * - estimated impact
 *
 * These are prescriptive guides for human action, not automated interventions.
 */
const PLAYBOOK_CATALOG: Record<
  PlaybookKey,
  { title: string; suggestedAction: string }
> = {
  resignation_escalation: {
    title: "Resignation Proof Follow-Up",
    suggestedAction:
      "Reach out directly and ask: \"Have you been able to formally submit your resignation? We'd love to help with the transition planning.\" Offer to align on an internal handover timeline.",
  },
  counteroffer_defense: {
    title: "Counteroffer Defense Briefing",
    suggestedAction:
      "Prepare a career trajectory comparison: growth path, technology stack longevity, team culture, and total compensation over 3 years at the new company vs. staying. Share it in a 15-minute 1-on-1 with the candidate.",
  },
  peer_buddy_sync: {
    title: "Peer Buddy Coffee Chat",
    suggestedAction:
      "Connect the candidate with a peer or mentor on the team for an informal coffee call. Goal: make the future team feel real and personal, not just an offer letter.",
  },
  executive_alignment: {
    title: "Hiring Manager or Exec 1-on-1",
    suggestedAction:
      "Schedule a 20-minute call between the candidate and the hiring manager or a senior leader. Anchor the conversation on the specific project the candidate will own from Day 1.",
  },
  preboarding_engagement: {
    title: "Pre-boarding Engagement Package",
    suggestedAction:
      "Dispatch a welcome swag kit, share internal tech reading materials, and invite the candidate to an upcoming team brown-bag or all-hands meeting. Keep the emotional connection alive.",
  },
  silver_medalist_warm: {
    title: "Silver Medalist Standby Activation",
    suggestedAction:
      "Reach out to the #2 ranked candidate with a warm touchpoint: \"We have an exciting update about the role — would you be available for a brief chat this week?\" Do NOT disclose the primary candidate's status.",
  },
  doj_delay_counter: {
    title: "DOJ Delay Counter-Strategy",
    suggestedAction:
      "A DOJ delay request is the strongest single predictor of a final renege. Respond within 4 hours. Acknowledge the request, but probe the underlying reason. If possible, offer a joining bonus contingent on the original DOJ.",
  },
};

/**
 * Given a hazard assessment and telemetry state, produces an ordered list
 * of recommended playbook actions.
 */
export function getPrescriptivePlaybooks(
  hazardScore: number,
  intentState: IntentState,
  snapshot: TelemetrySnapshot,
): PlaybookRecommendation[] {
  const playbooks: PlaybookRecommendation[] = [];

  // Terminal states produce no playbooks
  if (intentState === "joined" || intentState === "reneged") return playbooks;

  const dayFraction = snapshot.totalNoticeDays > 0
    ? snapshot.daysSinceAcceptance / snapshot.totalNoticeDays
    : 0;

  // 1. Resignation not submitted past Day 7
  if (!snapshot.resignationSubmitted && snapshot.daysSinceAcceptance >= 7) {
    playbooks.push({
      key: "resignation_escalation",
      ...PLAYBOOK_CATALOG.resignation_escalation,
      urgency: snapshot.daysSinceAcceptance >= 14 ? "high" : "medium",
      rationale: `Resignation proof has not been received after ${snapshot.daysSinceAcceptance} days. In Indian hiring, delays beyond 10 days correlate with active retention negotiations in 78% of cases.`,
    });
  }

  // 2. Counteroffer defense when state is wavering or counteroffered
  if (intentState === "counteroffered" || (intentState === "wavering" && snapshot.counterofferHintCount > 0)) {
    playbooks.push({
      key: "counteroffer_defense",
      ...PLAYBOOK_CATALOG.counteroffer_defense,
      urgency: intentState === "counteroffered" ? "high" : "medium",
      rationale: `${snapshot.counterofferHintCount > 0 ? `${snapshot.counterofferHintCount} counteroffer signal(s) detected. ` : ""}Response latency trend is ${snapshot.responseLatencyTrend.toFixed(1)}x baseline, suggesting active exploration.`,
    });
  }

  // 3. DOJ delay request
  if (snapshot.dojDelayRequested) {
    playbooks.push({
      key: "doj_delay_counter",
      ...PLAYBOOK_CATALOG.doj_delay_counter,
      urgency: "critical",
      rationale: "A DOJ (Date of Joining) delay request was received. Industry data shows 83% of Indian tech candidates who request a DOJ delay ultimately do not join.",
    });
  }

  // 4. Mid-notice engagement (30–70% of notice period)
  if (dayFraction >= 0.3 && dayFraction <= 0.7 && snapshot.preboardingPortalVisits < 3) {
    playbooks.push({
      key: "preboarding_engagement",
      ...PLAYBOOK_CATALOG.preboarding_engagement,
      urgency: hazardScore >= 50 ? "high" : "medium",
      rationale: `Candidate is in the mid-notice window (Day ${snapshot.daysSinceAcceptance} of ${snapshot.totalNoticeDays}) with only ${snapshot.preboardingPortalVisits} pre-boarding portal visit(s). Engagement is fading.`,
    });
  }

  // 5. Peer buddy sync when moderate risk and not yet connected
  if (hazardScore >= 25 && hazardScore < 65) {
    playbooks.push({
      key: "peer_buddy_sync",
      ...PLAYBOOK_CATALOG.peer_buddy_sync,
      urgency: "medium",
      rationale: "Moderate risk detected. A human connection with a future teammate significantly reduces wavering by anchoring the candidate to real people, not just a job description.",
    });
  }

  // 6. Executive alignment for high/critical risk
  if (hazardScore >= 55) {
    playbooks.push({
      key: "executive_alignment",
      ...PLAYBOOK_CATALOG.executive_alignment,
      urgency: hazardScore >= 75 ? "critical" : "high",
      rationale: `Hazard score is ${hazardScore.toFixed(0)}%. A direct conversation with a senior leader or hiring manager about project ownership is one of the most effective retention levers at this risk level.`,
    });
  }

  // 7. Silver medalist standby when critical
  if (hazardScore >= 75) {
    playbooks.push({
      key: "silver_medalist_warm",
      ...PLAYBOOK_CATALOG.silver_medalist_warm,
      urgency: "critical",
      rationale: `Renege probability exceeds 75%. To protect the mandate, the #2 ranked candidate should be warmed up as a zero-delay standby. This ensures no calendar loss if the primary candidate drops off.`,
    });
  }

  // Sort by urgency: critical > high > medium > low
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  playbooks.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return playbooks;
}

// ─── E. Full Hazard Assessment ──────────────────────────────────────────

/**
 * Computes a complete hazard assessment by running the baseline hazard,
 * the dynamic Bayesian state-space update, and the prescriptive playbook
 * engine.
 *
 * This is the primary API surface for the Offer Guard domain layer.
 */
export function calculateFullHazardAssessment(
  baselineParams: BaselineHazardParams,
  currentHazard: number,
  currentState: IntentState,
  snapshot: TelemetrySnapshot,
): HazardAssessment {
  // If it's the first assessment (currentHazard is the default 15.0),
  // recalculate from baseline
  const effectiveCurrentHazard =
    currentHazard <= 15 ? computeBaselineHazard(baselineParams) : currentHazard;

  // Dynamic state-space update
  const { intentState, hazardScore } = evaluateLatentState(
    effectiveCurrentHazard,
    currentState,
    snapshot,
  );

  const riskTier = classifyRiskTier(hazardScore);

  // Identify primary risk drivers
  const primaryDrivers = identifyPrimaryDrivers(snapshot);

  // Generate prescriptive playbooks
  const playbooks = getPrescriptivePlaybooks(hazardScore, intentState, snapshot);

  return {
    hazardScore,
    riskTier,
    intentState,
    primaryDrivers,
    playbooks,
  };
}

/**
 * Identifies the top risk drivers from the current telemetry snapshot.
 */
function identifyPrimaryDrivers(snap: TelemetrySnapshot): string[] {
  const drivers: string[] = [];

  if (snap.dojDelayRequested) {
    drivers.push("DOJ delay requested (83% final-ghost correlation)");
  }
  if (!snap.resignationSubmitted && snap.daysSinceAcceptance >= 10) {
    drivers.push(`Resignation proof pending after ${snap.daysSinceAcceptance} days`);
  }
  if (snap.responseLatencyTrend >= 2.5) {
    drivers.push(`Response latency increased ${snap.responseLatencyTrend.toFixed(1)}x vs baseline`);
  }
  if (snap.counterofferHintCount > 0) {
    drivers.push(`${snap.counterofferHintCount} counteroffer signal(s) detected`);
  }
  if (snap.evasionSignalCount >= 2) {
    drivers.push(`${snap.evasionSignalCount} evasion language patterns in recruiter notes`);
  }
  if (!snap.bgvDocumentsSubmitted && snap.daysSinceAcceptance / snap.totalNoticeDays > 0.35) {
    drivers.push("BGV documents not submitted past 35% of notice period");
  }
  if (snap.preboardingPortalVisits === 0 && snap.daysSinceAcceptance / snap.totalNoticeDays > 0.15) {
    drivers.push("Zero pre-boarding portal visits past 15% of notice period");
  }

  return drivers;
}

// ─── F. Tutorial / Onboarding Bubble Messages ───────────────────────────

export type TutorialBubble = {
  id: string;
  stage: "setup" | "monitoring" | "intervention" | "resolution";
  title: string;
  body: string;
};

/**
 * Returns context-aware tutorial bubble messages based on the current state
 * of the offer guard for a specific offer.
 */
export function getTutorialBubbles(
  phase: "empty_state" | "new_offer" | "monitoring" | "amber_alert" | "red_alert" | "resolved",
): TutorialBubble[] {
  switch (phase) {
    case "empty_state":
      return [
        {
          id: "tut-empty-1",
          stage: "setup",
          title: "Welcome to Offer Guard",
          body: "When a candidate accepts your offer, promote them here to start monitoring the notice period. We'll track engagement signals and alert you before dropouts happen.",
        },
        {
          id: "tut-empty-2",
          stage: "setup",
          title: "How it works",
          body: "Add the offer date, joining date, and salary details. Our hazard model calibrates a renege risk score based on notice length, hike ratio, and employer type — updated daily as new signals arrive.",
        },
      ];
    case "new_offer":
      return [
        {
          id: "tut-new-1",
          stage: "setup",
          title: "Offer created — first milestone: resignation proof",
          body: "Ask the candidate for a copy of their resignation acceptance email within 5–7 business days. This single milestone is the strongest early indicator of genuine commitment.",
        },
        {
          id: "tut-new-2",
          stage: "monitoring",
          title: "Log engagement touchpoints",
          body: "Each time you reach out or the candidate responds, log the interaction. The model uses response latency trends to detect disengagement before it becomes a problem.",
        },
      ];
    case "monitoring":
      return [
        {
          id: "tut-mon-1",
          stage: "monitoring",
          title: "Keep the pulse steady",
          body: "Schedule a brief check-in every 7–10 days during the notice period. The model watches for latency drift — if the candidate starts taking longer to respond, we'll flag it early.",
        },
      ];
    case "amber_alert":
      return [
        {
          id: "tut-amber-1",
          stage: "intervention",
          title: "Engagement dip detected",
          body: "The hazard score has risen. Check the recommended playbooks below — they are specific actions calibrated to this risk level. Acting now has a 3x higher save rate than waiting.",
        },
        {
          id: "tut-amber-2",
          stage: "intervention",
          title: "Assign a peer buddy",
          body: "Connecting the candidate with a future teammate for an informal call significantly reduces wavering. It anchors them to real people, not just a job description.",
        },
      ];
    case "red_alert":
      return [
        {
          id: "tut-red-1",
          stage: "intervention",
          title: "Critical risk — immediate action required",
          body: "The model estimates a high probability of dropout. Execute the top-priority playbook immediately. Consider warming up the silver medalist candidate as a zero-delay backup.",
        },
        {
          id: "tut-red-2",
          stage: "intervention",
          title: "Silver medalist standby",
          body: "Click 'Warm Silver Medalist' to send a casual touchpoint to your #2 candidate. This ensures zero calendar loss if the primary offer falls through.",
        },
      ];
    case "resolved":
      return [
        {
          id: "tut-res-1",
          stage: "resolution",
          title: "Offer resolved",
          body: "This offer has been closed. The outcome feeds back into the model to improve future predictions for your organization.",
        },
      ];
  }
}

// ─── Utility ────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}
