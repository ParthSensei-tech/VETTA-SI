import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Flame,
  Lock,
  PhoneCall,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  recordFeedbackSignal,
  type FeedbackReasonCode,
} from "@/features/recruiting/api/feedback-signal-api";

export const Route = createFileRoute("/app/triage")({
  component: DailyTriagePage,
});

type TriageCandidate = {
  id: string;
  alias: string;
  roleTitle: string;
  matchScore: number;
  currentCompany: string;
  experienceYears: number;
  fixedCtcLpa: number;
  expectedCtcLpa: number;
  noticeDays: number;
  servingNotice: boolean;
  audioDurationSeconds: number;
  audioSnippetText: string;
  technicalHighlights: string[];
  antiCheatVerdict: string;
};

const SAMPLE_CANDIDATES: TriageCandidate[] = [
  {
    id: "cand_1",
    alias: "Candidate A-101",
    roleTitle: "Lead Backend Go Engineer",
    matchScore: 94,
    currentCompany: "Tier-1 Payments Unicorn",
    experienceYears: 5.2,
    fixedCtcLpa: 28,
    expectedCtcLpa: 34,
    noticeDays: 30,
    servingNotice: true,
    audioDurationSeconds: 45,
    audioSnippetText:
      "Explained Raft consensus in Go, channel synchronization, and deadlock prevention in production microservices.",
    technicalHighlights: [
      "Top 5% GitHub Go commit velocity (48 PRs in 2026)",
      "Production Kafka pipelines handling 120k req/sec",
      "EPFO employment history clean; 0% proxy jitter",
    ],
    antiCheatVerdict: "100% CLEAN (Zero teleprompter latency, 0% proxy whisper)",
  },
  {
    id: "cand_2",
    alias: "Candidate A-102",
    roleTitle: "Lead Backend Go Engineer",
    matchScore: 91,
    currentCompany: "High-Growth B2B SaaS",
    experienceYears: 4.8,
    fixedCtcLpa: 24,
    expectedCtcLpa: 30,
    noticeDays: 45,
    servingNotice: false,
    audioDurationSeconds: 40,
    audioSnippetText:
      "Deep dive into Postgres query indexing, connection pooling, and gRPC service mesh architectures.",
    technicalHighlights: [
      "Built multi-tenant tenant isolation for 2M daily queries",
      "Hands-on Kubernetes cluster autoscaling",
      "Notice buyout negotiable to 20 days",
    ],
    antiCheatVerdict: "100% CLEAN (Natural speech cadence)",
  },
];

// Stubbed org/role for demo — in production these come from auth context
const DEMO_ORG_ID = "demo_org";
const DEMO_ROLE_ID = "role_lead_backend_go";
const SESSION_ID = `triage_${Date.now()}`;

function DailyTriagePage() {
  const [candidates, setCandidates] = useState<TriageCandidate[]>(SAMPLE_CANDIDATES);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const cardOpenedAt = useRef<number>(Date.now());

  const current = candidates[currentIndex];
  const allCompleted = currentIndex >= candidates.length;

  /** Records the decision signal silently — the data flywheel core. */
  async function captureSignal(
    candidate: TriageCandidate,
    action: "pass" | "unlock",
    reasonCode: FeedbackReasonCode,
  ) {
    const latencyMs = Date.now() - cardOpenedAt.current;
    // Fire-and-forget: never block the UI on this. If it fails, it's not critical UX.
    recordFeedbackSignal({
      data: {
        orgId: DEMO_ORG_ID,
        candidateId: candidate.id,
        roleId: DEMO_ROLE_ID,
        sessionId: SESSION_ID,
        action,
        reasonCode,
        reasonNote: "",
        matchScoreAtDecision: candidate.matchScore,
        decisionLatencyMs: latencyMs,
        audioPlayed: isPlayingAudio,
        hinglishFlags: candidate.technicalHighlights,
      },
    }).catch(() => {
      // Silently swallow — telemetry should never break the UI
    });
    // Reset card timer for the next candidate
    cardOpenedAt.current = Date.now();
  }

  function handlePass(reason: string, reasonCode: FeedbackReasonCode = "other") {
    if (current) void captureSignal(current, "pass", reasonCode);
    toast.success(`Passed candidate · Reason: "${reason}". AI Taste Centroid updated (-0.6).`);
    setCurrentIndex((prev) => prev + 1);
    setIsPlayingAudio(false);
  }

  function handleUnlock(candidate: TriageCandidate) {
    void captureSignal(candidate, "unlock", "strong_hire");
    setUnlockedIds((prev) => new Set([...prev, candidate.id]));
    toast.success("Dossier Unlocked! Full phone, email, and interview scheduler revealed (₹2,499).");
    setCurrentIndex((prev) => prev + 1);
    setIsPlayingAudio(false);
  }

  function handleReset() {
    setCurrentIndex(0);
    setUnlockedIds(new Set());
    cardOpenedAt.current = Date.now();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">☕</span>
            <h1 className="font-display text-xl font-bold tracking-tight">
              60-Second "Inbox Zero" Triage
            </h1>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            42 resumes parsed overnight · 2 top finalists ready for review
          </p>
        </div>

        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
          <Flame className="mr-1 h-3.5 w-3.5 fill-emerald-500" />
          Morning Pulse
        </Badge>
      </div>

      {!allCompleted && current ? (
        /* The Active Triage Card */
        <div className="mt-6 flex flex-col gap-5">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-xl">
            {/* Card Top Meta */}
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-500">
                  Top Finalist #{currentIndex + 1} of {candidates.length}
                </span>
                <h2 className="mt-1 font-display text-2xl font-bold text-fg">
                  {current.alias}
                </h2>
                <p className="text-xs text-muted">
                  {current.currentCompany} · {current.experienceYears} Years Exp
                </p>
              </div>

              <div className="text-right">
                <div className="font-display text-3xl font-black text-emerald-500">
                  {current.matchScore}%
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Match Score
                </span>
              </div>
            </div>

            {/* Compensation & Notice Period Chips */}
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg bg-surface px-2.5 py-1 font-medium text-fg">
                Fixed CTC: ₹{current.fixedCtcLpa}L → Expected: ₹{current.expectedCtcLpa}L
              </span>
              <span className="rounded-lg bg-surface px-2.5 py-1 font-medium text-fg">
                Notice: {current.noticeDays} Days {current.servingNotice ? "(Serving)" : "(On Offer)"}
              </span>
            </div>

            {/* 30-Second Audio Highlight Player */}
            <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
                  <Volume2 className="h-4 w-4" />
                  Hinglish Technical Voice Screen ({current.audioDurationSeconds}s Highlight)
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsPlayingAudio(!isPlayingAudio);
                    if (!isPlayingAudio) toast.info("Simulating audio playback of technical architecture highlight...");
                  }}
                  className="h-8 border-emerald-500/30 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/10"
                >
                  <Play className="mr-1 h-3.5 w-3.5 fill-current" />
                  {isPlayingAudio ? "Pause Audio" : "Play Snippet"}
                </Button>
              </div>

              <p className="mt-2 text-xs italic text-muted leading-relaxed">
                "{current.audioSnippetText}"
              </p>

              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>{current.antiCheatVerdict}</span>
              </div>
            </div>

            {/* Technical Highlights */}
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Verified Code Evidence:
              </p>
              <ul className="mt-2 flex flex-col gap-1.5 text-xs text-fg">
                {current.technicalHighlights.map((hl, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span>{hl}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Locked Contact Warning */}
            <div className="mt-5 flex items-center justify-between rounded-lg bg-surface/60 px-3 py-2 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                <span>Direct Contact Details & Full Audio: Locked</span>
              </span>
              <span className="text-[11px] text-emerald-500 font-semibold">
                100% Interview-Show Guarantee
              </span>
            </div>
          </div>

          {/* Sticky Bottom Thumb Zone Actions */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => handlePass("Notice period too long", "notice_too_long")}
              className="h-12 border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
            >
              <X className="mr-1.5 h-4 w-4" />
              Pass Candidate
            </Button>

            <Button
              type="button"
              onClick={() => handleUnlock(current)}
              className="col-span-1 h-12 bg-emerald-500 font-bold text-slate-950 hover:bg-emerald-400 sm:col-span-2"
            >
              <Sparkles className="mr-1.5 h-4 w-4 fill-slate-950" />
              Unlock & Schedule — ₹2,499
            </Button>
          </div>
        </div>
      ) : (
        /* Completed State */
        <div className="mt-10 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-3xl">
            🎉
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold text-fg">
            You're All Caught Up!
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted leading-relaxed">
            All 42 overnight applicants have been triaged in under 60 seconds. Your AI Taste Centroid has been calibrated for future candidate rankings.
          </p>

          <div className="mt-6 flex justify-center gap-3">
            <Button type="button" variant="outline" onClick={handleReset} className="text-xs">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Review Candidates Again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
