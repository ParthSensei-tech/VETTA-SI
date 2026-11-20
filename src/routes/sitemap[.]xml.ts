import { createFileRoute } from "@tanstack/react-router";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Request-time sitemap (never build-time): open roles change as recruiters
 * post and close them, so the list is read per request and cached for an hour.
 */
async function sitemap(): Promise<Response> {
  const [{ seoOrigin }, { listOpenJobs }] = await Promise.all([
    import("@/platform/seo/origin"),
    import("@/features/people/api/portal"),
  ]);
  const origin = seoOrigin();
  if (!origin) {
    return new Response("Sitemap unavailable: public origin is not configured.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const jobs = await listOpenJobs().catch(() => []);
  const entries = [
    { loc: `${origin}/` },
    { loc: `${origin}/pricing` },
    { loc: `${origin}/teaser` },
    { loc: `${origin}/data` },
    { loc: `${origin}/jobs` },
    { loc: `${origin}/compare/naukri` },
    { loc: `${origin}/compare/linkedin` },
    { loc: `${origin}/compare/agency` },
    ...jobs.map((job) => ({ loc: `${origin}/jobs/${job.id}`, lastmod: job.postedAt })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${xmlEscape(e.loc)}</loc>${"lastmod" in e && e.lastmod ? `<lastmod>${xmlEscape(e.lastmod)}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => sitemap(),
    },
  },
});