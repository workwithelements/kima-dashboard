/**
 * Custom metrics calculation utilities.
 * Evaluates user-defined metrics (numerator / denominator × multiplier)
 * against aggregated performance data.
 */

import type { CustomMetric, AggregatedMetrics } from "./types"
import { fmtCurrency, fmtNumber, fmtPercent } from "./format"

/** Map of base metric field names to their AggregatedMetrics key */
const FIELD_MAP: Record<string, keyof AggregatedMetrics> = {
  spend: "spend",
  impressions: "impressions",
  reach: "reach",
  unique_link_clicks: "clicks",
  landing_page_views: "landingPageViews",
  adds_to_cart: "addsToCart",
  registrations_completed: "registrationsCompleted",
  checkouts_initiated: "checkoutsInitiated",
  purchases: "purchases",
  purchase_value: "revenue",
  app_installs: "appInstalls",
}

/**
 * Calculate a custom metric value from aggregated data.
 * Returns null if the denominator is zero (division by zero).
 */
export function calculateCustomMetric(
  metric: CustomMetric,
  data: AggregatedMetrics
): number | null {
  const numKey = FIELD_MAP[metric.numerator]
  const denKey = FIELD_MAP[metric.denominator]

  if (!numKey || !denKey) return null

  const numerator = data[numKey] || 0
  const denominator = data[denKey] || 0

  if (denominator === 0) return null

  return (numerator / denominator) * (metric.multiplier || 1)
}

/**
 * Format a custom metric value according to its format setting.
 */
export function formatCustomMetric(
  value: number | null,
  metric: CustomMetric
): string {
  if (value === null) return "—"

  switch (metric.format) {
    case "currency":
      return fmtCurrency(value)
    case "percentage":
      return fmtPercent(value, metric.decimals)
    case "number":
    default:
      return metric.decimals === 0
        ? fmtNumber(value)
        : value.toFixed(metric.decimals)
  }
}

/**
 * Calculate all custom metrics from a list of definitions.
 * Returns an array of { metric, value, formatted } objects.
 */
export function calculateAllCustomMetrics(
  metrics: CustomMetric[],
  data: AggregatedMetrics
): { metric: CustomMetric; value: number | null; formatted: string }[] {
  return metrics.map((m) => {
    const value = calculateCustomMetric(m, data)
    return {
      metric: m,
      value,
      formatted: formatCustomMetric(value, m),
    }
  })
}
