// Retry policy (10 §Retry proposal). Configurable engineering defaults, not approved policy.
export interface RetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  /** after this many transient failures the item moves to needs_attention (still kept, manual retry) */
  maxTransientAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 2_000,
  maxDelayMs: 15 * 60_000,
  maxTransientAttempts: 8,
};

/**
 * Full-jitter exponential backoff. `attempt` is the number of failures so far (1 = first failure).
 * A server Retry-After is honoured as a lower bound, still capped at maxDelayMs.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  retryAfterMs?: number | null,
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.max(policy.baseDelayMs / 2, Math.floor(random() * exp));
  const withServerHint = retryAfterMs != null && retryAfterMs > 0 ? Math.max(jittered, retryAfterMs) : jittered;
  return Math.min(policy.maxDelayMs, withServerHint);
}
