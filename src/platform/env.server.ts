export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Returns true if running in development / local workspace mode.
 */
export function isWorkspacePreview(): boolean {
  if (process.env.GROK_PROJECT_ID || process.env.PROJECT_ID || process.env.VERCEL) {
    return false;
  }
  return true;
}
