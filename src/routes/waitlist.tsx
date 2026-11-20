import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Flame,
  MessageCircle,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { LandingNav } from "@/shared/components/landing/nav";
import { FOOTER } from "@/shared/components/landing/content/site";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { joinWaitlistFn, getWaitlistStatusFn } from "@/features/marketing/api/waitlist-api";
import type { WaitlistStatusResult } from "@/features/marketing/server/waitlist.server";

export const Route = createFileRoute("/waitlist")({
  validateSearch: (search: Record<string, unknown>): { ref?: string } => ({
    ref: typeof search.ref === "string" ? search.ref.slice(0, 32) : undefined,
  }),
  component: WaitlistPage,
});

function WaitlistPage() {
  const { ref } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [founderName, setFounderName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [waitlistResult, setWaitlistResult] = useState<WaitlistStatusResult | null>(null);

  // Check localStorage for prior registration
  useEffect(() => {
    const saved = localStorage.getItem("vetta_waitlist_email");
    if (saved) {
      getWaitlistStatusFn({ data: saved })
        .then((res) => {
          if (res) setWaitlistResult(res);
        })
        .catch(() => {});
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid work email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await joinWaitlistFn({
        data: {
          email,
          founderName,
          companyName,
          roleTitle,
          referredByCode: ref || undefined,
        },
      });

      setWaitlistResult(res);
      localStorage.setItem("vetta_waitlist_email", email);
      toast.success("Welcome to VIP Founder Cohort 1!");
    } catch (err: any) {
      toast.error(err?.message || "Failed to join waitlist. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const referralUrl = waitlistResult
    ? `${typeof window !== "undefined" ? window.location.origin : "https://vetta.ai"}/waitlist?ref=${waitlistResult.entry.referralCode}`
    : "";

  function copyReferral() {
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl);
    toast.success("Referral link copied! Share on WhatsApp to jump 100 spots.");
  }

  function shareWhatsApp() {
    if (!referralUrl) return;
    const text = `Hey! I just claimed priority access to Vetta — an autonomous recruitment workforce. They conduct 12-min technical phone screens in Hinglish with anti-cheating verification and give permanent free ATS parsing. Join VIP Cohort 1 via my founder link to get 10 free voice screens: ${referralUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  return (
    <div className="min-h-screen bg-[#070a11] text-slate-100 selection:bg-emerald-500/20 selection:text-emerald-300">
      <LandingNav />

      <main className="relative mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Glow ambient effects */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="pointer-events-none absolute top-48 right-10 -z-10 h-72 w-72 rounded-full bg-cyan-500/10 blur-[100px]" />

        {/* Header Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            <Flame className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
            VIP Founder Cohort 1 • Rolling Early Access
          </div>

          <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Software is Dead. <br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Work is the Product.
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400 sm:text-lg">
            Stop drowning in 500 resume PDFs. Vetta is the world's first autonomous recruitment workforce that parses resumes for free, dials candidates in Hinglish, and delivers verified finalists directly to your calendar.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Permanent Free ATS ($0)
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-cyan-400" /> 10 Free Voice Screens upon Activation
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-emerald-400" /> Over 840+ Founders in Queue
            </span>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="mt-12">
          {!waitlistResult ? (
            /* Signup Card */
            <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-xl">
              <h2 className="font-display text-xl font-bold text-white">
                Claim Your VIP Founder Cohort 1 Access
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Reserve your spot in the priority queue. First 500 founders get 10 free autonomous Hinglish phone screens credited upon activation.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-300">Work Email *</label>
                  <Input
                    type="email"
                    required
                    placeholder="founder@yourcompany.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 border-white/10 bg-slate-950/80 text-white placeholder:text-slate-600 focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-slate-300">Your Name</label>
                    <Input
                      type="text"
                      placeholder="Anupam Sharma"
                      value={founderName}
                      onChange={(e) => setFounderName(e.target.value)}
                      className="mt-1 border-white/10 bg-slate-950/80 text-white placeholder:text-slate-600 focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-300">Company Name</label>
                    <Input
                      type="text"
                      placeholder="NexusCore"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="mt-1 border-white/10 bg-slate-950/80 text-white placeholder:text-slate-600 focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">
                    What role are you currently hiring?
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. Lead Backend Go Engineer"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    className="mt-1 border-white/10 bg-slate-950/80 text-white placeholder:text-slate-600 focus:border-emerald-500"
                  />
                </div>

                {ref ? (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
                    ✓ Joining via VIP referral code: <strong>{ref}</strong>
                  </div>
                ) : null}

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-2 h-11 w-full bg-emerald-500 font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  {isSubmitting ? "Reserving your position..." : "Join VIP Founder Cohort 1"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </form>

              <p className="mt-4 text-center text-[11px] text-slate-500">
                Zero spam. DPDP compliant. Free forever ATS access included.
              </p>
            </div>
          ) : (
            /* Robinhood Queue Ticket Card */
            <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-slate-900/90 to-slate-950 p-8 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    VIP Queue Ticket Confirmed
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  Access: {waitlistResult.estimatedLaunchDate}
                </span>
              </div>

              {/* Huge Position Display */}
              <div className="my-8 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Your Priority Queue Position
                </p>
                <div className="mt-2 font-display text-6xl font-black tracking-tight text-white sm:text-7xl">
                  #{waitlistResult.entry.waitlistPosition}
                </div>
                <p className="mt-2 text-xs text-emerald-400 font-medium">
                  ahead of {Math.max(0, waitlistResult.totalWaitlistCount - waitlistResult.entry.waitlistPosition)} other founders
                </p>
              </div>

              {/* Jump the Line Viral Callout */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                  <Flame className="h-4 w-4 text-emerald-400" />
                  Want to jump 100 spots in line?
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Share your personal VIP invite link with founder friends. For every founder who joins through your link, you jump <strong>100 spots</strong> and unlock <strong>5 additional free voice screens</strong>!
                </p>

                <div className="mt-4 flex items-center gap-2">
                  <Input
                    readOnly
                    value={referralUrl}
                    className="h-9 border-white/10 bg-slate-950 text-xs text-slate-200"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={copyReferral}
                    className="shrink-0"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={shareWhatsApp}
                    className="w-full bg-[#25D366] text-xs font-semibold text-slate-950 hover:bg-[#20ba59]"
                  >
                    <MessageCircle className="mr-1.5 h-4 w-4" /> Share on WhatsApp
                  </Button>
                </div>
              </div>

              {/* Unlocked Perks List */}
              <div className="mt-6 border-t border-white/10 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Your Launch Bounties Unlocked ({waitlistResult.entry.referralCount} Referrals):
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {waitlistResult.perksUnlocked.map((perk, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Three Daily Founder Utilities Preview */}
        <div className="mt-20 border-t border-white/10 pt-16">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Built for the Daily Reality of Indian Tech Founders
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold text-white sm:text-3xl">
              The 3 Tools You Will Use Every Single Morning
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-6">
              <span className="text-2xl">☕</span>
              <h3 className="mt-3 font-display text-base font-bold text-white">
                09:00 AM WhatsApp Briefing
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                A daily morning briefing on WhatsApp tracking candidates serving 60–90 day notice periods with real-time counter-offer hazard alerts.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-6">
              <span className="text-2xl">⚡</span>
              <h3 className="mt-3 font-display text-base font-bold text-white">
                60-Second "Inbox Zero" Triage
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Swipe through the top 2 overnight candidates with 30-second Hinglish voice screening snippets. Clear 50 applicants in 60 seconds over morning chai.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-6">
              <span className="text-2xl">💬</span>
              <h3 className="mt-3 font-display text-base font-bold text-white">
                WhatsApp Candidate Intake Bot
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Drop your personal link (<code className="text-emerald-400">vetta.ai/f/yourname</code>) on LinkedIn. Candidates chat with the bot, verify notice & CTC, and filter out spam.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-white/10 py-8 text-center text-xs text-slate-500">
        <p>© 2026 Vetta Autonomous Technologies Inc. • Engineered for Blitzscaling in India</p>
      </footer>
    </div>
  );
}
