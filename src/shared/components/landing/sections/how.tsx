import { useEffect, useRef } from "react";
import { ClipboardCheck, MessagesSquare, Radar, Stamp } from "lucide-react";
import { STEPS } from "../content/site";
import { usePrefersReducedMotion } from "../use-landing-motion";

const ICONS = [MessagesSquare, Radar, ClipboardCheck, Stamp];

/**
 * Pinned cross-fade on scroll. Without JS or with reduced motion the four
 * steps render as a plain readable grid — all copy stays in the SSR HTML.
 */
export function HowItWorks() {
  const reduce = usePrefersReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) return;
    let cancelled = false;
    let ctx: { revert: () => void } | undefined;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([g, st]) => {
      const root = rootRef.current;
      const stage = stageRef.current;
      if (cancelled || !root || !stage) return;
      const gsap = g.default;
      const ScrollTrigger = st.default;
      gsap.registerPlugin(ScrollTrigger);
      root.classList.add("l-how-live");
      ctx = gsap.context(() => {
        const cards = gsap.utils.toArray<HTMLElement>("[data-how-card]", stage);
        gsap.set(cards.slice(1), { autoAlpha: 0, y: 28 });
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: root,
            start: "top top",
            end: "+=300%",
            pin: true,
            scrub: 0.6,
            anticipatePin: 1,
          },
        });
        cards.forEach((card, i) => {
          if (i === 0) return;
          tl.to(cards[i - 1], { autoAlpha: 0, y: -28, duration: 0.45 }, i)
            .to(card, { autoAlpha: 1, y: 0, duration: 0.45 }, i + 0.2);
        });
        if (barRef.current) {
          tl.fromTo(barRef.current, { scaleX: 0 }, { scaleX: 1, ease: "none", duration: 4 }, 0);
        }
      }, root);
      ScrollTrigger.refresh();
    });
    return () => {
      cancelled = true;
      ctx?.revert();
      rootRef.current?.classList.remove("l-how-live");
    };
  }, [reduce]);

  return (
    <section ref={rootRef} id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-20">
      <div className="mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-center px-5 py-24 sm:px-8">
        <p className="font-mono text-xs tracking-[0.25em] text-mint uppercase">The pipeline</p>
        <h2
          id="how-it-works-title"
          className="mt-4 font-l-display text-[clamp(1.6rem,3.4vw,2.6rem)] tracking-tight text-l-text"
        >
          How it works
        </h2>

        <div ref={stageRef} className="l-how-stage relative mt-10 grid gap-6 sm:grid-cols-2">
          {STEPS.map((s, i) => {
            const Icon = ICONS[i] ?? MessagesSquare;
            return (
              <div key={s.n} data-how-card className="l-glass rounded-2xl p-7">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-mint">{s.n}</span>
                  <span className="l-pulse-ring relative inline-flex size-9 items-center justify-center rounded-full border border-l-hairline">
                    <Icon className="size-4 text-glacier" aria-hidden="true" />
                  </span>
                </div>
                <h3 className="mt-6 font-l-display text-xl text-l-text">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-l-muted">{s.text}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-8 h-px w-full bg-l-hairline" aria-hidden="true">
          <div ref={barRef} className="h-px origin-left scale-x-0 bg-mint" />
        </div>
      </div>
    </section>
  );
}