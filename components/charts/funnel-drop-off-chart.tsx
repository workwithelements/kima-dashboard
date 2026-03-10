"use client"

import { useMemo } from "react"
import type { AggregatedMetrics } from "@/lib/utils/types"
import { calculateFunnelStep, FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"
import { fmtNumber } from "@/lib/utils/format"
import { getFunnelColor } from "./funnel-chart"

type Props = {
  metrics: AggregatedMetrics
  funnelSteps: string[]
}

type FunnelBar = {
  label: string
  count: number
  color: string
}

/** Sqrt scaling to balance between linear (impressions dominates) and log (too compressed) */
const scale = (count: number, max: number) =>
  max > 0 ? Math.max(Math.sqrt(count / max) * 100, 15) : 15

export default function FunnelDropOffChart({ metrics, funnelSteps }: Props) {
  const bars = useMemo(() => {
    const result: FunnelBar[] = [
      { label: "Impressions", count: metrics.impressions, color: "#a3a3a3" },
    ]
    for (let i = 0; i < funnelSteps.length; i++) {
      const def = FUNNEL_STEP_DEFS[funnelSteps[i]]
      if (!def) continue
      const vals = calculateFunnelStep(funnelSteps[i], metrics)
      result.push({
        label: def.label,
        count: vals.count,
        color: getFunnelColor(i),
      })
    }
    return result
  }, [metrics, funnelSteps])

  if (bars.length < 2) return null

  const maxCount = bars[0].count || 1

  return (
    <div className="flex flex-col items-center gap-0">
      {bars.map((bar, i) => {
        const widthPct = scale(bar.count, maxCount)
        const prevCount = i > 0 ? bars[i - 1].count : 0
        const dropOff =
          i > 0 && prevCount > 0
            ? ((prevCount - bar.count) / prevCount) * 100
            : null

        return (
          <div key={bar.label} className="flex w-full flex-col items-center">
            {/* Drop-off connector */}
            {dropOff !== null && (
              <div className="flex flex-col items-center py-0.5">
                <div className="h-3 w-px bg-neutral-700" />
                <span className="text-[10px] text-neutral-500">
                  ↓ {dropOff.toFixed(1)}% drop-off
                </span>
                <div className="h-1.5 w-px bg-neutral-700" />
              </div>
            )}
            {/* Centered box */}
            <div
              className="flex items-center justify-between rounded-lg px-4 py-2.5 transition-all"
              style={{
                width: `${widthPct}%`,
                minWidth: "180px",
                backgroundColor: bar.color + "1A",
                border: `1px solid ${bar.color}40`,
              }}
            >
              <span className="truncate text-xs font-medium text-neutral-300">
                {bar.label}
              </span>
              <span className="ml-3 whitespace-nowrap text-xs font-semibold" style={{ color: bar.color }}>
                {fmtNumber(bar.count)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
