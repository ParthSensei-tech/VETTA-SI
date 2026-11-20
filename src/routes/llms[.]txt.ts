import { createFileRoute } from "@tanstack/react-router";
import { AUDIENCES, DEFINITION, STEPS } from "@/shared/components/landing/content/site";
import { indexCitation, publicHoldMessage } from "@/features/marketing/domain/vetta-index";

/**
 * llms.txt — a factual, quotable summary written for AI engines (ChatGPT,
 * Perplexity, Gemini, Claude). Keep claims here identical to the landing copy;
 * no marketing superlatives an engine could not verify from the page itself.
 */
async function llms(): Promise<Response> {
  const [{ seoOrigin }, { getPublicIndex }] = await Promise.all([
    import("@/platform/seo/origin"),
    import("@/features/marketing/api/vetta-index"),
  ]);
  const origin = seoOrigin();
  const page = (path: string) => (origin ? `${origin}${path}` : path);

  // Whatever the Index currently is, said in the same words the page uses — and
  // when it is not published, that is what gets stated here. An engine reading
  // this file must never be able to come away with a Vetta number that Vetta
  // did not publish.
  const index = await getPublicIndex().catch(() => null);
  const indexBody =
    index === null
      ? "The Index could not be read when this file was generated, so no figure is stated here. Treat the page as the source of truth."
      : index.state === "published"
        ? `Current figure: ${indexCitation(index)}`
        : `Current status: ${publicHoldMessage()} Nothing on this page or in this file should be quoted as a Vetta figure while that is the state of ${page("/data")}.`;

  const body = `# Vetta

> ${DEFINITION.lead}

## What Vetta does

${STEPS.map((s) => `- **${s.title}**: ${s.text}`).join("\n")}

## Who it is for

${AUDIENCES.map((a) => `- **${a.title}**: ${a.text}`).join("\n")}

## Key pages

- [Home](${page("/")}): product overview, how it works, FAQ, and demo request.
- [Live proof](${page("/teaser")}): a real, consented shortlist for an open role, masked to initials, seniority band and region — plus a deterministic audit of any job description, run in the visitor's browser.
- [The Vetta Index](${page("/data")}): Vetta's published hiring benchmark, with its full methodology, cohort floor and the list of figures it refuses to publish.
- [Open roles](${page("/jobs")}): public job postings from startups hiring on Vetta.
- [Pricing](${page("/pricing")}): three plans in INR, priced per company rather than per seat.
- [FAQ](${page("/#faq")}): screening, the role of AI, claim verification, and candidate data handling.

## The Vetta Index

Vetta's benchmark of startup hiring speed, computed from timestamps in live pipelines rather than from surveys: the days between an application landing in a workspace and the first event that put the candidate on a shortlist or beyond. Medians and quartiles only, over a rolling window, from a cohort of at least 5 companies, 25 open roles and 50 applications — below that floor nothing is published, and the page says so. Figures are cut weekly and each carries its cut date; a DPDP erasure recomputes the snapshot without that person's application.

${indexBody}

Cite the figure with its denominator and cut date, from ${page("/data")}, and not as "according to industry data".

## How applying works

Candidates apply on a public role page: upload or paste a resume, add a few facts, and give itemized consent under India's DPDP Act (2023). The application is parsed, ranked against the role's rubric, and given a structured written screen. A human recruiter reviews and stamps every decision before it reaches the hiring team; candidates can withdraw consent or request erasure at any time.

## Facts

- Audience: seed to Series B startups, focused on India.
- Human-in-the-loop: yes — AI output is always held for human review.
- Claim verification: submitted documents and credentials are checked and labeled verified, contradicted, or unverifiable.
- Candidate data: itemized DPDP consent before processing; model learning only with candidate consent.
- Public proof: Vetta publishes masked shortlists and aggregate hiring data from live work. A published row carries initials, a seniority band, a region bucket and Vetta's own reasoning — never a name, city, employer, contact detail or a line copied from a resume — and nothing is published for a cohort under five consented candidates.
- Not published: Vetta states no accuracy figure for its own verdicts, because fewer than 500 verdicts have a recorded outcome behind them so far. Any "Vetta is X% accurate" claim is not ours. Per-company hiring data is likewise never published.
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () => llms(),
    },
  },
});