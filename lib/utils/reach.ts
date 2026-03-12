/**
 * Reach analysis utilities — new reach calculation and saturation scoring.
 * Implements the corrected running baseline approach from DASHBOARD-PLAN §3.4.2
 */

export type ReachDataPoint = {
  date: string
  reach: number
  impressions: number
  spend?: number
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
  /** Component breakdown for the 3-factor score */
  components: {
    /** Frequency pressure — how close to 8x cap (0–100) */
    frequency: number
    /** CPM/CPMr efficiency gap — cost of repeat impressions (0–100) */
    efficiency: number
    /** Trend decline — is new reach declining? (0–100) */
    trend: number
  }
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
 * Calculate saturation score (0–100) using a 3-component weighted formula.
 *
 * Saturation = (0.40 × F_score) + (0.35 × E_score) + (0.25 × T_score)
 *
 * F_score (Frequency Pressure, 40%):
 *   min(100, (avgFrequency / 8) × 100)
 *   How many times the average user sees ads. Capped at 8x = fully saturated.
 *
 * E_score (Efficiency Gap, 35%):
 *   min(100, ((CPMr - CPM) / CPMr) × 100)
 *   Cost gap between impression and reach. 0 = perfect, 100 = all repeat.
 *   Essentially 1 - (1/frequency) but using cost data captures auction dynamics.
 *
 * T_score (Trend Decline, 25%):
 *   min(100, max(0, decline × 200))
 *   Is new reach declining over time? 50%+ decline = max score.
 *
 * Zones:
 *   0–25:  Low (green)    — Healthy reach, room to grow
 *   26–55: Moderate (amber) — Monitor frequency and efficiency
 *   56–100: High (red)    — Audience fatigue, refresh needed
 *
 * When trend data is unavailable, weights redistribute to F=0.55, E=0.45.
 */
export function calculateSaturation(
  totalImpressions: number,
  totalReach: number,
  totalSpend: number,
  reachData?: PreparedReachPoint[]
): SaturationResult {
  // Edge case: insufficient data
  if (totalReach === 0 || totalImpressions === 0) {
    return {
      score: 0,
      level: "low",
      label: "Insufficient data",
      avgFrequency: 0,
      components: { frequency: 0, efficiency: 0, trend: 0 },
    }
  }

  const avgFrequency = totalImpressions / totalReach

  // --- F_score: Frequency pressure (cap at 8x) ---
  const fScore = Math.min(100, (avgFrequency / 8) * 100)

  // --- E_score: CPM/CPMr efficiency gap ---
  const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0
  const cpmr = totalReach > 0 ? (totalSpend / totalReach) * 1000 : 0
  const eScore = cpmr > 0 ? Math.min(100, ((cpmr - cpm) / cpmr) * 100) : 0

  // --- T_score: New reach trend decline ---
  let tScore = 0
  let hasTrendData = false

  if (reachData && reachData.length >= 7) {
    hasTrendData = true
    const firstHalf = reachData.slice(0, Math.floor(reachData.length / 2))
    const secondHalf = reachData.slice(Math.floor(reachData.length / 2))

    const firstAvgNewPct =
      firstHalf.reduce((sum, d) => sum + d.newReachPct, 0) / firstHalf.length
    const secondAvgNewPct =
      secondHalf.reduce((sum, d) => sum + d.newReachPct, 0) / secondHalf.length

    if (firstAvgNewPct > 0) {
      const declineRatio = (firstAvgNewPct - secondAvgNewPct) / firstAvgNewPct
      // Normalize: 50% decline = score 100, scale linearly
      tScore = Math.min(100, Math.max(0, declineRatio * 200))
    }
  }

  // --- Weighted score ---
  let score: number
  if (hasTrendData) {
    score = 0.4 * fScore + 0.35 * eScore + 0.25 * tScore
  } else {
    // No trend data — redistribute weights
    score = 0.55 * fScore + 0.45 * eScore
  }

  const roundedScore = Math.round(Math.min(100, Math.max(0, score)))

  let level: SaturationResult["level"]
  let label: string

  if (roundedScore <= 25) {
    level = "low"
    label = "Low saturation — healthy new reach"
  } else if (roundedScore <= 55) {
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
    components: {
      frequency: Math.round(fScore),
      efficiency: Math.round(eScore),
      trend: Math.round(tScore),
    },
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
  rows: { date: string; reach: number; impressions: number; spend?: number }[]
): ReachDataPoint[] {
  const byDate: Record<string, { reach: number; impressions: number; spend: number }> = {}

  for (const row of rows) {
    if (!row.date) continue
    if (!byDate[row.date]) {
      byDate[row.date] = { reach: 0, impressions: 0, spend: 0 }
    }
    byDate[row.date].reach += row.reach || 0
    byDate[row.date].impressions += row.impressions || 0
    byDate[row.date].spend += row.spend || 0
  }

  return Object.entries(byDate)
    .map(([date, v]) => ({
      date,
      reach: v.reach,
      impressions: v.impressions,
      spend: v.spend,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Daily CPM vs CPMr series for dual-line chart.
 * CPM  = (spend / impressions) × 1000
 * CPMr = (spend / reach) × 1000
 */
export type CpmrDataPoint = {
  date: string
  cpm: number
  cpmr: number
}

export function dailyCpmrSeries(
  rows: { date: string; spend: number; impressions: number; reach: number }[]
): CpmrDataPoint[] {
  const byDate: Record<string, { spend: number; impressions: number; reach: number }> = {}

  for (const row of rows) {
    if (!row.date) continue
    if (!byDate[row.date]) {
      byDate[row.date] = { spend: 0, impressions: 0, reach: 0 }
    }
    byDate[row.date].spend += row.spend || 0
    byDate[row.date].impressions += row.impressions || 0
    byDate[row.date].reach += row.reach || 0
  }

  return Object.entries(byDate)
    .map(([date, v]) => ({
      date,
      cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0,
      cpmr: v.reach > 0 ? (v.spend / v.reach) * 1000 : 0,
    }))
    .map((d) => ({
      ...d,
      cpm: Math.round(d.cpm * 100) / 100,
      cpmr: Math.round(d.cpmr * 100) / 100,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Rolling saturation score over time.
 * For each day, calculates saturation using a trailing window of N days.
 */
export function rollingSaturationSeries(
  dailyReach: ReachDataPoint[],
  baselineReach = 0,
  windowDays = 7
): { date: string; score: number }[] {
  if (dailyReach.length < windowDays) return []

  const result: { date: string; score: number }[] = []

  for (let i = windowDays - 1; i < dailyReach.length; i++) {
    const windowSlice = dailyReach.slice(i - windowDays + 1, i + 1)
    const windowImpressions = windowSlice.reduce((s, d) => s + d.impressions, 0)
    const windowReach = windowSlice.reduce((s, d) => s + d.reach, 0)
    const windowSpend = windowSlice.reduce((s, d) => s + (d.spend || 0), 0)

    // Prepare reach data for the window to calculate decline
    const windowBaseline = i >= windowDays ? baselineReach : 0
    const prepared = prepareReachData(windowSlice, windowBaseline)

    const sat = calculateSaturation(windowImpressions, windowReach, windowSpend, prepared)
    result.push({ date: dailyReach[i].date, score: sat.score })
  }

  return result
}
