/**
 * Creative fatigue detection.
 * Compares recent performance against lifetime to flag declining ads.
 */

import type { MetaDailyRow } from "./types"

/** Map key_action string to the corresponding MetaDailyRow field value */
function getConversionValue(row: Partial<MetaDailyRow>, keyAction?: string): number {
  switch (keyAction) {
    case "unique_link_clicks": return row.unique_link_clicks || 0
    case "landing_page_views": return row.landing_page_views || 0
    case "adds_to_cart": return row.adds_to_cart || 0
    case "checkouts_initiated": return row.checkouts_initiated || 0
    case "registrations_completed": return row.registrations_completed || 0
    case "app_installs": return row.app_installs || 0
    case "mobile_app_registrations": return row.mobile_app_registrations || 0
    case "purchases":
    default: return row.purchases || 0
  }
}

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
  rangeEnd?: string,
  keyAction?: string
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
  const recentConv = recentRows.reduce((s, r) => s + getConversionValue(r, keyAction), 0)
  const lifetimeSpend = lifetimeRows.reduce((s, r) => s + (r.spend || 0), 0)
  const lifetimeConv = lifetimeRows.reduce((s, r) => s + getConversionValue(r, keyAction), 0)

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
  rangeEnd?: string,
  keyAction?: string
): Record<string, FatigueResult> {
  const results: Record<string, FatigueResult> = {}
  for (const adId of adIds) {
    results[adId] = detectFatigue(allRows, adId, recentDays, rangeEnd, keyAction)
  }
  return results
}
