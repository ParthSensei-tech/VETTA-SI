/**
 * Authentication and social login providers configuration.
 * Kept in a lightweight dependency-free module safe for client & server imports.
 */

export type SocialProvider = {
  /** Local provider id and callback path segment. */
  providerId: string;
  /** Identity provider identifier. */
  idp: string;
  /** Human-readable label for the sign-in button. */
  label: string;
};

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
  { providerId: "google", idp: "google", label: "Google" },
  { providerId: "github", idp: "github", label: "GitHub" },
];
