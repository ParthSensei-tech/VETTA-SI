/**
 * Client-readable marker for gate-materialized sessions (zero-click identity
 * sessions minted by `gate-session.server.ts`). Signing out of a gate session
 * is a no-op — the next request re-materializes it from `x-gate-identity` — so
 * `UserButton` uses this to hide its sign-out control.
 * `__Host-` prefixed like the other auth cookies: browsers reject a `__Host-`
 * cookie carrying a `Domain`, preventing cookie spoofing across sibling domains.
 * Client-safe: no server imports.
 */
export const GATE_SESSION_MARKER_COOKIE = "gate_session";

export function hasGateSessionMarker(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((pair) => pair.trim().startsWith(`${GATE_SESSION_MARKER_COOKIE}=`));
}
