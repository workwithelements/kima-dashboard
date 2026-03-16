/**
 * Date utilities for range presets, comparison periods, and month helpers.
 */

import type { DateRange, ComparisonType } from "./types"

/** Today in YYYY-MM-DD */
export function today(): string {
  return new Date().toISOString().split("T")[0]
}

/** N days ago in YYYY-MM-DD */
export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
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

/** Date range presets */
export type DatePreset =
  | "today"
  | "last_7d"
  | "last_30d"
  | "this_month"
  | "last_month"
  | "custom"

export function getPresetRange(preset: DatePreset): DateRange {
  const now = new Date()
  switch (preset) {
    case "today":
      return { from: today(), to: today() }
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

  const from = new Date(primary.from + "T00:00:00")
  const to = new Date(primary.to + "T00:00:00")
  const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1

  switch (type) {
    case "previous_period": {
      const compTo = new Date(from)
      compTo.setDate(compTo.getDate() - 1)
      const compFrom = new Date(compTo)
      compFrom.setDate(compFrom.getDate() - days + 1)
      return {
        from: compFrom.toISOString().split("T")[0],
        to: compTo.toISOString().split("T")[0],
      }
    }
    case "previous_month": {
      const compFrom = new Date(from)
      compFrom.setMonth(compFrom.getMonth() - 1)
      const compTo = new Date(to)
      compTo.setMonth(compTo.getMonth() - 1)
      return {
        from: compFrom.toISOString().split("T")[0],
        to: compTo.toISOString().split("T")[0],
      }
    }
    case "previous_year": {
      const compFrom = new Date(from)
      compFrom.setFullYear(compFrom.getFullYear() - 1)
      const compTo = new Date(to)
      compTo.setFullYear(compTo.getFullYear() - 1)
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
