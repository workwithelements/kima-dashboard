"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, MetricCard } from "@/components/ui/card"
import ReachChart from "@/components/charts/reach-chart"
import SaturationGauge from "@/components/charts/saturation-gauge"
import DateRangePicker from "@/components/ui/date-range-picker"
import { fmtNumber, fmtPercent } from "@/lib/utils/format"
import {
  dailyReachSeries,
  prepareReachData,
  calculateSaturation,
  detectReachFatigue,
} from "@/lib/utils/reach"
import type { DatePreset } from "@/lib/utils/dates"

type Props = {
  rows: { date: string; reach: number; impressions: number }[]
  baselineReach: number
  preset: DatePreset
  from: string
  to: string
}

export default function ReachAnalysisView({
  rows,
  baselineReach,
  preset,
  from,
  to,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handlePresetChange(newPreset: DatePreset) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("preset", newPreset)
    params.delete("from")
    params.delete("to")
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleCustomChange(newFrom: string, newTo: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("preset", "custom")
    params.set("from", newFrom)
    params.set("to", newTo)
    router.push(`${pathname}?${params.toString()}`)
  }

  // Prepare data
  const dailyReach = dailyReachSeries(rows)
  const reachData = prepareReachData(dailyReach, baselineReach)

  // Aggregate totals
  const totalReach = rows.reduce((sum, r) => sum + (r.reach || 0), 0)
  const totalImpressions = rows.reduce((sum, r) => sum + (r.impressions || 0), 0)

  // Saturation
  const saturation = calculateSaturation(totalImpressions, totalReach, reachData)

  // Fatigue detection
  const fatigueDays = detectReachFatigue(reachData)

  // New reach summary
  const totalNewReach = reachData.reduce((sum, d) => sum + d.newReach, 0)
  const avgNewReachPct =
    reachData.length > 0
      ? reachData.reduce((sum, d) => sum + d.newReachPct, 0) / reachData.length
      : 0

  // Cumulative reach (final)
  const cumulativeReach =
    reachData.length > 0 ? reachData[reachData.length - 1].totalReach : 0

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-medium text-neutral-400">Reach Analysis</h2>
        <DateRangePicker
          preset={preset}
          from={from}
          to={to}
          onPresetChange={handlePresetChange}
          onCustomChange={handleCustomChange}
        />
      </div>

      {/* Scorecards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total Reach" value={fmtNumber(totalReach)} />
        <MetricCard
          label="Est. New Reach %"
          value={fmtPercent(avgNewReachPct, 1)}
          subValue={`${fmtNumber(totalNewReach)} new users`}
        />
        <MetricCard
          label="Avg Frequency"
          value={`${saturation.avgFrequency.toFixed(2)}x`}
        />
        <MetricCard
          label="Saturation Score"
          value={`${saturation.score}/100`}
          subValue={
            saturation.level === "low"
              ? "Healthy"
              : saturation.level === "moderate"
                ? "Monitor"
                : "Action needed"
          }
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Reach chart — 2/3 width */}
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Reach Over Time
          </h2>
          <ReachChart data={reachData} fatigueDays={fatigueDays} height={300} />
        </Card>

        {/* Saturation gauge — 1/3 width */}
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Saturation Score
          </h2>
          <div className="flex items-center justify-center py-4">
            <SaturationGauge saturation={saturation} />
          </div>
        </Card>
      </div>

      {/* Insights row */}
      <div className="grid gap-3 lg:grid-cols-3">
        <MetricCard
          label="Cumulative Reach"
          value={fmtNumber(cumulativeReach)}
          subValue={`From baseline of ${fmtNumber(baselineReach)}`}
        />
        <MetricCard
          label="Total Impressions"
          value={fmtNumber(totalImpressions)}
        />
        <MetricCard
          label="Reach Fatigue"
          value={
            fatigueDays >= 7
              ? `${fatigueDays} days declining`
              : fatigueDays >= 3
                ? `${fatigueDays} days declining`
                : "No fatigue detected"
          }
          subValue={
            fatigueDays >= 7
              ? "Consider refreshing creative"
              : fatigueDays >= 3
                ? "Monitoring trend"
                : "New reach is stable"
          }
        />
      </div>
    </div>
  )
}
