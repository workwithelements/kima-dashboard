/**
 * Date utilities for range presets, comparison periods, and month helpers.
 */

import type { DateRange, ComparisonType } from "./types"

/** Format a Date's local components as YYYY-MM-DD (avoids UTC shift). */
function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Today in YYYY-MM-DD (local timezone) */
export function today(): string {
  return formatLocal(new Date())
}

/** N days ago in YYYY-MM-DD (local timezone) */
export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return formatLocal(d)
}

/** First of current month */
export function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

/** Last day of current month */
export function monthEnd(): string {
  const d = new Date()
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return last.toISOString().split("T")[0]
}

/** First of a given month (Date → YYYY-MM-DD) */
export function firstOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`
}

/** Last day of a given month */
export function lastOfMonth(year: number, month: number): string {
  const last = new Date(year, month, 0)
  return last.toISOString().split("T")[0]
}

/** Days in a given month */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** Day number within the month (1-based) */
export function dayOfMonth(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getDate()
}

/** Shift a YYYY-MM-DD date by N days (negative for past) */
export function shiftDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00")
  d.setDate(d.getDate() + n)
  return formatLocal(d)
}

/**
 * Shift a YYYY-MM-DD date by N calendar months (negative for past), clamping
 * the day to the target month's length so e.g. Mar 31 − 1 month = Feb 28/29
 * rather than overflowing into March.
 */
export function shiftMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00")
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)))
  return formatLocal(d)
}

/** Date range presets */
export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_30d"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "ytd"
  | "custom"

export function getPresetRange(preset: DatePreset): DateRange {
  const now = new Date()
  switch (preset) {
    case "today":
      return { from: today(), to: today() }
    case "yesterday":
      return { from: daysAgo(1), to: daysAgo(1) }
    case "last_7d":
      return { from: daysAgo(7), to: daysAgo(1) }
    case "last_30d":
      return { from: daysAgo(30), to: daysAgo(1) }
    case "this_month":
      return { from: monthStart(), to: daysAgo(1) }
    case "last_month": {
      const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return {
        from: firstOfMonth(lastM.getFullYear(), lastM.getMonth() + 1),
        to: lastOfMonth(lastM.getFullYear(), lastM.getMonth() + 1),
      }
    }
    case "this_quarter": {
      const qStart = Math.floor(now.getMonth() / 3) * 3
      const qFrom = new Date(now.getFullYear(), qStart, 1)
      return {
        from: qFrom.toISOString().split("T")[0],
        to: daysAgo(1),
      }
    }
    case "last_quarter": {
      const curQStart = Math.floor(now.getMonth() / 3) * 3
      const lqStart = new Date(now.getFullYear(), curQStart - 3, 1)
      const lqEnd = new Date(now.getFullYear(), curQStart, 0) // last day of prev quarter
      return {
        from: lqStart.toISOString().split("T")[0],
        to: lqEnd.toISOString().split("T")[0],
      }
    }
    case "ytd":
      return {
        from: `${now.getFullYear()}-01-01`,
        to: daysAgo(1),
      }
    default:
      return { from: daysAgo(30), to: daysAgo(1) }
  }
}

/** Get comparison range based on the primary range */
export function getComparisonRange(
  primary: DateRange,
  type: ComparisonType
): DateRange | null {
  if (type === "none") return null

  // Parse as UTC so date arithmetic below is timezone-agnostic. Using
  // "T00:00:00" without a Z suffix parses as LOCAL time, which caused
  // a 1-day offset when the user's timezone is east of UTC (e.g. BST).
  const from = new Date(primary.from + "T00:00:00Z")
  const to = new Date(primary.to + "T00:00:00Z")
  const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1

  switch (type) {
    case "previous_period": {
      const compTo = new Date(from)
      compTo.setUTCDate(compTo.getUTCDate() - 1)
      const compFrom = new Date(compTo)
      compFrom.setUTCDate(compFrom.getUTCDate() - days + 1)
      return {
        from: compFrom.toISOString().split("T")[0],
        to: compTo.toISOString().split("T")[0],
      }
    }
    case "previous_month": {
      const compFrom = new Date(from)
      compFrom.setUTCMonth(compFrom.getUTCMonth() - 1)
      const compTo = new Date(to)
      compTo.setUTCMonth(compTo.getUTCMonth() - 1)
      return {
        from: compFrom.toISOString().split("T")[0],
        to: compTo.toISOString().split("T")[0],
      }
    }
    case "previous_year": {
      const compFrom = new Date(from)
      compFrom.setUTCFullYear(compFrom.getUTCFullYear() - 1)
      const compTo = new Date(to)
      compTo.setUTCFullYear(compTo.getUTCFullYear() - 1)
      return {
        from: compFrom.toISOString().split("T")[0],
        to: compTo.toISOString().split("T")[0],
      }
    }
    default:
      return null
  }
}

/** Count elapsed and remaining days in a month */
export function monthProgress(year: number, month: number): { elapsed: number; remaining: number; total: number } {
  const total = daysInMonth(year, month)
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { elapsed: total, remaining: 0, total }
  }
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return { elapsed: 0, remaining: total, total }
  }

  const elapsed = now.getDate()
  return { elapsed, remaining: total - elapsed, total }
}
