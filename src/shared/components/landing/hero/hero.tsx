import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { HeroStat } from "@/features/marketing/domain/vetta-index";
import { HERO } from "../content/site";
import { usePrefersReducedMotion, useSectionInView } from "../use-landing-motion";
import { GlassPanel, PillLink } from "../ui/primitives";
import { HeroBackdrop } from "./hero-backdrop";
import { BustFallback } from "./bust-fallback";

const ParticleBust = lazy(() => import("./particle-bust"));

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function useDeviceTier(): "low" | "mobile" | "high" {
  const [tier, setTier] = useState<"low" | "mobile" | "high">("low");
  useEffect(() => {
    const cores = navigator.hardwareConcurrency ?? 4;
    if (cores <= 4) return;
    setTier(matchMedia("(max-width: 767px)").matches ? "mobile" : "high");
  }, []);
  return tier;
}

export function Hero({ stat = null }: { stat?: HeroStat | null }) {
  const reduce = usePrefersReducedMotion();
  const tier = useDeviceTier();
  const [mounted, setMounted] = useState(false);
  const [sceneRef, inView] = useSectionInView<HTMLDivElement>("20%");

  useEffect(() => {
    setMounted(true);
  }, []);

  const showScene = mounted && !reduce && tier !== "low";
  const staticBust = <BustFallback className="h-full w-full opacity-70" />;

  return (
    <section
      aria-label="Introducing Vetta"
      className="relative isolate flex min-h-[100svh] items-center overflow-hidden"
    >
      <HeroBackdrop />
      <div className="l-vignette absolute inset-0" aria-hidden="true" />

      <div
        ref={sceneRef}
        aria-hidden="true"
        className="absolute inset-y-0 right-0 w-full opacity-50 [background:radial-gradient(62%_62%_at_50%_45%,rgba(7,16,15,0.72),transparent_78%)] lg:w-[58%] lg:opacity-100"
      >
        {showScene ? (
          <SceneBoundary fallback={staticBust}>
            <Suspense fallback={staticBust}>
              <ParticleBust count={tier === "mobile" ? 12000 : 40000} active={inView} />
            </Suspense>
          </SceneBoundary>
        ) : (
          staticBust
        )}
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-5 py-28 sm:px-8">
        <GlassPanel className="max-w-xl p-7 sm:p-10">
          <p className="l-intro-resolve font-l-display text-[clamp(2.6rem,7vw,5rem)] leading-none tracking-[0.08em] text-l-text">
            {HERO.wordmark}
          </p>
          <h1 className="l-intro-rise l-d1 mt-6 font-l-display text-[clamp(1.3rem,2.6vw,2rem)] leading-snug tracking-tight text-l-text">
            {HERO.headline}
          </h1>
          <p className="l-intro-rise l-d2 mt-4 text-sm leading-relaxed text-l-muted">{HERO.sub}</p>
          <div className="l-intro-rise l-d3 mt-8 flex flex-wrap gap-3">
            <PillLink href="#demo">{HERO.primaryCta}</PillLink>
            <PillLink href="#how-it-works" variant="ghost">
              {HERO.secondaryCta}
            </PillLink>
          </div>
        </GlassPanel>
      </div>

      {/* The hero's only number is the stored Vetta Index cut, so the block is
          absent rather than placeholder when the cohort has not cleared its
          floor. A visitor who sees "4.6 days" here can click through to the
          denominator, the window and the method behind it. */}
      {stat && (
        <Link
          to="/data"
          aria-label={`${stat.label}: ${stat.value}. Read the method.`}
          className="absolute right-5 bottom-6 z-10 hidden max-w-60 sm:block"
        >
          <GlassPanel className="rounded-2xl px-5 py-4 transition-colors hover:border-mint/40">
            <p className="text-[11px] tracking-wide text-l-muted uppercase">{stat.label}</p>
            <p className="mt-1 font-l-display text-2xl text-mint">{stat.value}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-l-muted/70">{stat.note}</p>
            <p className="mt-1.5 text-[10px] font-semibold text-mint/80">Read the method →</p>
          </GlassPanel>
        </Link>
      )}
    </section>
  );
}