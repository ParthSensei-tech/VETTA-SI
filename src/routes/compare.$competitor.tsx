import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, X, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

export const Route = createFileRoute("/compare/$competitor")({
  component: ComparePage,
});

type CompetitorKey = "naukri" | "linkedin" | "agency";

type CompetitorData = {
  name: string;
  tagline: string;
  painPoint: string;
  features: Array<{
    label: string;
    vetta: string;
    them: string;
    vettaWins: boolean;
  }>;
  costComparison: {
    theirAnnualCost: string;
    vettaCost: string;
    savings: string;
  };
  killStatement: string;
  cta: string;
};

const COMPETITORS: Record<CompetitorKey, CompetitorData> = {
  naukri: {
    name: "Naukri / InfoEdge",
    tagline: "Job boards for 2005. Vetta is built for 2026.",
    painPoint:
      "You're paying ₹15,000–₹2,00,000/year for a job board that dumps 400 unscreened resumes on you. Then you spend 3 weeks manually calling candidates who ghost you.",
    features: [
      {
        label: "Resume Parsing (ATS)",
        vetta: "Free, unlimited, AI-powered",
        them: "₹15,000–₹2,00,000/year (bundled ATS)",
        vettaWins: true,
      },
      {
        label: "AI Candidate Screening",
        vetta: "12-min Hinglish voice screen. Anti-cheating verified.",
        them: "Not offered. Manual recruiter calls.",
        vettaWins: true,
      },
      {
        label: "Candidate Shortlisting Speed",
        vetta: "60-second morning triage. 2 finalists in your inbox daily.",
        them: "3–4 weeks of manual review",
        vettaWins: true,
      },
      {
        label: "Pricing Model",
        vetta: "Pay ₹2,499 only when you unlock a verified finalist",
        them: "Pay ₹5,000–₹15,000 upfront per job posting. No hire guarantee.",
        vettaWins: true,
      },
      {
        label: "WhatsApp Candidate Flow",
        vetta: "Full WhatsApp screening + status updates",
        them: "No WhatsApp. Desktop-only email flow.",
        vettaWins: true,
      },
      {
        label: "Anti-Cheating Verification",
        vetta: "Real-time proxy detection + employment history EPFO check",
        them: "No verification. You get what candidates claim.",
        vettaWins: true,
      },
      {
        label: "Job Database Size",
        vetta: "AI sourcing from 6+ databases",
        them: "67M+ listed resumes (mostly stale)",
        vettaWins: false,
      },
    ],
    costComparison: {
      theirAnnualCost: "₹60,000–₹2,00,000/year (ATS + listings)",
      vettaCost: "₹0 until you hire. ₹2,499 per verified finalist unlock.",
      savings: "₹57,000–₹1,97,000 saved in year one for most seed-stage teams.",
    },
    killStatement:
      "Naukri cannot match our free tier without destroying their ₹600 Cr job listing business. So they won't. That's your moat as a Vetta user.",
    cta: "Switch from Naukri in 10 minutes. Free forever.",
  },

  linkedin: {
    name: "LinkedIn Recruiter India",
    tagline: "InMail credits for sourcing. Vetta does the whole job.",
    painPoint:
      "You're paying ₹5,000–₹8,000/month for LinkedIn Recruiter seats and spending hours sourcing, messaging, and chasing candidates who never reply to InMails.",
    features: [
      {
        label: "Resume / Profile Parsing",
        vetta: "Free, structured, with Hinglish CTC/notice extraction",
        them: "Profile scraping only. No structured extraction.",
        vettaWins: true,
      },
      {
        label: "Automated Screening",
        vetta: "Autonomous 12-min voice screen. No recruiter needed.",
        them: "No screening. You message candidates and hope they reply.",
        vettaWins: true,
      },
      {
        label: "Indian Market Accuracy",
        vetta: "Hinglish-native. Regional dialect aware. India-specific signals.",
        them: "Global English model. Struggles with Hinglish nuance.",
        vettaWins: true,
      },
      {
        label: "Pricing Model",
        vetta: "Free ATS. Pay per verified finalist. No monthly seat fee.",
        them: "₹5,000–₹8,000/month per recruiter seat regardless of hires.",
        vettaWins: true,
      },
      {
        label: "Candidate Response Rate",
        vetta: "WhatsApp-first. 73% response rate on first message.",
        them: "InMail. ~8–15% response rate in India.",
        vettaWins: true,
      },
      {
        label: "Professional Network Size",
        vetta: "AI sourcing from GitHub, job portals, alumni networks",
        them: "1B+ global profiles",
        vettaWins: false,
      },
      {
        label: "Offer Dropout Prevention",
        vetta: "Offer Guard: AI monitors offer risk, counter-offer playbook",
        them: "No offer tracking. You find out at the last minute.",
        vettaWins: true,
      },
    ],
    costComparison: {
      theirAnnualCost: "₹60,000–₹96,000/year per recruiter seat",
      vettaCost: "₹0 base. ₹2,499 per finalist you choose to unlock.",
      savings: "₹57,000–₹93,000 saved per year on seat costs alone.",
    },
    killStatement:
      "LinkedIn India's recruiter seat revenue is their business model. They cannot build autonomous screening that makes those seats worthless. We can — and we did.",
    cta: "Replace your LinkedIn Recruiter seat with Vetta for free.",
  },

  agency: {
    name: "Traditional Recruitment Agency",
    tagline: "15% commission for 6 weeks of ghosting. We charge ₹2,499.",
    painPoint:
      "Your agency takes 10–18% of annual CTC per hire. For a ₹20L role that's ₹2–3.6L. They show you 5 candidates after 3 weeks. 2 don't show up. 1 accepts another offer. You've wasted 6 weeks and paid for nothing.",
    features: [
      {
        label: "Cost per Hire",
        vetta: "₹2,499 per verified finalist unlock (flat, forever)",
        them: "₹60,000–₹3,60,000 per hire (10–18% of CTC)",
        vettaWins: true,
      },
      {
        label: "Time to First Shortlist",
        vetta: "2–3 days from role creation",
        them: "2–4 weeks minimum",
        vettaWins: true,
      },
      {
        label: "Screening Transparency",
        vetta: "Full transcript, audio highlight, anti-cheat verdict",
        them: "\"We felt they were a good fit.\" Black box.",
        vettaWins: true,
      },
      {
        label: "Candidate Verification",
        vetta: "EPFO employment history, proxy detection, GitHub commit verify",
        them: "Reference call (optional). CV taken at face value.",
        vettaWins: true,
      },
      {
        label: "Interview No-Show Guarantee",
        vetta: "100% show guarantee or free replacement",
        them: "No guarantee. \"We'll find another one.\" (Another 2 weeks.)",
        vettaWins: true,
      },
      {
        label: "Offer Dropout Risk",
        vetta: "Offer Guard AI monitors drop risk. Counter-offer playbook built in.",
        them: "Agency finds out when you tell them. Replacement starts from scratch.",
        vettaWins: true,
      },
      {
        label: "Passive Candidate Network",
        vetta: "AI sourcing. Outreach pipeline.",
        them: "Existing database + LinkedIn. Sometimes better for niche senior roles.",
        vettaWins: false,
      },
    ],
    costComparison: {
      theirAnnualCost:
        "₹2,00,000–₹18,00,000/year for 5–10 hires at mid-senior level",
      vettaCost: "₹12,495–₹24,990/year for the same 5–10 hires",
      savings: "₹1,87,505–₹17,75,010 saved per year. 50x cheaper.",
    },
    killStatement:
      "A traditional agency cannot charge ₹2,499 flat per finalist without going bankrupt. Their entire business is built on opaque commission. Transparency is their existential threat.",
    cta: "Kill your agency retainer. Start Vetta for free today.",
  },
};

function CompareFeatureRow({
  label,
  vetta,
  them,
  vettaWins,
}: CompetitorData["features"][0]) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pr-4 text-sm font-medium text-fg">{label}</td>
      <td className="py-3 pr-4 text-sm">
        <span className="flex items-start gap-1.5 text-emerald-500">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {vetta}
        </span>
      </td>
      <td className="py-3 text-sm">
        <span
          className={`flex items-start gap-1.5 ${vettaWins ? "text-muted" : "text-fg"}`}
        >
          {vettaWins ? (
            <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500/60" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          )}
          {them}
        </span>
      </td>
    </tr>
  );
}

function ComparePage() {
  const { competitor } = Route.useParams();
  const isValid = competitor === "naukri" || competitor === "linkedin" || competitor === "agency";
  const data = isValid ? COMPETITORS[competitor as CompetitorKey] : null;

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted">
          Compare page not found. Try{" "}
          <Link to="/compare/$competitor" params={{ competitor: "naukri" }} className="text-emerald-500 underline">
            /compare/naukri
          </Link>
          ,{" "}
          <Link to="/compare/$competitor" params={{ competitor: "linkedin" }} className="text-emerald-500 underline">
            /compare/linkedin
          </Link>
          , or{" "}
          <Link to="/compare/$competitor" params={{ competitor: "agency" }} className="text-emerald-500 underline">
            /compare/agency
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      {/* Hero */}
      <div className="mb-10 text-center">
        <span className="inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-500">
          Vetta vs {data.name}
        </span>
        <h1 className="mt-3 font-display text-3xl font-black tracking-tight text-fg sm:text-4xl">
          {data.tagline}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted">
          {data.painPoint}
        </p>
      </div>

      {/* Feature Table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface/50">
              <th className="py-3 pl-4 pr-4 text-left text-xs font-bold uppercase tracking-wider text-muted">
                Feature
              </th>
              <th className="py-3 pr-4 text-left text-xs font-bold uppercase tracking-wider text-emerald-500">
                Vetta ✦
              </th>
              <th className="py-3 pr-4 text-left text-xs font-bold uppercase tracking-wider text-muted">
                {data.name}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border px-4">
            {data.features.map((f) => (
              <CompareFeatureRow key={f.label} {...f} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Cost Box */}
      <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-500">
          Real Cost Comparison
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-surface px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {data.name} Annual Cost
            </p>
            <p className="mt-1 text-sm font-bold text-rose-400">
              {data.costComparison.theirAnnualCost}
            </p>
          </div>
          <div className="rounded-xl bg-surface px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Vetta Cost
            </p>
            <p className="mt-1 text-sm font-bold text-emerald-500">
              {data.costComparison.vettaCost}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-500/10 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
              You Save
            </p>
            <p className="mt-1 text-sm font-bold text-fg">
              {data.costComparison.savings}
            </p>
          </div>
        </div>
      </div>

      {/* Kill Statement */}
      <div className="mt-6 rounded-2xl border border-border bg-surface px-6 py-5">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>
            <span className="font-bold text-fg">Why can't they just copy Vetta?</span>{" "}
            {data.killStatement}
          </span>
        </p>
      </div>

      {/* CTA */}
      <div className="mt-8 flex flex-col items-center gap-3 text-center">
        <Link to="/waitlist">
          <Button className="h-12 bg-emerald-500 px-8 font-bold text-slate-950 hover:bg-emerald-400">
            {data.cta}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
        <p className="text-xs text-muted">
          No credit card required. Free tier is free forever.
        </p>
      </div>

      {/* Sibling links */}
      <div className="mt-10 flex flex-wrap justify-center gap-3 border-t border-border pt-6">
        <p className="w-full text-center text-xs text-muted">Also compare:</p>
        {(["naukri", "linkedin", "agency"] as CompetitorKey[])
          .filter((c) => c !== competitor)
          .map((c) => (
            <Link
              key={c}
              to="/compare/$competitor"
              params={{ competitor: c }}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-emerald-500/40 hover:text-emerald-500"
            >
              Vetta vs {COMPETITORS[c].name}
            </Link>
          ))}
      </div>
    </div>
  );
}
