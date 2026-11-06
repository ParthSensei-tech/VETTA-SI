export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function defaultIsRetryable(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("500") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("fetch failed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT")
  ) {
    return true;
  }
  return false;
}

/**
 * Executes an async task with bounded retries, exponential backoff, and random jitter.
 */
export async function withBoundedRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? 3, 5));
  const baseDelay = opts.baseDelayMs ?? 350;
  const maxDelay = opts.maxDelayMs ?? 2000;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }
      opts.onRetry?.(attempt, err);
      // Exponential backoff with jitter
      const expDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 150);
      await sleep(expDelay + jitter);
    }
  }

  throw lastError;
}
