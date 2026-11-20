import type { ReactNode } from "react";

export function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-28">
        <p className="font-mono text-xs tracking-[0.25em] text-mint uppercase">{eyebrow}</p>
        <h2
          id={`${id}-title`}
          className="mt-4 font-l-display text-[clamp(1.6rem,3.4vw,2.6rem)] tracking-tight text-l-text"
        >
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}