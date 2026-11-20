import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { parseUtmFromSearch, persistUtm } from "./utm.ts";

/**
 * Invisible component mounted at the application root.
 * Listens to location changes, captures UTM parameters and initial referrer,
 * and writes them into durable storage.
 */
export function UtmTracker() {
  const location = useRouterState({ select: (s) => s.location });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const search = window.location.search || location.searchStr || "";
    const referrer = document.referrer || "";
    const pathname = window.location.pathname || location.pathname || "/";

    const parsed = parseUtmFromSearch(search, referrer, pathname);
    if (parsed) {
      persistUtm(parsed);
    }
  }, [location.pathname, location.searchStr]);

  return null;
}
