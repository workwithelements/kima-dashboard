/**
 * Herfindahl-Hirschman Index (HHI) for ad spend concentration.
 *
 * HHI = Σ(share_i²) where share_i = ad_spend / total_spend
 *
 * Lower HHI → spend is spread across many ads (healthy)
 * Higher HHI → spend is concentrated in a few ads (risky)
 */

export type ConcentrationLevel = "Healthy" | "Moderate" | "Concentrated"

export type ConcentrationResult = {
  /** Raw HHI value (0 → perfectly diversified, 1 → single ad) */
  hhi: number
  /** Qualitative level based on thresholds */
  level: ConcentrationLevel
  /** Percentage of total spend going to the highest-spend ad */
  topAdShare: number
  /** Name of the top-spending ad */
  topAdName: string
  /** Score from 0-100 (100 = perfectly diversified) */
  score: number
}

const THRESHOLDS = {
  healthy: 0.15,
  moderate: 0.25,
} as const

export const CONCENTRATION_COLORS: Record<ConcentrationLevel, string> = {
  Healthy: "#22c55e",     // green-500
  Moderate: "#f59e0b",    // amber-500
  Concentrated: "#ef4444", // red-500
}

export function calculateConcentration(
  ads: { adId: string; adName: string; spend: number }[]
): ConcentrationResult {
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0)

  if (totalSpend === 0 || ads.length === 0) {
    return {
      hhi: 0,
      level: "Healthy",
      topAdShare: 0,
      topAdName: "",
      score: 100,
    }
  }

  // Calculate shares and HHI
  let hhi = 0
  let maxShare = 0
  let topAdName = ""

  for (const ad of ads) {
    const share = ad.spend / totalSpend
    hhi += share * share
    if (share > maxShare) {
      maxShare = share
      topAdName = ad.adName
    }
  }

  // Determine level
  let level: ConcentrationLevel
  if (hhi < THRESHOLDS.healthy) {
    level = "Healthy"
  } else if (hhi < THRESHOLDS.moderate) {
    level = "Moderate"
  } else {
    level = "Concentrated"
  }

  // Convert to 0-100 score (100 = fully diversified)
  // HHI ranges from 1/n (perfectly even) to 1 (single ad)
  // Map to 0-100 where lower HHI = higher score
  const score = Math.round(Math.max(0, Math.min(100, (1 - hhi) * 100)))

  return {
    hhi,
    level,
    topAdShare: maxShare * 100,
    topAdName,
    score,
  }
}
