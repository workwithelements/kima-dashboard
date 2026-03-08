/**
 * Creative fatigue detection.
 * Compares recent performance against lifetime to flag declining ads.
 */

import type { MetaDailyRow } from "./types"

export type FatigueStatus = "healthy" | "warning" | "fatigued"

export type FatigueResult = {
  status: FatigueStatus
  reason: string
  recentCPA: number | null
  lifetimeCPA: number | null
  cpaRatio: number | null
}

export const FATIGUE_CONFIG = {
  label: { healthy: "Healthy", warning: "Warning", fatigued: "Fatigued" },
  color: {
    healthy: "text-green-400",
    warning: "text-amber-400",
    fatigued: "text-red-400",
  },
  dot: {
    healthy: "bg-green-400",
    warning: "bg-amber-400",
    fatigued: "bg-red-400",
  },
} as const

/**
 * Detect fatigue for a single ad.
 *
 * @param allRows    All daily rows for this client (full date range)
 * @param adId       The ad to evaluate
 * @param recentDays Number of recent days to compare (default 7)
 * @param rangeEnd   End date of the analysis range (YYYY-MM-DD)
 */
export function detectFatigue(
  allRows: Partial<MetaDailyRow>[],
  adId: string,
  recentDays: number = 7,
  rangeEnd?: string
): FatigueResult {
  const adRows = allRows.filter((r) => r.ad_id === adId)
  if (adRows.length === 0) {
    return { status: "healthy", reason: "No data", recentCPA: null, lifetimeCPA: null, cpaRatio: null }
  }

  // Determine cutoff date for "recent" window
  const endDate = rangeEnd
    ? new Date(rangeEnd + "T00:00:00")
    : new Date()
  const cutoff = new Date(endDate)
  cutoff.setDate(cutoff.getDate() - recentDays)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  // Split into recent vs lifetime
  const recentRows = adRows.filter((r) => r.date && r.date >= cutoffStr)
  const lifetimeRows = adRows

  // Aggregate
  const recentSpend = recentRows.reduce((s, r) => s + (r.spend || 0), 0)
  const recentConv = recentRows.reduce((s, r) => s + (r.purchases || 0), 0)
  const lifetimeSpend = lifetimeRows.reduce((s, r) => s + (r.spend || 0), 0)
  const lifetimeConv = lifetimeRows.reduce((s, r) => s + (r.purchases || 0), 0)

  const recentCPA = recentConv > 0 ? recentSpend / recentConv : null
  const lifetimeCPA = lifetimeConv > 0 ? lifetimeSpend / lifetimeConv : null

  // Rule 1: Fatigued — recently spending but zero conversions, with historical conversions
  if (recentSpend > 0 && recentConv === 0 && lifetimeConv > 0) {
    return {
      status: "fatigued",
      reason: "Recent spend with zero conversions",
      recentCPA,
      lifetimeCPA,
      cpaRatio: null,
    }
  }

  // Rule 2: Warning — recent CPA is >1.3x lifetime CPA
  if (recentCPA !== null && lifetimeCPA !== null && lifetimeCPA > 0) {
    const ratio = recentCPA / lifetimeCPA
    if (ratio > 1.3) {
      return {
        status: "warning",
        reason: `CPA increased ${Math.round((ratio - 1) * 100)}% vs lifetime`,
        recentCPA,
        lifetimeCPA,
        cpaRatio: ratio,
      }
    }
  }

  return {
    status: "healthy",
    reason: "Performance stable",
    recentCPA,
    lifetimeCPA,
    cpaRatio: recentCPA !== null && lifetimeCPA !== null && lifetimeCPA > 0
      ? recentCPA / lifetimeCPA
      : null,
  }
}

/**
 * Batch detect fatigue for all ads.
 */
export function detectFatigueAll(
  allRows: Partial<MetaDailyRow>[],
  adIds: string[],
  recentDays?: number,
  rangeEnd?: string
): Record<string, FatigueResult> {
  const results: Record<string, FatigueResult> = {}
  for (const adId of adIds) {
    results[adId] = detectFatigue(allRows, adId, recentDays, rangeEnd)
  }
  return results
}
