"use client"

import { useState, useMemo } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, MetricCard } from "@/components/ui/card"
import MetricChart from "@/components/charts/metric-chart"
import FunnelChart, { getFunnelColor, type FunnelSeriesDef } from "@/components/charts/funnel-chart"
import ReachChart from "@/components/charts/reach-chart"
import SaturationGauge from "@/components/charts/saturation-gauge"
import PacingCard from "@/components/dashboard/pacing-card"
import AdSetSelector from "@/components/ui/adset-selector"
import Logo from "@/components/ui/logo"
import {
  fmtCurrency,
  fmtNumber,
  fmtPercent,
} from "@/lib/utils/format"
import AnnotationsBar, { type Annotation } from "@/components/ui/annotations-bar"
import { aggregateMetrics, deriveMetrics, dailyFunnelSeries } from "@/lib/utils/aggregate"
import {
  dailyReachSeries,
  prepareReachData,
  calculateSaturation,
  detectReachFatigue,
} from "@/lib/utils/reach"
import { calculateFunnelStep, calculateNetNewReach, FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"
import type { PacingResult } from "@/lib/utils/pacing"

type Row = {
  date: string
  adset_id?: string
  adset_name?: string
  spend: number
  impressions: number
  reach: number
  unique_link_clicks: number
  landing_page_views: number
  adds_to_cart: number
  registrations_completed: number
  checkouts_initiated: number
  purchases: number
  purchase_value: number
  app_installs: number
}

type Tab = "performance" | "pacing" | "reach"

const DATE_PRESETS = [
  { label: "Last 7 days", value: "last_7d" },
  { label: "Last 30 days", value: "last_30d" },
  { label: "This month", value: "this_month" },
]

export default function ClientDashboard({
  clientName,
  data,
  pacing,
  monthlyBudget,
  currentMonthDailySpend,
  reachRows,
  baselineReach,
  funnelSteps,
  keyAction: _keyAction,
  annotations: initialAnnotations = [],
  preset,
  from,
  to,
  tab: initialTab,
}: {
  clientName: string
  data: Row[]
  pacing: PacingResult
  monthlyBudget: number | null
  currentMonthDailySpend: { date: string; spend: number }[]
  reachRows: { date: string; reach: number; impressions: number }[]
  baselineReach: number
  funnelSteps: string[] | null
  keyAction: string | null
  annotations?: Annotation[]
  preset: string
  from: string
  to: string
  tab: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab === "pacing" ? "pacing" : initialTab === "reach" ? "reach" : "performance"
  )

  // Extract unique ad sets
  const adsets = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of data) {
      if (r.adset_id && r.adset_name) map.set(r.adset_id, r.adset_name)
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [data])

  const [selectedAdSets, setSelectedAdSets] = useState<string[]>(() =>
    adsets.map((a) => a.id)
  )

  // Filter rows by selected ad sets
  const filteredData = useMemo(() => {
    if (selectedAdSets.length === 0 || selectedAdSets.length === adsets.length) return data
    return data.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [data, selectedAdSets, adsets.length])

  // Handle date preset change
  function handlePresetChange(newPreset: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("preset", newPreset)
    params.delete("from")
    params.delete("to")
    params.set("tab", activeTab)
    router.push(`${pathname}?${params.toString()}`)
  }

  // Handle tab change
  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    router.push(`${pathname}?${params.toString()}`)
  }

  // Aggregate performance data from filtered rows
  const metrics = useMemo(() => aggregateMetrics(filteredData), [filteredData])
  const derived = useMemo(() => deriveMetrics(metrics), [metrics])

  // Net New Reach
  const netNewReach = useMemo(() => {
    const dailyRows = filteredData
      .filter((r) => r.reach != null)
      .map((r) => ({ reach: r.reach || 0, impressions: r.impressions || 0 }))
    return calculateNetNewReach(dailyRows, baselineReach)
  }, [filteredData, baselineReach])

  // Chart data
  const spendChartData = useMemo(() => {
    const byDate: Record<string, number> = {}
    for (const row of filteredData) {
      byDate[row.date] = (byDate[row.date] || 0) + (row.spend || 0)
    }
    return Object.entries(byDate)
      .map(([date, spend]) => ({ date, value: Math.round(spend * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredData])

  const steps = funnelSteps || []

  // Build funnel chart series from configured steps
  const funnelChartSeries: FunnelSeriesDef[] = useMemo(
    () =>
      steps
        .map((key, i) => {
          const def = FUNNEL_STEP_DEFS[key]
          if (!def) return null
          return { key, label: def.label, color: getFunnelColor(i) }
        })
        .filter(Boolean) as FunnelSeriesDef[],
    [steps]
  )
  const funnelData = useMemo(
    () => dailyFunnelSeries(filteredData, steps),
    [filteredData, steps]
  )

  // Pacing chart data
  const pacingSpendChartData = currentMonthDailySpend.map((d) => ({
    date: d.date,
    value: d.spend,
  }))

  let cumulative = 0
  const cumulativeSeries = currentMonthDailySpend.map((d) => {
    cumulative += d.spend
    return { date: d.date, value: Math.round(cumulative * 100) / 100 }
  })

  // Format display dates
  const displayFrom = new Date(from + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
  const displayTo = new Date(to + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Logo className="text-white" />
            <div className="h-6 w-px bg-neutral-700" />
            <h1 className="text-lg font-semibold">{clientName}</h1>
          </div>
          <p className="text-xs text-neutral-500">
            {displayFrom} – {displayTo}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {/* Tab bar + controls row */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-neutral-900 p-1">
            <button
              onClick={() => handleTabChange("performance")}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
                activeTab === "performance"
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Performance
            </button>
            <button
              onClick={() => handleTabChange("pacing")}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
                activeTab === "pacing"
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Budget & Pacing
            </button>
            <button
              onClick={() => handleTabChange("reach")}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
                activeTab === "reach"
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Reach Analysis
            </button>
          </div>

          {/* Date presets + ad set selector (performance + reach tabs) */}
          {(activeTab === "performance" || activeTab === "reach") && (
            <div className="flex items-center gap-3">
              <AdSetSelector
                adsets={adsets}
                selected={selectedAdSets}
                onChange={setSelectedAdSets}
              />
              <div className="flex gap-1 rounded-lg bg-neutral-900 p-1">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handlePresetChange(p.value)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      preset === p.value
                        ? "bg-brand-lime/10 text-brand-lime"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Performance tab */}
        {activeTab === "performance" && (
          <div className="space-y-6">
            {/* Core metrics — always shown */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Spend" value={fmtCurrency(metrics.spend)} />
              <MetricCard label="Impressions" value={fmtNumber(metrics.impressions)} />
              <MetricCard label="CPM" value={fmtCurrency(derived.cpm)} />
              <MetricCard label="Net New Reach" value={fmtNumber(netNewReach)} />
            </div>

            {/* Funnel steps — per-client configured */}
            {steps.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-medium text-neutral-400">Funnel Metrics</h2>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {steps.map((stepKey) => {
                    const def = FUNNEL_STEP_DEFS[stepKey]
                    if (!def) return null
                    const vals = calculateFunnelStep(stepKey, metrics)
                    return [
                      <MetricCard
                        key={`${stepKey}-count`}
                        label={def.label}
                        value={fmtNumber(vals.count)}
                      />,
                      <MetricCard
                        key={`${stepKey}-rate`}
                        label={def.rateLabel}
                        value={vals.rate !== null ? fmtPercent(vals.rate) : "—"}
                      />,
                      <MetricCard
                        key={`${stepKey}-cost`}
                        label={def.costLabel}
                        value={vals.costPer !== null ? fmtCurrency(vals.costPer) : "—"}
                      />,
                    ]
                  })}
                </div>
              </div>
            )}

            {/* Charts */}
            <div className={`grid gap-4 ${steps.length > 0 ? "lg:grid-cols-2" : ""}`}>
              <Card>
                <h2 className="mb-4 text-sm font-medium text-neutral-400">
                  Daily Spend
                </h2>
                <MetricChart
                  data={spendChartData}
                  label="Spend"
                  color="#CDFF00"
                  format="currency"
                  height={260}
                  annotations={initialAnnotations}
                />
                {initialAnnotations.length > 0 && (
                  <AnnotationsBar
                    annotations={initialAnnotations}
                    clientId=""
                    from={from}
                    to={to}
                    readOnly
                  />
                )}
              </Card>

              {steps.length > 0 && (
                <Card>
                  <h2 className="mb-4 text-sm font-medium text-neutral-400">
                    Funnel Trends
                  </h2>
                  <FunnelChart data={funnelData} series={funnelChartSeries} />
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Pacing tab */}
        {activeTab === "pacing" && (
          <div className="space-y-6">
            {/* Pacing card */}
            <PacingCard pacing={pacing} />

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="mb-4 text-sm font-medium text-neutral-400">
                  Daily Spend (This Month)
                </h2>
                <MetricChart
                  data={pacingSpendChartData}
                  label="Spend"
                  color="#CDFF00"
                  format="currency"
                  height={260}
                />
              </Card>

              <Card>
                <h2 className="mb-4 text-sm font-medium text-neutral-400">
                  Cumulative Spend
                </h2>
                <MetricChart
                  data={cumulativeSeries}
                  label="Cumulative Spend"
                  color="#FF69B4"
                  format="currency"
                  height={260}
                />
              </Card>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label="Days Elapsed"
                value={`${pacing.daysElapsed} / ${pacing.daysTotal}`}
                subValue={`${pacing.daysRemaining} remaining`}
              />
              <MetricCard
                label="Avg Daily Spend"
                value={fmtCurrency(
                  pacing.daysElapsed > 0
                    ? pacing.spentToDate / pacing.daysElapsed
                    : 0
                )}
                subValue={
                  pacing.idealDailySpend
                    ? `Ideal: ${fmtCurrency(pacing.idealDailySpend)}`
                    : undefined
                }
              />
              <MetricCard
                label="Remaining Projected"
                value={fmtCurrency(pacing.remainingProjected)}
              />
              <MetricCard
                label="Spend Days"
                value={fmtNumber(
                  currentMonthDailySpend.filter((d) => d.spend > 0).length
                )}
                subValue={`of ${pacing.daysElapsed} elapsed`}
              />
            </div>

            {/* No budget warning */}
            {!monthlyBudget && (
              <Card className="border-amber-900/50 bg-amber-950/20">
                <div className="flex items-start gap-3">
                  <span className="text-amber-500">⚠️</span>
                  <div>
                    <p className="text-sm font-medium text-amber-400">No budget set</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      Contact your account manager to set a monthly budget for pacing
                      projections and alerts.
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Reach tab */}
        {activeTab === "reach" && <ReachTabContent reachRows={reachRows} baselineReach={baselineReach} />}
      </div>

      {/* Footer */}
      <footer className="mt-8 border-t border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo className="text-neutral-600" />
          <p className="text-[10px] text-neutral-600">
            Report generated automatically · Data from Meta Ads
          </p>
        </div>
      </footer>
    </div>
  )
}

/** Reach tab inner content — extracted for cleanliness */
function ReachTabContent({
  reachRows,
  baselineReach,
}: {
  reachRows: { date: string; reach: number; impressions: number }[]
  baselineReach: number
}) {
  const dailyReach = dailyReachSeries(reachRows)
  const reachData = prepareReachData(dailyReach, baselineReach)

  const totalReach = reachRows.reduce((sum, r) => sum + (r.reach || 0), 0)
  const totalImpressions = reachRows.reduce((sum, r) => sum + (r.impressions || 0), 0)
  const saturation = calculateSaturation(totalImpressions, totalReach, 0, reachData)
  const fatigueDays = detectReachFatigue(reachData)

  const totalNewReach = reachData.reduce((sum, d) => sum + d.newReach, 0)
  const avgNewReachPct =
    reachData.length > 0
      ? reachData.reduce((sum, d) => sum + d.newReachPct, 0) / reachData.length
      : 0
  const cumulativeReach =
    reachData.length > 0 ? reachData[reachData.length - 1].totalReach : 0

  return (
    <div className="space-y-6">
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
