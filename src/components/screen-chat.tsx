import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_HINT, KNOWLEDGE_LABEL } from "@/lib/recruiting/constants";
import { grantScreenVoiceConsent, postScreenTurn, postScreenVoice } from "@/lib/recruiting/screen-session";
import { errorMessage, queryKeys } from "@/lib/recruiting/query";
import type { KnowledgeKind, PortalApplication, ScreenTurn } from "@/lib/recruiting/types";
import { cn } from "@/lib/utils";

export function ScreenChat({
  data,
  token,
}: {
  data: PortalApplication;
  token?: string;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const questions = data.questions ?? [];
  const done = data.stage === "complete" || data.answersSubmitted;
  const [showVoiceConsent, setShowVoiceConsent] = useState(false);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data.transcript.length]);

  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const grantVoiceMut = useMutation({
    mutationFn: () =>
      grantScreenVoiceConsent({
        data: token ? { token } : { applicationId: data.id },
      }),
    onSuccess: () => {
      setShowVoiceConsent(false);
      toast.success("Voice prescreen enabled. You can now record spoken answers.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const voiceMut = useMutation({
    mutationFn: (pcmBase64: string) =>
      postScreenVoice({
        data: token ? { token, pcmBase64 } : { applicationId: data.id, pcmBase64 },
      }),
    onSuccess: (next) => {
      void qc.setQueryData(queryKeys.portalApplication(data.id), next);
      if (token) void qc.setQueryData(queryKeys.screenToken(token), next);
      if (next.stage === "complete") toast.success("Screen submitted. A human still owns the next step.");
    },
    onError: (e) => {
      const msg = errorMessage(e);
      if (msg.toLowerCase().includes("voice")) {
        setShowVoiceConsent(true);
      }
      toast.error(msg);
    },
  });

  async function toggleRecord() {
    if (recording && recRef.current) {
      recRef.current.stop();
      setRecording(false);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void blobToPcm16(new Blob(chunksRef.current)).then(
        (pcm) => voiceMut.mutate(pcm),
        (e) => toast.error(errorMessage(e)),
      );
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  const mut = useMutation({
    mutationFn: () =>
      postScreenTurn({
        data: token
          ? { token, text: draft.trim(), channel: "text" as const }
          : { applicationId: data.id, text: draft.trim(), channel: "text" as const },
      }),
    onSuccess: (next) => {
      setDraft("");
      void qc.setQueryData(queryKeys.portalApplication(data.id), next);
      if (token) void qc.setQueryData(queryKeys.screenToken(token), next);
      if (next.stage === "complete") toast.success("Screen submitted. A human still owns the next step.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const lastAgent = [...data.transcript].reverse().find((t) => t.role === "agent");
  const kind = (lastAgent?.kind === "system" ? "practical" : lastAgent?.kind) as KnowledgeKind | undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.16em] text-muted uppercase">Written conversation</p>
          <h2 className="font-display text-2xl tracking-tight">Screen with Vetta</h2>
        </div>
        <p className="font-mono text-xs tabular-nums text-subtle">
          {Math.min(data.progress.asked, data.progress.total)}/{data.progress.total || questions.length} · ~
          {data.progress.minutes || 50}m
        </p>
      </div>

      <ol className="flex gap-1.5" aria-label="Progress">
        {questions.map((q) => {
          const answered = data.transcript.some((t) => t.role === "candidate" && t.question_id === q.id && !t.is_followup);
          const current = lastAgent?.question_id === q.id && !done;
          return (
            <li
              key={q.id}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                answered ? "bg-success" : current ? "bg-accent" : "bg-elevated",
              )}
            />
          );
        })}
      </ol>

      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
        {data.transcript.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted">Vetta is preparing the first question…</p>
        ) : (
          data.transcript.map((turn) => <Bubble key={turn.id} turn={turn} />)
        )}
        <div ref={bottom} />
      </div>

      {done ? (
        <div className="rounded-2xl bg-elevated p-5">
          <p className="font-display text-xl">That’s in. A human still reads this.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your answers are with the desk. Nothing is sent to a hiring manager without their stamp.
          </p>
        </div>
      ) : (
        <form
          className="sticky bottom-3 z-10 rounded-2xl bg-elevated p-3 shadow-[var(--shadow-lift)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim().length < 8) {
              toast.error("Give a little more — a sentence or two at least.");
              return;
            }
            mut.mutate();
          }}
        >
          {showVoiceConsent ? (
            <div className="mb-3 rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs leading-relaxed text-fg">
              <p className="font-semibold text-accent">Voice prescreen consent required</p>
              <p className="mt-1 text-muted">
                Voice prescreen records your audio responses and transcribes them via speech models solely for this interview. You may withdraw this consent at any time.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={grantVoiceMut.isPending}
                  onClick={() => grantVoiceMut.mutate()}
                >
                  {grantVoiceMut.isPending ? "Enabling…" : "Agree & Enable Voice"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowVoiceConsent(false)}
                >
                  Keep Written Only
                </Button>
              </div>
            </div>
          ) : null}
          {kind ? (
            <p className="mb-2 px-1 text-[11px] tracking-wide text-subtle uppercase">
              {KNOWLEDGE_LABEL[kind]} · {KNOWLEDGE_HINT[kind]}
            </p>
          ) : null}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply like you would to a colleague…"
            className="min-h-28 bg-surface"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (draft.trim().length >= 8) mut.mutate();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-subtle">Type, or hold a voice note in English, Hindi, or Hinglish. Nothing here is billed.</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={voiceMut.isPending} onClick={() => void toggleRecord()}>
                {recording ? "Stop" : voiceMut.isPending ? "Hearing…" : "Voice"}
              </Button>
              <Button type="submit" disabled={mut.isPending || draft.trim().length < 8} className="min-w-28">
                {mut.isPending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

async function blobToPcm16(blob: Blob): Promise<string> {
  const ctx = new AudioContext();
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const src = audio.getChannelData(0);
  const rate = 16000;
  const length = Math.floor(src.length * (rate / audio.sampleRate));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const s = src[Math.floor(i * (audio.sampleRate / rate))] ?? 0;
    const c = Math.max(-1, Math.min(1, s));
    out[i] = c < 0 ? c * 0x8000 : c * 0x7fff;
  }
  await ctx.close();
  const bytes = new Uint8Array(out.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function Bubble({ turn }: { turn: ScreenTurn }) {
  const mine = turn.role === "candidate";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap sm:max-w-[80%]",
          mine ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-elevated text-fg",
        )}
      >
        {!mine && turn.kind !== "system" ? (
          <p className="mb-1 text-[10px] tracking-[0.14em] text-subtle uppercase">
            {turn.is_followup ? "Follow-up" : KNOWLEDGE_LABEL[turn.kind]}
          </p>
        ) : null}
        {turn.channel === "voice" ? "Voice · " : turn.channel === "whatsapp" ? "WhatsApp · " : ""}
        {turn.text}
      </div>
    </div>
  );
}
