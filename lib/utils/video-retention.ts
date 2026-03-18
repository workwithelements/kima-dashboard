/**
 * Video retention analysis utilities.
 * Aggregates video milestone metrics and computes retention curves
 * based on Meta's video_p25/p50/p75/p95/p100 watched actions.
 *
 * Data source mapping:
 *  - videoPlays = video_play_actions (video starts) OR actions→video_view (3s views) as fallback
 *  - threeSecViews = actions→video_view (3-second views) OR video_thruplay_watched_actions (15s) as fallback
 *  - p25/p50/p75/p95/p100 = video_pXX_watched_actions
 */

import type { MetaDailyRow } from "./types"

export type VideoMetrics = {
  impressions: number
  videoPlays: number
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
  let videoPlays = 0
  let threeSecViews = 0
  let p25 = 0
  let p50 = 0
  let p75 = 0
  let p95 = 0
  let p100 = 0

  for (const r of filtered) {
    impressions += r.impressions || 0
    videoPlays += (r as Record<string, number>).video_plays || 0
    threeSecViews += r.video_3s_views || 0
    p25 += r.video_p25 || 0
    p50 += r.video_p50 || 0
    p75 += r.video_p75 || 0
    p95 += r.video_p95 || 0
    p100 += r.video_p100 || 0
  }

  return { impressions, videoPlays, threeSecViews, p25, p50, p75, p95, p100 }
}

/**
 * Calculate a retention curve from aggregated video metrics.
 *
 * Uses video plays (number of times the video started playing) as the base
 * (100%), then plots retention through 3s views, p25, p50, p75, p95, p100.
 * Percentages are capped at 100% to handle edge cases where milestone
 * counts can exceed plays for very short videos.
 */
export function calculateRetentionCurve(
  metrics: VideoMetrics
): RetentionPoint[] {
  // Use videoPlays as the base when available; fall back to threeSecViews
  // (video_plays column may be 0 for historical data before the sync populates it)
  const hasPlays = metrics.videoPlays > 0
  const base = hasPlays ? metrics.videoPlays : metrics.threeSecViews
  if (base === 0) return []

  const rate = (v: number) => Math.min(100, (v / base) * 100)

  // When we have video plays, show curve: Plays → 25% → 50% → 75% → 100%
  if (hasPlays) {
    return [
      { label: "Plays", percent: 100, viewers: base },
      { label: "25%", percent: rate(metrics.p25), viewers: metrics.p25 },
      { label: "50%", percent: rate(metrics.p50), viewers: metrics.p50 },
      { label: "75%", percent: rate(metrics.p75), viewers: metrics.p75 },
      { label: "100%", percent: rate(metrics.p100), viewers: metrics.p100 },
    ]
  }

  // Fallback: start from 3s views when video_plays not yet synced
  return [
    { label: "3s", percent: 100, viewers: base },
    { label: "25%", percent: rate(metrics.p25), viewers: metrics.p25 },
    { label: "50%", percent: rate(metrics.p50), viewers: metrics.p50 },
    { label: "75%", percent: rate(metrics.p75), viewers: metrics.p75 },
    { label: "100%", percent: rate(metrics.p100), viewers: metrics.p100 },
  ]
}

/**
 * Check if an ad is a video ad by looking for video play data.
 */
export function isVideoAd(
  rows: Partial<MetaDailyRow>[],
  adId: string
): boolean {
  return rows.some(
    (r) =>
      r.ad_id === adId &&
      (((r as Record<string, number>).video_plays || 0) > 0 ||
        (r.video_p25 || 0) > 0 ||
        (r.video_3s_views || 0) > 0)
  )
}

/**
 * Derived video KPIs.
 */
export function videoKPIs(metrics: VideoMetrics) {
  // Use videoPlays as base; fall back to threeSecViews if not yet synced
  const base = metrics.videoPlays > 0 ? metrics.videoPlays : metrics.threeSecViews

  // Hook rate: what % of video plays led to a 3s view (only meaningful with plays data)
  const hookRate =
    metrics.videoPlays > 0
      ? (metrics.threeSecViews / metrics.videoPlays) * 100
      : 0

  // Completion rate: of those who started, who finished (p100)
  const completionRate =
    base > 0 ? (metrics.p100 / base) * 100 : 0

  // Hold rate: same as completion rate (retained alias)
  const holdRate = completionRate

  // Estimate average watch % using trapezoidal integration of the retention curve
  let avgWatchPercent = 0
  if (base > 0) {
    const r3s = Math.min(1, metrics.threeSecViews / base)
    const r25 = Math.min(1, metrics.p25 / base)
    const r50 = Math.min(1, metrics.p50 / base)
    const r75 = Math.min(1, metrics.p75 / base)
    const r100 = Math.min(1, metrics.p100 / base)
    if (metrics.videoPlays > 0) {
      // Full curve: plays → 3s → 25% → ... → 100%
      avgWatchPercent =
        5 * (1 + r3s) / 2 +
        20 * (r3s + r25) / 2 +
        25 * (r25 + r50) / 2 +
        25 * (r50 + r75) / 2 +
        25 * (r75 + r100) / 2
    } else {
      // Fallback curve: 3s → 25% → ... → 100%
      avgWatchPercent =
        25 * (1 + r25) / 2 +
        25 * (r25 + r50) / 2 +
        25 * (r50 + r75) / 2 +
        25 * (r75 + r100) / 2
    }
  }

  return { hookRate, completionRate, holdRate, avgWatchPercent, videoPlays: metrics.videoPlays }
}
