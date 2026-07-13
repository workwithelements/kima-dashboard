"use client"

import { useMemo, useState } from "react"
import { fmtCurrency, fmtCurrencyCompact, fmtNumber } from "@/lib/utils/format"
import {
  conversionEventLabel,
  cpaSplitFor,
  type AdEfficiencyPoint,
  type EfficiencyThresholds,
  type WindowKey,
} from "@/lib/utils/reach-efficiency"
import {
  generateRecommendations,
  type ActionType,
  type CpmrFeedbackRow,
  type FeedbackStatus,
  type Recommendation,
  type TypeRates,
} from "@/lib/utils/reach-recommendations"

const TYPE_META: Record<
  ActionType,
  { badge: string; badgeClass: string; accent: string }
> = {
  scale: {
    badge: "Scale",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    accent: "text-emerald-400",
  },
  pause: {
    badge: "Pause",
    badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
    accent: "text-red-400",
  },
  protect: {
    badge: "Don't pause",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    accent: "text-amber-400",
  },
}

function recommendationCopy(
  rec: Recommendation,
  thresholds: EfficiencyThresholds,
  currency: string
): { title: string; reason: string } {
  const { ad } = rec
  const cpmr = fmtCurrency(ad.cpmr, currency)
  const cpmrMax = fmtCurrency(thresholds.cpmrMax, currency)
  const cpa = ad.cpa !== null ? fmtCurrency(ad.cpa, currency) : null
  const cpaSplit = fmtCurrency(cpaSplitFor(thresholds, ad.conversionEvent), currency)
  const event = conversionEventLabel(ad.conversionEvent)
  const spend = fmtCurrencyCompact(ad.spend, currency)
  const reach = fmtNumber(ad.reach)

  switch (rec.type) {
    case "scale":
      return {
        title: "Shift budget towards this ad",
        reason: `${reach} people reached at ${cpmr} CPMr (threshold ${cpmrMax}) with a ${cpa} CPA on ${event}, under the ${cpaSplit} split — cheap reach that converts. ${spend} already deployed; it has earned more.`,
      }
    case "pause":
      return {
        title: "Pause and reallocate this ad",
        reason: `${spend} spend buying reach at ${cpmr} CPMr (threshold ${cpmrMax})${cpa ? ` with a ${cpa} CPA on ${event}, over the ${cpaSplit} split` : " with no conversions recorded on any goal event"} — failing on both reach efficiency and CPA. Reallocate to the efficient-growth ads.`,
      }
    case "protect":
      return {
        title: "Keep this ad live despite its CPA",
        reason: `${cpa ? `A ${cpa} CPA on ${event} looks poor against the ${cpaSplit} split` : "No conversions recorded this window"}, but it buys reach at ${cpmr} CPMr vs the ${cpmrMax} threshold — among the cheapest awareness in the account (${reach} people). Pausing it typically shows up later as rising CPMs.`,
      }
  }
}

type Props = {
  points: AdEfficiencyPoint[]
  thresholds: EfficiencyThresholds
  thumbnails: Record<string, string>
  currency: string
  clientId: string
  windowKey: WindowKey
  initialFeedback: CpmrFeedbackRow[]
  typeRates: TypeRates
  readOnly?: boolean
}

export default function ReachRecommendations({
  points,
  thresholds,
  thumbnails,
  currency,
  clientId,
  windowKey,
  initialFeedback,
  typeRates,
  readOnly = false,
}: Props) {
  const [feedback, setFeedback] = useState<CpmrFeedbackRow[]>(initialFeedback)
  const [responding, setResponding] = useState<{ key: string; status: FeedbackStatus } | null>(null)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const recommendations = useMemo(
    () => generateRecommendations(points, thresholds, feedback, typeRates),
    [points, thresholds, feedback, typeRates]
  )

  async function submit(rec: Recommendation, status: FeedbackStatus, note: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/cpmr-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          ad_id: rec.ad.adId,
          ad_name: rec.ad.adName,
          action_type: rec.type,
          window_key: windowKey,
          status,
          feedback: note.trim() || null,
          metrics: {
            spend: rec.ad.spend,
            reach: rec.ad.reach,
            cpmr: rec.ad.cpmr,
            cpa: rec.ad.cpa,
            roas: rec.ad.roas,
            thresholds,
          },
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const row = (await res.json()) as CpmrFeedbackRow
      setFeedback((prev) => [row, ...prev.filter(
        (f) => !(f.ad_id === row.ad_id && f.action_type === row.action_type)
      )])
      setResponding(null)
      setReason("")
    } catch {
      setError("Couldn't save — try again")
    } finally {
      setSaving(false)
    }
  }

  if (recommendations.length === 0 && feedback.length === 0) return null

  const recentDecisions = feedback.slice(0, 3)

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-400">
          Recommended actions
          <span className="ml-2 text-[10px] font-normal text-neutral-600">
            from the reach-efficiency logic below · learns from your responses across clients
          </span>
        </h3>
        {feedback.length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-[10px] text-neutral-500 transition hover:text-neutral-300"
          >
            {showHistory ? "Hide decisions" : `Past decisions · ${feedback.length}`}
          </button>
        )}
      </div>

      {recommendations.length === 0 ? (
        <p className="py-3 text-xs text-neutral-500">
          No outstanding actions — nothing in this view is failing both jobs at
          scale, and current scale/protect calls have all been reviewed.
        </p>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec) => {
            const copy = recommendationCopy(rec, thresholds, currency)
            const meta = TYPE_META[rec.type]
            const isResponding = responding?.key === rec.key
            return (
              <div
                key={rec.key}
                className="flex flex-col gap-3 rounded-lg border border-neutral-800/80 bg-neutral-950/40 p-3 sm:flex-row sm:items-start"
              >
                {/* Creative chip */}
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-neutral-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnails[rec.ad.adId]}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(e) => { e.currentTarget.style.display = "none" }}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${meta.badgeClass}`}
                    >
                      {meta.badge}
                    </span>
                    <span className={`text-xs font-medium ${meta.accent}`}>{copy.title}</span>
                    <span className="break-words text-xs text-neutral-500">
                      {rec.ad.adName}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-400">{copy.reason}</p>

                  {/* Feedback loop */}
                  {!readOnly && (
                    isResponding ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={
                            responding!.status === "actioned"
                              ? "What did you do? (optional — helps future recommendations)"
                              : "Why not? (helps future recommendations)"
                          }
                          rows={2}
                          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-brand-lime focus:outline-none"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <button
                            disabled={saving}
                            onClick={() => submit(rec, responding!.status, reason)}
                            className="rounded-lg bg-brand-lime/15 px-3 py-1 text-xs font-medium text-brand-lime transition enabled:hover:bg-brand-lime/25 disabled:opacity-50"
                          >
                            {saving ? "Saving…" : responding!.status === "actioned" ? "Save — done" : "Save — dismissed"}
                          </button>
                          <button
                            disabled={saving}
                            onClick={() => { setResponding(null); setReason(""); setError(null) }}
                            className="px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-300"
                          >
                            Cancel
                          </button>
                          {error && <span className="text-xs text-red-400">{error}</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => { setResponding({ key: rec.key, status: "actioned" }); setReason("") }}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-500/20"
                        >
                          ✓ Done this
                        </button>
                        <button
                          onClick={() => { setResponding({ key: rec.key, status: "dismissed" }); setReason("") }}
                          className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-2.5 py-1 text-[11px] text-neutral-400 transition hover:border-neutral-600 hover:text-white"
                        >
                          ✕ Not doing this
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recent decisions — the qualitative half of the learning loop */}
      {showHistory && recentDecisions.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-neutral-800/60 pt-3">
          {recentDecisions.map((f) => (
            <p key={`${f.action_type}:${f.ad_id}`} className="text-[11px] text-neutral-500">
              <span className={f.status === "actioned" ? "text-emerald-400" : "text-neutral-400"}>
                {f.status === "actioned" ? "✓ actioned" : "✕ dismissed"}
              </span>
              <span className="mx-1.5 text-neutral-700">·</span>
              <span className="text-neutral-400">{f.action_type}</span>
              <span className="mx-1.5 text-neutral-700">·</span>
              {f.ad_name || `ad ${f.ad_id}`}
              {f.feedback && <span className="ml-1.5 italic text-neutral-500">— “{f.feedback}”</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
