/**
 * Simple in-memory sliding-window rate limiter.
 * For serverless: each instance has its own window, so this is
 * best-effort. For stricter limits, use Redis/KV.
 */

const attempts = new Map<string, number[]>()

const MAX_ATTEMPTS = 5
const WINDOW_MS = 60_000 // 1 minute

/**
 * Returns true if the key has exceeded the rate limit.
 * Call this before processing the request.
 */
export function isRateLimited(key: string): boolean {
  const now = Date.now()
  const timestamps = attempts.get(key) || []

  // Remove entries outside the window
  const recent = timestamps.filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(key, recent)
    return true
  }

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

  return false
}
