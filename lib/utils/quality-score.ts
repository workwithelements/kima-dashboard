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
 * A keyword-level QS row from `google_ads_keyword_quality`.
 */
export type KeywordQualityRow = {
  campaign_id: string
  campaign_name: string
  ad_group_id: string
  ad_group_name: string
  criterion_id: string
  keyword_text: string
  spend: number
  impressions: number
  /** 1–10. Null when Google Ads has no score yet (low-volume keyword). */
  quality_score: number | null
  expected_ctr: QualityBand
  ad_relevance: QualityBand
  landing_page_experience: QualityBand
}

/**
 * A historical Quality Score snapshot condensed to just the scores, used for
 * the WoW / vs-previous-month comparison columns. Keyed maps rather than full
 * rows keep the payload sent to the client small.
 */
export type QualitySnapshotComparison = {
  /** The comparison snapshot's date (YYYY-MM-DD) */
  snapshot_date: string
  /** ad_group_id → spend-weighted quality score (1–10) */
  ad_groups: Record<string, number>
  /** criterion_id → keyword quality score (scored keywords only) */
  keywords: Record<string, number>
}

/** Quality Score data for the dashboard: latest snapshot + historical comparisons */
export type GoogleAdsQualityData = {
  rows: KeywordQualityRow[]
  /** Nearest snapshot ≥ 7 days before the current one, or null if history doesn't reach back */
  weekAgo: QualitySnapshotComparison | null
  /** Nearest snapshot ≥ 1 calendar month before the current one, or null if history doesn't reach back */
  monthAgo: QualitySnapshotComparison | null
}

export const EMPTY_QUALITY_DATA: GoogleAdsQualityData = {
  rows: [],
  weekAgo: null,
  monthAgo: null,
}

/** Condense a snapshot's keyword rows into the score maps used for comparisons. */
export function toSnapshotComparison(
  snapshotDate: string,
  rows: KeywordQualityRow[]
): QualitySnapshotComparison {
  const ad_groups: Record<string, number> = {}
  for (const ag of rollupAdGroupQualityScore(rows)) {
    ad_groups[ag.ad_group_id] = ag.quality_score
  }
  const keywords: Record<string, number> = {}
  for (const r of rows) {
    if (r.quality_score != null) keywords[r.criterion_id] = r.quality_score
  }
  return { snapshot_date: snapshotDate, ad_groups, keywords }
}

/**
 * A keyword is "weak" if any of its three components is below average —
 * Google's explicit "this is hurting you" signal. Null-QS keywords (no data)
 * aren't counted as weak.
 */
export function isWeakKeyword(r: KeywordQualityRow): boolean {
  return (
    r.expected_ctr === "below_average" ||
    r.ad_relevance === "below_average" ||
    r.landing_page_experience === "below_average"
  )
}

/**
 * Roll keyword-level scores up to ad-group level, weighted by spend.
 *
 * Quality Score / component bands are averaged only over keywords that actually
 * have a score — Google Ads returns a null QS for low-volume keywords, and
 * counting those as zero would unfairly drag the ad group down. Spend and
 * impressions still reflect every keyword so the totals match the rest of the
 * dashboard. Ad groups with no scored keywords (e.g. all too low-volume) are
 * dropped, since there's nothing meaningful to show.
 *
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
    const scored = list.filter((r) => r.quality_score != null)
    if (scored.length === 0) continue

    const scoredSpend = scored.reduce((s, r) => s + r.spend, 0)
    // Weight by spend across scored keywords; if they have no spend, weight evenly.
    const weightOf = (r: KeywordQualityRow) =>
      scoredSpend > 0 ? r.spend : 1 / scored.length
    const weightTotal = scoredSpend > 0 ? scoredSpend : 1

    const wAvg = (pick: (r: KeywordQualityRow) => number) =>
      scored.reduce((s, r) => s + pick(r) * weightOf(r), 0) / weightTotal

    const totalSpend = list.reduce((s, r) => s + r.spend, 0)
    const weakSpend = list.filter(isWeakKeyword).reduce((s, r) => s + r.spend, 0)

    const first = list[0]
    result.push({
      campaign_id: first.campaign_id,
      campaign_name: first.campaign_name,
      ad_group_id: first.ad_group_id,
      ad_group_name: first.ad_group_name,
      spend: totalSpend,
      impressions: list.reduce((s, r) => s + r.impressions, 0),
      weak_spend_share: totalSpend > 0 ? weakSpend / totalSpend : 0,
      quality_score: Math.round(wAvg((r) => r.quality_score as number) * 10) / 10,
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
 * Whether an ad group has a genuine Quality Score weakness worth flagging:
 * a below-average component (Google's explicit "this is hurting you" signal),
 * or an overall score in the red zone (< 5). Healthy ad groups — average or
 * better across the board with a decent overall score — don't qualify, so the
 * crucial-amends panel stays quiet rather than always surfacing "the worst of a
 * good bunch".
 */
export function needsAttention(ag: AdGroupQualityScore): boolean {
  const hasBelowAverage =
    ag.expected_ctr === "below_average" ||
    ag.ad_relevance === "below_average" ||
    ag.landing_page_experience === "below_average"
  return hasBelowAverage || ag.quality_score < 5
}

/**
 * The most pressing ad groups to fix: among those with a real weakness
 * (see `needsAttention`), the spend-weighted lowest Quality Score. Priority =
 * spend × (10 − QS), so a poor score that costs real money ranks above a poor
 * score on a tiny ad group. Returns up to `n` — fewer (or none) when the
 * account is healthy.
 */
export function crucialAmends(
  adGroups: AdGroupQualityScore[],
  n = 3
): AdGroupQualityScore[] {
  return adGroups
    .filter(needsAttention)
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
