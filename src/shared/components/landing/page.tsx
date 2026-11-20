import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { indexHeroStat, type PublicIndex } from "@/features/marketing/domain/vetta-index";
import { FOOTER } from "./content/site";
import { usePrefersReducedMotion } from "./use-landing-motion";
import { LandingNav } from "./nav";
import { Hero } from "./hero/hero";
import { WhatVettaIs } from "./sections/what";
import { HowItWorks } from "./sections/how";
import { WhoItsFor } from "./sections/who";
import { Faq } from "./sections/faq";
import { DemoCta } from "./sections/demo-cta";

export function LandingPage({ index = null }: { index?: PublicIndex | null }) {
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    if (reduce) return;
    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let raf = 0;
    let cancelled = false;
    void import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({ duration: 1.1 });
      const loop = (time: number) => {
        lenis?.raf(time);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      lenis?.destroy();
    };
  }, [reduce]);

  return (
    <div className="landing min-h-dvh">
      <LandingNav />
      <main>
        <Hero stat={index ? indexHeroStat(index) : null} />
        <WhatVettaIs />
        <HowItWorks />
        <WhoItsFor />
        <Faq />
        <DemoCta />
      </main>
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