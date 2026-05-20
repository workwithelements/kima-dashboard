/**
 * Simple in-memory sliding-window rate limiter.
 * For serverless: each instance has its own window, so this is
 * best-effort. For stricter limits, use Redis/KV.
 */

const attempts = new Map<string, number[]>()

const MAX_ATTEMPTS = 5
const WINDOW_MS = 60_000 // 1 minute

/**
 * Returns true if the key has exceeded the failed-attempt budget in the
 * window. Does NOT increment — call `recordFailedAttempt` after a failure.
 */
export function isRateLimited(key: string): boolean {
  const now = Date.now()
  const timestamps = attempts.get(key) || []
  const recent = timestamps.filter((t) => now - t < WINDOW_MS)

  if (recent.length !== timestamps.length) {
    attempts.set(key, recent)
  }

  return recent.length >= MAX_ATTEMPTS
}

/**
 * Record a failed attempt for the key. Successful auths must NOT be
 * counted — otherwise a user who legitimately re-authenticates a few
 * times in quick succession would lock themselves out with the right
 * password.
 */
export function recordFailedAttempt(key: string): void {
  const now = Date.now()
  const timestamps = attempts.get(key) || []
  const recent = timestamps.filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  attempts.set(key, recent)

  // Cleanup: remove stale keys when map gets large
  if (attempts.size > 1000) {
    const keys = Array.from(attempts.keys())
    for (const k of keys) {
      const v = attempts.get(k)!
      const fresh = v.filter((t) => now - t < WINDOW_MS)
      if (fresh.length === 0) attempts.delete(k)
      else attempts.set(k, fresh)
    }
  }
}
