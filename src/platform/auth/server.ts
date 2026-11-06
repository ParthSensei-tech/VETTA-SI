/**
 * Self-hosted Better Auth for Vetta (server-only).
 *
 * Supports:
 * - Local & Production Email/Password authentication out of the box
 * - OAuth authentication via environment configuration
 * - Persistent sessions in PostgreSQL when DATABASE_URL is set, or in embedded PGLite
 */
import { betterAuth } from "better-auth";
import { bearer, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { emailAndPasswordEnabled } from "./email-password";
import { GATE_PROVIDER_ID, gateIdentitySessions } from "./gate-session.server";
import { SOCIAL_PROVIDERS } from "./providers";
import { pgliteDialect } from "./pglite-dialect";
import {
  OAUTH_ISSUER_DEFAULT,
  PREVIEW_ALLOWED_HOSTS,
  PREVIEW_CLIENT_ID,
  PREVIEW_CLIENT_SECRET,
} from "./preview";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/**
 * Preview secret stored on globalThis so HMR does not invalidate sessions mid-dev.
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __authSecret__?: string;
};
function localAuthSecret(): string {
  globalAuthRef.__authSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__authSecret__;
}

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

// Explicit off-switch if someone wants to bypass auth completely for dev.
const authDisabled = env("VITE_AUTH_ENABLED") === "false";

// Optional external OAuth broker creds
const oauthIssuer = env("OAUTH_ISSUER") ?? OAUTH_ISSUER_DEFAULT;
const oauthClientId = env("OAUTH_CLIENT_ID");
const oauthClientSecret = env("OAUTH_CLIENT_SECRET");

/** True when authentication is enabled (default true). */
export const authConfigured = !authDisabled;

const explicitBaseURL = env("BETTER_AUTH_URL");
const previewAllowedHosts: string[] = [...PREVIEW_ALLOWED_HOSTS];

const localPort = env("PORT") || "3000";
const LOCAL_DEV_ORIGINS: string[] = [
  `http://localhost:${localPort}`,
  `http://127.0.0.1:${localPort}`,
  `http://[::1]:${localPort}`,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const baseURL = explicitBaseURL ?? {
  allowedHosts: [...previewAllowedHosts, "localhost", "127.0.0.1", "[::1]"],
  protocol: "auto" as const,
  fallback: `http://localhost:${localPort}`,
};

const trustedOrigins: string[] = explicitBaseURL
  ? [explicitBaseURL, ...LOCAL_DEV_ORIGINS]
  : [
      ...previewAllowedHosts,
      ...previewAllowedHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
      ...LOCAL_DEV_ORIGINS,
    ];

const databaseUrl = env("DATABASE_URL");

const issuerBase = oauthIssuer.replace(/\/+$/, "");
const oauthAuthorizationUrl = `${issuerBase}/api/auth/oauth2/authorize`;
const oauthTokenUrl = `${issuerBase}/api/auth/oauth2/token`;
const oauthUserInfoUrl = `${issuerBase}/api/auth/oauth2/userinfo`;

// Real Postgres when DATABASE_URL is set, else embedded PGLite
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/** Session token cookie name */
export const SESSION_TOKEN_COOKIE = "vetta.session_token";

const oauthPlugin =
  !authDisabled && Boolean(oauthClientId && oauthClientSecret)
    ? genericOAuth({
        config: SOCIAL_PROVIDERS.map(({ providerId, idp }) => ({
          providerId,
          clientId: oauthClientId as string,
          clientSecret: oauthClientSecret as string,
          authorizationUrl: oauthAuthorizationUrl,
          tokenUrl: oauthTokenUrl,
          userInfoUrl: oauthUserInfoUrl,
          scopes: ["openid", "profile", "email"],
          authorizationUrlParams: { idp, prompt: "login" },
        })),
      })
    : null;

const isProd = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL,
  secret: env("BETTER_AUTH_SECRET") ?? localAuthSecret(),
  database,
  trustedOrigins,

  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [...SOCIAL_PROVIDERS.map((p) => p.providerId), GATE_PROVIDER_ID],
      requireLocalEmailVerified: false,
    },
  },

  session: { cookieCache: { enabled: true, maxAge: 300 } },

  // Local email/password authentication
  ...(emailAndPasswordEnabled ? { emailAndPassword: { enabled: true } } : {}),

  advanced: {
    useSecureCookies: isProd,
    defaultCookieAttributes: {
      secure: isProd,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "vetta.session_data" },
      account_data: { name: "vetta.account_data" },
      dont_remember: { name: "vetta.dont_remember" },
    },
  },

  plugins: [
    gateIdentitySessions(),
    ...(oauthPlugin ? [oauthPlugin] : []),
    bearer(),
    tanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

export { SOCIAL_PROVIDERS } from "./providers";
