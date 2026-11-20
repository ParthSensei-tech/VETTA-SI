/**
 * CTC & Notice Period Objection Playbook (India-Specific)
 * 
 * Mathematical and psychological scripts for handling candidate compensation pushbacks:
 * - Fixed vs. Variable pay breakdowns
 * - Notice period buyouts & joining bonus trade-offs
 * - Hybrid commute & Bengaluru/Gurugram relocation realities
 */

export interface CompensationComparison {
  currentFixedLpa: number;
  currentVariableLpa: number;
  offeredFixedLpa: number;
  offeredVariableLpa: number;
  offeredEsopLpa?: number;
}

export interface ObjectionScriptResult {
  category: "ctc_fixed_vs_variable" | "notice_period_buyout" | "esop_valuation" | "hybrid_commute";
  headline: string;
  mathExplanation: string;
  recommendedCounselingScript: string;
}

/**
 * Mathematically compares an offer against incumbent CTC, proving the fixed hike reality
 */
export function handleCtcFixedObjection(comp: CompensationComparison): ObjectionScriptResult {
  const currentTotal = comp.currentFixedLpa + comp.currentVariableLpa;
  const offeredTotal = comp.offeredFixedLpa + comp.offeredVariableLpa;

  const totalHikePct = Math.round(((offeredTotal - currentTotal) / (currentTotal || 1)) * 100);
  const fixedHikePct = Math.round(((comp.offeredFixedLpa - comp.currentFixedLpa) / (comp.currentFixedLpa || 1)) * 100);

  // Estimate in-hand monthly (rough approximation factoring 20-30% effective Indian tax + EPF)
  const currentMonthlyInHand = Math.round((comp.currentFixedLpa * 100000 * 0.72) / 12);
  const offeredMonthlyInHand = Math.round((comp.offeredFixedLpa * 100000 * 0.70) / 12);
  const monthlyInHandGain = offeredMonthlyInHand - currentMonthlyInHand;

  const headline = `True Guaranteed Fixed Hike: +${fixedHikePct}% (₹${(comp.offeredFixedLpa - comp.currentFixedLpa).toFixed(1)}L guaranteed increase)`;
  const mathExplanation = `While your incumbent total package had ₹${comp.currentVariableLpa}L locked in performance variables, this offer guarantees ₹${comp.offeredFixedLpa}L as pure fixed pay. Your monthly bank credit increases by ~₹${(monthlyInHandGain / 1000).toFixed(0)}k every month.`;

  const recommendedCounselingScript = [
    `"Look at the guaranteed component rather than inflated paper numbers. At your current firm, ${comp.currentVariableLpa ? `₹${comp.currentVariableLpa}L is at the mercy of company performance multipliers` : "your base is lagging"}.`,
    `Here, you get ₹${comp.offeredFixedLpa}L fixed every single month in your account, plus direct equity upside. That's a true ${fixedHikePct}% raise in actual living power."`,
  ].join(" ");

  return {
    category: "ctc_fixed_vs_variable",
    headline,
    mathExplanation,
    recommendedCounselingScript,
  };
}

/**
 * Resolves 60-90 day Indian notice period friction with buyout mechanics
 */
export function handleNoticePeriodObjection(params: {
  candidateNoticeDays: number;
  clientMaxAllowedDays?: number;
  currentFixedLpa: number;
}): ObjectionScriptResult {
  const noticeDays = params.candidateNoticeDays;
  const maxAllowed = params.clientMaxAllowedDays ?? 45;
  const needsBuyout = noticeDays > maxAllowed;

  // Buyout cost estimate (gross monthly pro-rated)
  const dailyRate = (params.currentFixedLpa * 100000) / 365;
  const excessDays = Math.max(0, noticeDays - maxAllowed);
  const buyoutCostLakh = Math.round((dailyRate * excessDays) / 100000 * 10) / 10;

  let headline = `Notice Period Strategy: ${noticeDays} Days`;
  let mathExplanation = "";
  let recommendedCounselingScript = "";

  if (needsBuyout) {
    headline = `Notice Period Buyout Strategy (${excessDays} Days Early Release)`;
    mathExplanation = `Buyout estimate for ${excessDays} days is ~₹${buyoutCostLakh}L. We can negotiate this as a transition joining bonus upon Day 1 relieving letter submission.`;
    recommendedCounselingScript = `"Don't let a 90-day notice period stall your career. Most employers agree to release you early if you complete handover within 30-45 days. If they deduct notice pay, the client is prepared to offset up to ₹${buyoutCostLakh}L as an upfront joining bonus."`;
  } else {
    headline = `Notice Period within Healthy Range (${noticeDays} Days)`;
    mathExplanation = `Candidate can onboard directly within the client's ${maxAllowed}-day window.`;
    recommendedCounselingScript = `"Your ${noticeDays}-day timeline works directly with the founders' roadmap. Let's get your resignation stamped this week to lock in your Day-1 date."`;
  }

  return {
    category: "notice_period_buyout",
    headline,
    mathExplanation,
    recommendedCounselingScript,
  };
}
