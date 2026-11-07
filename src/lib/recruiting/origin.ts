import { getRequest } from "@tanstack/react-start/server";
import { sharePath, screenPath } from "../../features/people/domain/links";

function originFromUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

export function publicOrigin(): string {
  try {
    const req = getRequest();
    if (!req) return "";

    const fromOrigin = originFromUrl(req.headers.get("origin"));
    if (fromOrigin) return fromOrigin;

    const fromReferer = originFromUrl(req.headers.get("referer"));
    if (fromReferer) return fromReferer;

    const xf = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    let host = (xf || req.headers.get("host") || "").trim();
    if (!host) host = originFromUrl(req.url).replace(/^https?:\/\//, "");
    if (!host) {
      try {
        host = new URL(req.url).host;
      } catch {
        return "";
      }
    }
    if (!host) return "";
    const protoHeader = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto =
      protoHeader ||
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}

export function absoluteUrl(path: string): string {
  const origin = publicOrigin();
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!origin) return normalized;
  return `${origin}${normalized}`;
}

export function shareUrl(token: string): string {
  return absoluteUrl(sharePath(token));
}

export function screenUrl(token: string): string {
  return absoluteUrl(screenPath(token));
}
