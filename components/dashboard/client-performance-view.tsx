"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { MetaDailyRow, Client, ComparisonType, HierarchyLevel } from "@/lib/utils/types"
import { aggregateMetrics, deriveMetrics, dailySpendSeries, dailyFunnelSeries, groupByLevel } from "@/lib/utils/aggregate"
import { fmtCurrency, fmtNumber, fmtPercent, fmtDelta } from "@/lib/utils/format"
import { calculateFunnelStep, calculateNetNewReach, FUNNEL_STEP_DEFS, type FunnelStepKey } from "@/lib/utils/funnel-steps"
import type { DatePreset } from "@/lib/utils/dates"
import { Card, MetricCard } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import AdSetSelector from "@/components/ui/adset-selector"
import MetricChart from "@/components/charts/metric-chart"
import FunnelChart, { getFunnelColor, type FunnelSeriesDef } from "@/components/charts/funnel-chart"
import FunnelDropOffChart from "@/components/charts/funnel-drop-off-chart"
import PerformanceTable from "@/components/tables/performance-table"
import ScorecardConfigModal from "./scorecard-config-modal"

type Props = {
  client: Client
  rows: Partial<MetaDailyRow>[]
  comparisonRows: Partial<MetaDailyRow>[]
  preset: DatePreset
  from: string
  to: string
  compareType: ComparisonType
  baselineReach?: number
  funnelSteps?: string[] | null
  /** Hide configure button (for public view) */
  readOnly?: boolean
}

const COMPARE_OPTIONS: { value: ComparisonType; label: string }[] = [
  { value: "previous_period", label: "vs Previous period" },
  { value: "previous_month", label: "vs Previous month" },
  { value: "previous_year", label: "vs Previous year" },
  { value: "none", label: "No comparison" },
]

export default function ClientPerformanceView({
  client,
  rows,
  comparisonRows,
  preset,
  from,
  to,
  compareType,
  baselineReach = 0,
  funnelSteps: initialSteps = null,
  readOnly = false,
}: Props) {
  const router = useRouter()
  const [level, setLevel] = useState<HierarchyLevel>("campaign")
  const [showConfig, setShowConfig] = useState(false)
  const [funnelSteps, setFunnelSteps] = useState<string[]>(initialSteps || [])

  // Extract unique ad sets from rows
  const adsets = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) {
      if (r.adset_id && r.adset_name) map.set(r.adset_id, r.adset_name)
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [rows])

  const [selectedAdSets, setSelectedAdSets] = useState<string[]>(() =>
    adsets.map((a) => a.id)
  )

  // Filter rows by selected ad sets
  const filteredRows = useMemo(() => {
    if (selectedAdSets.length === 0 || selectedAdSets.length === adsets.length) return rows
    return rows.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [rows, selectedAdSets, adsets.length])

  const filteredCompRows = useMemo(() => {
    if (selectedAdSets.length === 0 || selectedAdSets.length === adsets.length) return comparisonRows
    return comparisonRows.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [comparisonRows, selectedAdSets, adsets.length])

  // Aggregated metrics from filtered rows
  const metrics = useMemo(() => aggregateMetrics(filteredRows), [filteredRows])
  const derived = useMemo(() => deriveMetrics(metrics), [metrics])
  const compMetrics = useMemo(() => aggregateMetrics(filteredCompRows), [filteredCompRows])
  const compDerived = useMemo(() => deriveMetrics(compMetrics), [compMetrics])

  // Net New Reach
  const netNewReach = useMemo(() => {
    const dailyRows = filteredRows
      .filter((r) => r.reach != null)
      .map((r) => ({ reach: r.reach || 0, impressions: r.impressions || 0 }))
    return calculateNetNewReach(dailyRows, baselineReach)
  }, [filteredRows, baselineReach])

  const compNetNewReach = useMemo(() => {
    if (compareType === "none" || filteredCompRows.length === 0) return 0
    const dailyRows = filteredCompRows
      .filter((r) => r.reach != null)
      .map((r) => ({ reach: r.reach || 0, impressions: r.impressions || 0 }))
    return calculateNetNewReach(dailyRows, 0)
  }, [filteredCompRows, compareType])

  // Chart data
  const spendSeries = useMemo(
    () => dailySpendSeries(filteredRows).map((d) => ({ date: d.date, value: d.spend })),
    [filteredRows]
  )

  // Build funnel chart series from configured steps
  const funnelChartSeries: FunnelSeriesDef[] = useMemo(
    () =>
      funnelSteps
        .map((key, i) => {
          const def = FUNNEL_STEP_DEFS[key]
          if (!def) return null
          return { key, label: def.label, color: getFunnelColor(i) }
        })
        .filter(Boolean) as FunnelSeriesDef[],
    [funnelSteps]
  )
  const funnelSeries = useMemo(
    () => dailyFunnelSeries(filteredRows, funnelSteps),
    [filteredRows, funnelSteps]
  )

  // Table data
  const groupedData = useMemo(() => groupByLevel(filteredRows, level), [filteredRows, level])

  // Has comparison data?
  const hasComp = compareType !== "none" && filteredCompRows.length > 0

  // Delta helper
  const delta = (current: number, prev: number) =>
    hasComp ? fmtDelta(current, prev) : null

  // Navigation helpers
  function updateSearchParams(updates: Record<string, string>) {
    const params = new URLSearchParams()
    const merged = { preset, from, to, compare: compareType, ...updates }
    for (const [key, val] of Object.entries(merged)) {
      if (val) params.set(key, val)
    }
    router.push(`/dashboard/clients/${client.id}?${params.toString()}`)
  }

  function handlePresetChange(p: DatePreset) {
    updateSearchParams({ preset: p, from: "", to: "" })
  }

  function handleCustomChange(newFrom: string, newTo: string) {
    updateSearchParams({ preset: "custom", from: newFrom, to: newTo })
  }

  function handleCompareChange(c: ComparisonType) {
    updateSearchParams({ compare: c })
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <AdSetSelector
          adsets={adsets}
          selected={selectedAdSets}
          onChange={setSelectedAdSets}
        />

        <select
          value={compareType}
          onChange={(e) => handleCompareChange(e.target.value as ComparisonType)}
          className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600"
        >
          {COMPARE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <DateRangePicker
          preset={preset}
          from={from}
          to={to}
          onPresetChange={handlePresetChange}
          onCustomChange={handleCustomChange}
        />
      </div>

      {/* Core metrics — always shown */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Spend"
          value={fmtCurrency(metrics.spend)}
          delta={delta(metrics.spend, compMetrics.spend)}
        />
        <MetricCard
          label="Impressions"
          value={fmtNumber(metrics.impressions)}
          delta={delta(metrics.impressions, compMetrics.impressions)}
        />
        <MetricCard
          label="CPM"
          value={fmtCurrency(derived.cpm)}
          delta={delta(derived.cpm, compDerived.cpm)}
          invertDelta
        />
        <MetricCard
          label="Net New Reach"
          value={fmtNumber(netNewReach)}
          delta={delta(netNewReach, compNetNewReach)}
        />
      </div>

      {/* Funnel steps — per-client configurable */}
      {funnelSteps.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-400">Funnel Metrics</h2>
            {!readOnly && (
              <button
                onClick={() => setShowConfig(true)}
                className="flex items-center gap-1 rounded-lg border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-white"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Configure
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {funnelSteps.map((stepKey) => {
              const def = FUNNEL_STEP_DEFS[stepKey]
              if (!def) return null
              const vals = calculateFunnelStep(stepKey, metrics)
              const compVals = hasComp ? calculateFunnelStep(stepKey, compMetrics) : null
              return [
                <MetricCard
                  key={`${stepKey}-count`}
                  label={def.label}
                  value={fmtNumber(vals.count)}
                  delta={compVals ? delta(vals.count, compVals.count) : null}
                />,
                <MetricCard
                  key={`${stepKey}-rate`}
                  label={def.rateLabel}
                  value={vals.rate !== null ? fmtPercent(vals.rate) : "—"}
                  delta={
                    compVals && vals.rate !== null && compVals.rate !== null
                      ? delta(vals.rate, compVals.rate)
                      : null
                  }
                />,
                <MetricCard
                  key={`${stepKey}-cost`}
                  label={def.costLabel}
                  value={vals.costPer !== null ? fmtCurrency(vals.costPer) : "—"}
                  delta={
                    compVals && vals.costPer !== null && compVals.costPer !== null
                      ? delta(vals.costPer, compVals.costPer)
                      : null
                  }
                  invertDelta
                />,
              ]
            })}
          </div>
        </div>
      )}

      {/* Configure button when no steps configured */}
      {funnelSteps.length === 0 && !readOnly && (
        <div className="flex justify-center">
          <button
            onClick={() => setShowConfig(true)}
            className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-700 px-4 py-2.5 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add funnel steps
          </button>
        </div>
      )}

      {/* Charts */}
      <div className={`grid gap-4 ${funnelSteps.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Spend</h2>
          <MetricChart data={spendSeries} label="Spend" color="#CDFF00" format="currency" height={260} />
        </Card>

        {funnelSteps.length > 0 && (
          <Card>
            <h2 className="mb-4 text-sm font-medium text-neutral-400">Funnel Trends</h2>
            <FunnelChart data={funnelSeries} series={funnelChartSeries} />
          </Card>
        )}
      </div>

      {/* Funnel drop-off */}
      {funnelSteps.length > 0 && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Funnel Drop-Off</h2>
          <FunnelDropOffChart metrics={metrics} funnelSteps={funnelSteps} />
        </Card>
      )}

      {/* Performance table */}
      <Card>
        <h2 className="mb-4 text-sm font-medium text-neutral-400">
          Breakdown
        </h2>
        <PerformanceTable
          data={groupedData}
          level={level}
          onLevelChange={setLevel}
          funnelSteps={funnelSteps}
        />
      </Card>

      {/* Scorecard config modal */}
      {showConfig && (
        <ScorecardConfigModal
          clientId={client.id}
          selectedSteps={funnelSteps}
          onClose={() => setShowConfig(false)}
          onSaved={(steps) => {
            setFunnelSteps(steps)
            setShowConfig(false)
          }}
        />
      )}
    </div>
  )
}
