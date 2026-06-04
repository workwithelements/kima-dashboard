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
 * Time granularity for reach time-series charts.
 *  - "day":   daily buckets, pinned to the selected date range
 *  - "week":  ISO-week buckets (Monday start), defaults to the last 12 weeks
 *  - "month": calendar-month buckets, defaults to the last 6 months
 */
export type Granularity = "day" | "week" | "month"

export const DEFAULT_WEEKS = 12
export const DEFAULT_MONTHS = 6

/** Monday (UTC) of the ISO week containing dateStr (YYYY-MM-DD) */
export function weekStart(dateStr: string): string {
  const dt = new Date(dateStr + "T00:00:00Z")
  const day = dt.getUTCDay()
  const diff = (day === 0 ? -6 : 1) - day // shift back to Monday
  dt.setUTCDate(dt.getUTCDate() + diff)
  return dt.toISOString().split("T")[0]
}

/** First day of the calendar month containing dateStr (YYYY-MM-DD) */
export function monthStartKey(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01"
}

/** Start date (YYYY-MM-DD) of the bucket that dateStr falls into. */
export function bucketStart(dateStr: string, g: Granularity): string {
  if (g === "week") return weekStart(dateStr)
  if (g === "month") return monthStartKey(dateStr)
  return dateStr
}

/** Human-friendly axis/tooltip label for a bucket start date. */
export function formatBucketLabel(dateStr: string, g: Granularity): string {
  const dt = new Date(dateStr + "T00:00:00")
  if (g === "week") {
    return `w/c ${dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
  }
  if (g === "month") {
    return dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
  }
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/**
 * Compute the display window [from, to] for a given granularity, anchored to
 * the end of the selected range (`to`).
 *  - day:   the selected range as-is
 *  - week:  the last `weeks` ISO weeks ending in the week of `to`
 *  - month: the last `months` calendar months ending in the month of `to`
 */
export function granularityWindow(
  g: Granularity,
  from: string,
  to: string,
  weeks = DEFAULT_WEEKS,
  months = DEFAULT_MONTHS
): { windowFrom: string; windowTo: string } {
  if (g === "day") return { windowFrom: from, windowTo: to }
  if (g === "week") {
    const start = new Date(weekStart(to) + "T00:00:00Z")
    start.setUTCDate(start.getUTCDate() - 7 * (weeks - 1))
    return { windowFrom: start.toISOString().split("T")[0], windowTo: to }
  }
  const start = new Date(monthStartKey(to) + "T00:00:00Z")
  start.setUTCMonth(start.getUTCMonth() - (months - 1))
  return { windowFrom: start.toISOString().split("T")[0], windowTo: to }
}

export type ReachBuckets = {
  reach: PreparedReachPoint[]
  cpmr: CpmrDataPoint[]
  saturation: { date: string; score: number }[]
}

/**
 * Build bucketed reach / CPMr / saturation series from a LIFETIME daily series.
 *
 * Cumulative reach is accumulated from the very first day of the supplied
 * series, so "new reach" within any bucket is measured against the campaign /
 * ad set / ad's deduplicated lifetime reach. This captures only the audience
 * first reached during that bucket — not users already reached earlier in the
 * lifetime — which is what "true new reach during this period" means.
 *
 * For the stacked bars, `previousReach` is the lifetime cumulative reach BEFORE
 * the bucket (existing audience) and `newReach` is the incremental new reach
 * added during the bucket. `newReachPct` expresses that new reach as a share of
 * the lifetime cumulative reach at the end of the bucket.
 *
 * Only buckets whose start falls within [windowFrom, windowTo] are returned,
 * but the cumulative is always computed across the full `lifetimeDaily` input.
 */
export function buildReachBuckets(
  lifetimeDaily: ReachDataPoint[],
  granularity: Granularity,
  windowFrom: string,
  windowTo: string
): ReachBuckets {
  const dailyPrepared = prepareReachData(lifetimeDaily, 0)
  const dailySat = rollingSaturationSeries(lifetimeDaily, 0, 7)
  const satByDate = new Map(dailySat.map((s) => [s.date, s.score]))

  type Acc = {
    start: string
    firstPrev: number
    lastTotal: number
    newReach: number
    spend: number
    impressions: number
    reach: number
    lastSat: number | undefined
  }
  const buckets = new Map<string, Acc>()

  for (let i = 0; i < dailyPrepared.length; i++) {
    const p = dailyPrepared[i]
    const d = lifetimeDaily[i]
    const key = bucketStart(p.date, granularity)
    let acc = buckets.get(key)
    if (!acc) {
      acc = {
        start: key,
        firstPrev: p.previousReach,
        lastTotal: p.totalReach,
        newReach: 0,
        spend: 0,
        impressions: 0,
        reach: 0,
        lastSat: undefined,
      }
      buckets.set(key, acc)
    }
    acc.newReach += p.newReach
    acc.lastTotal = p.totalReach
    acc.spend += d.spend || 0
    acc.impressions += d.impressions || 0
    acc.reach += d.reach || 0
    const s = satByDate.get(p.date)
    if (s !== undefined) acc.lastSat = s
  }

  const ordered = Array.from(buckets.values())
    .sort((a, b) => a.start.localeCompare(b.start))
    .filter((b) => b.start >= windowFrom && b.start <= windowTo)

  const reach: PreparedReachPoint[] = ordered.map((b) => ({
    date: b.start,
    totalReach: b.lastTotal,
    previousReach: b.firstPrev,
    newReach: Math.max(0, Math.round(b.newReach)),
    newReachPct: b.lastTotal > 0 ? Math.round((b.newReach / b.lastTotal) * 1000) / 10 : 0,
  }))

  const cpmr: CpmrDataPoint[] = ordered.map((b) => ({
    date: b.start,
    cpm: b.impressions > 0 ? Math.round((b.spend / b.impressions) * 100000) / 100 : 0,
    cpmr: b.reach > 0 ? Math.round((b.spend / b.reach) * 100000) / 100 : 0,
  }))

  const saturation = ordered
    .filter((b) => b.lastSat !== undefined)
    .map((b) => ({ date: b.start, score: b.lastSat as number }))

  return { reach, cpmr, saturation }
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
