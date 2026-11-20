import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Briefcase, CheckCircle2, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { getFounderSlugProfileFn, getFounderWhatsAppUrlFn } from "@/features/recruiting/api/founder-slug-api";
import type { FounderSlugProfile } from "@/features/recruiting/server/founder-slug.server";

export const Route = createFileRoute("/f/$slug")({
  component: FounderIntakePage,
});

function FounderIntakePage() {
  const params = Route.useParams() as { slug: string };
  const slug = params.slug;
  const [profile, setProfile] = useState<FounderSlugProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<string>("");

  useEffect(() => {
    getFounderSlugProfileFn({ data: slug })
      .then((res) => {
        if (res) {
          setProfile(res);
          if (res.activeRoles.length > 0) {
            setSelectedRole(res.activeRoles[0]!.title);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  // Fallback demo profile if not yet in database
  const activeProfile: FounderSlugProfile = profile || {
    id: `fslug_${slug}`,
    orgId: "org_default",
    userId: "usr_default",
    slug,
    founderName: slug.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    companyName: "NexusCore Tech",
    headline: "Building high-performance distributed systems & infrastructure in Bengaluru.",
    whatsappNumber: "+91 98765 43210",
    activeRoles: [
      {
        id: "role_1",
        title: "Lead Backend Go Engineer",
        location: "Bengaluru (Hybrid)",
        experienceBand: "4–8 Years",
      },
      {
        id: "role_2",
        title: "Frontend Architect (React / TS)",
        location: "Bengaluru / Remote",
        experienceBand: "5–9 Years",
      },
    ],
    totalCandidatesIngested: 48,
  };

  function handleApply() {
    getFounderWhatsAppUrlFn({
      data: {
        whatsappNumber: activeProfile.whatsappNumber,
        founderName: activeProfile.founderName,
        companyName: activeProfile.companyName,
        roleTitle: selectedRole || undefined,
        candidateSource: "LinkedIn",
      },
    }).then(({ url }) => {
      window.open(url, "_blank");
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#070a11] text-slate-100">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link to="/" className="text-xs font-bold tracking-[0.25em] text-emerald-400">
            VETTA
          </Link>
          <span className="text-[11px] text-slate-400">Autonomous Talent Intake</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-12">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          {/* Founder Identity Header */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-cyan-500 font-display text-xl font-bold text-slate-950 shadow-lg">
              {activeProfile.founderName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-white sm:text-2xl">
                {activeProfile.founderName}
              </h1>
              <p className="text-xs text-emerald-400 font-medium">
                Hiring for {activeProfile.companyName}
              </p>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-slate-300">
            {activeProfile.headline}
          </p>

          {/* Active Roles Selection */}
          <div className="mt-6 border-t border-white/10 pt-5">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Select Role You Are Applying For:
            </label>
            <div className="mt-3 flex flex-col gap-2">
              {activeProfile.activeRoles.map((role) => (
                <div
                  key={role.id}
                  onClick={() => setSelectedRole(role.title)}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border p-3.5 transition-colors ${
                    selectedRole === role.title
                      ? "border-emerald-500 bg-emerald-500/10 text-white"
                      : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Briefcase className={`h-4 w-4 ${selectedRole === role.title ? "text-emerald-400" : "text-slate-500"}`} />
                    <div>
                      <p className="text-xs font-semibold">{role.title}</p>
                      <p className="text-[11px] text-slate-400">
                        {role.location} · {role.experienceBand}
                      </p>
                    </div>
                  </div>
                  {selectedRole === role.title && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 1-Click WhatsApp CTA */}
          <div className="mt-8">
            <Button
              type="button"
              onClick={handleApply}
              className="h-12 w-full bg-[#25D366] text-sm font-bold text-slate-950 shadow-lg transition-transform hover:bg-[#20ba59] active:scale-[0.98]"
            >
              <MessageCircle className="mr-2 h-5 w-5 fill-slate-950" />
              Apply via WhatsApp in 2 Minutes
              <ArrowUpRight className="ml-1 h-4 w-4" />
            </Button>
            <p className="mt-2.5 text-center text-[11px] text-slate-400">
              No long forms. Chat directly with {activeProfile.founderName}'s autonomous hiring assistant.
            </p>
          </div>

          {/* Trust Guarantees */}
          <div className="mt-6 flex items-center justify-center gap-4 border-t border-white/10 pt-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> DPDP Privacy Protected
            </span>
            <span>·</span>
            <span>⚡ Instant Feedback in 2 Hours</span>
          </div>
        </div>
      </main>

      <footer className="py-6 text-center text-[11px] text-slate-600">
        Powered by Vetta Autonomous Talent Infrastructure
      </footer>
    </div>
  );
}
