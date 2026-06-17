/**
 * Auto-detected "reach change" events for the Reach Analysis chart.
 *
 * The reach graph's key signal is **net-new reach** per bucket. This module flags
 * buckets where net-new reach changed materially versus its recent trend, then
 * attributes the most likely cause from the data already loaded by the tab —
 * campaign / ad-set launches and endings, spend jumps, and rising frequency
 * (audience saturation). Attribution is heuristic, so summaries say "likely".
 */

import { bucketStart, type Granularity, type PreparedReachPoint } from "./reach"

export type ReachCauseType =
  | "campaign_launch"
  | "adset_launch"
  | "spend"
  | "campaign_end"
  | "adset_end"
  | "saturation"

export type ReachCause = {
  type: ReachCauseType
  label: string
  magnitude?: number
}

export type ReachEvent = {
  /** Bucket-start date — matches the chart x-axis key. */
  date: string
  direction: "up" | "down"
  /** Signed % change in net-new reach vs the trailing baseline. */
  newReachPctChange: number
  causes: ReachCause[]
  summary: string
}

/** Row shape needed for attribution (subset of the reach view's rows). */
export type ReachEventRow = {
  date: string
  reach: number
  impressions: number
  spend?: number
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
}

// ── Tunables ────────────────────────────────────────────────────────────────
const TRAILING = 3 // buckets of trailing baseline
const REL_THRESHOLD = 0.35 // ≥35% change vs baseline to flag
const SPEND_THRESHOLD = 0.3 // ≥30% bucket-over-bucket spend move to attribute
const FREQ_RISE = 1.05 // frequency must rise ≥5% to call it saturation
const MAX_EVENTS = 8 // cap flags so the chart stays readable
const MAX_CAUSES = 3 // causes shown per flag
const MIN_ABS = 1 // absolute net-new-reach floor fallback

function truncate(s: string, n = 28): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

function pctStr(v: number): string {
  const r = Math.round(v)
  return `${r >= 0 ? "+" : ""}${r}%`
}

type Appearance = { first: string; last: string; name: string; campaignId?: string }

export function deriveReachEvents({
  bucketReach,
  lifetimeRows,
  granularity,
  windowTo,
}: {
  bucketReach: PreparedReachPoint[]
  lifetimeRows: ReachEventRow[]
  granularity: Granularity
  windowTo: string
}): ReachEvent[] {
  if (bucketReach.length < 2) return []

  // Per-bucket spend / impressions / reach, snapped to the same buckets as the chart.
  const agg = new Map<string, { spend: number; impressions: number; reach: number }>()
  for (const r of lifetimeRows) {
    if (!r.date) continue
    const key = bucketStart(r.date, granularity)
    const cur = agg.get(key) || { spend: 0, impressions: 0, reach: 0 }
    cur.spend += r.spend || 0
    cur.impressions += r.impressions || 0
    cur.reach += r.reach || 0
    agg.set(key, cur)
  }

  // First / last reach-bearing appearance per ad set + campaign (lifetime).
  const adsets = new Map<string, Appearance>()
  const campaigns = new Map<string, Appearance>()
  for (const r of lifetimeRows) {
    if (!r.date || (r.reach || 0) <= 0) continue
    if (r.adset_id) {
      const a = adsets.get(r.adset_id)
      if (!a) {
        adsets.set(r.adset_id, {
          first: r.date,
          last: r.date,
          name: r.adset_name || r.adset_id,
          campaignId: r.campaign_id,
        })
      } else {
        if (r.date < a.first) a.first = r.date
        if (r.date > a.last) a.last = r.date
      }
    }
    if (r.campaign_id) {
      const c = campaigns.get(r.campaign_id)
      if (!c) {
        campaigns.set(r.campaign_id, { first: r.date, last: r.date, name: r.campaign_name || r.campaign_id })
      } else {
        if (r.date < c.first) c.first = r.date
        if (r.date > c.last) c.last = r.date
      }
    }
  }

  // Median positive net-new reach scales the noise floors (suppresses daily spam).
  const positives = bucketReach.map((b) => b.newReach).filter((v) => v > 0).sort((a, b) => a - b)
  const median = positives.length ? positives[Math.floor(positives.length / 2)] : 0
  const ABS_FLOOR = Math.max(MIN_ABS, 0.5 * median)
  const DEN_FLOOR = Math.max(1, 0.25 * median)

  const flagged: ReachEvent[] = []

  for (let i = 1; i < bucketReach.length; i++) {
    const b = bucketReach[i]
    const window = bucketReach.slice(Math.max(0, i - TRAILING), i)
    const baseline = window.reduce((s, p) => s + p.newReach, 0) / window.length
    const delta = b.newReach - baseline
    const rel = delta / Math.max(baseline, DEN_FLOOR)
    if (Math.abs(rel) < REL_THRESHOLD || Math.abs(delta) < ABS_FLOOR) continue

    const direction: "up" | "down" = delta >= 0 ? "up" : "down"
    const bDate = b.date
    const causes: ReachCause[] = []

    // Campaign launches in this bucket.
    const launchedCampaigns = new Set<string>()
    for (const [id, c] of Array.from(campaigns)) {
      if (bucketStart(c.first, granularity) === bDate) {
        launchedCampaigns.add(id)
        causes.push({ type: "campaign_launch", label: `New campaign "${truncate(c.name)}"` })
      }
    }
    // Ad-set launches (skip ad sets whose campaign is already flagged as launched).
    for (const [, a] of Array.from(adsets)) {
      if (
        bucketStart(a.first, granularity) === bDate &&
        !(a.campaignId && launchedCampaigns.has(a.campaignId))
      ) {
        causes.push({ type: "adset_launch", label: `New ad set "${truncate(a.name)}"` })
      }
    }
    // Spend change vs prior bucket.
    const curAgg = agg.get(bDate)
    const prevAgg = agg.get(bucketReach[i - 1].date)
    if (curAgg && prevAgg && prevAgg.spend > 0) {
      const sPct = ((curAgg.spend - prevAgg.spend) / prevAgg.spend) * 100
      if (Math.abs(sPct) >= SPEND_THRESHOLD * 100) {
        causes.push({ type: "spend", label: `Spend ${pctStr(sPct)}`, magnitude: sPct })
      }
    }
    // Endings — last reach-bearing day falls in this bucket and isn't just the window edge.
    const endedCampaigns = new Set<string>()
    for (const [id, c] of Array.from(campaigns)) {
      if (c.last < windowTo && bucketStart(c.last, granularity) === bDate) {
        endedCampaigns.add(id)
        causes.push({ type: "campaign_end", label: `Campaign "${truncate(c.name)}" ended` })
      }
    }
    for (const [, a] of Array.from(adsets)) {
      if (
        a.last < windowTo &&
        bucketStart(a.last, granularity) === bDate &&
        !(a.campaignId && endedCampaigns.has(a.campaignId))
      ) {
        causes.push({ type: "adset_end", label: `Ad set "${truncate(a.name)}" ended` })
      }
    }
    // Saturation — frequency rising while net-new reach fell.
    if (direction === "down" && curAgg && prevAgg && curAgg.reach > 0 && prevAgg.reach > 0) {
      const fCur = curAgg.impressions / curAgg.reach
      const fPrev = prevAgg.impressions / prevAgg.reach
      if (fCur > fPrev * FREQ_RISE) {
        causes.push({ type: "saturation", label: "Audience saturating (frequency rising)" })
      }
    }

    const order: ReachCauseType[] = [
      "campaign_launch",
      "adset_launch",
      "spend",
      "campaign_end",
      "adset_end",
      "saturation",
    ]
    causes.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    const shown = causes.slice(0, MAX_CAUSES)

    const head = `Net new reach ${pctStr(rel * 100)}`
    const summary = shown.length
      ? `${head} — ${shown.map((c) => c.label).join("; ")}`
      : `${head} — cause unclear`

    flagged.push({ date: bDate, direction, newReachPctChange: rel * 100, causes: shown, summary })
  }

  // Keep the most material, then render chronologically.
  flagged.sort((a, b) => Math.abs(b.newReachPctChange) - Math.abs(a.newReachPctChange))
  return flagged.slice(0, MAX_EVENTS).sort((a, b) => a.date.localeCompare(b.date))
}
