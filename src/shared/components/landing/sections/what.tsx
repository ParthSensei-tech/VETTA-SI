import { DEFINITION } from "../content/site";
import { Section } from "../ui/section";

export function WhatVettaIs() {
  return (
    <Section id="what" eyebrow="The product" title={DEFINITION.title}>
      <p className="mt-8 max-w-3xl text-[clamp(1.05rem,2vw,1.4rem)] leading-relaxed text-l-text">
        {DEFINITION.lead}
      </p>
      <p className="mt-6 max-w-2xl text-sm leading-relaxed text-l-muted">{DEFINITION.body}</p>
    </Section>
  );
}