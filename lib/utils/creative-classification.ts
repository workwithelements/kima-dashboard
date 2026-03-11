/**
 * Creative performance classification logic.
 * Ported from KIMA v1 creative-dashboard.jsx with adaptations
 * for our DB schema (flat columns instead of Meta API actions array).
 *
 * Classifies each ad creative into one of 7 categories using
 * peer-comparison within each ad set.
 */

import type { MetaDailyRow } from "./types"
import { parseAdName, type ParsedAdName } from "./ad-name-parser"
import type { FatigueStatus, FatigueResult } from "./fatigue-detection"

// --- Classification Types ---

export type ClassificationType =
  | "DIRECT_WINNER"
  | "INDIRECT_WINNER"
  | "VIABLE_UNDERSCALED"
  | "LOSER"
  | "LOSER_NON_CONTRIBUTING"
  | "LOSER_NO_DELIVERY"
  | "INSUFFICIENT_DATA"

export type ClassificationResult = {
  type: ClassificationType
  reasons: string[]
}

export type ClassificationDef = {
  label: string
  color: string
  bgColor: string
  description: string
}

export type ClassifiedAd = {
  adId: string
  adName: string
  adsetId: string
  adsetName: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  postClickEvents: number
  spendShare: number
  cpa: number | null
  cvr: number
  postClickRate: number
  classification: ClassificationResult
  parsed?: ParsedAdName
  fatigueStatus?: FatigueStatus
  fatigueReason?: string
}

// --- Constants ---

export const CLASSIFICATIONS: Record<ClassificationType, ClassificationDef> = {
  DIRECT_WINNER: {
    label: "Direct Winner",
    color: "#22c55e",
    bgColor: "bg-green-500/15 text-green-400 border-green-500/30",
    description: "Driving conversions efficiently",
  },
  INDIRECT_WINNER: {
    label: "Indirect Winner",
    color: "#3b82f6",
    bgColor: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    description: "High delivery, assisting conversions",
  },
  VIABLE_UNDERSCALED: {
    label: "Viable (Under-scaled)",
    color: "#f59e0b",
    bgColor: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    description: "Efficient but low spend share",
  },
  LOSER: {
    label: "Loser",
    color: "#ef4444",
    bgColor: "bg-red-500/15 text-red-400 border-red-500/30",
    description: "Below median performance",
  },
  LOSER_NON_CONTRIBUTING: {
    label: "Non-Contributing",
    color: "#ef4444",
    bgColor: "bg-red-500/15 text-red-400 border-red-500/30",
    description: "High spend, zero conversions",
  },
  LOSER_NO_DELIVERY: {
    label: "No Delivery",
    color: "#94a3b8",
    bgColor: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
    description: "Zero impressions in window",
  },
  INSUFFICIENT_DATA: {
    label: "Insufficient Data",
    color: "#94a3b8",
    bgColor: "bg-neutral-500/15 text-neutral-500 border-neutral-600/30",
    description: "Not enough volume to classify",
  },
}

// Creative-level thresholds (tuned lower than adset-level)
const MIN_SPEND = 75
const MIN_IMPRESSIONS = 2500
const MIN_POST_CLICK = 30
const MIN_CONV_FOR_CONFIDENCE = 5
const HIGH_VOLUME_CONV = 8
const HIGH_DELIVERY_SHARE = 20 // Percentage
const VIABLE_SPEND_CEILING = 150

// --- Key Action Mapping ---

/** Map key_action string to the corresponding MetaDailyRow field value */
function getConversionValue(row: Partial<MetaDailyRow>, keyAction?: string): number {
  switch (keyAction) {
    case "unique_link_clicks": return row.unique_link_clicks || 0
    case "landing_page_views": return row.landing_page_views || 0
    case "adds_to_cart": return row.adds_to_cart || 0
    case "checkouts_initiated": return row.checkouts_initiated || 0
    case "registrations_completed": return row.registrations_completed || 0
    case "app_installs": return row.app_installs || 0
    case "mobile_app_registrations": return row.mobile_app_registrations || 0
    case "purchases":
    default: return row.purchases || 0
  }
}

// --- Helpers ---

type AdSetMedian = {
  cpa: number
  cvr: number
  postClickRate: number
}

type AdWithMetrics = {
  adId: string
  adName: string
  adsetId: string
  adsetName: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  postClickEvents: number
  spendShare: number
  cpa: number | null
  cvr: number
  postClickRate: number
  hasMinData: boolean
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Classify a single ad against its ad set peers.
 */
function classifyAd(
  ad: AdWithMetrics,
  _adSetTotalSpend: number,
  adSetMedian: AdSetMedian
): ClassificationResult {
  const {
    impressions,
    conversions,
    postClickRate,
    spendShare,
    cvr,
    cpa,
    spend,
    hasMinData,
  } = ad

  // A. No Delivery
  if (impressions === 0) {
    return { type: "LOSER_NO_DELIVERY", reasons: ["ZERO_IMPRESSIONS"] }
  }

  // B. Insufficient Data
  if (!hasMinData) {
    const needs: string[] = []
    if (spend < MIN_SPEND) needs.push("SPEND")
    if (impressions < MIN_IMPRESSIONS) needs.push("IMPRESSIONS")
    if (ad.postClickEvents < MIN_POST_CLICK) needs.push("POST_CLICKS")
    return {
      type: "INSUFFICIENT_DATA",
      reasons: [`INSUFFICIENT_VOLUME (Needs ${needs.join("/")})`],
    }
  }

  // C. Non-Contributing (has spend but zero conversions)
  if (spend >= MIN_SPEND && conversions === 0) {
    return { type: "LOSER_NON_CONTRIBUTING", reasons: ["SPEND_NO_CONVERSIONS"] }
  }

  // D. Direct Winners — high conversion volume + efficient CPA
  const efficientCpa = adSetMedian.cpa > 0 && cpa !== null && cpa <= adSetMedian.cpa
  if (conversions >= HIGH_VOLUME_CONV && efficientCpa) {
    const strongCvr = cvr >= adSetMedian.cvr
    return {
      type: "DIRECT_WINNER",
      reasons: [
        strongCvr
          ? "EFFICIENT_HIGH_VOLUME_STRONG_CVR"
          : "EFFICIENT_HIGH_VOLUME",
      ],
    }
  }

  // E. Indirect Winners — algorithm is scaling this creative heavily
  if (spendShare >= HIGH_DELIVERY_SHARE) {
    const strongIntent = postClickRate >= adSetMedian.postClickRate
    return {
      type: "INDIRECT_WINNER",
      reasons: [
        strongIntent
          ? "HIGH_DELIVERY_ASSISTIVE"
          : "HIGH_DELIVERY_MODERATE_ASSISTIVE",
      ],
    }
  }

  // F. Viable (Under-scaled) — low spend but promising signals
  if (spend <= VIABLE_SPEND_CEILING) {
    const goodCvr = cvr >= adSetMedian.cvr
    const goodPostClick = postClickRate >= adSetMedian.postClickRate
    const goodCpa = adSetMedian.cpa > 0 && cpa !== null && cpa <= adSetMedian.cpa
    if (goodCvr || goodPostClick || goodCpa) {
      let reason = "VIABLE_NOT_SCALED"
      if (goodCvr) reason = "VIABLE_NOT_SCALED_ABOVE_MEDIAN_CVR"
      else if (goodPostClick) reason = "VIABLE_NOT_SCALED_STRONG_POST_CLICK"
      else if (goodCpa) reason = "VIABLE_NOT_SCALED_EFFICIENT_CPA"
      return { type: "VIABLE_UNDERSCALED", reasons: [reason] }
    }
  }

  // G. Loser — below median with confidence
  const highConfBadPerf =
    conversions >= MIN_CONV_FOR_CONFIDENCE &&
    cpa !== null &&
    adSetMedian.cpa > 0 &&
    cpa > adSetMedian.cpa
  const lowConfLowIntent =
    conversions < MIN_CONV_FOR_CONFIDENCE &&
    spend >= MIN_SPEND &&
    postClickRate < adSetMedian.postClickRate

  if (highConfBadPerf || lowConfLowIntent) {
    let reason = "BELOW_MEDIAN_PERFORMANCE"
    if (highConfBadPerf) reason = "UNDER_MEDIAN_EFFICIENCY"
    else if (postClickRate < adSetMedian.postClickRate)
      reason = "LOW_POST_CLICK_INTENT"
    return { type: "LOSER", reasons: [reason] }
  }

  // H. Fallback — mixed signals
  return { type: "VIABLE_UNDERSCALED", reasons: ["MIXED_SIGNALS_HOLD"] }
}

/**
 * Classify all ads from raw daily performance rows.
 * Groups by ad_id to aggregate, then by adset for peer comparison.
 */
export function classifyAllAds(
  rows: Partial<MetaDailyRow>[],
  keyAction?: string
): ClassifiedAd[] {
  // Step 1: Aggregate rows by ad_id
  const adMap = new Map<
    string,
    {
      adName: string
      adsetId: string
      adsetName: string
      spend: number
      impressions: number
      clicks: number
      conversions: number
      revenue: number
      landingPageViews: number
      addsToCart: number
      checkoutsInitiated: number
      registrationsCompleted: number
      appInstalls: number
    }
  >()

  for (const row of rows) {
    const adId = row.ad_id
    if (!adId) continue

    const convValue = getConversionValue(row, keyAction)
    const existing = adMap.get(adId)
    if (existing) {
      existing.spend += row.spend || 0
      existing.impressions += row.impressions || 0
      existing.clicks += row.unique_link_clicks || 0
      existing.conversions += convValue
      existing.revenue += row.purchase_value || 0
      existing.landingPageViews += row.landing_page_views || 0
      existing.addsToCart += row.adds_to_cart || 0
      existing.checkoutsInitiated += row.checkouts_initiated || 0
      existing.registrationsCompleted += row.registrations_completed || 0
      existing.appInstalls += row.app_installs || 0
    } else {
      adMap.set(adId, {
        adName: row.ad_name || adId,
        adsetId: row.adset_id || "unknown",
        adsetName: row.adset_name || "Unknown",
        spend: row.spend || 0,
        impressions: row.impressions || 0,
        clicks: row.unique_link_clicks || 0,
        conversions: convValue,
        revenue: row.purchase_value || 0,
        landingPageViews: row.landing_page_views || 0,
        addsToCart: row.adds_to_cart || 0,
        checkoutsInitiated: row.checkouts_initiated || 0,
        registrationsCompleted: row.registrations_completed || 0,
        appInstalls: row.app_installs || 0,
      })
    }
  }

  // Step 2: Group aggregated ads by ad set
  type AdData = { adName: string; adsetId: string; adsetName: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; landingPageViews: number; addsToCart: number; checkoutsInitiated: number; registrationsCompleted: number; appInstalls: number }
  const byAdSet = new Map<string, { adId: string; data: AdData }[]>()
  adMap.forEach((data, adId) => {
    const group = byAdSet.get(data.adsetId) || []
    group.push({ adId, data })
    byAdSet.set(data.adsetId, group)
  })

  // Step 3: For each ad set, compute metrics and classify
  const classified: ClassifiedAd[] = []

  byAdSet.forEach((ads) => {
    const adSetTotalSpend = ads.reduce((s, a) => s + a.data.spend, 0)

    if (adSetTotalSpend === 0) {
      for (const { adId, data } of ads) {
        classified.push({
          adId,
          adName: data.adName,
          adsetId: data.adsetId,
          adsetName: data.adsetName,
          spend: 0,
          impressions: data.impressions,
          clicks: data.clicks,
          conversions: data.conversions,
          revenue: data.revenue,
          postClickEvents: 0,
          spendShare: 0,
          cpa: null,
          cvr: 0,
          postClickRate: 0,
          classification: {
            type: "LOSER_NO_DELIVERY",
            reasons: ["ZERO_ADSET_SPEND"],
          },
        })
      }
      return
    }

    // Compute per-ad metrics
    const adsWithMetrics: AdWithMetrics[] = ads.map(({ adId, data }) => {
      const postClickEvents =
        data.landingPageViews +
        data.addsToCart +
        data.checkoutsInitiated +
        data.conversions +
        data.registrationsCompleted +
        data.appInstalls

      const hasMinData =
        data.spend >= MIN_SPEND ||
        postClickEvents >= MIN_POST_CLICK ||
        data.impressions >= MIN_IMPRESSIONS

      return {
        adId,
        adName: data.adName,
        adsetId: data.adsetId,
        adsetName: data.adsetName,
        spend: data.spend,
        impressions: data.impressions,
        clicks: data.clicks,
        conversions: data.conversions,
        revenue: data.revenue,
        postClickEvents,
        spendShare: (data.spend / adSetTotalSpend) * 100,
        cpa: data.conversions > 0 ? data.spend / data.conversions : null,
        cvr:
          data.impressions > 0 ? data.conversions / data.impressions : 0,
        postClickRate:
          data.impressions > 0 ? postClickEvents / data.impressions : 0,
        hasMinData,
      }
    })

    // Compute medians from eligible ads
    const eligible = adsWithMetrics.filter((a) => a.hasMinData)
    const withConv = eligible.filter(
      (a) => a.conversions > 0 && a.cpa !== null
    )

    const adSetMedian: AdSetMedian = {
      cpa: median(withConv.map((a) => a.cpa!)),
      cvr: median(eligible.map((a) => a.cvr)),
      postClickRate: median(eligible.map((a) => a.postClickRate)),
    }

    // Classify each ad
    for (const ad of adsWithMetrics) {
      const result = classifyAd(ad, adSetTotalSpend, adSetMedian)
      classified.push({
        ...ad,
        classification: result,
        parsed: parseAdName(ad.adName),
      })
    }
  })

  // Sort by spend descending
  classified.sort((a, b) => b.spend - a.spend)
  return classified
}

/**
 * Merge fatigue status into classified ads.
 * Enriches each ad with fatigueStatus + fatigueReason fields.
 */
export function mergeClassificationWithFatigue(
  ads: ClassifiedAd[],
  fatigueMap: Record<string, FatigueResult>
): ClassifiedAd[] {
  return ads.map((ad) => {
    const f = fatigueMap[ad.adId]
    if (!f || f.status === "healthy") return ad
    return { ...ad, fatigueStatus: f.status, fatigueReason: f.reason }
  })
}

/**
 * Get unified display label for classification + fatigue.
 * Returns the classification label with optional fatigue suffix.
 */
export function getUnifiedStatusLabel(ad: ClassifiedAd): string {
  const cls = CLASSIFICATIONS[ad.classification.type]
  if (!ad.fatigueStatus || ad.fatigueStatus === "healthy") return cls.label
  // Fatigue is redundant for losers and no-delivery
  if (
    ad.classification.type === "LOSER" ||
    ad.classification.type === "LOSER_NON_CONTRIBUTING" ||
    ad.classification.type === "LOSER_NO_DELIVERY"
  ) {
    return cls.label
  }
  const suffix = ad.fatigueStatus === "fatigued" ? "Fatigued" : "Fatigue Warning"
  return `${cls.label} · ${suffix}`
}

/** Count ads by classification type */
export function countByClassification(
  ads: ClassifiedAd[]
): Record<ClassificationType, number> {
  const counts: Record<ClassificationType, number> = {
    DIRECT_WINNER: 0,
    INDIRECT_WINNER: 0,
    VIABLE_UNDERSCALED: 0,
    LOSER: 0,
    LOSER_NON_CONTRIBUTING: 0,
    LOSER_NO_DELIVERY: 0,
    INSUFFICIENT_DATA: 0,
  }
  for (const ad of ads) {
    counts[ad.classification.type]++
  }
  return counts
}
