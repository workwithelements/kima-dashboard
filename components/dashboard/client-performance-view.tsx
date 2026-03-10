"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import type { MetaDailyRow, GoogleAdsDailyRow, MetaDemographicsRow, MetaPlacementsRow, Client, ComparisonType, HierarchyLevel, AggregatedMetrics } from "@/lib/utils/types"
import { getClientPlatforms } from "@/lib/utils/types"
import {
  aggregateMetrics,
  aggregateGoogleAdsMetrics,
  deriveMetrics,
  dailySpendSeries,
  dailyFunnelSeries,
  groupByLevel,
  groupGoogleAdsByLevel,
} from "@/lib/utils/aggregate"
import { fmtCurrency, fmtNumber, fmtPercent, fmtDelta } from "@/lib/utils/format"
import { calculateFunnelStep, calculateNetNewReach, FUNNEL_STEP_DEFS, type FunnelStepKey } from "@/lib/utils/funnel-steps"
import type { DatePreset } from "@/lib/utils/dates"
import { Card, MetricCard } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import AdSetSelector from "@/components/ui/adset-selector"
import PlatformSelector, { type PlatformView } from "@/components/ui/platform-selector"
import PerformanceTable from "@/components/tables/performance-table"
import ScorecardConfigModal from "./scorecard-config-modal"

// Lazy-load heavy chart components (recharts ~200KB)
const ChartPlaceholder = () => (
  <div className="h-64 animate-pulse rounded bg-neutral-800/50" />
)
const MetricChart = dynamic(() => import("@/components/charts/metric-chart"), {
  ssr: false,
  loading: ChartPlaceholder,
})
const FunnelChart = dynamic(
  () => import("@/components/charts/funnel-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
const FunnelDropOffChart = dynamic(
  () => import("@/components/charts/funnel-drop-off-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
const DemographicsChart = dynamic(
  () => import("@/components/charts/demographics-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
const PlacementsChart = dynamic(
  () => import("@/components/charts/placements-chart"),
  { ssr: false, loading: ChartPlaceholder }
)

// Re-export types/utils from funnel-chart that are used in this file
import { getFunnelColor, type FunnelSeriesDef } from "@/components/charts/funnel-chart"

type Props = {
  client: Client
  rows: Partial<MetaDailyRow>[]
  comparisonRows: Partial<MetaDailyRow>[]
  googleAdsRows?: Partial<GoogleAdsDailyRow>[]
  googleAdsComparisonRows?: Partial<GoogleAdsDailyRow>[]
  preset: DatePreset
  from: string
  to: string
  compareType: ComparisonType
  baselineReach?: number
  funnelSteps?: string[] | null
  /** Demographics breakdown rows (Meta only) */
  demographics?: MetaDemographicsRow[]
  /** Placements breakdown rows (Meta only) */
  placements?: MetaPlacementsRow[]
  /** Hide configure button (for public view) */
  readOnly?: boolean
}

const COMPARE_OPTIONS: { value: ComparisonType; label: string }[] = [
  { value: "previous_period", label: "vs Previous period" },
  { value: "previous_month", label: "vs Previous month" },
  { value: "previous_year", label: "vs Previous year" },
  { value: "none", label: "No comparison" },
]

/** Merge two AggregatedMetrics objects by summing all fields */
function mergeMetrics(a: AggregatedMetrics, b: AggregatedMetrics): AggregatedMetrics {
  return {
    spend: a.spend + b.spend,
    impressions: a.impressions + b.impressions,
    reach: a.reach + b.reach,
    clicks: a.clicks + b.clicks,
    landingPageViews: a.landingPageViews + b.landingPageViews,
    addsToCart: a.addsToCart + b.addsToCart,
    registrationsCompleted: a.registrationsCompleted + b.registrationsCompleted,
    checkoutsInitiated: a.checkoutsInitiated + b.checkoutsInitiated,
    purchases: a.purchases + b.purchases,
    revenue: a.revenue + b.revenue,
    appInstalls: a.appInstalls + b.appInstalls,
  }
}

export default function ClientPerformanceView({
  client,
  rows,
  comparisonRows,
  googleAdsRows = [],
  googleAdsComparisonRows = [],
  preset,
  from,
  to,
  compareType,
  baselineReach = 0,
  funnelSteps: initialSteps = null,
  demographics = [],
  placements = [],
  readOnly = false,
}: Props) {
  const currency = client.currency_code ?? "GBP"
  const router = useRouter()
  const [level, setLevel] = useState<HierarchyLevel>("campaign")
  const [gaLevel, setGaLevel] = useState<"campaign" | "ad_group">("campaign")
  const [showConfig, setShowConfig] = useState(false)
  const [funnelSteps, setFunnelSteps] = useState<string[]>(initialSteps || [])
  const [breakdownTab, setBreakdownTab] = useState<"demographics" | "placements">("demographics")
  const [breakdownMetric, setBreakdownMetric] = useState<"spend" | "impressions" | "purchases">("spend")

  // Platform toggle
  const platforms = useMemo(() => getClientPlatforms(client), [client])
  const [platform, setPlatform] = useState<PlatformView>(() =>
    platforms.length > 1 ? platforms[0] : platforms[0] || "meta"
  )

  const isMeta = platform === "meta"
  const isGoogleAds = platform === "google_ads"
  const isAll = platform === "all"

  // Extract unique ad sets from Meta rows (only for Meta view)
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

  // Filter Meta rows by selected ad sets
  const filteredRows = useMemo(() => {
    if (selectedAdSets.length === 0 || selectedAdSets.length === adsets.length) return rows
    return rows.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [rows, selectedAdSets, adsets.length])

  const filteredCompRows = useMemo(() => {
    if (selectedAdSets.length === 0 || selectedAdSets.length === adsets.length) return comparisonRows
    return comparisonRows.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [comparisonRows, selectedAdSets, adsets.length])

  // Aggregated metrics based on selected platform
  const metrics = useMemo(() => {
    if (isMeta) return aggregateMetrics(filteredRows)
    if (isGoogleAds) return aggregateGoogleAdsMetrics(googleAdsRows)
    // "all" — combine both
    return mergeMetrics(aggregateMetrics(filteredRows), aggregateGoogleAdsMetrics(googleAdsRows))
  }, [filteredRows, googleAdsRows, platform])

  const derived = useMemo(() => deriveMetrics(metrics), [metrics])

  const compMetrics = useMemo(() => {
    if (isMeta) return aggregateMetrics(filteredCompRows)
    if (isGoogleAds) return aggregateGoogleAdsMetrics(googleAdsComparisonRows)
    return mergeMetrics(aggregateMetrics(filteredCompRows), aggregateGoogleAdsMetrics(googleAdsComparisonRows))
  }, [filteredCompRows, googleAdsComparisonRows, platform])

  const compDerived = useMemo(() => deriveMetrics(compMetrics), [compMetrics])

  // Net New Reach (Meta only)
  const netNewReach = useMemo(() => {
    if (!isMeta && !isAll) return 0
    const dailyRows = filteredRows
      .filter((r) => r.reach != null)
      .map((r) => ({ reach: r.reach || 0, impressions: r.impressions || 0 }))
    return calculateNetNewReach(dailyRows, baselineReach)
  }, [filteredRows, baselineReach, platform])

  const compNetNewReach = useMemo(() => {
    if (!isMeta || compareType === "none" || filteredCompRows.length === 0) return 0
    const dailyRows = filteredCompRows
      .filter((r) => r.reach != null)
      .map((r) => ({ reach: r.reach || 0, impressions: r.impressions || 0 }))
    return calculateNetNewReach(dailyRows, 0)
  }, [filteredCompRows, compareType, platform])

  // Chart data — daily spend series
  const spendSeries = useMemo(() => {
    if (isMeta) {
      return dailySpendSeries(filteredRows).map((d) => ({ date: d.date, value: d.spend }))
    }
    if (isGoogleAds) {
      // Build spend series from Google Ads rows
      const byDate: Record<string, number> = {}
      for (const r of googleAdsRows) {
        if (!r.date) continue
        byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
      }
      return Object.entries(byDate)
        .map(([date, spend]) => ({ date, value: Math.round(spend * 100) / 100 }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }
    // "all" — combine both platforms
    const byDate: Record<string, number> = {}
    for (const r of filteredRows) {
      if (!r.date) continue
      byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
    }
    for (const r of googleAdsRows) {
      if (!r.date) continue
      byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
    }
    return Object.entries(byDate)
      .map(([date, spend]) => ({ date, value: Math.round(spend * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredRows, googleAdsRows, platform])

  // Build funnel chart series from configured steps (Meta only)
  const funnelChartSeries: FunnelSeriesDef[] = useMemo(
    () =>
      isMeta
        ? funnelSteps
            .map((key, i) => {
              const def = FUNNEL_STEP_DEFS[key]
              if (!def) return null
              return { key, label: def.label, color: getFunnelColor(i) }
            })
            .filter(Boolean) as FunnelSeriesDef[]
        : [],
    [funnelSteps, platform]
  )
  const funnelSeries = useMemo(
    () => (isMeta ? dailyFunnelSeries(filteredRows, funnelSteps) : []),
    [filteredRows, funnelSteps, platform]
  )

  // Table data
  const groupedData = useMemo(() => {
    if (isMeta) return groupByLevel(filteredRows, level)
    if (isGoogleAds) return groupGoogleAdsByLevel(googleAdsRows, gaLevel)
    // "all" — combine both platforms grouped by campaign
    const metaGroups = groupByLevel(filteredRows, "campaign")
    const gaGroups = groupGoogleAdsByLevel(googleAdsRows, "campaign")
    // Merge: different platforms will have different campaign IDs, so just concat
    return [...metaGroups, ...gaGroups].sort((a, b) => b.metrics.spend - a.metrics.spend)
  }, [filteredRows, googleAdsRows, level, gaLevel, platform])

  // Has comparison data?
  const hasComp = compareType !== "none" && (filteredCompRows.length > 0 || googleAdsComparisonRows.length > 0)

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

  // Show funnel only for Meta view
  const showFunnel = isMeta && funnelSteps.length > 0
  // Show reach only for Meta (or all with Meta)
  const showReach = isMeta

  // Table level options based on platform
  const tableLevelOptions = useMemo(() => {
    if (isGoogleAds) {
      return [
        { key: "campaign", label: "Campaigns" },
        { key: "ad_group", label: "Ad Groups" },
      ]
    }
    if (isAll) {
      return [{ key: "campaign", label: "Campaigns" }]
    }
    return undefined // Use default (campaign/adset/ad)
  }, [platform])

  const currentTableLevel = isGoogleAds ? gaLevel : isAll ? "campaign" : level
  const handleTableLevelChange = (newLevel: any) => {
    if (isGoogleAds) setGaLevel(newLevel)
    else if (!isAll) setLevel(newLevel)
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <PlatformSelector
          platforms={platforms}
          selected={platform}
          onChange={setPlatform}
        />

        {isMeta && (
          <AdSetSelector
            adsets={adsets}
            selected={selectedAdSets}
            onChange={setSelectedAdSets}
          />
        )}

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
          value={fmtCurrency(metrics.spend, currency)}
          delta={delta(metrics.spend, compMetrics.spend)}
        />
        <MetricCard
          label="Impressions"
          value={fmtNumber(metrics.impressions)}
          delta={delta(metrics.impressions, compMetrics.impressions)}
        />
        <MetricCard
          label={isGoogleAds ? "CPC" : "CPM"}
          value={isGoogleAds ? fmtCurrency(derived.cpc, currency) : fmtCurrency(derived.cpm, currency)}
          delta={isGoogleAds ? delta(derived.cpc, compDerived.cpc) : delta(derived.cpm, compDerived.cpm)}
          invertDelta
        />
        {showReach ? (
          <MetricCard
            label="Net New Reach"
            value={fmtNumber(netNewReach)}
            delta={delta(netNewReach, compNetNewReach)}
          />
        ) : (
          <MetricCard
            label="Clicks"
            value={fmtNumber(metrics.clicks)}
            delta={delta(metrics.clicks, compMetrics.clicks)}
          />
        )}
      </div>

      {/* Funnel steps — per-client configurable (Meta only) */}
      {showFunnel && (
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
            {funnelSteps.map((stepKey, stepIdx) => {
              const def = FUNNEL_STEP_DEFS[stepKey]
              if (!def) return null
              // Use previous funnel step as denominator (if available)
              const prevStepField = stepIdx > 0
                ? FUNNEL_STEP_DEFS[funnelSteps[stepIdx - 1]]?.field
                : undefined
              const vals = calculateFunnelStep(stepKey, metrics, prevStepField)
              const compVals = hasComp ? calculateFunnelStep(stepKey, compMetrics, prevStepField) : null
              const rateDecimals = def.rateDecimals ?? 1
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
                  value={vals.rate !== null ? fmtPercent(vals.rate, rateDecimals) : "—"}
                  delta={
                    compVals && vals.rate !== null && compVals.rate !== null
                      ? delta(vals.rate, compVals.rate)
                      : null
                  }
                />,
                <MetricCard
                  key={`${stepKey}-cost`}
                  label={def.costLabel}
                  value={vals.costPer !== null ? fmtCurrency(vals.costPer, currency) : "—"}
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

      {/* Configure button when no steps configured (Meta only) */}
      {isMeta && funnelSteps.length === 0 && !readOnly && (
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

      {/* Google Ads summary metrics */}
      {isGoogleAds && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="Conversions"
            value={fmtNumber(metrics.purchases)}
            delta={delta(metrics.purchases, compMetrics.purchases)}
          />
          <MetricCard
            label="Conv. Value"
            value={fmtCurrency(metrics.revenue, currency)}
            delta={delta(metrics.revenue, compMetrics.revenue)}
          />
          <MetricCard
            label="ROAS"
            value={derived.roas.toFixed(2) + "x"}
            delta={delta(derived.roas, compDerived.roas)}
          />
          <MetricCard
            label="CTR"
            value={fmtPercent(derived.ctr)}
            delta={delta(derived.ctr, compDerived.ctr)}
          />
        </div>
      )}

      {/* "All" platforms summary */}
      {isAll && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="Clicks"
            value={fmtNumber(metrics.clicks)}
            delta={delta(metrics.clicks, compMetrics.clicks)}
          />
          <MetricCard
            label="Conversions"
            value={fmtNumber(metrics.purchases)}
            delta={delta(metrics.purchases, compMetrics.purchases)}
          />
          <MetricCard
            label="Revenue"
            value={fmtCurrency(metrics.revenue, currency)}
            delta={delta(metrics.revenue, compMetrics.revenue)}
          />
          <MetricCard
            label="ROAS"
            value={derived.roas.toFixed(2) + "x"}
            delta={delta(derived.roas, compDerived.roas)}
          />
        </div>
      )}

      {/* Charts */}
      <div className={`grid gap-4 ${showFunnel ? "lg:grid-cols-2" : ""}`}>
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Spend</h2>
          <MetricChart data={spendSeries} label="Spend" color="#CDFF00" format="currency" height={260} />
        </Card>

        {showFunnel && (
          <Card>
            <h2 className="mb-4 text-sm font-medium text-neutral-400">Funnel Trends</h2>
            <FunnelChart data={funnelSeries} series={funnelChartSeries} />
          </Card>
        )}
      </div>

      {/* Funnel drop-off (Meta only) */}
      {showFunnel && (
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
          level={currentTableLevel}
          onLevelChange={handleTableLevelChange}
          funnelSteps={isMeta ? funnelSteps : []}
          levelOptions={tableLevelOptions}
          currency={currency}
        />
      </Card>

      {/* Breakdowns section (Meta only) */}
      {(isMeta || isAll) && (demographics.length > 0 || placements.length > 0) && (
        <BreakdownsSection
          demographics={demographics}
          placements={placements}
          tab={breakdownTab}
          onTabChange={setBreakdownTab}
          metric={breakdownMetric}
          onMetricChange={setBreakdownMetric}
          currency={currency}
          selectedAdSets={selectedAdSets}
          allAdSets={adsets.length}
        />
      )}

      {/* Scorecard config modal (Meta only) */}
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

/* ──────────────────────────────────────────────────────────────────────────── */
/*  Breakdowns Section — demographics & placements inline                     */
/* ──────────────────────────────────────────────────────────────────────────── */

type BreakdownsSectionProps = {
  demographics: MetaDemographicsRow[]
  placements: MetaPlacementsRow[]
  tab: "demographics" | "placements"
  onTabChange: (t: "demographics" | "placements") => void
  metric: "spend" | "impressions" | "purchases"
  onMetricChange: (m: "spend" | "impressions" | "purchases") => void
  currency: string
  selectedAdSets: string[]
  allAdSets: number
}

type DemoAgg = {
  spend: number
  impressions: number
  purchases: number
  purchase_value: number
  unique_link_clicks: number
}

const BREAKDOWN_METRIC_OPTIONS: { value: "spend" | "impressions" | "purchases"; label: string }[] = [
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "purchases", label: "Purchases" },
]

function BreakdownsSection({
  demographics,
  placements,
  tab,
  onTabChange,
  metric,
  onMetricChange,
  currency,
  selectedAdSets,
  allAdSets,
}: BreakdownsSectionProps) {
  // Filter breakdowns by selected ad sets
  const filteredDemographics = useMemo(() => {
    if (selectedAdSets.length === 0 || selectedAdSets.length === allAdSets) return demographics
    return demographics.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [demographics, selectedAdSets, allAdSets])

  const filteredPlacements = useMemo(() => {
    if (selectedAdSets.length === 0 || selectedAdSets.length === allAdSets) return placements
    return placements.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
  }, [placements, selectedAdSets, allAdSets])

  // Demographics summary table
  const demoTable = useMemo(() => {
    const agg = new Map<string, DemoAgg>()
    for (const r of filteredDemographics) {
      const key = `${r.age}|${r.gender}`
      const existing = agg.get(key) || { spend: 0, impressions: 0, purchases: 0, purchase_value: 0, unique_link_clicks: 0 }
      existing.spend += r.spend || 0
      existing.impressions += r.impressions || 0
      existing.purchases += r.purchases || 0
      existing.purchase_value += r.purchase_value || 0
      existing.unique_link_clicks += r.unique_link_clicks || 0
      agg.set(key, existing)
    }
    return Array.from(agg.entries())
      .map(([key, vals]) => {
        const [age, gender] = key.split("|")
        const cpa = vals.purchases > 0 ? vals.spend / vals.purchases : null
        const roas = vals.spend > 0 ? vals.purchase_value / vals.spend : 0
        const ctr = vals.impressions > 0 ? (vals.unique_link_clicks / vals.impressions) * 100 : 0
        return { age, gender, ...vals, cpa, roas, ctr }
      })
      .sort((a, b) => b.spend - a.spend)
  }, [filteredDemographics])

  // Placements summary table
  const placementTable = useMemo(() => {
    const agg = new Map<string, DemoAgg & { platform: string; position: string }>()
    for (const r of filteredPlacements) {
      const key = `${r.publisher_platform}|${r.platform_position}`
      const existing = agg.get(key) || {
        platform: r.publisher_platform,
        position: r.platform_position,
        spend: 0, impressions: 0, purchases: 0, purchase_value: 0, unique_link_clicks: 0,
      }
      existing.spend += r.spend || 0
      existing.impressions += r.impressions || 0
      existing.purchases += r.purchases || 0
      existing.purchase_value += r.purchase_value || 0
      existing.unique_link_clicks += r.unique_link_clicks || 0
      agg.set(key, existing)
    }
    return Array.from(agg.values())
      .map((vals) => {
        const cpm = vals.impressions > 0 ? (vals.spend / vals.impressions) * 1000 : 0
        const cpa = vals.purchases > 0 ? vals.spend / vals.purchases : null
        return { ...vals, cpm, cpa }
      })
      .sort((a, b) => b.spend - a.spend)
  }, [filteredPlacements])

  const fmtPlatform = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  const metricLabel = metric === "spend" ? "Spend" : metric === "impressions" ? "Impressions" : "Purchases"

  return (
    <Card>
      {/* Header with tabs + metric selector */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-neutral-400">Breakdowns</h2>
          <div className="flex rounded-lg border border-neutral-700 bg-neutral-800/50 p-0.5">
            {(["demographics", "placements"] as const).map((t) => (
              <button
                key={t}
                onClick={() => onTabChange(t)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  tab === t
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                {t === "demographics" ? "Demographics" : "Placements"}
              </button>
            ))}
          </div>
        </div>

        <select
          value={metric}
          onChange={(e) => onMetricChange(e.target.value as "spend" | "impressions" | "purchases")}
          className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600"
        >
          {BREAKDOWN_METRIC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Demographics sub-tab */}
      {tab === "demographics" && (
        <>
          {filteredDemographics.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              No demographic data available.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs text-neutral-500">{metricLabel} by Age &amp; Gender</p>
                <DemographicsChart rows={filteredDemographics} metric={metric} />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-500">
                      <th className="pb-2 pr-4 font-medium">Age</th>
                      <th className="pb-2 pr-4 font-medium">Gender</th>
                      <th className="pb-2 pr-4 font-medium text-right">Spend</th>
                      <th className="pb-2 pr-4 font-medium text-right">Impressions</th>
                      <th className="pb-2 pr-4 font-medium text-right">CTR</th>
                      <th className="pb-2 pr-4 font-medium text-right">Purchases</th>
                      <th className="pb-2 pr-4 font-medium text-right">CPA</th>
                      <th className="pb-2 font-medium text-right">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demoTable.map((row, i) => (
                      <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                        <td className="py-2 pr-4 text-neutral-300">{row.age}</td>
                        <td className="py-2 pr-4 capitalize text-neutral-300">{row.gender}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.spend, currency)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.impressions)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtPercent(row.ctr)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.purchases)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{row.cpa !== null ? fmtCurrency(row.cpa, currency) : "—"}</td>
                        <td className="py-2 text-right text-neutral-300">{row.roas.toFixed(2)}x</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Placements sub-tab */}
      {tab === "placements" && (
        <>
          {filteredPlacements.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              No placement data available.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs text-neutral-500">{metricLabel} by Platform</p>
                  <PlacementsChart rows={filteredPlacements} groupBy="publisher_platform" metric={metric} />
                </div>
                <div>
                  <p className="mb-2 text-xs text-neutral-500">{metricLabel} by Position</p>
                  <PlacementsChart rows={filteredPlacements} groupBy="platform_position" metric={metric} />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-500">
                      <th className="pb-2 pr-4 font-medium">Platform</th>
                      <th className="pb-2 pr-4 font-medium">Position</th>
                      <th className="pb-2 pr-4 font-medium text-right">Spend</th>
                      <th className="pb-2 pr-4 font-medium text-right">Impressions</th>
                      <th className="pb-2 pr-4 font-medium text-right">CPM</th>
                      <th className="pb-2 pr-4 font-medium text-right">Purchases</th>
                      <th className="pb-2 font-medium text-right">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {placementTable.map((row, i) => (
                      <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                        <td className="py-2 pr-4 text-neutral-300">{fmtPlatform(row.platform)}</td>
                        <td className="py-2 pr-4 text-neutral-300">{fmtPlatform(row.position)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.spend, currency)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.impressions)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.cpm, currency)}</td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.purchases)}</td>
                        <td className="py-2 text-right text-neutral-300">{row.cpa !== null ? fmtCurrency(row.cpa, currency) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
