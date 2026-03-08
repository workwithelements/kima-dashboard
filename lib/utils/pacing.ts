/**
 * Budget pacing projection engine.
 *
 * Weighted blend:
 *   50% — Recent momentum (7-day trailing average)
 *   30% — Historical day-of-month pattern (how spend distributes across the month)
 *   20% — Day-of-week seasonality (Mon-Sun spend patterns)
 *
 * Pacing status thresholds:
 *   >115% or <85%  → Red    (significantly over/under)
 *   >105% or <95%  → Amber  (slightly over/under)
 *   95-105%        → Green  (on track)
 */

import { daysInMonth, monthProgress } from "./dates"
import type { PacingStatus } from "./types"
import { getPacingStatus } from "./types"

export type PacingResult = {
  /** Monthly budget (null if not set) */
  budget: number | null
  /** Spend so far this month */
  spentToDate: number
  /** Expected spend based on linear pacing */
  expectedSpend: number
  /** Projected end-of-month spend */
  projectedSpend: number
  /** Pacing percentage: (projected / budget) × 100 */
  pacingPct: number | null
  /** Status label */
  status: PacingStatus
  /** Ideal daily spend (budget / days in month) */
  idealDailySpend: number | null
  /** Projected remaining spend */
  remainingProjected: number
  /** Days elapsed / total */
  daysElapsed: number
  daysTotal: number
  daysRemaining: number
}

type DailySpend = { date: string; spend: number }

/**
 * Calculate pacing projection for a client.
 *
 * @param dailySpend   Array of { date, spend } for the current month (up to today)
 * @param budget       Monthly budget (null if not set)
 * @param year         Budget year
 * @param month        Budget month (1-12)
 * @param historicalDaily  Optional historical daily spend for richer projection
 */
export function calculatePacing(
  dailySpend: DailySpend[],
  budget: number | null,
  year: number,
  month: number,
  historicalDaily?: DailySpend[]
): PacingResult {
  const { elapsed, remaining, total } = monthProgress(year, month)

  // Sum spend to date
  const spentToDate = dailySpend.reduce((sum, d) => sum + d.spend, 0)

  // Linear expectation
  const expectedSpend = budget
    ? (budget / total) * elapsed
    : 0

  // === Projection Engine ===

  // 1. Recent momentum: 7-day trailing average
  const recentDays = dailySpend.slice(-7)
  const recentAvg =
    recentDays.length > 0
      ? recentDays.reduce((s, d) => s + d.spend, 0) / recentDays.length
      : 0

  // 2. Day-of-month pattern weight
  // If we have historical data, compute what % of monthly total typically falls in remaining days
  let domWeight = recentAvg // fallback
  if (historicalDaily && historicalDaily.length > 0) {
    // Compute average spend per day-of-month from historical data
    const domTotals: Record<number, { total: number; count: number }> = {}
    for (const d of historicalDaily) {
      const dayNum = new Date(d.date + "T00:00:00").getDate()
      if (!domTotals[dayNum]) domTotals[dayNum] = { total: 0, count: 0 }
      domTotals[dayNum].total += d.spend
      domTotals[dayNum].count++
    }
    const domAvgs: Record<number, number> = {}
    let totalAvg = 0
    for (const [day, data] of Object.entries(domTotals)) {
      domAvgs[Number(day)] = data.total / data.count
      totalAvg += data.total / data.count
    }

    // Project remaining by scaling
    if (totalAvg > 0) {
      let remainingDomAvg = 0
      for (let d = elapsed + 1; d <= total; d++) {
        remainingDomAvg += domAvgs[d] || totalAvg / total
      }
      domWeight = (spentToDate + remainingDomAvg) / total * (total / (remaining || 1))
    }
  }

  // 3. Day-of-week seasonality
  let dowWeight = recentAvg // fallback
  if (historicalDaily && historicalDaily.length > 7) {
    // Average spend per day-of-week (0=Sun, 6=Sat)
    const dowTotals: Record<number, { total: number; count: number }> = {}
    for (const d of historicalDaily) {
      const dow = new Date(d.date + "T00:00:00").getDay()
      if (!dowTotals[dow]) dowTotals[dow] = { total: 0, count: 0 }
      dowTotals[dow].total += d.spend
      dowTotals[dow].count++
    }
    const dowAvgs: Record<number, number> = {}
    const globalDailyAvg = historicalDaily.reduce((s, d) => s + d.spend, 0) / historicalDaily.length

    for (const [dow, data] of Object.entries(dowTotals)) {
      dowAvgs[Number(dow)] = data.total / data.count
    }

    // Project remaining days by day-of-week
    let remainingDowProjection = 0
    const todayDate = new Date()
    for (let i = 1; i <= remaining; i++) {
      const futureDate = new Date(todayDate)
      futureDate.setDate(futureDate.getDate() + i)
      const dow = futureDate.getDay()
      remainingDowProjection += dowAvgs[dow] || globalDailyAvg
    }
    dowWeight = (spentToDate + remainingDowProjection) > 0
      ? (spentToDate + remainingDowProjection) / total * (total / (remaining || 1))
      : recentAvg
  }

  // Weighted projection: 50% momentum + 30% day-of-month + 20% day-of-week
  const projectedRemaining = remaining > 0
    ? (recentAvg * 0.5 + domWeight * 0.3 + dowWeight * 0.2) * remaining
    : 0

  // Simple fallback if we don't have historical data
  const projectedSpend = historicalDaily && historicalDaily.length > 0
    ? spentToDate + projectedRemaining
    : elapsed > 0
      ? (spentToDate / elapsed) * total
      : 0

  // Pacing percentage
  const pacingPct = budget && budget > 0 ? (projectedSpend / budget) * 100 : null

  return {
    budget,
    spentToDate: Math.round(spentToDate * 100) / 100,
    expectedSpend: Math.round(expectedSpend * 100) / 100,
    projectedSpend: Math.round(projectedSpend * 100) / 100,
    pacingPct: pacingPct !== null ? Math.round(pacingPct * 10) / 10 : null,
    status: getPacingStatus(pacingPct),
    idealDailySpend: budget ? Math.round((budget / total) * 100) / 100 : null,
    remainingProjected: Math.round(Math.max(0, projectedSpend - spentToDate) * 100) / 100,
    daysElapsed: elapsed,
    daysTotal: total,
    daysRemaining: remaining,
  }
}
