/**
 * Alexia Clark campaign structure detection.
 *
 * Campaigns fall into 3 types:
 *   - ASC (Advantage+ Shopping)
 *   - Retargeting
 *   - Body Part (Abs, Booty, Arms, etc.) — landing pages vary by adset
 *
 * Adset names for body-part campaigns follow the pattern:
 *   "040726 I AC  | Abs I Broad | Women 24–54  | Abs LP 7"
 * where the last `|`-delimited segment contains `LP <number>`.
 */

import type { MetaDailyRow, AggregatedMetrics } from "./types"
import { aggregateMetrics } from "./aggregate"

export type CampaignType = "ASC" | "Retargeting" | "BodyPart"

export type CampaignClassification = {
  type: CampaignType
  /** For body-part campaigns, the extracted body part label (e.g. "Abs") */
  label: string
}

/** Known body-part keywords (case-insensitive) */
const BODY_PART_KEYWORDS = [
  "full body",
  "upper body",
  "lower body",
  "booty",
  "glutes",
  "abs",
  "core",
  "arms",
  "legs",
  "shoulders",
  "back",
  "chest",
]

/** Classify a campaign by its name */
export function classifyCampaign(name: string | null | undefined): CampaignClassification {
  if (!name) return { type: "BodyPart", label: "Unknown" }

  if (/\basc\b|advantage/i.test(name)) {
    return { type: "ASC", label: "ASC" }
  }
  if (/retarget|\brtg\b|\brmkt\b|remarketing/i.test(name)) {
    return { type: "Retargeting", label: "Retargeting" }
  }

  // Body part — find a keyword match, preferring longer matches first
  const lower = name.toLowerCase()
  const sorted = [...BODY_PART_KEYWORDS].sort((a, b) => b.length - a.length)
  for (const kw of sorted) {
    if (lower.includes(kw)) {
      // Capitalize first letter of each word
      const label = kw.replace(/\b\w/g, (c) => c.toUpperCase())
      return { type: "BodyPart", label }
    }
  }

  // Fallback: use first "|" segment or the whole name
  const first = name.split("|")[0].trim()
  return { type: "BodyPart", label: first || "Other" }
}

/** Extract landing page variant from an adset name. Returns e.g. "LP 7" or null. */
export function extractLandingPage(adsetName: string | null | undefined): string | null {
  if (!adsetName) return null
  const segments = adsetName.split("|").map((s) => s.trim())
  const last = segments[segments.length - 1] || ""
  const match = last.match(/LP\s*(\d+)/i)
  return match ? `LP ${match[1]}` : null
}

// ── Aggregation types ──

export type CampaignTypeSummary = {
  type: CampaignType
  label: string
  /** For body-part, list of distinct body-part labels */
  bodyPartLabel?: string
  spend: number
  purchases: number
  cpa: number | null
}

export type LandingPageBreakdown = {
  landingPage: string
  spend: number
  purchases: number
  cpa: number | null
  cvr: number
  isWinner: boolean
}

export type BodyPartGroup = {
  bodyPart: string
  totalSpend: number
  totalPurchases: number
  landingPages: LandingPageBreakdown[]
}

export type AdsetDetailRow = {
  adsetId: string
  adsetName: string
  campaignName: string
  campaignType: CampaignType
  campaignLabel: string
  landingPage: string | null
  spend: number
  impressions: number
  purchases: number
  revenue: number
  cpa: number | null
  cvr: number
  roas: number
}

// ── Aggregation helpers ──

/** Summarise spend/purchases/CPA per campaign type (ASC, Retargeting, each body part) */
export function summariseByCampaignType(
  rows: Partial<MetaDailyRow>[]
): CampaignTypeSummary[] {
  // Bucket rows by "type|label"
  const buckets = new Map<string, { type: CampaignType; label: string; rows: Partial<MetaDailyRow>[] }>()

  for (const row of rows) {
    if (!row.campaign_id) continue
    const cls = classifyCampaign(row.campaign_name)
    const key = `${cls.type}|${cls.label}`
    const existing = buckets.get(key)
    if (existing) {
      existing.rows.push(row)
    } else {
      buckets.set(key, { type: cls.type, label: cls.label, rows: [row] })
    }
  }

  const summaries: CampaignTypeSummary[] = []
  buckets.forEach(({ type, label, rows }) => {
    const agg = aggregateMetrics(rows)
    summaries.push({
      type,
      label,
      spend: agg.spend,
      purchases: agg.purchases,
      cpa: agg.purchases > 0 ? agg.spend / agg.purchases : null,
    })
  })

  // Sort: ASC first, Retargeting second, body parts by spend desc
  summaries.sort((a, b) => {
    const order: Record<CampaignType, number> = { ASC: 0, Retargeting: 1, BodyPart: 2 }
    if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type]
    return b.spend - a.spend
  })

  return summaries
}

/** Group body-part campaign rows by body part → landing page, rank landing pages by CPA */
export function groupBodyPartLandingPages(
  rows: Partial<MetaDailyRow>[]
): BodyPartGroup[] {
  // Only body-part rows
  const bodyPartRows = rows.filter((r) => {
    if (!r.campaign_name) return false
    return classifyCampaign(r.campaign_name).type === "BodyPart"
  })

  // Bucket: bodyPart → landingPage → rows
  const byBodyPart = new Map<string, Map<string, Partial<MetaDailyRow>[]>>()

  for (const row of bodyPartRows) {
    const cls = classifyCampaign(row.campaign_name)
    const lp = extractLandingPage(row.adset_name) || "Unknown"
    const bp = cls.label
    if (!byBodyPart.has(bp)) byBodyPart.set(bp, new Map())
    const lpMap = byBodyPart.get(bp)!
    if (!lpMap.has(lp)) lpMap.set(lp, [])
    lpMap.get(lp)!.push(row)
  }

  const groups: BodyPartGroup[] = []
  byBodyPart.forEach((lpMap, bodyPart) => {
    const landingPages: LandingPageBreakdown[] = []
    let totalSpend = 0
    let totalPurchases = 0

    lpMap.forEach((lpRows, lp) => {
      const agg = aggregateMetrics(lpRows)
      const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : null
      const cvr = agg.impressions > 0 ? agg.purchases / agg.impressions : 0
      landingPages.push({
        landingPage: lp,
        spend: agg.spend,
        purchases: agg.purchases,
        cpa,
        cvr,
        isWinner: false,
      })
      totalSpend += agg.spend
      totalPurchases += agg.purchases
    })

    // Sort landing pages by CPA (nulls last)
    landingPages.sort((a, b) => {
      if (a.cpa === null && b.cpa === null) return 0
      if (a.cpa === null) return 1
      if (b.cpa === null) return -1
      return a.cpa - b.cpa
    })

    // Mark the winner (best CPA with at least 1 purchase)
    const winner = landingPages.find((lp) => lp.cpa !== null && lp.purchases >= 1)
    if (winner) winner.isWinner = true

    groups.push({
      bodyPart,
      totalSpend,
      totalPurchases,
      landingPages,
    })
  })

  // Sort body parts by total spend desc
  groups.sort((a, b) => b.totalSpend - a.totalSpend)
  return groups
}

/** Build a flat list of adset-level detail rows for the breakdown table */
export function buildAdsetDetailRows(
  rows: Partial<MetaDailyRow>[]
): AdsetDetailRow[] {
  // Bucket by adset_id
  const byAdset = new Map<string, Partial<MetaDailyRow>[]>()
  for (const row of rows) {
    if (!row.adset_id) continue
    const list = byAdset.get(row.adset_id) || []
    list.push(row)
    byAdset.set(row.adset_id, list)
  }

  const results: AdsetDetailRow[] = []
  byAdset.forEach((adsetRows, adsetId) => {
    const first = adsetRows[0]
    if (!first) return
    const agg = aggregateMetrics(adsetRows)
    const cls = classifyCampaign(first.campaign_name)
    const lp = extractLandingPage(first.adset_name)
    results.push({
      adsetId,
      adsetName: first.adset_name || adsetId,
      campaignName: first.campaign_name || "",
      campaignType: cls.type,
      campaignLabel: cls.label,
      landingPage: lp,
      spend: agg.spend,
      impressions: agg.impressions,
      purchases: agg.purchases,
      revenue: agg.revenue,
      cpa: agg.purchases > 0 ? agg.spend / agg.purchases : null,
      cvr: agg.impressions > 0 ? agg.purchases / agg.impressions : 0,
      roas: agg.spend > 0 ? agg.revenue / agg.spend : 0,
    })
  })

  return results
}
