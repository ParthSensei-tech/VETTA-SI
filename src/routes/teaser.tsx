import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Lock, ScanLine, ShieldCheck, Sparkles } from "lucide-react";
import { getTeaser, getTeaserBoard, unlockTeaser } from "@/features/marketing/api/teaser";
import { getStoredUtm } from "@/platform/telemetry/utm";
import { auditJobDescription, MAX_JD_CHARS, type JdAudit } from "@/features/marketing/domain/jd-audit";
import {
  TEASER_PRIVACY_NOTE,
  UNLOCK_ASK,
  type TeaserResult,
  type TeaserRowView,
} from "@/features/marketing/domain/teaser";
import { GlassPanel } from "@/shared/components/landing/ui/primitives";
import { LandingNav } from "@/shared/components/landing/nav";
import { DemoCta } from "@/shared/components/landing/sections/demo-cta";
import { FOOTER } from "@/shared/components/landing/content/site";

const EMAIL_KEY = "vetta.teaserEmail";

const LEVEL_LABEL: Record<string, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

const SAMPLE_JD = `Senior Backend Engineer — Series A fintech, Bengaluru (sample text, written by us to show what the audit catches)

We are hiring a senior backend engineer to own our ledger service.

Requirements:
- Must have 5-8 years of experience building distributed systems
- Strong command of Node.js, TypeScript and PostgreSQL
- Hands-on experience with AWS and Kubernetes
- Must have worked on payments, reconciliation or ledgers
- Minimum qualifications: B.Tech in Computer Science
- Excellent communication skills and ability to work in a fast-paced environment
- Should be comfortable wearing many hats

Nice to have:
- Familiarity with Kafka
- Exposure to React for internal tooling

What you'll do:
- Own the settlement pipeline end to end
- Partner with product and compliance on new markets
`;

export const Route = createFileRoute("/teaser")({
  validateSearch: (search: Record<string, unknown>) => ({
    role: typeof search.role === "string" ? search.role.slice(0, 80) : "",
    email: typeof search.email === "string" && search.email.includes("@") ? search.email.slice(0, 254) : "",
    tab: search.tab === "audit" ? ("audit" as const) : ("live" as const),
  }),
  loader: async () => {
    const [{ seoOrigin }, board] = await Promise.all([
      import("@/platform/seo/origin"),
      getTeaserBoard().catch(() => null),
    ]);
    return { origin: seoOrigin(), board };
  },
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    return {
      meta: [
        { title: "Teaser — Vetta | A real shortlist, with the names left off" },
        {
          name: "description",
          content:
            "Vetta publishes a live shortlist for open roles — ranked, evidence-traced and masked to initials, region and seniority band. No name, city, employer or resume line ever appears. Or paste your job description for a free audit of what it can actually grade.",
        },
      ],
      links: origin ? [{ rel: "canonical", href: `${origin}/teaser` }] : [],
    };
  },
  component: TeaserPage,
});

function RowCard({ row }: { row: TeaserRowView }) {
  return (
    <GlassPanel className="rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <span className="font-l-display text-lg text-l-text">{row.handle}</span>
          <span className="text-xs text-l-muted">
            {[row.seniority, row.region, row.experience].filter(Boolean).join(" · ")}
          </span>
        </div>
        <span className="flex items-center gap-2">
          <span className="text-xs text-l-muted">{LEVEL_LABEL[row.level ?? ""] ?? "Verdict"}</span>
          <span className="rounded-full border border-mint/40 px-2.5 py-0.5 font-l-display text-sm text-mint">
            {row.score ?? "—"}
          </span>
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {row.bullets.map((bullet, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-l-text/90">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-mint" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      {row.probe && (
        <p className="mt-3 border-t border-l-hairline pt-3 text-xs leading-relaxed text-l-muted">
          <span className="font-semibold text-l-text">Still to probe:</span> {row.probe}
        </p>
      )}
    </GlassPanel>
  );
}

type UnlockAsk = { email: string; name: string; company: string; marketingOptIn: boolean };

function UnlockForm({
  onUnlocked,
  busyLabel,
  ask = UNLOCK_ASK,
  hint,
  thanks,
}: {
  onUnlocked: (input: UnlockAsk) => Promise<void>;
  busyLabel: string;
  ask?: string;
  hint?: string;
  /** What the page says once the lead is written. A form with no reply is a form nobody trusts. */
  thanks: (email: string) => string;
}) {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(EMAIL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");

  if (done) {
    return (
      <p role="status" className="flex items-start gap-2.5 text-sm leading-relaxed text-mint">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{thanks(done)}</span>
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.includes("@")) {
          setNote("That email will not reach you.");
          return;
        }
        setBusy(true);
        setNote("");
        try {
          const input = { email: email.trim(), name: name.trim(), company: company.trim(), marketingOptIn: optIn };
          await onUnlocked(input);
          setDone(input.email);
        } catch (error) {
          setNote(error instanceof Error ? error.message : "Could not unlock that right now.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@startup.com"
          aria-label="Your email"
          className="rounded-xl border border-l-hairline bg-l-bg/60 px-3.5 py-2.5 text-sm text-l-text outline-none transition-colors placeholder:text-l-muted/70 focus:border-mint/60"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          aria-label="Your name"
          className="rounded-xl border border-l-hairline bg-l-bg/60 px-3.5 py-2.5 text-sm text-l-text outline-none transition-colors placeholder:text-l-muted/70 focus:border-mint/60"
        />
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company (optional)"
          aria-label="Your company"
          className="rounded-xl border border-l-hairline bg-l-bg/60 px-3.5 py-2.5 text-sm text-l-text outline-none transition-colors placeholder:text-l-muted/70 focus:border-mint/60"
        />
      </div>
      <label className="flex items-start gap-2 text-xs leading-relaxed text-l-muted">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
          className="mt-0.5 size-3.5 shrink-0 accent-mint"
        />
        Also send me the weekly Vetta Index. Stored as a dated yes, and one reply unsubscribes.
      </label>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-l-bg transition-opacity disabled:opacity-60"
      >
        {busy ? busyLabel : ask}
        {!busy && <ArrowRight className="size-4" aria-hidden />}
      </button>
      {hint && <p className="text-xs leading-relaxed text-l-muted">{hint}</p>}
      {note && <p className="text-xs text-ember">{note}</p>}
    </form>
  );
}

function LiveTeaser({
  roleId,
  emailParam,
  onUnlocked,
}: {
  roleId: string;
  emailParam: string;
  onUnlocked: (roleId: string, input: UnlockAsk) => Promise<void>;
}) {
  const [result, setResult] = useState<TeaserResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    getTeaser({ data: { roleId, ...(emailParam ? { email: emailParam } : {}) } })
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [roleId, emailParam]);

  if (failed) return <p className="text-sm text-l-muted">That shortlist could not be read. Try another role.</p>;
  if (!result) return <p className="animate-pulse text-sm text-l-muted">Reading the shortlist…</p>;

  if (result.state !== "ready") {
    return (
      <GlassPanel className="rounded-2xl p-6">
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-l-text/90">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
          {result.message}
        </p>
        <Link
          to="/signup"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-mint"
        >
          Run this on your own role <ArrowRight className="size-4" aria-hidden />
        </Link>
      </GlassPanel>
    );
  }

  const { role } = result;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-l-display text-xl text-l-text">{role.title}</h2>
          <p className="mt-1 text-xs text-l-muted">
            {role.companyName} · {role.location || "Location not stated"} ·{" "}
            {role.compensationBand || "Band private"}
          </p>
        </div>
        <p className="text-xs text-l-muted">
          {result.shortlistSize} consented candidates ranked ·{" "}
          {result.unlocked ? "full list" : `top ${result.rows.length} shown`} · refreshed every 5 minutes
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {result.rows.map((row, i) => (
          <RowCard key={`${row.handle}-${i}`} row={row} />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-l-muted">
        A score is Vetta&rsquo;s read of the paper against the JD&rsquo;s own requirements — what it found
        evidence for, and what it did not. It is not a promise about a person, and the workspace that
        hired sees the evidence behind every line here.
      </p>

      {!result.unlocked && (
        <GlassPanel className="rounded-2xl p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-l-text">
            <Lock className="size-4 text-mint" aria-hidden />
            {result.hiddenRows > 0
              ? `${result.hiddenRows} more shortlisted, plus every verdict's evidence trail`
              : "The evidence trail and the probe list, in full"}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-l-muted">
            Still masked — the full list is more rows, more reasons and the follow-up each screen needs,
            not the names.
          </p>
          <div className="mt-4">
            <UnlockForm
              busyLabel="Unlocking…"
              thanks={() => "Unlocked above — more rows, more reasons, the probe list. Still masked."}
              onUnlocked={(input) => onUnlocked(role.id, input)}
            />
          </div>
        </GlassPanel>
      )}
      {result.unlocked && (
        <p className="text-xs text-mint">
          Unlocked for {emailParam} — the full masked shortlist is above.
        </p>
      )}
    </div>
  );
}

function AuditTeaser({ onUnlocked }: { onUnlocked: (input: UnlockAsk) => Promise<void> }) {
  const [jd, setJd] = useState("");
  const [audit, setAudit] = useState<JdAudit | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value.slice(0, MAX_JD_CHARS))}
          rows={10}
          placeholder="Paste the job description you are hiring for. It is read in this tab, in your browser — nothing is sent to us and nothing is stored."
          aria-label="Job description to audit"
          className="w-full resize-y rounded-2xl border border-l-hairline bg-l-bg/60 p-4 text-sm leading-relaxed text-l-text outline-none transition-colors placeholder:text-l-muted/70 focus:border-mint/60"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={jd.trim().length < 80}
            onClick={() => setAudit(auditJobDescription(jd))}
            className="inline-flex items-center gap-2 rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-l-bg transition-opacity disabled:opacity-40"
          >
            <ScanLine className="size-4" aria-hidden />
            Audit it
          </button>
          <button
            type="button"
            onClick={() => {
              setJd(SAMPLE_JD);
              setAudit(auditJobDescription(SAMPLE_JD));
            }}
            className="text-xs text-l-muted underline decoration-l-hairline underline-offset-4 transition-colors hover:text-l-text"
          >
            Use a sample JD
          </button>
          {jd.trim().length > 0 && (
            <span className="text-xs text-l-muted">{jd.trim().length} characters read locally</span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-l-muted">
          This half of the teaser is a deterministic read of your own text — no model, no benchmark, no
          number we could get wrong. Everything below is either a line you wrote or a thing your JD does
          not say.
        </p>
      </div>

      {audit && (
        <div className="flex flex-col gap-3">
          <GlassPanel className="rounded-2xl p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-mint">What a screener can grade today</p>
            <ul className="mt-3 flex flex-col gap-2">
              {audit.gradedOn.length ? (
                audit.gradedOn.map((item, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-l-text/90">
                    <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-mint" />
                    <span>{item}</span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-l-muted">
                  Nothing yet — this JD states no requirement a resume can be checked against.
                </li>
              )}
            </ul>
            <p className="mt-4 border-t border-l-hairline pt-3 text-xs text-l-muted">
              Read: {audit.linesRead} lines · seniority implied: {audit.seniority} ·{" "}
              {audit.years ? `experience asked: ${audit.years}` : "no experience range"} ·{" "}
              {audit.workMode ?? "work mode not stated"}
            </p>
          </GlassPanel>

          {audit.vagueDemands.length > 0 && (
            <GlassPanel className="rounded-2xl p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-ember">Grades nothing, as written</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {audit.vagueDemands.map((phrase) => (
                  <span
                    key={phrase}
                    className="rounded-full border border-l-hairline px-3 py-1 text-xs text-l-muted"
                  >
                    &ldquo;{phrase}&rdquo;
                  </span>
                ))}
              </div>
            </GlassPanel>
          )}

          {audit.gaps.length > 0 && (
            <GlassPanel className="rounded-2xl p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-mint">Undecided, and therefore gut-called</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {audit.gaps.map((gap, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-l-text/90">
                    <ArrowRight className="mt-1 size-3.5 shrink-0 text-mint" aria-hidden />
                    <span>{gap}</span>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}

          {audit.niceToHaves.length > 0 && (
            <p className="text-xs leading-relaxed text-l-muted">
              Optional, from your text: {audit.niceToHaves.join(" · ")}
            </p>
          )}

          <GlassPanel className="rounded-2xl p-6">
            <p className="text-sm font-semibold text-l-text">
              Want this built into a rubric you can actually run?
            </p>
            <div className="mt-4">
              <UnlockForm
                busyLabel="Sending…"
                ask="Have the founder build it for me"
                thanks={(mail) => `Noted — a person, not an autoresponder, replies to ${mail}.`}
                hint="Nothing you pasted reaches us — this tab reads your job description in your browser and stores no copy of it. So this is a person-to-person ask: leave the address, and a human replies to start."
                onUnlocked={onUnlocked}
              />
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}

function TeaserPage() {
  const { role: roleParam, email: emailParam, tab: tabParam } = Route.useSearch();
  const { board } = Route.useLoaderData();
  const [tab, setTab] = useState<"live" | "audit">(tabParam);
  const [selected, setSelected] = useState(roleParam);
  const [unlockedEmail, setUnlockedEmail] = useState(emailParam);

  const roles = board?.roles ?? [];
  const activeRole = selected || roles[0]?.id || "";

  useEffect(() => {
    if (!activeRole && roles[0]) setSelected(roles[0].id);
  }, [activeRole, roles]);

  async function unlock(roleId: string, input: UnlockAsk) {
    const utm = getStoredUtm();
    await unlockTeaser({
      data: {
        roleId,
        ...input,
        utmSource: utm?.utm_source || "",
        utmMedium: utm?.utm_medium || "",
        utmCampaign: utm?.utm_campaign || "",
        utmTerm: utm?.utm_term || "",
        utmContent: utm?.utm_content || "",
        initialReferrer: utm?.initial_referrer || "",
      },
    });
    try {
      localStorage.setItem(EMAIL_KEY, input.email);
    } catch {
      /* private mode: the unlock still works, it just does not survive a reload */
    }
    setUnlockedEmail(input.email);
  }

  return (
    <div className="landing min-h-dvh">
      <LandingNav />
      <main className="mx-auto max-w-5xl px-5 pt-14 pb-20 sm:px-8">
        <header className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.22em] text-mint">The teaser</p>
          <h1 className="mt-4 font-l-display text-[clamp(1.7rem,4.2vw,3rem)] leading-tight tracking-tight text-l-text">
            A real shortlist, with the names left off.
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-l-muted">
            This is Vetta&rsquo;s work, not a mockup: a shortlist built for a role that is open right now,
            ranked from applications whose owners consented to their profile being seen outside the
            workspace hiring for it. We publish the judgement — the ranking, the reasons, what still needs
            probing — and withhold the identity. Give us a look at your role and we will show you yours.
          </p>
        </header>

        {(board?.openRoles ?? 0) > 0 && (
          <p className="mt-6 flex flex-wrap items-center gap-2 text-xs text-l-muted">
            <Sparkles className="size-3.5 text-mint" aria-hidden />
            {board!.openRoles} {board!.openRoles === 1 ? "role is" : "roles are"} open on Vetta right now
            {board!.unlocksThisWeek > 0 && (
              <>
                <span aria-hidden>·</span>
                {board!.unlocksThisWeek} founders unlocked a shortlist this week
              </>
            )}
          </p>
        )}

        <div className="mt-8 flex gap-2 border-b border-l-hairline pb-3">
          {(
            [
              ["live", "A live Vetta shortlist"],
              ["audit", "Audit the JD you're hiring for"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={
                tab === key
                  ? "rounded-full bg-mint/15 px-4 py-1.5 text-xs font-semibold text-mint"
                  : "rounded-full border border-transparent px-4 py-1.5 text-xs text-l-muted transition-colors hover:text-l-text"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "live" && (
          <>
            {roles.length === 0 ? (
              <GlassPanel className="mt-6 rounded-2xl p-6">
                <p className="text-sm leading-relaxed text-l-text/90">
                  No role is open on Vetta at this moment, so there is nothing honest to show yet. The
                  audit tab works right now on your own job description — and the first live shortlists go
                  up as soon as a workspace publishes one.
                </p>
                <button
                  type="button"
                  onClick={() => setTab("audit")}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-mint"
                >
                  Audit a JD instead <ArrowRight className="size-4" aria-hidden />
                </button>
              </GlassPanel>
            ) : (
              <div className="mt-6 flex flex-wrap gap-2">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelected(role.id)}
                    className={
                      role.id === activeRole
                        ? "rounded-full border border-mint/60 bg-mint/10 px-3.5 py-1.5 text-xs text-l-text"
                        : "rounded-full border border-l-hairline px-3.5 py-1.5 text-xs text-l-muted transition-colors hover:border-mint/40 hover:text-l-text"
                    }
                  >
                    {role.title} · {role.location || "India"}
                  </button>
                ))}
              </div>
            )}
            {/* The empty board is the only state where there is nothing to read,
                so the reader is not rendered beside it — a page that says "no
                role is open" and "pick a role above" contradicts itself. */}
            {roles.length > 0 && (
              <div className="mt-6">
                <LiveTeaser
                  roleId={activeRole}
                  emailParam={unlockedEmail}
                  onUnlocked={unlock}
                />
              </div>
            )}
          </>
        )}

        {tab === "audit" && (
          <div className="mt-6">
            <AuditTeaser onUnlocked={(input) => unlock("", input)} />
          </div>
        )}

        <GlassPanel className="mt-10 rounded-2xl p-6">
          <p className="flex items-start gap-2.5 text-xs leading-relaxed text-l-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
            {TEASER_PRIVACY_NOTE}
          </p>
          <Link to="/pricing" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-mint">
            Plans, including pay-only-when-it-hires <ArrowRight className="size-4" aria-hidden />
          </Link>
        </GlassPanel>
      </main>

      <div className="pt-4">
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
