"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { Card, MetricCard } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import { fmtNumber, fmtPercent, fmtCurrency, fmtDelta } from "@/lib/utils/format"

// Lazy-load heavy chart components
const ChartPlaceholder = () => (
  <div className="h-64 animate-pulse rounded bg-neutral-800/50" />
)
const ReachChart = dynamic(() => import("@/components/charts/reach-chart"), {
  ssr: false,
  loading: ChartPlaceholder,
})
const SaturationGauge = dynamic(
  () => import("@/components/charts/saturation-gauge"),
  { ssr: false, loading: ChartPlaceholder }
)
const CpmrChart = dynamic(() => import("@/components/charts/cpmr-chart"), {
  ssr: false,
  loading: ChartPlaceholder,
})
const SaturationTimelineChart = dynamic(
  () => import("@/components/charts/saturation-timeline-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
import {
  dailyReachSeries,
  prepareReachData,
  calculateSaturation,
  detectReachFatigue,
  dailyCpmrSeries,
  rollingSaturationSeries,
} from "@/lib/utils/reach"
import type { DatePreset } from "@/lib/utils/dates"

type ReachRow = { date: string; reach: number; impressions: number; spend?: number }

type Props = {
  rows: ReachRow[]
  baselineReach: number
  preset: DatePreset
  from: string
  to: string
  currency?: string
  comparisonRows?: ReachRow[]
}

export default function ReachAnalysisView({
  rows,
  baselineReach,
  preset,
  from,
  to,
  currency = "GBP",
  comparisonRows = [],
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

  // — Primary period data —
  const dailyReach = dailyReachSeries(rows)
  const reachData = prepareReachData(dailyReach, baselineReach)

  const totalReach = rows.reduce((sum, r) => sum + (r.reach || 0), 0)
  const totalImpressions = rows.reduce((sum, r) => sum + (r.impressions || 0), 0)
  const totalSpend = rows.reduce((sum, r) => sum + (r.spend || 0), 0)

  const saturation = calculateSaturation(totalImpressions, totalReach, totalSpend, reachData)

  const cpmr = totalReach > 0 ? (totalSpend / totalReach) * 1000 : 0
  const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0

  const totalNewReach = reachData.reduce((sum, d) => sum + d.newReach, 0)
  const avgNewReachPct =
    reachData.length > 0
      ? reachData.reduce((sum, d) => sum + d.newReachPct, 0) / reachData.length
      : 0

  // — Comparison period data —
  const hasComparison = comparisonRows.length > 0
  let compTotalReach = 0
  let compTotalImpressions = 0
  let compTotalSpend = 0
  let compAvgNewReachPct = 0
  let compFrequency = 0
  let compCpmr = 0
  let compCpm = 0

  if (hasComparison) {
    compTotalReach = comparisonRows.reduce((sum, r) => sum + (r.reach || 0), 0)
    compTotalImpressions = comparisonRows.reduce((sum, r) => sum + (r.impressions || 0), 0)
    compTotalSpend = comparisonRows.reduce((sum, r) => sum + (r.spend || 0), 0)

    const compDailyReach = dailyReachSeries(comparisonRows)
    const compReachData = prepareReachData(compDailyReach, 0)
    compAvgNewReachPct =
      compReachData.length > 0
        ? compReachData.reduce((sum, d) => sum + d.newReachPct, 0) / compReachData.length
        : 0

    compFrequency = compTotalReach > 0 ? compTotalImpressions / compTotalReach : 0
    compCpmr = compTotalReach > 0 ? (compTotalSpend / compTotalReach) * 1000 : 0
    compCpm = compTotalImpressions > 0 ? (compTotalSpend / compTotalImpressions) * 1000 : 0
  }

  // Deltas
  const reachDelta = hasComparison ? fmtDelta(totalReach, compTotalReach) : null
  const newReachPctDelta = hasComparison ? fmtDelta(avgNewReachPct, compAvgNewReachPct) : null
  const freqDelta = hasComparison ? fmtDelta(saturation.avgFrequency, compFrequency) : null
  const cpmrDelta = hasComparison ? fmtDelta(cpmr, compCpmr) : null
  const cpmDelta = hasComparison ? fmtDelta(cpm, compCpm) : null

  // — Charts data —
  const cpmrData = dailyCpmrSeries(
    rows.map((r) => ({
      date: r.date,
      spend: r.spend || 0,
      impressions: r.impressions,
      reach: r.reach,
    }))
  )

  const saturationTimeline = rollingSaturationSeries(dailyReach, baselineReach, 7)
  const fatigueDays = detectReachFatigue(reachData)

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
        <MetricCard
          label="Total Reach"
          value={fmtNumber(totalReach)}
          delta={reachDelta}
        />
        <MetricCard
          label="Est. New Reach %"
          value={fmtPercent(avgNewReachPct, 1)}
          subValue={`${fmtNumber(totalNewReach)} new users`}
          delta={newReachPctDelta}
        />
        <MetricCard
          label="Avg Frequency"
          value={`${saturation.avgFrequency.toFixed(2)}x`}
          delta={freqDelta}
          invertDelta
        />
        <MetricCard
          label="CPMr"
          value={fmtCurrency(cpmr, currency)}
          subValue="Cost per 1k reach"
          delta={cpmrDelta}
          invertDelta
        />
        <MetricCard
          label="CPM"
          value={fmtCurrency(cpm, currency)}
          subValue="Cost per 1k impressions"
          delta={cpmDelta}
          invertDelta
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
            <CpmrChart data={cpmrData} height={280} currency={currency} />
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

    </div>
  )
}
