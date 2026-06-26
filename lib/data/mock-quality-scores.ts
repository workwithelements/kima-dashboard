/**
 * MOCK Quality Score data — Phase 1.
 *
 * Quality Score isn't collected by the Google Ads sync yet (it lives at keyword
 * level and isn't fetched). To build and demo the UI now, we derive plausible
 * ad-group QS from the real GA rows already loaded: genuine campaign/ad-group
 * names and spend, deterministically seeded scores. No randomness, so the view
 * is stable across renders.
 *
 * Phase 2 replaces this with `rollupAdGroupQualityScore` over real keyword data;
 * the section component and helpers stay unchanged.
 */

import type { AdGroupQualityScore, GoogleAdsDailyRow, QualityBand } from "../utils/types"

/** Small deterministic string hash (FNV-1a-ish) → unsigned 32-bit int */
function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const BANDS: QualityBand[] = ["below_average", "average", "above_average"]

/** Pick a band from a 0–999 bucket, skewed by the overall score */
function bandFor(seed: number, score: number): QualityBand {
  // Lower overall scores bias toward worse component bands.
  const bucket = (seed % 1000) / 1000
  const skew = score / 10 // 0.1 (bad) → 1.0 (great)
  const v = bucket * 0.6 + skew * 0.4
  if (v < 0.4) return BANDS[0]
  if (v < 0.72) return BANDS[1]
  return BANDS[2]
}

export function buildMockQualityScores(
  gaRows: Partial<GoogleAdsDailyRow>[]
): AdGroupQualityScore[] {
  const groups = new Map<
    string,
    {
      campaign_id: string
      campaign_name: string
      ad_group_name: string
      spend: number
      impressions: number
    }
  >()

  for (const r of gaRows) {
    if (!r.ad_group_id) continue
    const g = groups.get(r.ad_group_id)
    if (g) {
      g.spend += r.spend || 0
      g.impressions += r.impressions || 0
    } else {
      groups.set(r.ad_group_id, {
        campaign_id: r.campaign_id || "unknown",
        campaign_name: r.campaign_name || r.campaign_id || "Unknown campaign",
        ad_group_name: r.ad_group_name || r.ad_group_id || "Unknown ad group",
        spend: r.spend || 0,
        impressions: r.impressions || 0,
      })
    }
  }

  const result: AdGroupQualityScore[] = []
  for (const [adGroupId, g] of Array.from(groups.entries())) {
    const seed = hash(adGroupId)
    // Overall QS 3–10, deterministic per ad group.
    const quality_score = 3 + (seed % 71) / 10 // 3.0–10.0
    result.push({
      campaign_id: g.campaign_id,
      campaign_name: g.campaign_name,
      ad_group_id: adGroupId,
      ad_group_name: g.ad_group_name,
      spend: g.spend,
      impressions: g.impressions,
      quality_score: Math.round(quality_score * 10) / 10,
      expected_ctr: bandFor(hash("ctr" + adGroupId), quality_score),
      ad_relevance: bandFor(hash("rel" + adGroupId), quality_score),
      landing_page_experience: bandFor(hash("lp" + adGroupId), quality_score),
    })
  }

  return result.sort((a, b) => b.spend - a.spend)
}
