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
    <div className="space-y-1">
      {bars.map((bar, i) => {
        const widthPct = Math.max((bar.count / maxCount) * 100, 5)
        const prevCount = i > 0 ? bars[i - 1].count : 0
        const dropOff =
          i > 0 && prevCount > 0
            ? ((prevCount - bar.count) / prevCount) * 100
            : null

        return (
          <div key={bar.label}>
            {/* Drop-off annotation */}
            {dropOff !== null && (
              <div className="flex items-center gap-2 py-0.5 pl-2">
                <svg className="h-3 w-3 text-neutral-500" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M3 7l3 3 3-3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[10px] text-neutral-500">
                  {dropOff.toFixed(1)}% drop-off
                </span>
              </div>
            )}
            {/* Bar */}
            <div
              className="flex items-center gap-3 rounded-md px-3 py-2 transition-all"
              style={{
                width: `${widthPct}%`,
                backgroundColor: bar.color + "1A",
                borderLeft: `3px solid ${bar.color}`,
                minWidth: "140px",
              }}
            >
              <span className="truncate text-xs font-medium text-neutral-300">
                {bar.label}
              </span>
              <span className="ml-auto whitespace-nowrap text-xs font-semibold" style={{ color: bar.color }}>
                {fmtNumber(bar.count)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
