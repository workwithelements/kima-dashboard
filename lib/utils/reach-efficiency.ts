/**
 * Reach efficiency (CPMr report) — per-ad aggregation, auto-thresholds and
 * classification for the "which ads drive cheap reach at scale" scatter.
 *
 * Classification model:
 *   TOF growth zone = spend ≥ spend threshold AND CPMr ≤ CPMr threshold
 *   Inside the zone, ads are split by CPA:
 *     efficient  — CPA at or below the split → scale these
 *     reachPlay  — CPA above the split (or no conversions) → don't pause;
 *                  they buy cheap reach even though they don't convert directly
 *   Everything outside the zone is "other" (context dots).
 */

export type WindowKey = "7d" | "14d" | "30d" | "90d" | "custom"

export const WINDOW_PRESETS: { key: WindowKey; label: string; days: number }[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "14d", label: "14d", days: 14 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
]

/**
 * Conversion events an ad set can be optimising towards, deepest-funnel
 * first. The ad set's actual optimization_goal isn't synced from Meta, so we
 * infer it: the client's key action when the ad set records any of it, else
 * the first event in this order the ad set has conversions for in the window.
 */
export const CONVERSION_EVENT_PRIORITY = [
  "purchases",
  "trials_started",
  "registrations_completed",
  "app_installs",
  "mobile_app_registrations",
  "checkouts_initiated",
  "adds_to_cart",
] as const

/** Human label for a conversion event column ("registrations_completed" → "registrations completed") */
export function conversionEventLabel(event: string | null): string {
  return event ? event.replace(/_/g, " ") : "conversions"
}

/** Daily performance row shape consumed by the aggregator. `events` carries
 *  the per-event conversion counts for goal-event resolution. */
export type EfficiencyDailyRow = {
  ad_id?: string | null
  ad_name?: string | null
  adset_id?: string | null
  adset_name?: string | null
  campaign_id?: string | null
  campaign_name?: string | null
  spend?: number | null
  reach?: number | null
  impressions?: number | null
  /** conversion event column → count for this day */
  events?: Record<string, number> | null
  revenue?: number | null
  video_plays?: number | null
}

/** One ad aggregated over a window. `conversions` counts the ad set's
 *  resolved goal event (see `conversionEvent`). */
export type AdEfficiencyRow = {
  adId: string
  adName: string
  adsetId: string
  adsetName: string
  campaignId: string
  campaignName: string
  spend: number
  reach: number
  impressions: number
  conversions: number
  /** Which event `conversions` counts, or null when the ad set recorded none */
  conversionEvent: string | null
  revenue: number
  isVideo: boolean
}

/** Aggregation output before goal-event resolution: per-ad per-event sums. */
export type AdEfficiencyRawRow = AdEfficiencyRow & {
  events: Record<string, number>
}

export type AdClassification = "efficient" | "reachPlay" | "other"

export type AdEfficiencyPoint = AdEfficiencyRow & {
  /** Cost per 1k people reached (summed daily reach). */
  cpmr: number
  /** Spend per key-action conversion; null when no conversions recorded. */
  cpa: number | null
  roas: number
  classification: AdClassification
}

export type EfficiencyThresholds = {
  /** Minimum window spend to qualify for the TOF growth zone. */
  spendMin: number
  /** Maximum CPMr to qualify for the TOF growth zone. */
  cpmrMax: number
  /** Overall CPA split (median CPA across all converting ads) — fallback when
   *  an ad's goal event has no per-event split. */
  cpaSplit: number
  /** CPA split per goal event — median CPA among converting ads sharing that
   *  event, so lead CPAs aren't judged against purchase CPAs. */
  cpaSplits: Record<string, number>
}

/** The CPA split an ad should be judged against (its goal event's, else overall). */
export function cpaSplitFor(
  thresholds: EfficiencyThresholds,
  conversionEvent: string | null
): number {
  return (
    (conversionEvent ? thresholds.cpaSplits[conversionEvent] : undefined) ??
    thresholds.cpaSplit
  )
}

/** Aggregate daily rows to one row per ad. Ads without spend or reach in the
 *  window are dropped — they can't be placed on the map. */
export function aggregateAdEfficiency(rows: EfficiencyDailyRow[]): AdEfficiencyRawRow[] {
  const byAd = new Map<string, AdEfficiencyRawRow>()
  for (const r of rows) {
    if (!r.ad_id) continue
    let acc = byAd.get(r.ad_id)
    if (!acc) {
      acc = {
        adId: r.ad_id,
        adName: r.ad_name || r.ad_id,
        adsetId: r.adset_id || "",
        adsetName: r.adset_name || "",
        campaignId: r.campaign_id || "",
        campaignName: r.campaign_name || "",
        spend: 0,
        reach: 0,
        impressions: 0,
        conversions: 0,
        conversionEvent: null,
        revenue: 0,
        isVideo: false,
        events: {},
      }
      byAd.set(r.ad_id, acc)
    }
    acc.spend += r.spend || 0
    acc.reach += r.reach || 0
    acc.impressions += r.impressions || 0
    acc.revenue += r.revenue || 0
    for (const [event, count] of Object.entries(r.events || {})) {
      if (count) acc.events[event] = (acc.events[event] || 0) + count
    }
    if ((r.video_plays || 0) > 0) acc.isVideo = true
    // Prefer the most recent non-empty names (rows arrive date-ascending)
    if (r.ad_name) acc.adName = r.ad_name
    if (r.adset_id) acc.adsetId = r.adset_id
    if (r.adset_name) acc.adsetName = r.adset_name
    if (r.campaign_id) acc.campaignId = r.campaign_id
    if (r.campaign_name) acc.campaignName = r.campaign_name
  }
  return Array.from(byAd.values()).filter((a) => a.spend > 0 && a.reach > 0)
}

/**
 * Pin each ad's conversions to its AD SET's goal event: the client's key
 * action when the ad set recorded any of it in the window, otherwise the
 * deepest-funnel event (CONVERSION_EVENT_PRIORITY) the ad set has. All ads in
 * an ad set share one event, so their CPAs are comparable. Strips the
 * per-event sums so the client payload stays flat.
 */
export function resolveAdsetConversionEvents(
  ads: AdEfficiencyRawRow[],
  keyAction: string
): AdEfficiencyRow[] {
  // Sum events per ad set
  const adsetEvents = new Map<string, Record<string, number>>()
  for (const ad of ads) {
    const sums = adsetEvents.get(ad.adsetId) || {}
    for (const [event, count] of Object.entries(ad.events)) {
      sums[event] = (sums[event] || 0) + count
    }
    adsetEvents.set(ad.adsetId, sums)
  }

  // Pick each ad set's event: key action first, then priority order
  const adsetEvent = new Map<string, string | null>()
  for (const [adsetId, sums] of Array.from(adsetEvents.entries())) {
    let event: string | null = null
    if (sums[keyAction] > 0) {
      event = keyAction
    } else {
      event = CONVERSION_EVENT_PRIORITY.find((e) => sums[e] > 0) ?? null
    }
    adsetEvent.set(adsetId, event)
  }

  return ads.map(({ events, ...ad }) => {
    const event = adsetEvent.get(ad.adsetId) ?? null
    return {
      ...ad,
      conversionEvent: event,
      conversions: event ? events[event] || 0 : 0,
    }
  })
}

/** Linear-interpolated percentile (p in 0..1) of an unsorted numeric array. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * Auto-derive thresholds from the (already filtered) ad set:
 *  - spendMin: p75 of ad spend — "high spend" = top quartile of spenders
 *  - cpmrMax: median CPMr — "cheap reach" = cheaper than the typical ad
 *  - cpaSplit(s): median CPA among converting ads, overall and per goal event
 */
export function computeThresholds(ads: AdEfficiencyRow[]): EfficiencyThresholds {
  const spends = ads.map((a) => a.spend)
  const cpmrs = ads.map((a) => (a.spend / a.reach) * 1000)

  const converting = ads.filter((a) => a.conversions > 0)
  const cpas = converting.map((a) => a.spend / a.conversions)

  const cpasByEvent: Record<string, number[]> = {}
  for (const a of converting) {
    if (!a.conversionEvent) continue
    ;(cpasByEvent[a.conversionEvent] ||= []).push(a.spend / a.conversions)
  }
  const cpaSplits: Record<string, number> = {}
  for (const [event, values] of Object.entries(cpasByEvent)) {
    cpaSplits[event] = percentile(values, 0.5)
  }

  return {
    spendMin: percentile(spends, 0.75),
    cpmrMax: percentile(cpmrs, 0.5),
    cpaSplit: percentile(cpas, 0.5),
    cpaSplits,
  }
}

/** Derive per-ad metrics and classify against thresholds. */
export function classifyAds(
  ads: AdEfficiencyRow[],
  thresholds: EfficiencyThresholds
): AdEfficiencyPoint[] {
  return ads.map((a) => {
    const cpmr = (a.spend / a.reach) * 1000
    const cpa = a.conversions > 0 ? a.spend / a.conversions : null
    const roas = a.spend > 0 ? a.revenue / a.spend : 0
    const inZone = a.spend >= thresholds.spendMin && cpmr <= thresholds.cpmrMax
    let classification: AdClassification = "other"
    if (inZone) {
      classification =
        cpa !== null && cpa <= cpaSplitFor(thresholds, a.conversionEvent)
          ? "efficient"
          : "reachPlay"
    }
    return { ...a, cpmr, cpa, roas, classification }
  })
}

/** Classification display config — colors validated for the dark chart surface. */
export const CLASSIFICATION_CONFIG: Record<
  AdClassification,
  { dot: string; label: string; badge: string; badgeClass: string }
> = {
  efficient: {
    dot: "#059669",
    label: "Efficient growth (low CPA)",
    badge: "Scale",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  reachPlay: {
    dot: "#D97706",
    label: "Reach play — don't pause (high CPA)",
    badge: "Don't pause",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  other: {
    dot: "#525252",
    label: "Other",
    badge: "Below thresholds",
    badgeClass: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  },
}
