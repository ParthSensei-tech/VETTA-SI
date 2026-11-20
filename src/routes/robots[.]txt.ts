import { createFileRoute } from "@tanstack/react-router";

/**
 * Public crawling policy. The marketing site and public role pages are open to
 * every crawler — explicitly including the AI engines (GPTBot, PerplexityBot,
 * Google-Extended, ClaudeBot) so Vetta can be cited in AI answers. Authenticated
 * surfaces and tokenized candidate links stay out.
 */
async function robots(): Promise<Response> {
  const { seoOrigin } = await import("@/platform/seo/origin");
  const origin = seoOrigin();
  const lines = [
    "User-agent: *",
    "User-agent: GPTBot",
    "User-agent: PerplexityBot",
    "User-agent: Google-Extended",
    "User-agent: ClaudeBot",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "Disallow: /apply/",
    "Disallow: /screen/",
    "Disallow: /share/",
    "Disallow: /portal/",
  ];
  if (origin) lines.push("", `Sitemap: ${origin}/sitemap.xml`);
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => robots(),
    },
  },
});