/**
 * Default OAuth client and host definitions.
 */
export const PREVIEW_CLIENT_ID = process.env.AUTH_CLIENT_ID || "";
export const PREVIEW_CLIENT_SECRET = process.env.AUTH_CLIENT_SECRET || "";
export const OAUTH_ISSUER_DEFAULT = process.env.AUTH_ISSUER || "";
export const PREVIEW_ALLOWED_HOSTS = ["localhost", "127.0.0.1"] as const;
