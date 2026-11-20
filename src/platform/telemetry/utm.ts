/**
 * Universal UTM Tracking & Attribution Engine
 *
 * Captures, normalizes, and persists inbound marketing campaigns, candidate sources,
 * and referral tokens across the Vetta platform.
 * Supports first-touch and last-touch attribution via localStorage and first-party cookies.
 */

export interface UtmAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  ref?: string;
  gclid?: string;
  initial_referrer?: string;
  landing_path?: string;
  captured_at?: string;
  touch_count?: number;
}

export const STORAGE_KEY_FIRST_TOUCH = "vetta_utm_first_touch";
export const STORAGE_KEY_LAST_TOUCH = "vetta_utm_last_touch";
export const COOKIE_NAME_UTM = "vetta_utm";

/**
 * Parses UTM parameters and referral information from a search query string.
 */
export function parseUtmFromSearch(
  search: string,
  referrer: string = "",
  pathname: string = "/",
): UtmAttribution | null {
  if (!search && !referrer) return null;

  const normalized = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalized);

  const utm_source = params.get("utm_source")?.trim();
  const utm_medium = params.get("utm_medium")?.trim();
  const utm_campaign = params.get("utm_campaign")?.trim();
  const utm_term = params.get("utm_term")?.trim();
  const utm_content = params.get("utm_content")?.trim();
  const ref = params.get("ref")?.trim();
  const gclid = params.get("gclid")?.trim();

  // If no marketing params exist, return null
  if (!utm_source && !utm_medium && !utm_campaign && !utm_term && !utm_content && !ref && !gclid) {
    return null;
  }

  const attribution: UtmAttribution = {
    utm_source: utm_source || undefined,
    utm_medium: utm_medium || undefined,
    utm_campaign: utm_campaign || undefined,
    utm_term: utm_term || undefined,
    utm_content: utm_content || undefined,
    ref: ref || undefined,
    gclid: gclid || undefined,
    initial_referrer: referrer ? sanitizeReferrer(referrer) : undefined,
    landing_path: pathname || "/",
    captured_at: new Date().toISOString(),
    touch_count: 1,
  };

  return attribution;
}

function sanitizeReferrer(ref: string): string {
  try {
    const url = new URL(ref);
    return url.origin;
  } catch {
    return ref.slice(0, 100);
  }
}

/**
 * Persists attribution to browser localStorage and cookie.
 */
export function persistUtm(attribution: UtmAttribution): void {
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    // 1. First-touch preservation (never overwritten once set)
    const existingFirst = window.localStorage.getItem(STORAGE_KEY_FIRST_TOUCH);
    if (!existingFirst) {
      window.localStorage.setItem(STORAGE_KEY_FIRST_TOUCH, JSON.stringify(attribution));
    }

    // 2. Last-touch update
    const prevLastRaw = window.localStorage.getItem(STORAGE_KEY_LAST_TOUCH);
    let touchCount = 1;
    if (prevLastRaw) {
      try {
        const prev = JSON.parse(prevLastRaw) as UtmAttribution;
        touchCount = (prev.touch_count || 1) + 1;
      } catch {
        // Ignore parse error
      }
    }

    const lastTouchData: UtmAttribution = {
      ...attribution,
      touch_count: touchCount,
    };
    window.localStorage.setItem(STORAGE_KEY_LAST_TOUCH, JSON.stringify(lastTouchData));

    // 3. First-party cookie for SSR / API access
    const cookieValue = encodeURIComponent(
      JSON.stringify({
        source: lastTouchData.utm_source || "",
        campaign: lastTouchData.utm_campaign || "",
        medium: lastTouchData.utm_medium || "",
      }),
    );
    document.cookie = `${COOKIE_NAME_UTM}=${cookieValue}; Path=/; Max-Age=2592000; SameSite=Lax`;
  } catch {
    // Storage access may fail in private windows, safely ignore
  }
}

/**
 * Reads active stored attribution. Prefers last-touch, falls back to first-touch.
 */
export function getStoredUtm(): UtmAttribution | null {
  if (typeof window === "undefined" || !window.localStorage) return null;

  try {
    const lastRaw = window.localStorage.getItem(STORAGE_KEY_LAST_TOUCH);
    if (lastRaw) return JSON.parse(lastRaw) as UtmAttribution;

    const firstRaw = window.localStorage.getItem(STORAGE_KEY_FIRST_TOUCH);
    if (firstRaw) return JSON.parse(firstRaw) as UtmAttribution;
  } catch {
    return null;
  }
  return null;
}

/**
 * Appends trackable UTM query parameters to an outbound or shareable link.
 */
export function buildShareableUrl(baseUrl: string, utm: Partial<UtmAttribution>): string {
  try {
    const url = new URL(baseUrl, typeof window !== "undefined" ? window.location.origin : "https://vetta.ai");
    if (utm.utm_source) url.searchParams.set("utm_source", utm.utm_source);
    if (utm.utm_medium) url.searchParams.set("utm_medium", utm.utm_medium);
    if (utm.utm_campaign) url.searchParams.set("utm_campaign", utm.utm_campaign);
    if (utm.utm_content) url.searchParams.set("utm_content", utm.utm_content);
    if (utm.utm_term) url.searchParams.set("utm_term", utm.utm_term);
    if (utm.ref) url.searchParams.set("ref", utm.ref);
    return url.toString();
  } catch {
    return baseUrl;
  }
}
