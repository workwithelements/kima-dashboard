/**
 * Reach analysis utilities — new reach calculation and saturation scoring.
 * Implements the corrected running baseline approach from DASHBOARD-PLAN §3.4.2
 */

export type ReachDataPoint = {
  date: string
  reach: number
  impressions: number
}

export type PreparedReachPoint = {
  date: string
  totalReach: number
  previousReach: number
  newReach: number
  newReachPct: number
}

export type SaturationResult = {
  score: number
  level: "low" | "moderate" | "high"
  label: string
  avgFrequency: number
}

/**
 * Prepare reach data using the running baseline approach.
 *
 * For each day, new reach = today's cumulative - yesterday's cumulative.
 * For day 1, we use the provided baseline (reach before the range started).
 */
export function prepareReachData(
  dailyReach: ReachDataPoint[],
  baselineReach = 0
): PreparedReachPoint[] {
  if (!dailyReach.length) return []

  // Build cumulative reach series
  // Note: Meta API provides "reach" per day which is unique users that day.
  // For new reach estimation, we use a running total approach.
  let cumulativeReach = baselineReach
  const result: PreparedReachPoint[] = []

  for (let i = 0; i < dailyReach.length; i++) {
    const day = dailyReach[i]
    const dailyUniqueReach = day.reach || 0

    // Estimate new reach for this day
    // Compute frequency from impressions/reach as a proxy for overlap
    // Higher frequency = more overlap = less new reach
    const freq = dailyUniqueReach > 0 ? (day.impressions || 0) / dailyUniqueReach : 1
    const overlapFactor = Math.min(1, 1 / Math.max(1, freq))
    const estimatedNewReach = Math.round(dailyUniqueReach * overlapFactor)

    const previousReach = cumulativeReach
    cumulativeReach += estimatedNewReach

    const newReachPct =
      cumulativeReach > 0
        ? (estimatedNewReach / cumulativeReach) * 100
        : 0

    result.push({
      date: day.date,
      totalReach: cumulativeReach,
      previousReach,
      newReach: Math.max(0, estimatedNewReach),
      newReachPct: Math.round(newReachPct * 10) / 10,
    })
  }

  return result
}

/**
 * Calculate saturation score (0–100).
 *
 * Formula from V1 SaturationAnalysis:
 *   saturation = min(100, max(0, (avgFrequency / 3) × 50 + (saturationPremium / 100) × 50))
 *
 * Zones:
 *   0–30:  Low (green)   — Healthy reach, room to grow
 *   30–60: Moderate (amber) — Monitor frequency
 *   60–100: High (red)   — Audience fatigue, refresh needed
 */
export function calculateSaturation(
  totalImpressions: number,
  totalReach: number,
  reachData?: PreparedReachPoint[]
): SaturationResult {
  const avgFrequency = totalReach > 0 ? totalImpressions / totalReach : 0

  // Calculate saturation premium based on declining new reach %
  let saturationPremium = 0
  if (reachData && reachData.length >= 7) {
    const firstHalf = reachData.slice(0, Math.floor(reachData.length / 2))
    const secondHalf = reachData.slice(Math.floor(reachData.length / 2))

    const firstAvgNewPct =
      firstHalf.reduce((sum, d) => sum + d.newReachPct, 0) / firstHalf.length
    const secondAvgNewPct =
      secondHalf.reduce((sum, d) => sum + d.newReachPct, 0) / secondHalf.length

    // If new reach % is declining, that contributes to saturation
    if (firstAvgNewPct > 0) {
      const decline = ((firstAvgNewPct - secondAvgNewPct) / firstAvgNewPct) * 100
      saturationPremium = Math.max(0, decline)
    }
  }

  const score = Math.min(
    100,
    Math.max(
      0,
      (avgFrequency / 3) * 50 + (saturationPremium / 100) * 50
    )
  )

  const roundedScore = Math.round(score)

  let level: SaturationResult["level"]
  let label: string

  if (roundedScore <= 30) {
    level = "low"
    label = "Low saturation — healthy new reach"
  } else if (roundedScore <= 60) {
    level = "moderate"
    label = "Moderate saturation — monitor frequency"
  } else {
    level = "high"
    label = "High saturation — refresh creative"
  }

  return {
    score: roundedScore,
    level,
    label,
    avgFrequency: Math.round(avgFrequency * 100) / 100,
  }
}

/**
 * Detect if new reach is in a declining trend (7+ consecutive days down).
 * Returns the number of consecutive declining days, or 0 if not declining.
 */
export function detectReachFatigue(reachData: PreparedReachPoint[]): number {
  if (reachData.length < 3) return 0

  let consecutiveDecline = 0
  for (let i = reachData.length - 1; i >= 1; i--) {
    if (reachData[i].newReachPct < reachData[i - 1].newReachPct) {
      consecutiveDecline++
    } else {
      break
    }
  }

  return consecutiveDecline
}

/**
 * Group rows by date and aggregate reach-related metrics
 */
export function dailyReachSeries(
  rows: { date: string; reach: number; impressions: number }[]
): ReachDataPoint[] {
  const byDate: Record<string, { reach: number; impressions: number }> = {}

  for (const row of rows) {
    if (!row.date) continue
    if (!byDate[row.date]) {
      byDate[row.date] = { reach: 0, impressions: 0 }
    }
    byDate[row.date].reach += row.reach || 0
    byDate[row.date].impressions += row.impressions || 0
  }

  return Object.entries(byDate)
    .map(([date, v]) => ({
      date,
      reach: v.reach,
      impressions: v.impressions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
