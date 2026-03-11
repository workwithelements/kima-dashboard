/**
 * Video retention analysis utilities.
 * Aggregates video milestone metrics and computes retention curves.
 */

import type { MetaDailyRow } from "./types"

export type VideoMetrics = {
  impressions: number
  threeSecViews: number
  p25: number
  p50: number
  p75: number
  p95: number
  p100: number
}

export type RetentionPoint = {
  label: string
  percent: number
  viewers: number
}

/**
 * Aggregate video metric columns for a specific ad (or all ads if no adId).
 */
export function aggregateVideoMetrics(
  rows: Partial<MetaDailyRow>[],
  adId?: string
): VideoMetrics {
  const filtered = adId ? rows.filter((r) => r.ad_id === adId) : rows

  let impressions = 0
  let threeSecViews = 0
  let p25 = 0
  let p50 = 0
  let p75 = 0
  let p95 = 0
  let p100 = 0

  for (const r of filtered) {
    impressions += r.impressions || 0
    threeSecViews += r.video_3s_views || 0
    p25 += r.video_p25 || 0
    p50 += r.video_p50 || 0
    p75 += r.video_p75 || 0
    p95 += r.video_p95 || 0
    p100 += r.video_p100 || 0
  }

  return { impressions, threeSecViews, p25, p50, p75, p95, p100 }
}

/**
 * Calculate a retention curve from aggregated video metrics.
 * Returns an array of points from Video Views (3s) -> 25% -> ... -> 100%.
 * Each point shows the percentage of video viewers (3s) retained at that milestone.
 */
export function calculateRetentionCurve(
  metrics: VideoMetrics
): RetentionPoint[] {
  const base = metrics.threeSecViews
  if (base === 0) return []

  const rate = (v: number) => (v / base) * 100

  return [
    { label: "Views", percent: 100, viewers: base },
    { label: "25%", percent: rate(metrics.p25), viewers: metrics.p25 },
    { label: "50%", percent: rate(metrics.p50), viewers: metrics.p50 },
    { label: "75%", percent: rate(metrics.p75), viewers: metrics.p75 },
    { label: "95%", percent: rate(metrics.p95), viewers: metrics.p95 },
    { label: "100%", percent: rate(metrics.p100), viewers: metrics.p100 },
  ]
}

/**
 * Check if an ad is a video ad by looking for 3s view data.
 */
export function isVideoAd(
  rows: Partial<MetaDailyRow>[],
  adId: string
): boolean {
  return rows.some(
    (r) => r.ad_id === adId && (r.video_3s_views || 0) > 0
  )
}

/**
 * Derived video KPIs.
 */
export function videoKPIs(metrics: VideoMetrics) {
  const hookRate =
    metrics.impressions > 0
      ? (metrics.threeSecViews / metrics.impressions) * 100
      : 0
  const completionRate =
    metrics.threeSecViews > 0
      ? (metrics.p100 / metrics.threeSecViews) * 100
      : 0
  const holdRate =
    metrics.threeSecViews > 0
      ? (metrics.p100 / metrics.threeSecViews) * 100
      : 0

  // Estimate average watch % using trapezoidal integration of the retention
  // curve based on video views (3s), milestones at 25%, 50%, 75%, 95%, 100%.
  let avgWatchPercent = 0
  if (metrics.threeSecViews > 0) {
    const base = metrics.threeSecViews
    const r25 = metrics.p25 / base
    const r50 = metrics.p50 / base
    const r75 = metrics.p75 / base
    const r95 = metrics.p95 / base
    const r100 = metrics.p100 / base
    avgWatchPercent =
      (0.25 * (1 + r25) / 2 +
        0.25 * (r25 + r50) / 2 +
        0.25 * (r50 + r75) / 2 +
        0.2 * (r75 + r95) / 2 +
        0.05 * (r95 + r100) / 2) *
      100
  }

  return { hookRate, completionRate, holdRate, avgWatchPercent }
}
