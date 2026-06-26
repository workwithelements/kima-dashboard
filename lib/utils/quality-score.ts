/**
 * Quality Score helpers — shared between the dashboard UI and (Phase 2) the
 * keyword→ad-group roll-up off real Google Ads data.
 *
 * Quality Score is a 1–10 keyword-level metric in Google Ads. Its three
 * constituent parts (Expected CTR, Ad Relevance, Landing Page Experience) are
 * categorical: Below average / Average / Above average. To present them at
 * ad-group level we roll keyword scores up weighted by spend.
 */

import type { AdGroupQualityScore, QualityBand } from "./types"

/** Component bands worst→best, with their ordinal value used for weighting */
export const QS_BANDS: Record<QualityBand, { label: string; ordinal: number }> = {
  below_average: { label: "Below average", ordinal: 1 },
  average: { label: "Average", ordinal: 2 },
  above_average: { label: "Above average", ordinal: 3 },
}

export function bandLabel(band: QualityBand): string {
  return QS_BANDS[band].label
}

/** Tailwind text colour for a component band (red / amber / green) */
export function bandColor(band: QualityBand): string {
  switch (band) {
    case "above_average":
      return "text-green-400"
    case "average":
      return "text-amber-400"
    case "below_average":
      return "text-red-400"
  }
}

/** Tailwind badge classes (bg tint + text) for a component band */
export function bandBadge(band: QualityBand): string {
  switch (band) {
    case "above_average":
      return "bg-green-500/15 text-green-400"
    case "average":
      return "bg-amber-500/15 text-amber-400"
    case "below_average":
      return "bg-red-500/15 text-red-400"
  }
}

/** Tailwind text colour for an overall 1–10 Quality Score */
export function qsColor(score: number): string {
  if (score >= 8) return "text-green-400"
  if (score >= 5) return "text-amber-400"
  return "text-red-400"
}

const ORDINAL_TO_BAND: QualityBand[] = ["below_average", "below_average", "average", "above_average"]

/** Map a (rounded) ordinal 1–3 back to a band */
function ordinalToBand(ord: number): QualityBand {
  const i = Math.max(1, Math.min(3, Math.round(ord)))
  return ORDINAL_TO_BAND[i]
}

/**
 * A keyword-level QS row (Phase 2 shape from `keyword_view`). Phase 1 builds
 * mock ad-group rows directly, so this is exercised once the real sync lands.
 */
export type KeywordQualityRow = {
  campaign_id: string
  campaign_name: string
  ad_group_id: string
  ad_group_name: string
  spend: number
  impressions: number
  quality_score: number
  expected_ctr: QualityBand
  ad_relevance: QualityBand
  landing_page_experience: QualityBand
}

/**
 * Roll keyword-level scores up to ad-group level, weighted by spend.
 * Keywords with zero spend fall back to an even weight so they still count.
 */
export function rollupAdGroupQualityScore(rows: KeywordQualityRow[]): AdGroupQualityScore[] {
  const groups = new Map<string, KeywordQualityRow[]>()
  for (const r of rows) {
    const list = groups.get(r.ad_group_id)
    if (list) list.push(r)
    else groups.set(r.ad_group_id, [r])
  }

  const result: AdGroupQualityScore[] = []
  for (const list of Array.from(groups.values())) {
    const totalSpend = list.reduce((s, r) => s + r.spend, 0)
    // Weight by spend; if the whole ad group has no spend, weight evenly.
    const weightOf = (r: KeywordQualityRow) =>
      totalSpend > 0 ? r.spend : 1 / list.length
    const weightTotal = totalSpend > 0 ? totalSpend : 1

    const wAvg = (pick: (r: KeywordQualityRow) => number) =>
      list.reduce((s, r) => s + pick(r) * weightOf(r), 0) / weightTotal

    const first = list[0]
    result.push({
      campaign_id: first.campaign_id,
      campaign_name: first.campaign_name,
      ad_group_id: first.ad_group_id,
      ad_group_name: first.ad_group_name,
      spend: totalSpend,
      impressions: list.reduce((s, r) => s + r.impressions, 0),
      quality_score: Math.round(wAvg((r) => r.quality_score) * 10) / 10,
      expected_ctr: ordinalToBand(wAvg((r) => QS_BANDS[r.expected_ctr].ordinal)),
      ad_relevance: ordinalToBand(wAvg((r) => QS_BANDS[r.ad_relevance].ordinal)),
      landing_page_experience: ordinalToBand(
        wAvg((r) => QS_BANDS[r.landing_page_experience].ordinal)
      ),
    })
  }

  return result.sort((a, b) => b.spend - a.spend)
}

/**
 * The most pressing ad groups to fix: spend-weighted lowest Quality Score.
 * Priority = spend × (10 − QS), so a poor score that costs real money ranks
 * above a poor score on a tiny ad group. Returns the top `n`.
 */
export function crucialAmends(
  adGroups: AdGroupQualityScore[],
  n = 3
): AdGroupQualityScore[] {
  return [...adGroups]
    .map((ag) => ({ ag, priority: ag.spend * (10 - ag.quality_score) }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, n)
    .map((x) => x.ag)
}

const COMPONENT_META: {
  key: "expected_ctr" | "ad_relevance" | "landing_page_experience"
  label: string
  fix: string
}[] = [
  {
    key: "expected_ctr",
    label: "Expected CTR",
    fix: "tighten ad copy & keyword match to lift click-through",
  },
  {
    key: "ad_relevance",
    label: "Ad Relevance",
    fix: "align ad text more closely with the ad group's keywords",
  },
  {
    key: "landing_page_experience",
    label: "Landing Page Experience",
    fix: "review landing page relevance, speed & mobile UX",
  },
]

/**
 * Which components are dragging an ad group's score down — below-average first,
 * then average — worst-first, each with a short fix suggestion. Used for the
 * "Driven by:" copy in the crucial-amends panel.
 */
export function drivers(
  ag: AdGroupQualityScore
): { label: string; band: QualityBand; fix: string }[] {
  return COMPONENT_META.map((c) => ({ label: c.label, band: ag[c.key], fix: c.fix }))
    .filter((c) => c.band !== "above_average")
    .sort((a, b) => QS_BANDS[a.band].ordinal - QS_BANDS[b.band].ordinal)
}
