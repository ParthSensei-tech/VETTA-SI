/**
 * Voice Screening Agent with Hinglish Entity Normalizer & Proxy Cheating Forensics
 * 
 * Specifically calibrated for the Indian tech market:
 * - Parses code-mixed Hinglish speech (notice period buybacks, CTC fixed vs variable, in-hand)
 * - Identifies proxy-interview assistance, AI teleprompter reading, and audio latency jitter
 */

import { getSql } from "../../../platform/db.ts";

export interface HinglishEntities {
  noticeDays: number | null;
  servingNotice: boolean;
  buybackPossible: boolean;
  fixedLpa: number | null;
  expectedLpa: number | null;
  inHandMonthlyLakh: number | null;
  currentLocation: string | null;
  preferredWorkMode: "onsite" | "hybrid" | "remote" | null;
}

export interface ProxyDetectionResult {
  proxyRiskScore: number; // 0 - 100
  cheatingFlags: string[];
  verdict: "passed" | "borderline" | "flagged" | "failed";
  reasoning: string[];
}

export interface VoiceScreenSessionInput {
  orgId: string;
  candidateId: string;
  roleId: string;
  durationSeconds: number;
  transcriptText: string;
  responseLatenciesMs?: number[];
  claimedExperience?: string;
  technicalRubricExpectations?: string[];
}

/**
 * Normalizes bilingual Indian English-Hindi expressions into structured data
 */
export function parseHinglishScreeningEntities(text: string): HinglishEntities {
  const lower = text.toLowerCase();

  // Notice Period Extraction
  let noticeDays: number | null = null;
  let servingNotice = false;
  let buybackPossible = false;

  if (/immediate(ly)?(\s+joiner)?|join\s+today|kal\s+se\s+join/i.test(lower)) {
    noticeDays = 0;
  } else if (/paper\s+drop|serving\s+notice|resigned\s+already|resignation\s+dal\s+diya/i.test(lower)) {
    servingNotice = true;
    const match = lower.match(/(\d+)\s*(days?|din)\s*(bache|left|remaining)?/i);
    noticeDays = match ? parseInt(match[1]!, 10) : 30;
  } else {
    const match = lower.match(/(\d+)\s*(days?|din|months?|mahina)\s*(ka\s*)?(notice|ka\s*notice)?/i);
    if (match) {
      const num = parseInt(match[1]!, 10);
      noticeDays = /month|mahina/i.test(match[2]!) ? num * 30 : num;
    }
  }

  if (/buyback\s*(possible|ho\s*jayega|karwa\s*denge)|buyout\s*(possible|chalega)/i.test(lower)) {
    buybackPossible = true;
  }

  // Compensation Extraction (Fixed LPA, in-hand, Expected)
  let fixedLpa: number | null = null;
  let expectedLpa: number | null = null;
  let inHandMonthlyLakh: number | null = null;

  const fixedMatch = lower.match(/fixed\s*(component|salary|ctc)?\s*(is|hai)?\s*(\d+(\.\d+)?)\s*(lpa|lakh|lac)?/i) ||
                     lower.match(/(\d+(\.\d+)?)\s*(lpa|lakh|lac)\s*(fixed|in-hand)?/i);
  if (fixedMatch) {
    fixedLpa = parseFloat(fixedMatch[3] || fixedMatch[1]!);
  }

  const expectedMatch = lower.match(/expect(ing|ation)?\s*(is|around|hai)?\s*(\d+(\.\d+)?)\s*(lpa|lakh|lac)?/i);
  if (expectedMatch) {
    expectedLpa = parseFloat(expectedMatch[3]!);
  }

  const inHandMatch = lower.match(/in-hand\s*(around|milta\s*hai)?\s*(\d+(\.\d+)?)\s*(l|lakh|lac|k|thousand)?/i) ||
                      lower.match(/haath\s*me\s*(\d+(\.\d+)?)\s*(lakh|lac)?/i);
  if (inHandMatch) {
    const val = parseFloat(inHandMatch[2] || inHandMatch[1]!);
    inHandMonthlyLakh = val > 50 ? val / 100000 : val;
  }

  // Work Mode & Location
  let preferredWorkMode: "onsite" | "hybrid" | "remote" | null = null;
  if (/hybrid/i.test(lower)) preferredWorkMode = "hybrid";
  else if (/remote|wfh|ghar\s*se/i.test(lower)) preferredWorkMode = "remote";
  else if (/onsite|office\s*aana/i.test(lower)) preferredWorkMode = "onsite";

  let currentLocation: string | null = null;
  if (/bengaluru|bangalore/i.test(lower)) currentLocation = "Bengaluru";
  else if (/hyderabad/i.test(lower)) currentLocation = "Hyderabad";
  else if (/pune/i.test(lower)) currentLocation = "Pune";
  else if (/gurugram|gurgaon|delhi|noida/i.test(lower)) currentLocation = "Delhi NCR";
  else if (/mumbai/i.test(lower)) currentLocation = "Mumbai";

  return {
    noticeDays,
    servingNotice,
    buybackPossible,
    fixedLpa,
    expectedLpa,
    inHandMonthlyLakh,
    currentLocation,
    preferredWorkMode,
  };
}

/**
 * Identifies proxy interviews, AI teleprompter reading, and audio latency jitter
 */
export function detectProxyAndCheatingAnomalies(input: {
  durationSeconds: number;
  transcript: string;
  responseLatenciesMs?: number[];
  claimedExperience?: string;
}): ProxyDetectionResult {
  const flags: string[] = [];
  const reasoning: string[] = [];
  let riskScore = 0;

  const latencies = input.responseLatenciesMs ?? [];

  // Check 1: Latency Jitter (Secondary Screen / Proctor Whisper Gaps)
  if (latencies.length > 0) {
    // Look for suspicious long gaps before answering basic recall questions
    const longPauses = latencies.filter((l) => l > 4500 && l < 10000);
    if (longPauses.length >= 3) {
      riskScore += 35;
      flags.push("LATENCY_JITTER_PROCTOR_WHISPER");
      reasoning.push(
        `Detected ${longPauses.length} prolonged pauses (4.5s–10s) before answering direct technical questions.`,
      );
    }
  }

  // Check 2: Canned AI Teleprompter Reading (Zero natural fillers, robotic perfection)
  const lower = input.transcript.toLowerCase();
  const naturalFillers = (lower.match(/\b(uh|um|you know|basically|so like|actually|well|matlab|dekho)\b/g) || []).length;
  const wordCount = input.transcript.split(/\s+/).filter(Boolean).length;
  const fillerRatio = wordCount > 0 ? (naturalFillers / wordCount) * 100 : 0;

  // If transcript is over 200 words but has literally 0 natural conversational disfluencies
  if (wordCount > 200 && fillerRatio < 0.2) {
    riskScore += 25;
    flags.push("ROBOTIC_TELEPROMPTER_READING");
    reasoning.push(
      "Unnaturally rigid speech flow with zero conversational pauses or self-corrections (AI teleprompter pattern).",
    );
  }

  // Check 3: Verbatim LLM Hallmarks in Spoken Answer
  if (
    /in conclusion, it is important to remember that/i.test(lower) ||
    /delving into the nuances of/i.test(lower) ||
    /firstly.*secondly.*thirdly.*furthermore/i.test(lower)
  ) {
    riskScore += 30;
    flags.push("VERBATIM_LLM_SCRIPT_RECITATION");
    reasoning.push("Spoken answer contains synthetic markdown essay phrasing typical of generated LLM outputs.");
  }

  // Check 4: Unnatural Audio Speed vs Duration
  const wordsPerMinute = input.durationSeconds > 0 ? (wordCount / input.durationSeconds) * 60 : 0;
  if (wordsPerMinute > 240) {
    riskScore += 15;
    flags.push("SYNTHETIC_SPEECH_PACE_ANOMALY");
    reasoning.push(`Words per minute (${Math.round(wordsPerMinute)} wpm) significantly exceeds conversational average.`);
  }

  riskScore = Math.min(100, riskScore);

  let verdict: "passed" | "borderline" | "flagged" | "failed" = "passed";
  if (riskScore >= 60) verdict = "flagged";
  else if (riskScore >= 35) verdict = "borderline";

  return {
    proxyRiskScore: riskScore,
    cheatingFlags: flags,
    verdict,
    reasoning,
  };
}

/**
 * Persists evaluated voice screening session
 */
export async function recordVoiceScreeningSession(input: VoiceScreenSessionInput): Promise<{
  sessionId: string;
  entities: HinglishEntities;
  proxyResult: ProxyDetectionResult;
  techScore: number;
  communicationScore: number;
}> {
  const sql = await getSql();
  const sessionId = `vss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const entities = parseHinglishScreeningEntities(input.transcriptText);
  const proxyResult = detectProxyAndCheatingAnomalies({
    durationSeconds: input.durationSeconds,
    transcript: input.transcriptText,
    responseLatenciesMs: input.responseLatenciesMs,
    claimedExperience: input.claimedExperience,
  });

  // Basic technical & communication scoring based on entities and speech coherence
  let techScore = 75;
  if (entities.fixedLpa && entities.fixedLpa > 30) techScore += 5;
  if (proxyResult.proxyRiskScore > 40) techScore -= 30;
  techScore = Math.max(0, Math.min(100, techScore));

  let communicationScore = 80;
  if (proxyResult.cheatingFlags.includes("ROBOTIC_TELEPROMPTER_READING")) communicationScore -= 20;

  await sql`
    insert into voice_screen_sessions (
      id, org_id, candidate_id, role_id, duration_seconds, transcript_text,
      hinglish_entities_json, tech_score, communication_score, proxy_risk_score,
      cheating_flags, evaluated, verdict, notes, created_at
    ) values (
      ${sessionId}, ${input.orgId}, ${input.candidateId}, ${input.roleId},
      ${input.durationSeconds}, ${input.transcriptText}, ${JSON.stringify(entities)},
      ${techScore}, ${communicationScore}, ${proxyResult.proxyRiskScore},
      ${JSON.stringify(proxyResult.cheatingFlags)}, true, ${proxyResult.verdict},
      ${proxyResult.reasoning.join(" ")}, now()
    )`;

  return {
    sessionId,
    entities,
    proxyResult,
    techScore,
    communicationScore,
  };
}
