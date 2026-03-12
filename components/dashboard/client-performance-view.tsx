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
import AdsSidebar, { type AdEntry } from "@/components/ui/ads-sidebar"
import ScorecardConfigModal from "./scorecard-config-modal"
import AnnotationsBar, { type Annotation } from "@/components/ui/annotations-bar"

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
const FunnelBarChart = dynamic(
  () => import("@/components/charts/funnel-bar-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
const ConversionRatesChart = dynamic(
  () => import("@/components/charts/conversion-rates-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
const CPAChart = dynamic(
  () => import("@/components/charts/cpa-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
const FunnelDropOffChart = dynamic(
  () => import("@/components/charts/funnel-drop-off-chart"),
  { ssr: false, loading: ChartPlaceholder }
)
const PlatformCPAChart = dynamic(
  () => import("@/components/charts/platform-cpa-chart"),
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
  /** Key action step for CPA chart denominator */
  keyAction?: string | null
  /** Demographics breakdown rows (Meta only) */
  demographics?: MetaDemographicsRow[]
  /** Placements breakdown rows (Meta only) */
  placements?: MetaPlacementsRow[]
  /** Annotations / notes for this client in date range */
  annotations?: Annotation[]
  /** Contribution margin percentage (0-100) for CM3 calculation */
  contributionMarginPct?: number | null
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
    mobileAppRegistrations: a.mobileAppRegistrations + b.mobileAppRegistrations,
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
  keyAction: initialKeyAction = null,
  annotations: initialAnnotations = [],
  demographics = [],
  placements = [],
  contributionMarginPct = null,
  readOnly = false,
}: Props) {
  const currency = client.currency_code ?? "GBP"
  const router = useRouter()
  const [gaLevel, setGaLevel] = useState<"campaign" | "ad_group">("campaign")
  const [showConfig, setShowConfig] = useState(false)
  const [funnelSteps, setFunnelSteps] = useState<string[]>(initialSteps || [])
  const [keyAction, setKeyAction] = useState<string | null>(initialKeyAction)
  const [cmPct, setCmPct] = useState<number | null>(contributionMarginPct)
  // Active CPA step: which funnel step drives the CPA chart (defaults to keyAction or last step)
  const [activeCpaStep, setActiveCpaStep] = useState<string | null>(null)
  const [breakdownTab, setBreakdownTab] = useState<"demographics" | "placements">("demographics")
  const [breakdownMetric, setBreakdownMetric] = useState<"spend" | "impressions" | "purchases">("spend")
  const [breakdownOpen, setBreakdownOpen] = useState(true)
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations)

  // Drill-down state for Meta performance table
  type DrillCrumb = { level: HierarchyLevel; id: string; name: string }
  const [drillPath, setDrillPath] = useState<DrillCrumb[]>([])
  const [metaLevel, setMetaLevel] = useState<HierarchyLevel>("campaign")

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

  // Avg Daily New Reach (Meta only)
  const numDays = useMemo(() => {
    const start = new Date(from + "T00:00:00")
    const end = new Date(to + "T00:00:00")
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  }, [from, to])

  const avgDailyNewReach = useMemo(() => {
    if (!isMeta && !isAll) return 0
    const dailyRows = filteredRows
      .filter((r) => r.reach != null)
      .map((r) => ({ reach: r.reach || 0, impressions: r.impressions || 0 }))
    const total = calculateNetNewReach(dailyRows, baselineReach)
    return Math.round(total / numDays)
  }, [filteredRows, baselineReach, platform, numDays])

  const compAvgDailyNewReach = useMemo(() => {
    if (!isMeta || compareType === "none" || filteredCompRows.length === 0) return 0
    const dailyRows = filteredCompRows
      .filter((r) => r.reach != null)
      .map((r) => ({ reach: r.reach || 0, impressions: r.impressions || 0 }))
    const total = calculateNetNewReach(dailyRows, 0)
    // Use same numDays for comparison (approximate)
    return Math.round(total / numDays)
  }, [filteredCompRows, compareType, platform, numDays])

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

  // Daily spend lookup (keyed by date) for CPA line on funnel bar chart
  const spendByDate = useMemo(() => {
    const byDate: Record<string, number> = {}
    for (const r of filteredRows) {
      if (!r.date) continue
      byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
    }
    return byDate
  }, [filteredRows])

  // Daily totals for conversion rates chart
  const dailyTotals = useMemo(() => {
    const byDate: Record<string, { impressions: number; clicks: number; spend: number }> = {}
    for (const r of filteredRows) {
      if (!r.date) continue
      if (!byDate[r.date]) byDate[r.date] = { impressions: 0, clicks: 0, spend: 0 }
      byDate[r.date].impressions += r.impressions || 0
      byDate[r.date].clicks += r.unique_link_clicks || 0
      byDate[r.date].spend += r.spend || 0
    }
    return byDate
  }, [filteredRows])

  // Table data — apply drill-down filtering for Meta
  const groupedData = useMemo(() => {
    if (isMeta) {
      let rows = filteredRows
      if (drillPath.length >= 1) rows = rows.filter(r => r.campaign_id === drillPath[0].id)
      if (drillPath.length >= 2) rows = rows.filter(r => r.adset_id === drillPath[1].id)
      return groupByLevel(rows, metaLevel)
    }
    if (isGoogleAds) return groupGoogleAdsByLevel(googleAdsRows, gaLevel)
    // "all" — combine both platforms grouped by campaign
    const metaGroups = groupByLevel(filteredRows, "campaign")
    const gaGroups = groupGoogleAdsByLevel(googleAdsRows, "campaign")
    // Merge: different platforms will have different campaign IDs, so just concat
    return [...metaGroups, ...gaGroups].sort((a, b) => b.metrics.spend - a.metrics.spend)
  }, [filteredRows, googleAdsRows, metaLevel, drillPath, gaLevel, platform])

  // Has comparison data?
  const hasComp = compareType !== "none" && (filteredCompRows.length > 0 || googleAdsComparisonRows.length > 0)

  // Comparison spend series — built from comparison rows (aligned by day index)
  const compSpendSeries = useMemo(() => {
    if (!hasComp) return undefined
    if (isMeta) {
      return dailySpendSeries(filteredCompRows).map((d) => ({ date: d.date, value: d.spend }))
    }
    if (isGoogleAds) {
      const byDate: Record<string, number> = {}
      for (const r of googleAdsComparisonRows) {
        if (!r.date) continue
        byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
      }
      return Object.entries(byDate)
        .map(([date, spend]) => ({ date, value: Math.round(spend * 100) / 100 }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }
    // "all"
    const byDate: Record<string, number> = {}
    for (const r of filteredCompRows) {
      if (!r.date) continue
      byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
    }
    for (const r of googleAdsComparisonRows) {
      if (!r.date) continue
      byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
    }
    return Object.entries(byDate)
      .map(([date, spend]) => ({ date, value: Math.round(spend * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredCompRows, googleAdsComparisonRows, hasComp, platform])

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

  // "All Platforms" key action: resolve field + label for the conversion metric
  const allKeyActionStep = keyAction || (funnelSteps.length > 0 ? funnelSteps[funnelSteps.length - 1] : null)
  const allKeyActionDef = allKeyActionStep ? FUNNEL_STEP_DEFS[allKeyActionStep] : null
  const allKeyActionField = allKeyActionDef?.field || "purchases"
  const allKeyActionLabel = allKeyActionDef?.label || "Conversions"
  const allKeyActionCostLabel = allKeyActionDef?.costLabel || "CPA"

  // "All Platforms" key action count (Meta uses configured funnel step, Google Ads always uses "conversions" → purchases)
  const allMetaKeyCount = (metrics as Record<string, number>)[allKeyActionField] || 0
  const gaMetrics = useMemo(() => aggregateGoogleAdsMetrics(googleAdsRows), [googleAdsRows])
  const allGoogleKeyCount = gaMetrics.purchases // Google "conversions" always mapped to purchases
  const allTotalKeyCount = allMetaKeyCount + allGoogleKeyCount
  const allCpa = allTotalKeyCount > 0 ? metrics.spend / allTotalKeyCount : 0

  // Platform CPA chart data (stacked conversions by platform + CPA line)
  const platformCpaData = useMemo(() => {
    if (!isAll) return []

    // Map meta conversions by date using key action field
    const metaByDate: Record<string, { spend: number; conversions: number }> = {}
    for (const r of filteredRows) {
      if (!r.date) continue
      if (!metaByDate[r.date]) metaByDate[r.date] = { spend: 0, conversions: 0 }
      metaByDate[r.date].spend += r.spend || 0
      metaByDate[r.date].conversions += ((r as Record<string, any>)[allKeyActionStep || "purchases"] || 0)
    }

    // Map google conversions by date
    const googleByDate: Record<string, { spend: number; conversions: number }> = {}
    for (const r of googleAdsRows) {
      if (!r.date) continue
      if (!googleByDate[r.date]) googleByDate[r.date] = { spend: 0, conversions: 0 }
      googleByDate[r.date].spend += r.spend || 0
      googleByDate[r.date].conversions += r.conversions || 0
    }

    // Collect all dates
    const allDates = new Set([...Object.keys(metaByDate), ...Object.keys(googleByDate)])
    const sorted = Array.from(allDates).sort()

    // Build enriched data
    const enriched = sorted.map((date) => {
      const meta = metaByDate[date] || { spend: 0, conversions: 0 }
      const google = googleByDate[date] || { spend: 0, conversions: 0 }
      const totalConversions = meta.conversions + google.conversions
      const totalSpend = meta.spend + google.spend
      const cpa = totalConversions > 0 ? totalSpend / totalConversions : null
      return {
        date,
        metaConversions: meta.conversions,
        googleConversions: google.conversions,
        totalConversions,
        cpa,
        rolling: null as number | null,
      }
    })

    // Compute 7-day rolling average CPA
    return enriched.map((d, i) => {
      const window = enriched.slice(Math.max(0, i - 6), i + 1)
      const validCpa = window.filter((w) => w.cpa !== null).map((w) => w.cpa!)
      const rolling = validCpa.length > 0
        ? validCpa.reduce((a, b) => a + b, 0) / validCpa.length
        : null
      return { ...d, rolling }
    })
  }, [filteredRows, googleAdsRows, platform, allKeyActionStep])

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

  const currentTableLevel = isGoogleAds ? gaLevel : isAll ? "campaign" : metaLevel
  const handleTableLevelChange = (newLevel: any) => {
    if (isGoogleAds) setGaLevel(newLevel)
    else if (!isAll) {
      setMetaLevel(newLevel as HierarchyLevel)
      setDrillPath([]) // reset drill-down when manually switching level
    }
  }

  // Drill-down breadcrumb for Meta performance table
  const drillBreadcrumb = isMeta && drillPath.length > 0 ? [
    { label: "All Campaigns", onClick: () => { setDrillPath([]); setMetaLevel("campaign") } },
    ...drillPath.map((crumb, i) => ({
      label: crumb.name,
      onClick: () => {
        setDrillPath(prev => prev.slice(0, i + 1))
        setMetaLevel(crumb.level === "campaign" ? "adset" : "ad")
      },
    })),
  ] : undefined

  const handleDrillDown = isMeta && metaLevel !== "ad" ? (row: { id: string; name: string }) => {
    setDrillPath(prev => [...prev, { level: metaLevel, id: row.id, name: row.name }])
    setMetaLevel(metaLevel === "campaign" ? "adset" : "ad")
  } : undefined

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
          label="CPM"
          value={fmtCurrency(derived.cpm, currency)}
          delta={delta(derived.cpm, compDerived.cpm)}
          invertDelta
        />
        {showReach ? (
          <MetricCard
            label="Avg. Daily New Reach"
            value={fmtNumber(avgDailyNewReach)}
            delta={delta(avgDailyNewReach, compAvgDailyNewReach)}
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
              const resolvedCpaStep = activeCpaStep || keyAction || funnelSteps[funnelSteps.length - 1]
              const isActive = stepKey === resolvedCpaStep
              return [
                <button
                  key={`${stepKey}-count`}
                  onClick={() => setActiveCpaStep(stepKey)}
                  className={`rounded-xl text-left transition ${isActive ? "ring-1 ring-brand-lime/40" : "ring-1 ring-transparent hover:ring-neutral-700"}`}
                >
                  <MetricCard
                    label={def.label}
                    value={fmtNumber(vals.count)}
                    delta={compVals ? delta(vals.count, compVals.count) : null}
                  />
                </button>,
                <button
                  key={`${stepKey}-rate`}
                  onClick={() => setActiveCpaStep(stepKey)}
                  className={`rounded-xl text-left transition ${isActive ? "ring-1 ring-brand-lime/40" : "ring-1 ring-transparent hover:ring-neutral-700"}`}
                >
                  <MetricCard
                    label={def.rateLabel}
                    value={vals.rate !== null ? fmtPercent(vals.rate, rateDecimals) : "—"}
                    delta={
                      compVals && vals.rate !== null && compVals.rate !== null
                        ? delta(vals.rate, compVals.rate)
                        : null
                    }
                  />
                </button>,
                <button
                  key={`${stepKey}-cost`}
                  onClick={() => setActiveCpaStep(stepKey)}
                  className={`rounded-xl text-left transition ${isActive ? "ring-1 ring-brand-lime/40" : "ring-1 ring-transparent hover:ring-neutral-700"}`}
                >
                  <MetricCard
                    label={def.costLabel}
                    value={vals.costPer !== null ? fmtCurrency(vals.costPer, currency) : "—"}
                    delta={
                      compVals && vals.costPer !== null && compVals.costPer !== null
                        ? delta(vals.costPer, compVals.costPer)
                        : null
                    }
                    invertDelta
                  />
                </button>,
              ]
            })}
          </div>
        </div>
      )}

      {/* Revenue / AOV / ROAS — shown when configured via scorecard + revenue > 0 */}
      {metrics.revenue > 0 && funnelSteps.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MetricCard
            label="Revenue"
            value={fmtCurrency(metrics.revenue, currency)}
            delta={delta(metrics.revenue, compMetrics.revenue)}
          />
          <MetricCard
            label="AOV"
            value={fmtCurrency(derived.aov, currency)}
            delta={delta(derived.aov, compDerived.aov)}
          />
          <MetricCard
            label="ROAS"
            value={derived.roas.toFixed(2) + "x"}
            delta={delta(derived.roas, compDerived.roas)}
          />
        </div>
      )}

      {/* CM3 — Contribution Margin 3 (shown when CM% is set and revenue > 0) */}
      {cmPct != null && metrics.revenue > 0 && (() => {
        const cm3 = (metrics.revenue * cmPct / 100) - metrics.spend
        const cm3Roas = metrics.spend > 0 ? cm3 / metrics.spend : 0
        const compCm3 = hasComp && compMetrics.revenue > 0
          ? (compMetrics.revenue * cmPct / 100) - compMetrics.spend
          : null
        const compCm3Roas = compCm3 !== null && compMetrics.spend > 0
          ? compCm3 / compMetrics.spend
          : null
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
            <MetricCard
              label="CM3"
              value={fmtCurrency(cm3, currency)}
              subValue={`CM ${cmPct}%`}
              delta={compCm3 !== null ? fmtDelta(cm3, compCm3) : undefined}
            />
            <MetricCard
              label="CM3 ROAS"
              value={cm3Roas.toFixed(2) + "x"}
              subValue="Profit per ad spend"
              delta={compCm3Roas !== null ? fmtDelta(cm3Roas, compCm3Roas) : undefined}
            />
          </div>
        )
      })()}

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

      {/* "All" platforms summary — key metric conversions + CPA */}
      {isAll && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label={`Total ${allKeyActionLabel}`}
            value={fmtNumber(allTotalKeyCount)}
            subValue={`Meta: ${fmtNumber(allMetaKeyCount)} · Google: ${fmtNumber(allGoogleKeyCount)}`}
            delta={delta(metrics.purchases, compMetrics.purchases)}
          />
          <MetricCard
            label={allKeyActionCostLabel}
            value={allCpa > 0 ? fmtCurrency(allCpa, currency) : "\u2014"}
            invertDelta
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
      <Card>
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Spend</h2>
        <MetricChart data={spendSeries} label="Spend" color="#CDFF00" format="currency" height={260} currency={currency} comparisonData={compSpendSeries} comparisonLabel="Previous Period" annotations={annotations} />
        <AnnotationsBar
          annotations={annotations}
          clientId={client.id}
          from={from}
          to={to}
          onAdd={(a) => setAnnotations((prev) => [...prev, a].sort((x, y) => x.date.localeCompare(y.date)))}
          onDelete={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
          readOnly={readOnly}
        />
      </Card>

      {/* Platform CPA chart (All Platforms view) */}
      {isAll && platformCpaData.length > 0 && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Cost Per {allKeyActionLabel} by Platform
          </h2>
          <PlatformCPAChart
            data={platformCpaData}
            conversionLabel={allKeyActionLabel}
            currency={currency}
          />
        </Card>
      )}

      {/* CPA Chart (Meta only, when funnel steps exist) */}
      {showFunnel && (() => {
        const cpaStepKey = activeCpaStep || keyAction || funnelSteps[funnelSteps.length - 1]
        const cpaStepLabel = FUNNEL_STEP_DEFS[cpaStepKey]?.label || "Action"
        return (
          <Card>
            <h2 className="mb-4 text-sm font-medium text-neutral-400">
              Cost Per {cpaStepLabel}
            </h2>
            <CPAChart
              data={funnelSeries}
              stepKey={cpaStepKey}
              stepLabel={cpaStepLabel}
              spendByDate={spendByDate}
              currency={currency}
            />
          </Card>
        )
      })()}

      {showFunnel && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 text-sm font-medium text-neutral-400">Funnel Trends</h2>
            <FunnelBarChart
              data={funnelSeries}
              series={funnelChartSeries}
            />
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-medium text-neutral-400">Conversion Rates</h2>
            <ConversionRatesChart
              data={funnelSeries}
              series={funnelChartSeries}
              dailyTotals={dailyTotals}
              funnelStepKeys={funnelSteps}
            />
          </Card>
        </div>
      )}

      {/* Funnel drop-off (Meta only) */}
      {showFunnel && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Funnel Drop-Off</h2>
          <FunnelDropOffChart metrics={metrics} funnelSteps={funnelSteps} />
        </Card>
      )}

      {/* Performance table — collapsible */}
      <Card>
        <button
          onClick={() => setBreakdownOpen((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <h2 className="text-sm font-medium text-neutral-400">Overview</h2>
          <svg
            className={`h-4 w-4 text-neutral-500 transition-transform ${breakdownOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {breakdownOpen && (
          <div className="mt-4">
            <PerformanceTable
              data={groupedData}
              level={currentTableLevel}
              onLevelChange={handleTableLevelChange}
              funnelSteps={isMeta ? funnelSteps : []}
              levelOptions={tableLevelOptions}
              currency={currency}
              breadcrumb={drillBreadcrumb}
              onRowClick={handleDrillDown}
            />
          </div>
        )}
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
          funnelSteps={funnelSteps}
        />
      )}

      {/* Scorecard config modal (Meta only) */}
      {showConfig && (
        <ScorecardConfigModal
          clientId={client.id}
          selectedSteps={funnelSteps}
          keyAction={keyAction}
          contributionMarginPct={cmPct}
          onClose={() => setShowConfig(false)}
          onSaved={(steps, newKeyAction, newCmPct) => {
            setFunnelSteps(steps)
            setKeyAction(newKeyAction)
            setCmPct(newCmPct)
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
  funnelSteps: string[]
}

/** Fields available in demographics/placements breakdown data */
const BREAKDOWN_AVAILABLE_FIELDS = new Set([
  "spend", "impressions", "reach", "unique_link_clicks", "landing_page_views", "purchases", "purchase_value",
])

type BreakdownAgg = {
  spend: number
  impressions: number
  purchases: number
  purchase_value: number
  unique_link_clicks: number
  landing_page_views: number
  reach: number
}

const EMPTY_BREAKDOWN_AGG: BreakdownAgg = {
  spend: 0, impressions: 0, purchases: 0, purchase_value: 0,
  unique_link_clicks: 0, landing_page_views: 0, reach: 0,
}

/** Breakdown metric options — always show Spend + Impressions, plus any funnel steps available in breakdown data */
function getBreakdownMetricOptions(funnelSteps: string[]): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [
    { value: "spend", label: "Spend" },
    { value: "impressions", label: "Impressions" },
  ]
  for (const stepKey of funnelSteps) {
    if (BREAKDOWN_AVAILABLE_FIELDS.has(stepKey)) {
      const def = FUNNEL_STEP_DEFS[stepKey]
      if (def && !options.some(o => o.value === stepKey)) {
        options.push({ value: stepKey, label: def.label })
      }
    }
  }
  // Always include purchases if not already (from funnel)
  if (!options.some(o => o.value === "purchases")) {
    options.push({ value: "purchases", label: "Purchases" })
  }
  return options
}

/** Get the raw field name from a breakdown row given a metric key */
function getBreakdownValue(row: Record<string, any>, metricKey: string): number {
  return (row[metricKey] || 0) as number
}

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
  funnelSteps,
}: BreakdownsSectionProps) {
  // Sidebar state for showing top ads per breakdown dimension
  const [sidebarData, setSidebarData] = useState<{
    title: string
    metric: string
    ads: AdEntry[]
  } | null>(null)

  // Build metric options based on funnel steps
  const metricOptions = useMemo(() => getBreakdownMetricOptions(funnelSteps), [funnelSteps])

  // Get the funnel steps that are available in breakdown data
  const availableFunnelSteps = useMemo(
    () => funnelSteps.filter(s => BREAKDOWN_AVAILABLE_FIELDS.has(s)),
    [funnelSteps]
  )

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
    const agg = new Map<string, BreakdownAgg>()
    for (const r of filteredDemographics) {
      const key = `${r.age}|${r.gender}`
      const existing = agg.get(key) || { ...EMPTY_BREAKDOWN_AGG }
      existing.spend += r.spend || 0
      existing.impressions += r.impressions || 0
      existing.purchases += r.purchases || 0
      existing.purchase_value += r.purchase_value || 0
      existing.unique_link_clicks += r.unique_link_clicks || 0
      existing.landing_page_views += r.landing_page_views || 0
      existing.reach += r.reach || 0
      agg.set(key, existing)
    }
    return Array.from(agg.entries())
      .map(([key, vals]) => {
        const [age, gender] = key.split("|")
        return { age, gender, ...vals }
      })
      .sort((a, b) => b.spend - a.spend)
  }, [filteredDemographics])

  // Placements summary table
  const placementTable = useMemo(() => {
    const agg = new Map<string, BreakdownAgg & { platform: string; position: string }>()
    for (const r of filteredPlacements) {
      const key = `${r.publisher_platform}|${r.platform_position}`
      const existing = agg.get(key) || {
        platform: r.publisher_platform,
        position: r.platform_position,
        ...EMPTY_BREAKDOWN_AGG,
      }
      existing.spend += r.spend || 0
      existing.impressions += r.impressions || 0
      existing.purchases += r.purchases || 0
      existing.purchase_value += r.purchase_value || 0
      existing.unique_link_clicks += r.unique_link_clicks || 0
      existing.landing_page_views += r.landing_page_views || 0
      existing.reach += r.reach || 0
      agg.set(key, existing)
    }
    return Array.from(agg.values())
      .sort((a, b) => b.spend - a.spend)
  }, [filteredPlacements])

  const fmtPlatform = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  const metricLabel = metricOptions.find(o => o.value === metric)?.label || metric

  // Helper: compute derived metrics for a breakdown row
  function deriveBreakdown(vals: BreakdownAgg) {
    return {
      ctr: vals.impressions > 0 ? (vals.unique_link_clicks / vals.impressions) * 100 : 0,
      cpm: vals.impressions > 0 ? (vals.spend / vals.impressions) * 1000 : 0,
      cpc: vals.unique_link_clicks > 0 ? vals.spend / vals.unique_link_clicks : null,
      cpa: vals.purchases > 0 ? vals.spend / vals.purchases : null,
      roas: vals.spend > 0 ? vals.purchase_value / vals.spend : 0,
      landingRate: vals.impressions > 0 ? (vals.landing_page_views / vals.impressions) * 100 : 0,
      convRate: vals.unique_link_clicks > 0 ? (vals.purchases / vals.unique_link_clicks) * 100 : 0,
    }
  }

  // Build ads sidebar from a subset of breakdown rows
  function buildAdEntries(rows: Record<string, any>[]): AdEntry[] {
    const agg = new Map<string, { name: string; value: number }>()
    for (const r of rows) {
      if (!r.ad_id) continue
      const existing = agg.get(r.ad_id) || { name: r.ad_name || r.ad_id, value: 0 }
      existing.value += getBreakdownValue(r, metric)
      agg.set(r.ad_id, existing)
    }
    const entries = Array.from(agg.entries())
      .map(([adId, { name, value }]) => ({ adId, adName: name, value, share: 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20)
    const total = entries.reduce((s, e) => s + e.value, 0)
    for (const e of entries) e.share = total > 0 ? e.value / total : 0
    return entries
  }

  function handleDemoBarClick(age: string, gender: string) {
    const genderLabel = gender.charAt(0).toUpperCase() + gender.slice(1)
    const filtered = filteredDemographics.filter(r => r.age === age && r.gender === gender)
    setSidebarData({
      title: `${genderLabel} ${age}`,
      metric: metricLabel,
      ads: buildAdEntries(filtered),
    })
  }

  function handlePlacementBarClick(groupBy: "publisher_platform" | "platform_position", rawName: string) {
    const filtered = filteredPlacements.filter(r => r[groupBy] === rawName)
    setSidebarData({
      title: fmtPlatform(rawName),
      metric: metricLabel,
      ads: buildAdEntries(filtered),
    })
  }

  /** Build dynamic table columns based on funnel steps */
  function renderFunnelColumns(vals: BreakdownAgg, derived: ReturnType<typeof deriveBreakdown>) {
    const cols: React.ReactNode[] = []
    for (const stepKey of availableFunnelSteps) {
      const def = FUNNEL_STEP_DEFS[stepKey]
      if (!def) continue
      const count = getBreakdownValue(vals, stepKey)
      const costPer = count > 0 ? vals.spend / count : null
      cols.push(
        <td key={`${stepKey}-count`} className="py-2 pr-4 text-right text-neutral-300">
          {fmtNumber(count)}
        </td>
      )
      cols.push(
        <td key={`${stepKey}-cost`} className="py-2 pr-4 text-right text-neutral-300">
          {costPer !== null ? fmtCurrency(costPer, currency) : "—"}
        </td>
      )
    }
    // Always show ROAS at the end if purchases are in the funnel
    if (availableFunnelSteps.includes("purchases")) {
      cols.push(
        <td key="roas" className="py-2 text-right text-neutral-300">
          {derived.roas.toFixed(2)}x
        </td>
      )
    }
    return cols
  }

  /** Build dynamic table headers based on funnel steps */
  function renderFunnelHeaders() {
    const headers: React.ReactNode[] = []
    for (const stepKey of availableFunnelSteps) {
      const def = FUNNEL_STEP_DEFS[stepKey]
      if (!def) continue
      headers.push(
        <th key={`${stepKey}-count`} className="pb-2 pr-4 font-medium text-right">
          {def.label}
        </th>
      )
      headers.push(
        <th key={`${stepKey}-cost`} className="pb-2 pr-4 font-medium text-right">
          {def.costLabel}
        </th>
      )
    }
    if (availableFunnelSteps.includes("purchases")) {
      headers.push(
        <th key="roas" className="pb-2 font-medium text-right">
          ROAS
        </th>
      )
    }
    return headers
  }

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
          onChange={(e) => onMetricChange(e.target.value as any)}
          className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600"
        >
          {metricOptions.map((o) => (
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
                <DemographicsChart rows={filteredDemographics} metric={metric as any} onBarClick={handleDemoBarClick} />
              </div>

              <div className="overflow-x-auto">
                {(() => {
                  const totalDemoSpend = demoTable.reduce((s, r) => s + r.spend, 0)
                  return (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-neutral-800 text-neutral-500">
                          <th className="pb-2 pr-4 font-medium">Age</th>
                          <th className="pb-2 pr-4 font-medium">Gender</th>
                          <th className="pb-2 pr-4 font-medium text-right">Spend</th>
                          <th className="pb-2 pr-4 font-medium text-right">Share</th>
                          <th className="pb-2 pr-4 font-medium text-right">Impressions</th>
                          <th className="pb-2 pr-4 font-medium text-right">CPM</th>
                          {renderFunnelHeaders()}
                        </tr>
                      </thead>
                      <tbody>
                        {demoTable.map((row, i) => {
                          const d = deriveBreakdown(row)
                          const share = totalDemoSpend > 0 ? (row.spend / totalDemoSpend) * 100 : 0
                          return (
                            <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                              <td className="py-2 pr-4 text-neutral-300">{row.age}</td>
                              <td className="py-2 pr-4 capitalize text-neutral-300">{row.gender}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.spend, currency)}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtPercent(share)}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.impressions)}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(d.cpm, currency)}</td>
                              {renderFunnelColumns(row, d)}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
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
                  <PlacementsChart rows={filteredPlacements} groupBy="publisher_platform" metric={metric as any} onBarClick={(raw) => handlePlacementBarClick("publisher_platform", raw)} />
                </div>
                <div>
                  <p className="mb-2 text-xs text-neutral-500">{metricLabel} by Position</p>
                  <PlacementsChart rows={filteredPlacements} groupBy="platform_position" metric={metric as any} onBarClick={(raw) => handlePlacementBarClick("platform_position", raw)} />
                </div>
              </div>

              <div className="overflow-x-auto">
                {(() => {
                  const totalPlacementSpend = placementTable.reduce((s, r) => s + r.spend, 0)
                  return (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-neutral-800 text-neutral-500">
                          <th className="pb-2 pr-4 font-medium">Platform</th>
                          <th className="pb-2 pr-4 font-medium">Position</th>
                          <th className="pb-2 pr-4 font-medium text-right">Spend</th>
                          <th className="pb-2 pr-4 font-medium text-right">Share</th>
                          <th className="pb-2 pr-4 font-medium text-right">Impressions</th>
                          <th className="pb-2 pr-4 font-medium text-right">CPM</th>
                          {renderFunnelHeaders()}
                        </tr>
                      </thead>
                      <tbody>
                        {placementTable.map((row, i) => {
                          const d = deriveBreakdown(row)
                          const share = totalPlacementSpend > 0 ? (row.spend / totalPlacementSpend) * 100 : 0
                          return (
                            <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                              <td className="py-2 pr-4 text-neutral-300">{fmtPlatform(row.platform)}</td>
                              <td className="py-2 pr-4 text-neutral-300">{fmtPlatform(row.position)}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.spend, currency)}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtPercent(share)}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.impressions)}</td>
                              <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(d.cpm, currency)}</td>
                              {renderFunnelColumns(row, d)}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
              </div>
            </div>
          )}
        </>
      )}

      {/* Ads sidebar */}
      {sidebarData && (
        <AdsSidebar
          title={sidebarData.title}
          metric={sidebarData.metric}
          ads={sidebarData.ads}
          currency={currency}
          onClose={() => setSidebarData(null)}
        />
      )}
    </Card>
  )
}
