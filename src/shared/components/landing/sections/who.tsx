import { Compass, Rocket, Users } from "lucide-react";
import { AUDIENCES } from "../content/site";
import { GlassPanel } from "../ui/primitives";
import { Section } from "../ui/section";

const ICONS = [Rocket, Users, Compass];

export function WhoItsFor() {
  return (
    <Section id="who-its-for" eyebrow="Built for startups" title="Who it's for">
      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {AUDIENCES.map((a, i) => {
          const Icon = ICONS[i] ?? Rocket;
          return (
            <GlassPanel key={a.title} className="rounded-2xl p-6">
              <Icon className="size-5 text-mint" aria-hidden="true" />
              <h3 className="mt-5 font-l-display text-lg leading-snug text-l-text">{a.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-l-muted">{a.text}</p>
            </GlassPanel>
          );
        })}
      </div>
    </Section>
  );
}