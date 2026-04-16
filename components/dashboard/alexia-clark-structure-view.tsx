"use client"

import { useMemo } from "react"
import { Card } from "@/components/ui/card"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import {
  summariseByCampaignType,
  groupBodyPartLandingPages,
} from "@/lib/utils/alexia-clark-structure"
import type { MetaDailyRow } from "@/lib/utils/types"

type Props = {
  rows: Partial<MetaDailyRow>[]
  currency?: string
}

export default function AlexiaClarkStructureView({ rows, currency = "GBP" }: Props) {

  const summaries = useMemo(() => summariseByCampaignType(rows), [rows])
  const bodyPartGroups = useMemo(() => groupBodyPartLandingPages(rows), [rows])

  // Best & worst CPA across summaries (for color coding)
  const { bestCpa, worstCpa } = useMemo(() => {
    const cpas = summaries.map((s) => s.cpa).filter((c): c is number => c !== null)
    if (cpas.length === 0) return { bestCpa: null, worstCpa: null }
    return { bestCpa: Math.min(...cpas), worstCpa: Math.max(...cpas) }
  }, [summaries])

  if (summaries.length === 0) return null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Campaign Structure Analysis</h2>
        <p className="text-xs text-neutral-500">
          Performance by campaign type, with landing page winners inside body-part campaigns.
        </p>
      </div>

      {/* ── Section 1: Campaign Type Summary ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summaries.map((s) => {
          const isBest = s.cpa !== null && s.cpa === bestCpa && summaries.length > 1
          const isWorst = s.cpa !== null && s.cpa === worstCpa && summaries.length > 1
          const cpaColor = isBest ? "text-green-400" : isWorst ? "text-red-400" : "text-white"
          return (
            <div
              key={`${s.type}-${s.label}`}
              className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                {s.label}
              </p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${cpaColor}`}>
                {s.cpa !== null ? fmtCurrency(s.cpa, currency) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">
                {fmtCurrency(s.spend, currency)} spend &middot; {fmtNumber(s.purchases)} purchases
              </p>
            </div>
          )
        })}
      </div>

      {/* ── Section 2: Landing Page Winners per Body Part ── */}
      {(() => {
        // Only show groups that actually have multiple landing page variants
        const multiLpGroups = bodyPartGroups.filter((g) => g.landingPages.length > 1)
        if (multiLpGroups.length === 0) return null
        return (
          <Card>
            <h3 className="mb-4 text-sm font-semibold">Landing Page Performance by Body Part</h3>
            <div className="space-y-6">
              {multiLpGroups.map((group) => {
                // Max CPA for bar scaling (only non-null)
              const maxCpa = Math.max(
                ...group.landingPages.map((lp) => lp.cpa || 0),
                1
              )
              return (
                <div key={group.bodyPart}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h4 className="text-sm font-medium uppercase tracking-wider text-neutral-300">
                      {group.bodyPart}
                    </h4>
                    <span className="text-[11px] text-neutral-500">
                      {fmtCurrency(group.totalSpend, currency)} total &middot; {fmtNumber(group.totalPurchases)} purchases
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {group.landingPages.map((lp) => {
                      // Invert so LOWER CPA gets LONGER bar
                      const inverted = lp.cpa !== null ? 1 - lp.cpa / maxCpa : 0
                      const barWidth = Math.max(8, inverted * 100)
                      // Color: green for winner, amber for mid, red for worst
                      let barColor = "bg-neutral-700"
                      if (lp.isWinner) barColor = "bg-green-500/80"
                      else if (lp.cpa !== null) {
                        const ratio = lp.cpa / maxCpa
                        if (ratio < 0.6) barColor = "bg-brand-lime/60"
                        else if (ratio < 0.85) barColor = "bg-amber-500/60"
                        else barColor = "bg-red-500/50"
                      }
                      return (
                        <div key={lp.landingPage} className="flex items-center gap-3 text-xs">
                          <div className="w-14 shrink-0 font-medium text-neutral-300">
                            {lp.landingPage}
                          </div>
                          <div className="flex-1 overflow-hidden rounded bg-neutral-800">
                            <div
                              className={`h-5 rounded ${barColor} transition-all`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <div className="flex w-36 shrink-0 items-center justify-end gap-2 tabular-nums">
                            <span className={lp.isWinner ? "font-semibold text-green-400" : "text-neutral-300"}>
                              {lp.cpa !== null ? fmtCurrency(lp.cpa, currency) : "—"}
                            </span>
                            {lp.isWinner && (
                              <span className="rounded border border-green-500/30 bg-green-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-green-400">
                                WINNER
                              </span>
                            )}
                          </div>
                          <div className="hidden w-32 shrink-0 text-right text-[10px] text-neutral-500 sm:block">
                            {fmtCurrency(lp.spend, currency)} &middot; {fmtNumber(lp.purchases)} purch
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            </div>
          </Card>
        )
      })()}

    </div>
  )
}

