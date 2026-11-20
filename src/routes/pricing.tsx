import { createFileRoute, Link } from "@tanstack/react-router";
import { PLAN_TIERS, type ProductPlan } from "@/features/billing/domain/plans";
import { PlanCheckout } from "@/shared/components/landing/plan-checkout";
import { productLd, softwareApplicationLd } from "@/platform/seo/jsonld";
import { GlassPanel } from "@/shared/components/landing/ui/primitives";
import { LandingNav } from "@/shared/components/landing/nav";
import { DemoCta } from "@/shared/components/landing/sections/demo-cta";
import { FOOTER } from "@/shared/components/landing/content/site";
import { formatRupees } from "@/features/analytics/domain/funnel-analytics";

export const Route = createFileRoute("/pricing")({
  loader: async () => {
    const { seoOrigin } = await import("@/platform/seo/origin");
    return { origin: seoOrigin() };
  },
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    return {
      meta: [
        { title: "Pricing — Vetta | Evidence-first hiring from ₹6,999 a month" },
        {
          name: "description",
          content:
            "Agencies charge 8.33% of CTC to guess. Vetta plans run from ₹6,999 a month for the whole company — evidence-traced shortlists, DPDP compliance, and an optional pay-on-hire plan.",
        },
        ...(origin
          ? [
              { "script:ld+json": productLd(origin) },
              { "script:ld+json": softwareApplicationLd(origin) },
            ]
          : []),
      ],
      links: origin ? [{ rel: "canonical", href: `${origin}/pricing` }] : [],
    };
  },
  component: PricingPage,
});

/** The number every founder already knows: one agency hire at 8.33% of a ₹30L CTC. */
const AGENCY_ANCHOR_INR = 250_000;

const TIER_POINTS: Record<string, string[]> = {
  free: [
    "1 open role at a time",
    "30 AI screens a month",
    "Evidence-traced verdicts and DPDP receipts — in full",
  ],
  starter: [
    "3 open roles · 3 seats",
    "300 AI screens a month",
    "Branded careers page on your domain",
    "Pay-on-hire option: ₹0 subscription, flat success fee on join",
  ],
  growth: [
    "Unlimited roles and screens · 10 seats",
    "Client-disclosure packs and export slate",
    "Priority AI ladder — verdicts while your queue is still parsing",
    "Offer Guard rene-risk checks included",
  ],
};

function inr(paise: number): string {
  return formatRupees(paise / 100);
}

/** A plan you can buy, a page you can be linked to, or the demo anchor. */
type TierCta =
  | { label: string; to: "/login" | "/signup" }
  | { label: string; href: string }
  | { label: string; checkout: Extract<ProductPlan, "starter" | "growth">; variant?: "primary" | "secondary" };

function TierCard({
  plan,
  recommended,
  cta,
}: {
  plan: keyof typeof PLAN_TIERS;
  recommended?: boolean;
  cta: TierCta;
}) {
  const tier = PLAN_TIERS[plan];
  return (
    <GlassPanel
      className={
        recommended
          ? "relative rounded-3xl border border-mint/40 p-7 shadow-[0_0_60px_-20px_rgba(120,255,200,0.35)]"
          : "relative rounded-3xl p-7"
      }
    >
      {recommended && (
        <span className="absolute -top-3 left-7 rounded-full bg-mint px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-l-bg">
          Most seed startups pick this
        </span>
      )}
      <h3 className="font-l-display text-lg tracking-tight text-l-text">{tier.displayName}</h3>
      <p className="mt-3 font-l-display text-[clamp(1.6rem,2.6vw,2.2rem)] leading-none text-l-text">
        {tier.pricePaiseMonthly === null ? "Quoted" : inr(tier.pricePaiseMonthly)}
        {tier.pricePaiseMonthly !== null && (
          <span className="text-sm font-normal text-l-muted"> /month</span>
        )}
      </p>
      <p className="mt-1 text-xs text-l-muted">
        {plan === "portfolio"
          ? "Annual, per fund"
          : tier.pricePaiseMonthly
            ? `${inr(Math.round((tier.pricePaiseMonthly * 10) / 12))} a year — two months free`
            : "Free while you run one role"}
      </p>
      <ul className="mt-6 flex flex-col gap-2.5 text-sm leading-relaxed text-l-muted">
        {TIER_POINTS[plan].map((point) => (
          <li key={point} className="flex gap-2">
            <span aria-hidden className="text-mint">
              ✓
            </span>
            {point}
          </li>
        ))}
      </ul>
      <div className="mt-7">
        {"checkout" in cta ? (
          <PlanCheckout plan={cta.checkout} label={cta.label} variant={cta.variant} />
        ) : "to" in cta ? (
          <Link
            to={cta.to}
            className={
              recommended
                ? "block rounded-full bg-mint px-5 py-2.5 text-center text-sm font-semibold text-l-bg"
                : "block rounded-full border border-l-hairline px-5 py-2.5 text-center text-sm font-medium text-l-text transition-colors hover:border-mint/50"
            }
          >
            {cta.label}
          </Link>
        ) : (
          <a
            href={cta.href}
            className="block rounded-full border border-l-hairline px-5 py-2.5 text-center text-sm font-medium text-l-text transition-colors hover:border-mint/50"
          >
            {cta.label}
          </a>
        )}
      </div>
    </GlassPanel>
  );
}

function PricingPage() {
  return (
    <div className="landing min-h-dvh">
      <LandingNav />
      <main className="mx-auto max-w-7xl px-5 pt-14 sm:px-8">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-xs uppercase tracking-[0.22em] text-mint">Pricing</p>
          <h1 className="mt-4 font-l-display text-[clamp(1.8rem,4.4vw,3.2rem)] leading-tight tracking-tight text-l-text">
            Agencies charge 8.33% to guess.
            <br />
            Vetta charges ₹6,999 to know.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-l-muted">
            Every plan runs the whole product — evidence-traced verdicts, India-calibrated rubrics
            and DPDP compliance are not upsells. What changes is how many roles you can run at once
            and how fast the AI ladder answers.
          </p>
        </header>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm">
          <span className="text-l-muted line-through decoration-ember/70">
            {formatRupees(AGENCY_ANCHOR_INR)} per hire, one agency
          </span>
          <span aria-hidden className="text-l-muted">
            →
          </span>
          <span className="font-semibold text-mint">
            {inr(PLAN_TIERS.starter.pricePaiseMonthly ?? 0)} a month, every hire
          </span>
        </div>

        <section aria-label="Plans" className="mt-12 grid gap-6 md:grid-cols-3">
          <TierCard
            plan="growth"
            cta={{ label: "Start Vetta Ops", checkout: "growth", variant: "secondary" }}
          />
          <TierCard
            plan="starter"
            recommended
            cta={{ label: "Start Vetta Engine", checkout: "starter", variant: "primary" }}
          />
          <TierCard plan="free" cta={{ label: "Run one role free", to: "/signup" }} />
        </section>

        <GlassPanel className="mt-6 rounded-3xl p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-l-display text-lg text-l-text">
                {PLAN_TIERS.portfolio.displayName} — for seed funds and accelerators
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-l-muted">
                Every portfolio company on Vetta Ops, one invoice, one onboarding, and a shared
                hiring view across the fund. Fifteen startups for less than one recruiter.
              </p>
            </div>
            <a
              href="#demo"
              className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-l-bg"
            >
              Book a fund demo
            </a>
          </div>
        </GlassPanel>

        <GlassPanel className="mt-6 rounded-3xl p-7">
          <h3 className="font-l-display text-lg text-l-text">Not sure yet? Pay only when it hires.</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-l-muted">
            On Vetta Engine you can waive the subscription entirely and pay a flat{" "}
            {formatRupees(49_999)} success fee only when a Vetta-shortlisted candidate joins. If
            they renege within 90 days, the fee is clawed back. The software you already screened
            with stays yours.
          </p>
        </GlassPanel>

        <p className="mt-8 text-center text-xs text-l-muted">
          Screen allowances reset on the 1st — unused screens are lost, used verdicts are never
          touched. Prices exclude GST.
        </p>
      </main>

      <div className="pt-16">
        <DemoCta />
      </div>

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-l-hairline px-5 py-6 text-xs text-l-muted sm:px-8">
        <span>{FOOTER.tagline}</span>
        <div className="flex gap-5">
          {FOOTER.links.map((l) => (
            <Link key={l.href} to={l.href} className="transition-colors hover:text-l-text">
              {l.label}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
