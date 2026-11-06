import type { KnowledgeKind, ScreenFollowUp, ScreenQuestion, ScreenTurn } from "./types.ts";
import { parseJson } from "../../shared/utils.ts";

const KINDS: KnowledgeKind[] = ["practical", "basic", "common"];

export function normalizeKind(raw: unknown, fallback: KnowledgeKind = "practical"): KnowledgeKind {
  return KINDS.includes(raw as KnowledgeKind) ? (raw as KnowledgeKind) : fallback;
}

export function normalizeQuestion(
  raw: Partial<ScreenQuestion> | ScreenQuestion,
  index: number,
): ScreenQuestion {
  const kindCycle: KnowledgeKind[] = [
    "practical",
    "basic",
    "common",
    "practical",
    "basic",
    "common",
  ];
  const followUps = Array.isArray(raw.follow_ups)
    ? raw.follow_ups
        .slice(0, 2)
        .map((f, i) => ({
          id: String(f.id || `${raw.id || `q${index + 1}`}-f${i + 1}`),
          prompt: String(f.prompt || "").trim(),
          intent: String(f.intent || "Follow-up").trim(),
        }))
        .filter((f) => f.prompt)
    : [];
  return {
    id: String(raw.id || `q${index + 1}`),
    prompt: String(raw.prompt || "").trim(),
    intent: String(raw.intent || "").trim(),
    time_minutes: Math.max(4, Math.min(25, Number(raw.time_minutes) || 10)),
    kind: normalizeKind(raw.kind, kindCycle[index] ?? "practical"),
    follow_ups: followUps,
  };
}

export function normalizeQuestions(raw: unknown): ScreenQuestion[] {
  const list = Array.isArray(raw)
    ? raw
    : parseJson<ScreenQuestion[]>(typeof raw === "string" ? raw : "[]", []);
  return list.map((q, i) => normalizeQuestion(q, i)).filter((q) => q.prompt);
}

export function normalizeTranscript(raw: unknown): ScreenTurn[] {
  const list = Array.isArray(raw)
    ? raw
    : parseJson<ScreenTurn[]>(typeof raw === "string" ? raw : "[]", []);
  return list.map((t, i) => ({
    id: String(t.id || `t${i + 1}`),
    question_id: String(t.question_id || ""),
    role: t.role === "candidate" ? "candidate" : "agent",
    text: String(t.text || ""),
    is_followup: Boolean(t.is_followup),
    kind: t.kind === "system" ? "system" : normalizeKind(t.kind, "practical"),
    created_at: String(t.created_at || new Date().toISOString()),
    channel:
      t.channel === "voice" || t.channel === "whatsapp" || t.channel === "text"
        ? t.channel
        : undefined,
    lang: t.lang ? String(t.lang) : null,
  }));
}

export function answersFromTranscript(
  transcript: ScreenTurn[],
): { question_id: string; answer: string }[] {
  const map = new Map<string, string[]>();
  for (const turn of transcript) {
    if (turn.role !== "candidate" || !turn.question_id) continue;
    const prev = map.get(turn.question_id) ?? [];
    prev.push(turn.text);
    map.set(turn.question_id, prev);
  }
  return [...map.entries()].map(([question_id, parts]) => ({
    question_id,
    answer: parts.join("\n\n"),
  }));
}

export function nextStemIndex(questions: ScreenQuestion[], transcript: ScreenTurn[]): number {
  const answeredStems = new Set(
    transcript.filter((t) => t.role === "candidate" && !t.is_followup).map((t) => t.question_id),
  );
  return questions.findIndex((q) => !answeredStems.has(q.id));
}

export function lastAgentTurn(transcript: ScreenTurn[]): ScreenTurn | null {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    if (transcript[i]?.role === "agent") return transcript[i]!;
  }
  return null;
}

export function shouldFollowUp(answer: string, alreadyFollowed: boolean): boolean {
  if (alreadyFollowed) return false;
  const t = answer.trim();
  if (t.length < 140) return true;
  const concrete =
    /\d|because|trade-?off|for example|e\.g\.|we |I |postgres|queue|latency|schema|on-call|prod/i.test(
      t,
    );
  return !concrete;
}

export function newTurn(
  partial: Omit<ScreenTurn, "id" | "created_at"> & { id?: string },
): ScreenTurn {
  return {
    id: partial.id || crypto.randomUUID(),
    question_id: partial.question_id,
    role: partial.role,
    text: partial.text,
    is_followup: partial.is_followup,
    kind: partial.kind,
    created_at: new Date().toISOString(),
    channel: partial.channel,
    lang: partial.lang ?? null,
  };
}

export function openingMessage(candidateName: string, minutes: number): string {
  const first = candidateName.split(" ")[0] || "there";
  return `Hi ${first} — I’m Vetta, the screening partner for this role. This is a written conversation, not a live call and not a timed test. I’ll ask a few questions across how you actually work, the basics of the stack, and judgement. Sometimes I’ll follow up once. Budget about ${minutes} minutes. Ready? First one:`;
}

export function closingMessage(): string {
  return "That’s everything from me. I’m sending this to the desk for a human read — a recruiter still owns the next step. You’ll hear if there’s a conversation with the hiring team.";
}

export type FollowUpDecision = {
  kind: "followup" | "next" | "done";
  question: ScreenQuestion | null;
  followUp: ScreenFollowUp | null;
};

export function decideNext(
  questions: ScreenQuestion[],
  transcript: ScreenTurn[],
): FollowUpDecision {
  const lastCandidate = [...transcript].reverse().find((t) => t.role === "candidate");
  if (lastCandidate) {
    const q = questions.find((item) => item.id === lastCandidate.question_id);
    const alreadyFollowed = transcript.some(
      (t) => t.role === "agent" && t.is_followup && t.question_id === lastCandidate.question_id,
    );
    if (
      q &&
      !lastCandidate.is_followup &&
      shouldFollowUp(lastCandidate.text, alreadyFollowed) &&
      q.follow_ups[0]
    ) {
      return { kind: "followup", question: q, followUp: q.follow_ups[0] };
    }
  }
  const idx = nextStemIndex(questions, transcript);
  if (idx < 0) return { kind: "done", question: null, followUp: null };
  return { kind: "next", question: questions[idx]!, followUp: null };
}
