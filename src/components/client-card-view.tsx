import type { ClientCard } from "@/lib/recruiting/types";

export function ClientCardView({ card }: { card: ClientCard }) {
  return (
    <article className="rounded-2xl bg-elevated p-6">
      <p className="text-xs tracking-wide text-muted uppercase">{card.fit_label}</p>
      <h3 className="mt-1 font-display text-2xl font-medium">{card.candidate_name}</h3>
      <p className="text-sm text-muted">{card.headline}</p>
      <p className="mt-4 text-sm leading-relaxed">{card.summary}</p>
      {card.highlights.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1.5 text-sm">
          {card.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
      {card.watchouts.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs tracking-wide text-muted uppercase">Watchouts</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-muted">
            {card.watchouts.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.interview_probes.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs tracking-wide text-muted uppercase">Interview probes</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {card.interview_probes.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-5 text-xs text-subtle">
        {card.location}
        {card.availability ? ` · ${card.availability}` : ""}
      </p>
      {card.screen ? (
        <p className="mt-3 text-sm text-muted">
          Screen: {card.screen.verdict}. {card.screen.notes}
        </p>
      ) : null}
    </article>
  );
}
