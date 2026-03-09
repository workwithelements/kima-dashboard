"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, MetricCard } from "@/components/ui/card"
import ReachChart from "@/components/charts/reach-chart"
import SaturationGauge from "@/components/charts/saturation-gauge"
import CpmrChart from "@/components/charts/cpmr-chart"
import SaturationTimelineChart from "@/components/charts/saturation-timeline-chart"
import DateRangePicker from "@/components/ui/date-range-picker"
import { fmtNumber, fmtPercent, fmtCurrency } from "@/lib/utils/format"
import {
  dailyReachSeries,
  prepareReachData,
  calculateSaturation,
  detectReachFatigue,
  dailyCpmrSeries,
  rollingSaturationSeries,
} from "@/lib/utils/reach"
import type { DatePreset } from "@/lib/utils/dates"

type Props = {
  rows: { date: string; reach: number; impressions: number; spend?: number }[]
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
  const totalSpend = rows.reduce((sum, r) => sum + (r.spend || 0), 0)

  // Saturation
  const saturation = calculateSaturation(totalImpressions, totalReach, reachData)

  // CPMr
  const cpmr = totalReach > 0 ? (totalSpend / totalReach) * 1000 : 0

  // CPM vs CPMr series
  const cpmrData = dailyCpmrSeries(
    rows.map((r) => ({
      date: r.date,
      spend: r.spend || 0,
      impressions: r.impressions,
      reach: r.reach,
    }))
  )

  // Rolling saturation series
  const saturationTimeline = rollingSaturationSeries(dailyReach, baselineReach, 7)

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
          label="CPMr"
          value={fmtCurrency(cpmr)}
          subValue="Cost per 1k reach"
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

      {/* Charts row 1: Reach + Saturation gauge */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Reach Over Time
          </h2>
          <ReachChart data={reachData} fatigueDays={fatigueDays} height={300} />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Saturation Score
          </h2>
          <div className="flex items-center justify-center py-4">
            <SaturationGauge saturation={saturation} />
          </div>
        </Card>
      </div>

      {/* Charts row 2: CPM/CPMr + Saturation timeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            CPM vs CPMr
          </h2>
          {cpmrData.length > 0 ? (
            <CpmrChart data={cpmrData} height={280} />
          ) : (
            <p className="py-12 text-center text-xs text-neutral-500">
              No spend data available
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Saturation Over Time
            <span className="ml-2 text-[10px] text-neutral-600">(7-day rolling)</span>
          </h2>
          {saturationTimeline.length > 0 ? (
            <SaturationTimelineChart data={saturationTimeline} height={280} />
          ) : (
            <p className="py-12 text-center text-xs text-neutral-500">
              Need at least 7 days of data
            </p>
          )}
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
