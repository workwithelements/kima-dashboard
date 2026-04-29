/**
 * Funnel step definitions and calculation helpers.
 *
 * Each "funnel step" is a selectable metric field that auto-generates
 * a triplet of 3 MetricCards: count, rate, cost per.
 */

import type { AggregatedMetrics } from "./types"
import { fmtCurrency, fmtNumber, fmtPercent } from "./format"

export type FunnelStepDef = {
  field: keyof AggregatedMetrics
  label: string
  shortLabel: string
  rateLabel: string
  rateDenominator: keyof AggregatedMetrics
  rateMultiplier: number
  costLabel: string
  /** Decimal places for rate display (default 1) */
  rateDecimals?: number
}

export type FunnelStepValues = {
  count: number
  rate: number | null
  costPer: number | null
}

export type FormattedFunnelStep = {
  count: string
  rate: string
  costPer: string
}

/** All available funnel step definitions keyed by DB field name */
export const FUNNEL_STEP_DEFS: Record<string, FunnelStepDef> = {
  unique_link_clicks: {
    field: "clicks",
    label: "Link Clicks",
    shortLabel: "Click",
    rateLabel: "CTR",
    rateDenominator: "impressions",
    rateMultiplier: 100,
    costLabel: "CPC",
  },
  landing_page_views: {
    field: "landingPageViews",
    label: "Landing Page Views",
    shortLabel: "Landing",
    rateLabel: "Landing Rate",
    rateDenominator: "impressions",
    rateMultiplier: 100,
    costLabel: "Cost per Landing",
    rateDecimals: 2,
  },
  adds_to_cart: {
    field: "addsToCart",
    label: "Adds to Cart",
    shortLabel: "Cart",
    rateLabel: "Cart Rate",
    rateDenominator: "landingPageViews",
    rateMultiplier: 100,
    costLabel: "Cost per Cart",
  },
  purchases: {
    field: "purchases",
    label: "Purchases",
    shortLabel: "Purchase",
    rateLabel: "Conv. Rate",
    rateDenominator: "clicks",
    rateMultiplier: 100,
    costLabel: "CPA",
  },
  checkouts_initiated: {
    field: "checkoutsInitiated",
    label: "Checkouts Initiated",
    shortLabel: "Checkout",
    rateLabel: "Checkout Rate",
    rateDenominator: "addsToCart",
    rateMultiplier: 100,
    costLabel: "Cost per Checkout",
  },
  registrations_completed: {
    field: "registrationsCompleted",
    label: "Registrations",
    shortLabel: "Registration",
    rateLabel: "Reg. Rate",
    rateDenominator: "clicks",
    rateMultiplier: 100,
    costLabel: "Cost per Reg.",
  },
  trials_started: {
    field: "trialsStarted",
    label: "Trials Started",
    shortLabel: "Trial",
    rateLabel: "Trial Rate",
    rateDenominator: "landingPageViews",
    rateMultiplier: 100,
    costLabel: "Cost per Trial",
  },
  app_installs: {
    field: "appInstalls",
    label: "App Installs",
    shortLabel: "Install",
    rateLabel: "Install Rate",
    rateDenominator: "clicks",
    rateMultiplier: 100,
    costLabel: "Cost per Install",
  },
  mobile_app_registrations: {
    field: "mobileAppRegistrations",
    label: "In-App Registrations",
    shortLabel: "In-App Reg.",
    rateLabel: "In-App Reg. Rate",
    rateDenominator: "appInstalls",
    rateMultiplier: 100,
    costLabel: "Cost per In-App Reg.",
  },
}

/** Ordered list of all available step keys for the config UI */
export const FUNNEL_STEP_ORDER = [
  "unique_link_clicks",
  "landing_page_views",
  "adds_to_cart",
  "checkouts_initiated",
  "purchases",
  "registrations_completed",
  "trials_started",
  "app_installs",
  "mobile_app_registrations",
] as const

export type FunnelStepKey = (typeof FUNNEL_STEP_ORDER)[number]

/**
 * Amplitude-backed funnel steps are persisted with this prefix to distinguish
 * them from `meta_daily_performance` columns. The suffix is the row id of the
 * tracked event in `amplitude_events` (e.g. `amplitude:f3a8…`). Counts come
 * from Amplitude's `/events/segmentation` API at render-time using the
 * dashboard's date range, not from the DB rows.
 */
export const AMPLITUDE_STEP_PREFIX = "amplitude:"

export function isAmplitudeStep(key: string): boolean {
  return key.startsWith(AMPLITUDE_STEP_PREFIX)
}

/** The suffix of an amplitude funnel-step key — a row id from `amplitude_events`. */
export function amplitudeEventId(key: string): string {
  return key.slice(AMPLITUDE_STEP_PREFIX.length)
}

/**
 * Calculate the count, rate, and cost-per values for a funnel step.
 * When `prevStepField` is provided, it overrides the static rateDenominator
 * so the rate is calculated relative to the previous step in the funnel.
 */
export function calculateFunnelStep(
  stepKey: string,
  data: AggregatedMetrics,
  prevStepField?: keyof AggregatedMetrics
): FunnelStepValues {
  const def = FUNNEL_STEP_DEFS[stepKey]
  if (!def) return { count: 0, rate: null, costPer: null }

  const count = data[def.field] || 0
  const denominatorField = prevStepField ?? def.rateDenominator
  const denominator = data[denominatorField] || 0
  const spend = data.spend || 0

  return {
    count,
    rate: denominator > 0 ? (count / denominator) * def.rateMultiplier : null,
    costPer: count > 0 ? spend / count : null,
  }
}

/**
 * Format a funnel step's values for display.
 */
export function formatFunnelStep(values: FunnelStepValues, rateDecimals = 1): FormattedFunnelStep {
  return {
    count: fmtNumber(values.count),
    rate: values.rate !== null ? fmtPercent(values.rate, rateDecimals) : "—",
    costPer: values.costPer !== null ? fmtCurrency(values.costPer) : "—",
  }
}

/**
 * Calculate net new reach from daily rows + baseline.
 * Simple sum of daily reach values (frequency not available in DB).
 */
export function calculateNetNewReach(
  dailyRows: { reach: number; impressions?: number }[],
  baselineReach: number
): number {
  let totalReach = 0
  for (const row of dailyRows) {
    totalReach += row.reach || 0
  }
  return totalReach
}
