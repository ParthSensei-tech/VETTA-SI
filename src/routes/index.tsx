import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { Button } from "@/shared/components/ui/button";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { UserMenu } from "@/shared/components/user-menu";
import { VettaMark, VettaWordmark } from "@/shared/components/vetta-mark";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  const ctaTo = !isPending && user ? "/app" : "/login";
  const ctaLabel = !isPending && user ? "Open workspace" : "Sign in to Vetta";

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <VettaWordmark />
        <div className="flex items-center gap-1 sm:gap-3">
          <Link
            to="/jobs"
            className="hidden text-sm text-muted transition-colors duration-150 hover:text-fg sm:inline"
          >
            Open roles
          </Link>
          <ThemeToggle className="size-11 min-w-11 px-0 sm:min-w-0 sm:px-3" />
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24">
        <section className="vetta-enter grid gap-12 pt-10 pb-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <p className="text-xs tracking-[0.22em] text-muted uppercase">
              Seed — Series B · India
            </p>
            <h1 className="mt-4 font-display text-[clamp(2.6rem,6vw,5.2rem)] leading-[0.95] tracking-tight">
              Resume in.
              <br />
              Ranked slate out.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted">
              AI-native technical recruiting for early-stage teams. Vetta ranks every resume against
              the role — skill, ownership, notice, city — not pedigree theatre. Nothing is
              client-facing until a human stamps it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to={ctaTo}>
                  {ctaLabel}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/jobs">Browse open roles</Link>
              </Button>
            </div>
            <p className="mt-4">
              <a
                href="#how"
                className="text-sm text-muted transition-colors duration-150 hover:text-fg"
              >
                How it works
              </a>
            </p>
          </div>

          <aside className="vetta-enter vetta-enter-delay-2 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <div className="mb-4 flex items-center justify-between text-xs text-muted">
              <span>Held for human review</span>
              <span className="font-mono tabular-nums">03 in queue</span>
            </div>
            <ol className="flex flex-col gap-2">
              {[
                { n: "01", title: "Ranked against the JD", meta: "Score locked · evidence quoted" },
                {
                  n: "02",
                  title: "Async screen evaluated",
                  meta: "Written answers · no live call",
                },
                { n: "03", title: "Client pack drafted", meta: "Waiting on your stamp" },
              ].map((row) => (
                <li
                  key={row.n}
                  className="flex items-center gap-4 rounded-xl bg-elevated px-4 py-3"
                >
                  <span className="font-mono text-xs text-subtle">{row.n}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm">{row.title}</p>
                    <p className="truncate text-xs text-muted">{row.meta}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-subtle">
              Illustration of the gate — your workspace starts empty.
            </p>
          </aside>
        </section>

        <section
          id="how"
          className="grid gap-px overflow-hidden rounded-2xl bg-border md:grid-cols-3"
        >
          {[
            {
              n: "01",
              t: "Open a role",
              d: "Company, stage, city, skills, must-haves, pay band. Any Seed to Series B seat.",
            },
            {
              n: "02",
              t: "Drop resumes",
              d: "One paste or a whole folder. Ranking runs in the background — notice, CTC, fit — without you watching.",
            },
            {
              n: "03",
              t: "Review and send",
              d: "We prep the shortlist and screens. You only approve what the client sees.",
            },
          ].map((s) => (
            <article key={s.n} className="bg-bg px-6 py-8">
              <p className="font-mono text-xs text-subtle">{s.n}</p>
              <h2 className="mt-3 font-display text-2xl">{s.t}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">{s.d}</p>
            </article>
          ))}
        </section>

        <section className="mt-20 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl tracking-tight">Built for the first TA hire.</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Founding CTOs and recruiters at Seed to Series B companies do not need an ATS. They
              need a ranked shortlist they can defend, a written screen that does not eat a
              calendar, and a hard gate so a half-baked note never lands in a founder’s inbox.
            </p>
          </div>
          <ul className="flex flex-col gap-4 text-sm leading-relaxed text-muted">
            <li>
              <span className="text-fg">Skill first.</span> Pedigree is a weak prior. The model is
              instructed not to theatre IIT or FAANG.
            </li>
            <li>
              <span className="text-fg">India-native.</span> Notice periods, LPA bands, Bengaluru /
              Hyd / Pune / remote-India, ESOP literacy.
            </li>
            <li>
              <span className="text-fg">Human-gated.</span> Approvals are a first-class queue, not a
              checkbox buried in a send dialog.
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-subtle">
          <span className="inline-flex items-center gap-2">
            <VettaMark className="size-3.5" />
            Vetta
          </span>
          <nav className="flex items-center gap-4">
            <Link to="/jobs" className="hover:text-fg">
              Open roles
            </Link>
            <Link to="/login" className="hover:text-fg">
              Recruiter sign in
            </Link>
          </nav>
          <span>Technical recruiting for India’s early-stage teams</span>
        </div>
      </footer>
    </div>
  );
}
