import { z } from "zod";
import type {
  ClientCard,
  KnowledgeKind,
  ParsedProfile,
  RankEvidence,
  RankResult,
  ScreenEvaluation,
  ScreenQuestion,
  StackMatch,
} from "../../recruiting/domain/types";

export const ParsedProfileSchema = z.object({
  full_name: z.string().trim().default("Unnamed candidate"),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  location: z.string().trim().default(""),
  linkedin_url: z.string().trim().default(""),
  current_title: z.string().trim().default(""),
  current_company: z.string().trim().default(""),
  years_experience: z.number().nullable().catch(null).default(null),
  skills: z
    .array(z.string().trim())
    .default([])
    .transform((arr) => arr.filter(Boolean).slice(0, 30)),
  summary: z.string().trim().default(""),
});

export const RankEvidenceItemSchema = z.object({
  claim: z.string().trim().min(1),
  quote: z.string().trim().default(""),
});

export const IndiaContextSchema = z.object({
  location_fit: z.enum(["local", "relocation", "remote_india", "unknown"]).default("unknown"),
  notice_period_days: z.number().int().nullable().catch(null).default(null),
  current_ctc_lakh: z.number().nullable().catch(null).default(null),
  expected_ctc_lakh: z.number().nullable().catch(null).default(null),
  early_stage_fit: z.enum(["high", "medium", "low", "unknown"]).default("unknown"),
  notes: z.string().trim().default(""),
});

export const RequirementEvaluationSchema = z.object({
  requirement: z.string().trim(),
  category: z.enum(["must_have", "nice_to_have", "hard_constraint", "skill"]).default("must_have"),
  status: z.enum(["satisfied", "failed", "missing_info"]).default("missing_info"),
  evidenceQuote: z.string().trim().nullable().optional(),
  explanation: z.string().trim().default(""),
});

export const StackMatchItemSchema = z.object({
  skill: z.string().trim(),
  level: z.enum(["strong", "partial", "missing"]).default("partial"),
  status: z.enum(["satisfied", "failed", "missing_info"]).optional(),
  note: z.string().trim().optional(),
});

export const MatchDimensionSchema = z.object({
  id: z.string(),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0),
  note: z.string().default(""),
});

export const MatchBreakdownSchema = z
  .object({
    dimensions: z.array(MatchDimensionSchema).default([]),
    hardGates: z.array(z.string()).default([]),
    roleFamily: z.string().default(""),
    resumeFamily: z.string().default(""),
    familyAligned: z.boolean().default(true),
  })
  .optional();

export const RankResultSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
  level: z.enum(["strong_yes", "yes", "maybe", "no"]),
  summary: z.string().trim().min(1),
  evidence: z.array(RankEvidenceItemSchema).default([]),
  gaps: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  india: IndiaContextSchema.default({
    location_fit: "unknown",
    notice_period_days: null,
    current_ctc_lakh: null,
    expected_ctc_lakh: null,
    early_stage_fit: "unknown",
    notes: "",
  }),
  stack_match: z.array(StackMatchItemSchema).default([]),
  requirements: z.array(RequirementEvaluationSchema).default([]),
  screen_focus: z.array(z.string()).default([]),
  match: MatchBreakdownSchema,
});

export const RankResponseSchema = z.object({
  profile: ParsedProfileSchema,
  rank: RankResultSchema,
});

export type ValidatedRankResponse = z.infer<typeof RankResponseSchema>;

export const ScreenFollowUpSchema = z.object({
  id: z.string().trim().default("f1"),
  prompt: z.string().trim().min(1),
  intent: z.string().trim().default(""),
});

export const ScreenQuestionSchema = z.object({
  id: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  intent: z.string().trim().default(""),
  time_minutes: z.number().min(1).max(120).default(10),
  kind: z.enum(["practical", "basic", "common"] as const),
  follow_ups: z.array(ScreenFollowUpSchema).default([]),
});

export const ScreenQuestionsResponseSchema = z.object({
  questions: z.array(ScreenQuestionSchema).min(3).max(8),
});

export const ScreenFollowUpResponseSchema = z.object({
  prompt: z.string().trim().min(8),
});

export const ScreenEvaluationResponseSchema = z.object({
  score: z.number().min(0).max(100).nullable().catch(null).default(null),
  verdict: z.string().trim().min(1).default("Needs review"),
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  notes: z.string().trim().default(""),
});

export const ClientCardResponseSchema = z.object({
  candidate_name: z.string().trim().min(1),
  headline: z.string().trim().min(1),
  fit_label: z.string().trim().default("Worth a conversation"),
  summary: z.string().trim().min(10),
  highlights: z.array(z.string()).default([]),
  watchouts: z.array(z.string()).default([]),
  interview_probes: z.array(z.string()).default([]),
  location: z.string().trim().default(""),
  availability: z.string().trim().default("To be confirmed"),
  screen: z
    .object({
      verdict: z.string().default(""),
      notes: z.string().default(""),
    })
    .optional(),
});

/**
 * Extracts and strictly validates JSON from raw model text.
 */
export function extractAndValidateJson<T>(
  schema: z.ZodType<T>,
  rawText: string,
): { ok: true; data: T } | { ok: false; error: string; rawJson?: unknown } {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const target = fenced?.[1]?.trim() ?? trimmed;
  const start = target.indexOf("{");
  const end = target.lastIndexOf("}");
  const jsonStr = start >= 0 && end > start ? target.slice(start, end + 1) : target;

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonStr);
  } catch (parseErr) {
    return {
      ok: false,
      error: `JSON parse failed: ${parseErr instanceof Error ? parseErr.message : "invalid JSON"}`,
    };
  }

  const result = schema.safeParse(rawJson);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((e) => `${e.path.map(String).join(".") || "root"}: ${e.message}`)
      .join("; ");
    return {
      ok: false,
      error: `Schema validation failed: ${errorDetails}`,
      rawJson,
    };
  }

  return { ok: true, data: result.data };
}
