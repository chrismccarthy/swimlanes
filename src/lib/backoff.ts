/**
 * Exponential backoff with jitter, shared by every reconnect loop.
 *
 * A dropped realtime subscription is retried 1s, 2s, 4s ... after the first
 * failure, capped at 30s. The jitter keeps a roomful of clients that lost the
 * same server from stampeding back in lockstep.
 */

/** First delay, in ms; doubles per attempt. */
export const BACKOFF_BASE_MS = 1_000;

/** Longest a retry ever waits, in ms. */
export const BACKOFF_MAX_MS = 30_000;

/** How far either side of the nominal delay the jitter may move it (±25%). */
const JITTER = 0.25;

/**
 * Delay before retry number `attempt` (0 = the first retry after a failure).
 *
 * The result is never above {@link BACKOFF_MAX_MS}, so a long-running outage
 * settles into a steady ~30s poll rather than growing without bound.
 */
export function backoffDelay(attempt: number): number {
  const nominal = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  const spread = nominal * JITTER;
  // Math.random() is uniform on [0, 1), so this lands in [nominal ± spread).
  const jittered = nominal - spread + Math.random() * spread * 2;
  return Math.min(BACKOFF_MAX_MS, Math.round(jittered));
}
