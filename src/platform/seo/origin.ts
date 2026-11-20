import { createIsomorphicFn } from "@tanstack/react-start";
import { publicOrigin } from "@/features/recruiting/domain/origin";

/**
 * Canonical public origin for SEO surfaces (canonical links, sitemap, robots,
 * JSON-LD). Prefers the explicit deploy-time configuration over request
 * headers, so crawlers always see the production host even when the request
 * arrives through a preview proxy or an IP host.
 *
 * Isomorphic because route loaders ship in the client bundle too: the server
 * reads the active request, the client returns "" and `head()` simply omits
 * the origin-derived tags — SSR is where crawlers read them.
 */
function serverOrigin(): string {
  const explicit = process.env.VITE_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // fall through to hostname / request
    }
  }
  const host = process.env.VITE_PUBLIC_HOSTNAME?.trim();
  if (host) return `https://${host}`;
  return publicOrigin();
}

export const seoOrigin = createIsomorphicFn()
  .server(serverOrigin)
  .client((): string => "");
