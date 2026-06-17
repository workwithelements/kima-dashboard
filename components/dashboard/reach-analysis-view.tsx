"use client"

import { useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { Card, MetricCard } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import AdSetSelector from "@/components/ui/adset-selector"
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
  buildReachBuckets,
  granularityWindow,
  formatBucketLabel,
  DEFAULT_WEEKS,
  DEFAULT_MONTHS,
  type Granularity,
} from "@/lib/utils/reach"
import { deriveReachEvents } from "@/lib/utils/reach-events"
import AnnotationsBar, { type Annotation } from "@/components/ui/annotations-bar"
import type { DatePreset } from "@/lib/utils/dates"

type ReachRow = {
  date: string
  reach: number
  impressions: number
  spend?: number
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
}

type Props = {
  clientId: string
  rows: ReachRow[]
  baselineReach: number
  preset: DatePreset
  from: string
  to: string
  currency?: string
  comparisonRows?: ReachRow[]
  /** Full lifetime daily reach (inception → period end) for the granularity
   *  toggle and deduped lifetime new-reach calculation. Falls back to `rows`. */
  lifetimeRows?: ReachRow[]
  /** Manual annotations for the client (rendered as flags on the reach chart). */
  annotations?: Annotation[]
  /** Read-only (public share view) — hides annotation add/delete controls. */
  readOnly?: boolean
}

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Days" },
  { value: "week", label: `Weeks` },
  { value: "month", label: `Months` },
]

export default function ReachAnalysisView({
  clientId,
  rows,
  baselineReach,
  preset,
  from,
  to,
  currency = "GBP",
  comparisonRows = [],
  lifetimeRows,
  annotations: initialAnnotations = [],
  readOnly = false,
}: Props) {
  const [granularity, setGranularity] = useState<Granularity>("day")
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations)
  const lifetime = lifetimeRows && lifetimeRows.length > 0 ? lifetimeRows : rows
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

  // Extract unique ad sets from the lifetime rows (most complete set)
  const adsets = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of lifetime) {
      if (r.adset_id && r.adset_name) map.set(r.adset_id, r.adset_name)
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [lifetime])

  const [selectedAdSets, setSelectedAdSets] = useState<string[]>(() =>
    adsets.map((a) => a.id)
  )

  const allAdSetsSelected =
    selectedAdSets.length === 0 || selectedAdSets.length === adsets.length

  // Filter rows by selected ad sets
  const filteredRows = useMemo(() => {
    if (allAdSetsSelected) return rows
    return rows.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [rows, selectedAdSets, allAdSetsSelected])

  const filteredCompRows = useMemo(() => {
    if (allAdSetsSelected) return comparisonRows
    return comparisonRows.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [comparisonRows, selectedAdSets, allAdSetsSelected])

  const filteredLifetime = useMemo(() => {
    if (allAdSetsSelected) return lifetime
    return lifetime.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [lifetime, selectedAdSets, allAdSetsSelected])

  // Lifetime cumulative reach series (deduped via the running-baseline model,
  // accumulated from inception). New reach in any period is measured against
  // this so users first reached earlier in the lifetime aren't re-counted.
  const lifetimeDaily = useMemo(() => dailyReachSeries(filteredLifetime), [filteredLifetime])
  const lifetimePrepared = useMemo(() => prepareReachData(lifetimeDaily, 0), [lifetimeDaily])

  // Bucketed series for the time-series charts, per granularity + window.
  const { windowFrom, windowTo } = granularityWindow(granularity, from, to)
  const buckets = useMemo(
    () => buildReachBuckets(lifetimeDaily, granularity, windowFrom, windowTo),
    [lifetimeDaily, granularity, windowFrom, windowTo]
  )

  // Auto-detected reach-change flags: buckets where net-new reach moved materially,
  // with likely causes attributed from launches / spend / saturation.
  const autoEvents = useMemo(
    () =>
      deriveReachEvents({
        bucketReach: buckets.reach,
        lifetimeRows: filteredLifetime,
        granularity,
        windowTo,
      }),
    [buckets.reach, filteredLifetime, granularity, windowTo]
  )

  // True new reach during the SELECTED period as a share of lifetime reach.
  const selectedNew = useMemo(() => {
    const inPeriod = lifetimePrepared.filter((p) => p.date >= from && p.date <= to)
    const newReach = inPeriod.reduce((s, d) => s + d.newReach, 0)
    const upToEnd = lifetimePrepared.filter((p) => p.date <= to)
    const lifetimeCum = upToEnd.length ? upToEnd[upToEnd.length - 1].totalReach : 0
    return { newReach, lifetimeCum, pct: lifetimeCum > 0 ? (newReach / lifetimeCum) * 100 : 0 }
  }, [lifetimePrepared, from, to])

  const compNew = useMemo(() => {
    if (filteredCompRows.length === 0) return null
    const dates = filteredCompRows.map((r) => r.date).filter(Boolean).sort()
    const cFrom = dates[0]
    const cTo = dates[dates.length - 1]
    const inPeriod = lifetimePrepared.filter((p) => p.date >= cFrom && p.date <= cTo)
    const newReach = inPeriod.reduce((s, d) => s + d.newReach, 0)
    const upToEnd = lifetimePrepared.filter((p) => p.date <= cTo)
    const lifetimeCum = upToEnd.length ? upToEnd[upToEnd.length - 1].totalReach : 0
    return { newReach, pct: lifetimeCum > 0 ? (newReach / lifetimeCum) * 100 : 0 }
  }, [filteredCompRows, lifetimePrepared])

  // — Primary period data (scorecards reflect the selected date range) —
  const dailyReach = dailyReachSeries(filteredRows)
  const reachData = prepareReachData(dailyReach, baselineReach)

  const totalReach = filteredRows.reduce((sum, r) => sum + (r.reach || 0), 0)
  const totalImpressions = filteredRows.reduce((sum, r) => sum + (r.impressions || 0), 0)
  const totalSpend = filteredRows.reduce((sum, r) => sum + (r.spend || 0), 0)

  const saturation = calculateSaturation(totalImpressions, totalReach, totalSpend, reachData)

  const cpmr = totalReach > 0 ? (totalSpend / totalReach) * 1000 : 0
  const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0

  // True new reach for the selected period as a share of lifetime reach.
  const totalNewReach = selectedNew.newReach
  const avgNewReachPct = selectedNew.pct

  // — Comparison period data —
  const hasComparison = filteredCompRows.length > 0
  let compTotalReach = 0
  let compTotalImpressions = 0
  let compTotalSpend = 0
  let compFrequency = 0
  let compCpmr = 0
  let compCpm = 0

  if (hasComparison) {
    compTotalReach = filteredCompRows.reduce((sum, r) => sum + (r.reach || 0), 0)
    compTotalImpressions = filteredCompRows.reduce((sum, r) => sum + (r.impressions || 0), 0)
    compTotalSpend = filteredCompRows.reduce((sum, r) => sum + (r.spend || 0), 0)

    compFrequency = compTotalReach > 0 ? compTotalImpressions / compTotalReach : 0
    compCpmr = compTotalReach > 0 ? (compTotalSpend / compTotalReach) * 1000 : 0
    compCpm = compTotalImpressions > 0 ? (compTotalSpend / compTotalImpressions) * 1000 : 0
  }

  // Deltas
  const reachDelta = hasComparison ? fmtDelta(totalReach, compTotalReach) : null
  const newReachPctDelta =
    hasComparison && compNew ? fmtDelta(avgNewReachPct, compNew.pct) : null
  const freqDelta = hasComparison ? fmtDelta(saturation.avgFrequency, compFrequency) : null
  const cpmrDelta = hasComparison ? fmtDelta(cpmr, compCpmr) : null
  const cpmDelta = hasComparison ? fmtDelta(cpm, compCpm) : null

  // — Charts data (bucketed per the selected granularity / window) —
  const cpmrData = buckets.cpmr
  const saturationTimeline = buckets.saturation
  const fatigueDays = detectReachFatigue(buckets.reach)
  const bucketLabel = (s: string) => formatBucketLabel(s, granularity)

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-medium text-neutral-400">Reach Analysis</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Granularity toggle: Days (date select) / Weeks (12) / Months (6) */}
          <div className="inline-flex rounded-lg border border-neutral-700 bg-neutral-800/50 p-0.5">
            {GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGranularity(opt.value)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  granularity === opt.value
                    ? "bg-brand-lime/15 text-brand-lime"
                    : "text-neutral-400 hover:text-white"
                }`}
                title={
                  opt.value === "day"
                    ? "Daily — pinned to the selected date range"
                    : opt.value === "week"
                      ? `Weekly — last ${DEFAULT_WEEKS} weeks`
                      : `Monthly — last ${DEFAULT_MONTHS} months`
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <AdSetSelector
            items={adsets}
            selected={selectedAdSets}
            onChange={setSelectedAdSets}
            label="ad sets"
          />
          <DateRangePicker
            preset={preset}
            from={from}
            to={to}
            onPresetChange={handlePresetChange}
            onCustomChange={handleCustomChange}
          />
        </div>
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
          subValue={`${fmtNumber(totalNewReach)} new of ${fmtNumber(selectedNew.lifetimeCum)} lifetime`}
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
          <h2 className="mb-4 flex items-center justify-between text-sm font-medium text-neutral-400">
            <span>Reach Over Time</span>
            <span className="text-[10px] font-normal text-neutral-600">
              {granularity === "day"
                ? "Daily · selected range"
                : granularity === "week"
                  ? `Weekly · last ${DEFAULT_WEEKS} weeks`
                  : `Monthly · last ${DEFAULT_MONTHS} months`}
              {" · new reach vs lifetime"}
            </span>
          </h2>
          {buckets.reach.length > 0 ? (
            <ReachChart
              data={buckets.reach}
              granularity={granularity}
              fatigueDays={fatigueDays}
              height={300}
              events={autoEvents}
              annotations={annotations.map((a) => ({ date: a.date, text: a.text }))}
            />
          ) : (
            <p className="py-12 text-center text-xs text-neutral-500">
              No reach data for this period
            </p>
          )}

          {/* Flag legend + manual notes */}
          {buckets.reach.length > 0 && (
            <div className="mt-2 border-t border-neutral-800/60 pt-2">
              <div className="flex items-center gap-4 text-[10px] text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <span className="text-[#60A5FA]">◆</span> auto-detected reach change
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-brand-lime">▼</span> your note
                </span>
                <span className="text-neutral-600">hover a flag&apos;s bar for details</span>
              </div>
              <AnnotationsBar
                annotations={annotations}
                clientId={clientId}
                from={from}
                to={to}
                readOnly={readOnly}
                onAdd={(a) =>
                  setAnnotations((prev) =>
                    [...prev, a].sort((x, y) => x.date.localeCompare(y.date))
                  )
                }
                onDelete={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
              />
            </div>
          )}
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
            <CpmrChart data={cpmrData} height={280} currency={currency} labelFormatter={bucketLabel} />
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
            <SaturationTimelineChart data={saturationTimeline} height={280} labelFormatter={bucketLabel} />
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
