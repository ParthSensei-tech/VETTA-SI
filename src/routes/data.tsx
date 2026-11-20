import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BarChart3, Quote, Scale, ShieldCheck } from "lucide-react";
import { getPublicIndex, type PublicIndex } from "@/features/marketing/api/vetta-index";
import {
  INDEX_FLOOR,
  INDEX_WINDOW_DAYS,
  formatDays,
  indexCitation,
  shortDate,
} from "@/features/marketing/domain/vetta-index";
import { datasetLd } from "@/platform/seo/jsonld";
import { GlassPanel } from "@/shared/components/landing/ui/primitives";
import { LandingNav } from "@/shared/components/landing/nav";
import { DemoCta } from "@/shared/components/landing/sections/demo-cta";
import { FOOTER } from "@/shared/components/landing/content/site";

/**
 * The public face of the Vetta Index. The number itself is decided in
 * `public-index.server.ts` — this page renders whatever state it is handed and
 * adds nothing, because a benchmark whose prose lives further upstream than its
 * arithmetic is a benchmark that drifts from itself.
 */

export const Route = createFileRoute("/data")({
  loader: async () => {
    const [{ seoOrigin }, index] = await Promise.all([
      import("@/platform/seo/origin"),
      getPublicIndex().catch(() => null),
    ]);
    return { origin: seoOrigin(), index };
  },
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const index = loaderData?.index ?? null;
    return {
      meta: [
        { title: "The Vetta Index — how long hiring actually takes" },
        {
          name: "description",
          content:
            index?.state === "published"
              ? `${indexCitation(index)} Measured on live Vetta pipelines — median time to shortlist and where hiring loses people, published only when the cohort behind it is big enough to be a market fact.`
              : "The Vetta Index measures median time-to-shortlist on live startup hiring pipelines. It publishes nothing until at least 5 companies, 25 open roles and 50 applications sit inside one 90-day window — an empty page is a floor, not a bug.",
        },
        ...(origin && index?.state === "published"
          ? [{ "script:ld+json": datasetLd(origin, index) }]
          : []),
      ],
      links: origin ? [{ rel: "canonical", href: `${origin}/data` }] : [],
    };
  },
  component: IndexPage,
});

const METHOD = [
  [
    "Start of the clock",
    "The moment an application lands in a workspace — the day the person exists to the company. Not the day someone first opened it, which is the number a vendor can make look good by definition.",
  ],
  [
    "End of the clock",
    "The first event that puts the candidate on a shortlist or anywhere past it: shortlisted, screening, ready, approved or sent. A score alone is not a decision, so it never stops the clock.",
  ],
  [
    "How it's aggregated",
    `Median and quartiles, never a mean. One role left unread for nine weeks is a fact about that role; as an average it silently becomes a fact about Indian hiring.`,
  ],
  [
    "What a cut is",
    `One snapshot per weekly cut, over a rolling ${INDEX_WINDOW_DAYS}-day window of applications. Every figure carries the date it was cut, so a quote from March and a quote from November cannot be mistaken for a trend.`,
  ],
  [
    "When it's withheld",
    `Fewer than ${INDEX_FLOOR.orgs} companies, ${INDEX_FLOOR.roles} roles or ${INDEX_FLOOR.applications} applications in the window, and nothing publishes. A cut older than 30 days is taken out of print even if it cleared. This page has been empty more often than not, on purpose.`,
  ],
  [
    "How it handles erasure",
    "A DPDP erasure rebuilds the snapshot in the same call. A derived statistic that keeps contributing the erased person's application is not a deletion, it is a copy — so the median is recomputed without them, and if the cohort falls under the floor the number leaves the page.",
  ],
] as const;

/** Things we refuse to publish, stated publicly — the promise is the position. */
const NOT_PUBLISHED = [
  [
    "Per-company or per-role numbers",
    "That is a competitor's pipeline, and at three candidates it stops being a statistic and becomes a name.",
  ],
  [
    "Salary bands",
    "Not measured at scale yet. Compensation figures will appear here when enough consented offers carry them, with their own denominator — not before.",
  ],
  [
    "Any accuracy figure for Vetta verdicts",
    "We will not quote a hit rate until at least 500 of our verdicts have a recorded outcome behind them, and we will publish the misses with the hits. Until then: not measured, and nobody should believe a vendor who says otherwise.",
  ],
  [
    "Anything from before the window",
    "The page shows the newest cut only. Digging backwards for the flattering quarter is how benchmarks become folklore.",
  ],
] as const;

function Measure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.16em] text-l-muted">{label}</p>
      <p className="mt-1 font-l-display text-2xl leading-none text-mint">{value}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-l-muted">{detail}</p>
    </div>
  );
}

function PublishedView({ index }: { index: Extract<PublicIndex, { state: "published" }> }) {
  const spread = index.metrics.timeToShortlist;
  const exits = index.metrics.pipelineExits;
  const widest = exits.reduce((max, exit) => Math.max(max, exit.share), 0);

  return (
    <>
      <section
        aria-label="Median time to shortlist"
        className="mt-9 grid gap-5 lg:grid-cols-[1.15fr_1fr]"
      >
        <GlassPanel className="rounded-3xl p-7 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-mint">
              <BarChart3 className="size-4" aria-hidden />
              Applying to shortlisted
            </p>
            <p className="text-xs text-l-muted">
              {index.windowDays}-day window · cut {shortDate(index.builtAt)}
            </p>
          </div>
          <p className="mt-5 font-l-display text-[clamp(2.6rem,6vw,4rem)] leading-none text-l-text">
            {formatDays(spread.medianDays)}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-l-muted">
            The median time a founder took to decide a candidate was worth a conversation. Half the
            shortlists happened in the middle band of{" "}
            <span className="text-l-text">
              {formatDays(spread.q1Days)} to {formatDays(spread.q3Days)}
            </span>
            .
          </p>
          <div className="mt-7 grid gap-6 border-t border-l-hairline pt-6 sm:grid-cols-3">
            <Measure
              label="Measured over"
              value={String(spread.sampleCount)}
              detail="applications that reached a shortlist"
            />
            <Measure
              label="Across"
              value={String(index.cohorts.orgs)}
              detail={`companies · ${index.cohorts.roles} open roles`}
            />
            <Measure
              label="Every pipeline"
              value={String(index.cohorts.applications)}
              detail="applications in the window, shortlisted or not"
            />
          </div>
        </GlassPanel>

        <GlassPanel className="rounded-3xl p-7 sm:p-8">
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-mint">
            <Scale className="size-4" aria-hidden />
            Where pipelines end
          </p>
          <p className="mt-3 text-sm leading-relaxed text-l-muted">
            Every exit Vetta recorded in the window, by the stage the candidate was sitting in when
            the pipeline stopped. This is the half of hiring nobody publishes: most rejections are
            not &ldquo;not good enough&rdquo;, they are &ldquo;never read&rdquo;.
          </p>
          {exits.length === 0 ? (
            <p className="mt-6 rounded-2xl border border-l-hairline px-4 py-3 text-xs leading-relaxed text-l-muted">
              No exits were recorded in this window, so nothing is claimed about them. The stage
              counts start publishing with the next cut that has them.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {exits.map((exit) => (
                <li key={exit.stage || exit.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-l-text/90">{exit.label}</span>
                    <span className="shrink-0 font-l-display text-mint">
                      {exit.share}%
                      <span className="ml-1.5 text-xs text-l-muted">
                        {exit.count} of {exits.reduce((n, e) => n + e.count, 0)}
                      </span>
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 rounded-full bg-l-hairline"
                    role="img"
                    aria-label={`${exit.label}: ${exit.share}% of recorded exits`}
                  >
                    <div
                      className="h-full rounded-full bg-mint/70"
                      style={{ width: `${widest ? (exit.share / widest) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </section>

      <GlassPanel className="mt-5 rounded-3xl p-7">
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-mint">
          <Quote className="size-4" aria-hidden />
          Cite it like this
        </p>
        <blockquote className="mt-4 font-l-display text-base leading-relaxed text-l-text sm:text-lg">
          {indexCitation(index)}
        </blockquote>
        <p className="mt-4 text-xs leading-relaxed text-l-muted">
          Take the whole sentence. A median lifted out of its denominator is the exact artefact this
          page exists to stop.
        </p>
      </GlassPanel>
    </>
  );
}

function HeldView({ index }: { index: Extract<PublicIndex, { state: "not_published" }> }) {
  return (
    <GlassPanel className="mt-9 rounded-3xl p-7 sm:p-9">
      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-mint">
        <ShieldCheck className="size-4" aria-hidden />
        Nothing to publish this week
      </p>
      <p className="mt-5 max-w-3xl font-l-display text-xl leading-snug text-l-text sm:text-2xl">
        {index.message}
      </p>
      <p className="mt-5 max-w-3xl text-sm leading-relaxed text-l-muted">
        An empty page here is a floor, not a bug. The Index exists because founders are told what
        hiring &ldquo;normally&rdquo; takes by people with no data, so ours publishes nothing until
        the cohort behind a figure is large enough that the figure is about the market rather than
        about one company having a slow month. The first cut that clears goes live on this page and
        nowhere else first.
        {index.lastCheckedAt && (
          <>
            {" "}
            Last checked {shortDate(index.lastCheckedAt)}.
          </>
        )}
      </p>
      <div className="mt-7 flex flex-wrap gap-4 border-t border-l-hairline pt-6 text-sm">
        <Link
          to="/teaser"
          search={{ role: "", email: "", tab: "live" }}
          className="inline-flex items-center gap-2 font-semibold text-mint"
        >
          See a live shortlist instead <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link to="/pricing" className="inline-flex items-center gap-2 text-l-text">
          Plans, including pay-only-when-it-hires
        </Link>
      </div>
    </GlassPanel>
  );
}

function IndexPage() {
  const { index } = Route.useLoaderData();

  return (
    <div className="landing min-h-dvh">
      <LandingNav />
      <main className="mx-auto max-w-7xl px-5 pt-14 pb-10 sm:px-8">
        <header className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.22em] text-mint">The Vetta Index</p>
          <h1 className="mt-4 font-l-display text-[clamp(1.8rem,4.4vw,3.2rem)] leading-tight tracking-tight text-l-text">
            How long hiring actually takes, measured on the pipelines we run.
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-l-muted">
            Every &ldquo;average time to hire&rdquo; number in this market comes from a survey of
            people guessing, or from an ATS publishing its own best quarter. This one comes from
            timestamps: when a candidate applied, and when a human first put them on a list. One
            weekly cut, medians only, the denominator printed beside the number, and nothing at all
            published from a cohort too small to be a fact.
          </p>
        </header>

        {index === null ? (
          <GlassPanel className="mt-9 rounded-3xl p-7">
            <p className="text-sm leading-relaxed text-l-muted">
              The Index could not be read just now. That is a fault, not a withheld figure — the
              numbers come from a stored weekly cut, and the page will show it as soon as it can be
              read.
            </p>
          </GlassPanel>
        ) : index.state === "published" ? (
          <PublishedView index={index} />
        ) : (
          <HeldView index={index} />
        )}

        <section aria-label="Methodology" className="mt-14">
          <h2 className="font-l-display text-xl text-l-text">How the number is built</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-l-muted">
            The whole method, because a benchmark you cannot check is a slogan with a decimal point.
            Anyone with a workspace can reproduce these figures from their own export.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {METHOD.map(([title, body]) => (
              <GlassPanel key={title} className="rounded-2xl p-5">
                <p className="text-sm font-semibold text-l-text">{title}</p>
                <p className="mt-2 text-xs leading-relaxed text-l-muted">{body}</p>
              </GlassPanel>
            ))}
          </div>
        </section>

        <section aria-label="What the Index will not publish" className="mt-14">
          <h2 className="font-l-display text-xl text-l-text">
            What the Index will not tell you
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-l-muted">
            Written down before anyone asks, because the list of numbers a publisher refuses is the
            only real evidence that its other numbers are not selected for effect.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {NOT_PUBLISHED.map(([title, body]) => (
              <GlassPanel key={title} className="rounded-2xl border-l-2 border-l-ember/40 p-5">
                <p className="text-sm font-semibold text-l-text">{title}</p>
                <p className="mt-2 text-xs leading-relaxed text-l-muted">{body}</p>
              </GlassPanel>
            ))}
          </div>
        </section>

        <p className="mt-12 text-xs leading-relaxed text-l-muted">
          Aggregate figures only. No application, candidate, company or role is identifiable in
          anything published here, and no free text written by a recruiter about a person ever
          reaches this page — only stage names from Vetta&rsquo;s own vocabulary.
        </p>
      </main>

      <div className="pt-8">
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
