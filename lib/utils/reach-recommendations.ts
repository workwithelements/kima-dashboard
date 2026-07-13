/**
 * CPMr report recommendations — turns the reach-efficiency classification into
 * a ranked shortlist of concrete actions, with a feedback loop that learns
 * which recommendation types the team actually acts on.
 *
 * Action types:
 *   scale   — efficient-growth ad (cheap reach + good CPA): push more budget
 *   pause   — high spend, expensive reach AND bad CPA: failing both jobs
 *   protect — reach play with scary CPA someone might wrongly pause
 *
 * Learning model: each recommendation the team resolves is stored as
 * actioned/dismissed (with a free-text reason). Ranking multiplies the
 * money-at-stake by a Laplace-smoothed acceptance rate for the action type —
 * global across all clients, blended with the client's own history when it
 * has any. Types the team keeps dismissing sink; types they act on rise.
 * Resolved ads are never re-recommended for the same action.
 */

import { cpaSplitFor, type AdEfficiencyPoint, type EfficiencyThresholds } from "./reach-efficiency"

export type ActionType = "scale" | "pause" | "protect"
export type FeedbackStatus = "actioned" | "dismissed"

export type CpmrFeedbackRow = {
  ad_id: string
  ad_name?: string | null
  action_type: ActionType
  status: FeedbackStatus
  feedback: string | null
  created_at?: string
}

/** Global (all-client) resolved counts per action type. */
export type TypeRates = Partial<Record<ActionType, { actioned: number; dismissed: number }>>

export type Recommendation = {
  /** Stable identity for the feedback loop */
  key: string
  type: ActionType
  ad: AdEfficiencyPoint
  /** Spend at stake in the window — the ranking's impact term */
  impact: number
  /** Ranking score after learning weights (exposed for debugging/tests) */
  score: number
}

/** Laplace-smoothed acceptance rate: (actioned+1)/(actioned+dismissed+2).
 *  With no history this is 0.5, so new types start neutral. */
function acceptanceRate(counts?: { actioned: number; dismissed: number }): number {
  const a = counts?.actioned ?? 0
  const d = counts?.dismissed ?? 0
  return (a + 1) / (a + d + 2)
}

function typeWeight(
  type: ActionType,
  globalRates: TypeRates,
  clientRates: TypeRates
): number {
  const global = acceptanceRate(globalRates[type])
  const client = clientRates[type]
  // Blend 50/50 with the client's own history once it exists — a client that
  // consistently overrides a rec type teaches us faster than the global pool.
  return client ? (global + acceptanceRate(client)) / 2 : global
}

/** Client-level counts derived from the client's feedback rows. */
export function clientTypeRates(feedback: CpmrFeedbackRow[]): TypeRates {
  const rates: TypeRates = {}
  for (const row of feedback) {
    const entry = (rates[row.action_type] ||= { actioned: 0, dismissed: 0 })
    if (row.status === "actioned") entry.actioned++
    else entry.dismissed++
  }
  return rates
}

/**
 * Generate the top `max` recommended actions for the current (filtered) view.
 * Guarantees at most one recommendation per ad and prefers covering distinct
 * action types before doubling up on one.
 */
export function generateRecommendations(
  points: AdEfficiencyPoint[],
  thresholds: EfficiencyThresholds,
  feedback: CpmrFeedbackRow[],
  globalRates: TypeRates = {},
  max = 3
): Recommendation[] {
  const resolved = new Set(feedback.map((f) => `${f.action_type}:${f.ad_id}`))
  const clientRates = clientTypeRates(feedback)
  const weight: Record<ActionType, number> = {
    scale: typeWeight("scale", globalRates, clientRates),
    pause: typeWeight("pause", globalRates, clientRates),
    protect: typeWeight("protect", globalRates, clientRates),
  }

  const candidates: Recommendation[] = []
  const push = (type: ActionType, ad: AdEfficiencyPoint, impact: number) => {
    const key = `${type}:${ad.adId}`
    if (resolved.has(key)) return
    candidates.push({ key, type, ad, impact, score: impact * weight[type] })
  }

  for (const p of points) {
    // Judge CPA against the split for the ad set's own goal event
    const split = cpaSplitFor(thresholds, p.conversionEvent)
    if (p.classification === "efficient") {
      // Best-of-both ads: more budget here buys cheap reach that converts
      push("scale", p, p.spend)
    } else if (p.classification === "reachPlay") {
      // Only flag the reach plays someone might actually pause: CPA well past
      // the split (or unmeasurable) despite healthy reach buying
      if (p.cpa === null || p.cpa > split * 1.25) {
        push("protect", p, p.spend)
      }
    } else if (
      p.spend >= thresholds.spendMin &&
      p.cpmr > thresholds.cpmrMax &&
      (p.cpa === null || p.cpa > split)
    ) {
      // Top-quartile spend buying expensive reach with a bad CPA — failing
      // both jobs; the reallocation candidates
      push("pause", p, p.spend)
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  // One rec per ad; cover distinct types first, then fill by score
  const picked: Recommendation[] = []
  const usedAds = new Set<string>()
  const usedTypes = new Set<ActionType>()
  for (const diversityPass of [true, false]) {
    for (const c of candidates) {
      if (picked.length >= max) break
      if (usedAds.has(c.ad.adId)) continue
      if (diversityPass && usedTypes.has(c.type)) continue
      picked.push(c)
      usedAds.add(c.ad.adId)
      usedTypes.add(c.type)
    }
  }
  return picked.sort((a, b) => b.score - a.score)
}
