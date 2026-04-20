"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import type { MetaDailyRow, GoogleAdsDailyRow, MetaDemographicsRow, MetaPlacementsRow, Client, ComparisonType, HierarchyLevel, AggregatedMetrics, ShopifyDailyOrdersRow, ShopifyAttributionRow } from "@/lib/utils/types"
import { getClientPlatforms } from "@/lib/utils/types"
import {
  aggregateMetrics,
  aggregateGoogleAdsMetrics,
  deriveMetrics,
  dailySpendSeries,
  dailyFunnelSeries,
  groupByLevel,
  groupGoogleAdsByLevel,
  aggregateShopifyMetrics,
  calculateCM3,
  calculateMetaAttribution,
} from "@/lib/utils/aggregate"
import { fmtCurrency, fmtNumber, fmtPercent, fmtDelta } from "@/lib/utils/format"
import { calculateFunnelStep, calculateNetNewReach, FUNNEL_STEP_DEFS, type FunnelStepKey } from "@/lib/utils/funnel-steps"
import { getComparisonRange, getPresetRange, type DatePreset } from "@/lib/utils/dates"
import { Card, MetricCard } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import AdSetSelector from "@/components/ui/adset-selector"
import PlatformSelector, { type PlatformView } from "@/components/ui/platform-selector"
import PerformanceTable from "@/components/tables/performance-table"
import AlexiaClarkStructureView from "@/components/dashboard/alexia-clark-structure-view"
import AdsSidebar, { type AdEntry } from "@/components/ui/ads-sidebar"
import ScorecardConfigModal from "./scorecard-config-modal"
import AnnotationsBar, { type Annotation } from "@/components/ui/annotations-bar"
import { calculatePacing } from "@/lib/utils/pacing"
import {
  type NamingConfig,
  parseAdName,
  getAvailableDimensions,
  getDimensionLabel,
  getDimensionValue,
  type ParsedAdName,
} from "@/lib/utils/ad-name-parser"
import {
  classifyAllAds,
  countByClassification,
  CLASSIFICATIONS,
  type ClassificationType,
} from "@/lib/utils/creative-classification"
import {
  calculateConcentration,
  CONCENTRATION_COLORS,
} from "@/lib/utils/spend-concentration"

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
const SpendBreakdownPie = dynamic(
  () => import("@/components/charts/spend-breakdown-pie"),
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
const CoverageAnalysis = dynamic(
  () => import("@/components/charts/coverage-analysis"),
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
  /** Wider fetch window actually pulled from the server (for client-side date filtering) */
  fetchedFrom?: string
  fetchedTo?: string
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
  /** Contribution margin percentage (0-100) for CM3 calculation (fallback when no Shopify) */
  contributionMarginPct?: number | null
  /** Shopify daily order data */
  shopifyOrders?: ShopifyDailyOrdersRow[]
  /** Shopify UTM attribution data */
  shopifyAttribution?: ShopifyAttributionRow[]
  /** Shopify comparison period orders */
  shopifyCompOrders?: ShopifyDailyOrdersRow[]
  /** Shopify comparison period attribution */
  shopifyCompAttribution?: ShopifyAttributionRow[]
  /** Hide configure button (for public view) */
  readOnly?: boolean
  /** Client-specific naming convention config */
  namingConfig?: NamingConfig
  /** ad_id → ISO created_time for test badge */
  createdDates?: Record<string, string>
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
  rows: rawRows,
  comparisonRows: rawComparisonRows,
  googleAdsRows: rawGoogleAdsRows = [],
  googleAdsComparisonRows: rawGoogleAdsComparisonRows = [],
  preset,
  from,
  to,
  fetchedFrom,
  fetchedTo,
  compareType,
  baselineReach = 0,
  funnelSteps: initialSteps = null,
  keyAction: initialKeyAction = null,
  annotations: initialAnnotations = [],
  demographics = [],
  placements = [],
  contributionMarginPct = null,
  shopifyOrders = [],
  shopifyAttribution = [],
  shopifyCompOrders = [],
  shopifyCompAttribution = [],
  readOnly = false,
  namingConfig,
  createdDates = {},
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
  // Dimension filters for ad-level view
  const [perfDimFilters, setPerfDimFilters] = useState<Record<string, string[]>>({})

  // Compute new ad IDs (first 5 days of activity) for test badge
  const newAdIds = useMemo(() => {
    const ids = new Set<string>()
    const now = Date.now()
    const entries = Object.entries(createdDates)
    for (const [adId, dateStr] of entries) {
      const created = new Date(dateStr).getTime()
      if (now - created <= 5 * 86_400_000) ids.add(adId)
    }
    if (typeof window !== "undefined") {
      console.log(`[TestBadge] createdDates entries: ${entries.length}, newAdIds (≤5d): ${ids.size}`)
      if (entries.length > 0 && ids.size === 0) {
        // Show sample to help debug — maybe the window is too narrow
        const sample = entries.slice(0, 3).map(([id, d]) => {
          const age = Math.round((now - new Date(d).getTime()) / 86_400_000)
          return `${id.slice(0, 12)}…: ${age}d ago`
        })
        console.log(`[TestBadge] No ads within 5d window. Samples: ${sample.join(", ")}`)
      }
    }
    return ids
  }, [createdDates])

  // Entity status: blue=testing, green=live, red=paused
  // - "testing": has spend on the latest date AND fewer than 5 distinct spend days
  // - "live": has spend on the latest date AND 5+ distinct spend days
  // - "paused": no spend on the latest date
  const entityStatusMap = useMemo(() => {
    const map = new Map<string, "testing" | "live" | "paused">()
    let maxDate = ""
    for (const r of rawRows) {
      if (r.date && r.date > maxDate) maxDate = r.date
    }
    for (const r of rawGoogleAdsRows) {
      if (r.date && r.date > maxDate) maxDate = r.date
    }
    if (!maxDate) return map

    // Count distinct spend days per entity and track if active on maxDate
    const spendDays = new Map<string, Set<string>>()
    const activeOnMax = new Set<string>()

    function track(id: string, date: string, spend: number) {
      if (!id) return
      if (spend > 0) {
        if (!spendDays.has(id)) spendDays.set(id, new Set())
        spendDays.get(id)!.add(date)
        if (date === maxDate) activeOnMax.add(id)
      }
    }

    for (const r of rawRows) {
      if (!r.date) continue
      track(r.campaign_id || "", r.date, r.spend || 0)
      track(r.adset_id || "", r.date, r.spend || 0)
      track(r.ad_id || "", r.date, r.spend || 0)
    }
    for (const r of rawGoogleAdsRows) {
      if (!r.date) continue
      track(r.campaign_id || "", r.date, r.spend || 0)
      track(r.ad_group_id || "", r.date, r.spend || 0)
    }

    // Assign status
    const allIds = new Set<string>()
    spendDays.forEach((_, id) => allIds.add(id))
    activeOnMax.forEach((id) => allIds.add(id))
    allIds.forEach((id) => {
      if (!activeOnMax.has(id)) {
        map.set(id, "paused")
      } else {
        const days = spendDays.get(id)?.size ?? 0
        map.set(id, days >= 5 ? "live" : "testing")
      }
    })
    return map
  }, [rawRows, rawGoogleAdsRows])

  // Client-side date filtering: the server may have fetched a wider window
  // than the user's current selection so that switching between short presets
  // is instant. Here we narrow the raw rows down to the display range.
  const rows = useMemo(
    () => rawRows.filter((r) => r.date && r.date >= from && r.date <= to),
    [rawRows, from, to]
  )
  const googleAdsRows = useMemo(
    () => rawGoogleAdsRows.filter((r) => r.date && r.date >= from && r.date <= to),
    [rawGoogleAdsRows, from, to]
  )
  // Comparison range is derived from the current display range + compareType
  const clientCompRange = useMemo(
    () => getComparisonRange({ from, to }, compareType),
    [from, to, compareType]
  )
  const comparisonRows = useMemo(() => {
    if (!clientCompRange) return [] as typeof rawComparisonRows
    return rawComparisonRows.filter(
      (r) => r.date && r.date >= clientCompRange.from && r.date <= clientCompRange.to
    )
  }, [rawComparisonRows, clientCompRange])
  const googleAdsComparisonRows = useMemo(() => {
    if (!clientCompRange) return [] as typeof rawGoogleAdsComparisonRows
    return rawGoogleAdsComparisonRows.filter(
      (r) => r.date && r.date >= clientCompRange.from && r.date <= clientCompRange.to
    )
  }, [rawGoogleAdsComparisonRows, clientCompRange])

  // Drill-down state for Meta performance table
  type DrillCrumb = { level: HierarchyLevel; id: string; name: string }
  const [drillPath, setDrillPath] = useState<DrillCrumb[]>([])
  const [metaLevel, setMetaLevel] = useState<HierarchyLevel>("campaign")

  // Status filter for the performance table — "all" | "live" | "testing" | "paused"
  const [tableStatusFilter, setTableStatusFilter] = useState<"all" | "live" | "testing" | "paused">("all")

  // Platform toggle
  const platforms = useMemo(() => getClientPlatforms(client), [client])
  const [platform, setPlatform] = useState<PlatformView>(() =>
    platforms.length > 1 ? platforms[0] : platforms[0] || "meta"
  )

  const isMeta = platform === "meta"
  const isGoogleAds = platform === "google_ads"
  const isAll = platform === "all"

  // Determine "active" cutoff — last 3 days of the selected range
  const activeCutoff = useMemo(() => {
    const d = new Date(to + "T00:00:00")
    d.setDate(d.getDate() - 2)
    return d.toISOString().split("T")[0]
  }, [to])

  // Extract unique campaigns from Meta rows with active status
  const campaigns = useMemo(() => {
    const map = new Map<string, { name: string; active: boolean }>()
    for (const r of rows) {
      if (!r.campaign_id || !r.campaign_name) continue
      const prev = map.get(r.campaign_id)
      const isRecent = (r.date || "") >= activeCutoff && (r.spend || 0) > 0
      map.set(r.campaign_id, {
        name: r.campaign_name,
        active: prev?.active || isRecent,
      })
    }
    return Array.from(map, ([id, v]) => ({ id, name: v.name, active: v.active })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [rows, activeCutoff])

  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>(() =>
    campaigns.map((c) => c.id)
  )

  // Extract unique ad sets from Meta rows with active status
  const adsets = useMemo(() => {
    const map = new Map<string, { name: string; active: boolean }>()
    for (const r of rows) {
      if (!r.adset_id || !r.adset_name) continue
      // If campaign filter is active, only include adsets from selected campaigns
      if (
        selectedCampaigns.length > 0 &&
        selectedCampaigns.length < campaigns.length &&
        r.campaign_id &&
        !selectedCampaigns.includes(r.campaign_id)
      ) {
        continue
      }
      const prev = map.get(r.adset_id)
      const isRecent = (r.date || "") >= activeCutoff && (r.spend || 0) > 0
      map.set(r.adset_id, {
        name: r.adset_name,
        active: prev?.active || isRecent,
      })
    }
    return Array.from(map, ([id, v]) => ({ id, name: v.name, active: v.active })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [rows, activeCutoff, selectedCampaigns, campaigns.length])

  const [selectedAdSets, setSelectedAdSets] = useState<string[]>(() =>
    adsets.map((a) => a.id)
  )

  // Extract unique Google Ads campaigns
  const gaCampaigns = useMemo(() => {
    const map = new Map<string, { name: string; active: boolean }>()
    for (const r of googleAdsRows) {
      if (!r.campaign_id || !r.campaign_name) continue
      const prev = map.get(r.campaign_id)
      const isRecent = (r.date || "") >= activeCutoff && (r.spend || 0) > 0
      map.set(r.campaign_id, {
        name: r.campaign_name,
        active: prev?.active || isRecent,
      })
    }
    return Array.from(map, ([id, v]) => ({ id, name: v.name, active: v.active })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [googleAdsRows, activeCutoff])

  const [selectedGaCampaigns, setSelectedGaCampaigns] = useState<string[]>(() =>
    gaCampaigns.map((c) => c.id)
  )

  // Extract unique ad groups from Google Ads rows with active status
  const adGroups = useMemo(() => {
    const map = new Map<string, { name: string; active: boolean }>()
    for (const r of googleAdsRows) {
      if (!r.ad_group_id || !r.ad_group_name) continue
      if (
        selectedGaCampaigns.length > 0 &&
        selectedGaCampaigns.length < gaCampaigns.length &&
        r.campaign_id &&
        !selectedGaCampaigns.includes(r.campaign_id)
      ) {
        continue
      }
      const prev = map.get(r.ad_group_id)
      const isRecent = (r.date || "") >= activeCutoff && (r.spend || 0) > 0
      map.set(r.ad_group_id, {
        name: r.ad_group_name,
        active: prev?.active || isRecent,
      })
    }
    return Array.from(map, ([id, v]) => ({ id, name: v.name, active: v.active })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [googleAdsRows, activeCutoff, selectedGaCampaigns, gaCampaigns.length])

  const [selectedAdGroups, setSelectedAdGroups] = useState<string[]>(() =>
    adGroups.map((a) => a.id)
  )

  // Filter Meta rows by selected campaigns + ad sets
  const filteredRows = useMemo(() => {
    let result = rows
    if (selectedCampaigns.length > 0 && selectedCampaigns.length < campaigns.length) {
      result = result.filter((r) => r.campaign_id && selectedCampaigns.includes(r.campaign_id))
    }
    if (selectedAdSets.length > 0 && selectedAdSets.length < adsets.length) {
      result = result.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
    }
    return result
  }, [rows, selectedCampaigns, campaigns.length, selectedAdSets, adsets.length])

  const filteredCompRows = useMemo(() => {
    let result = comparisonRows
    if (selectedCampaigns.length > 0 && selectedCampaigns.length < campaigns.length) {
      result = result.filter((r) => r.campaign_id && selectedCampaigns.includes(r.campaign_id))
    }
    if (selectedAdSets.length > 0 && selectedAdSets.length < adsets.length) {
      result = result.filter((r) => r.adset_id && selectedAdSets.includes(r.adset_id))
    }
    return result
  }, [comparisonRows, selectedCampaigns, campaigns.length, selectedAdSets, adsets.length])

  // Filter Google Ads rows by selected campaigns + ad groups
  const filteredGaRows = useMemo(() => {
    let result = googleAdsRows
    if (selectedGaCampaigns.length > 0 && selectedGaCampaigns.length < gaCampaigns.length) {
      result = result.filter((r) => r.campaign_id && selectedGaCampaigns.includes(r.campaign_id))
    }
    if (selectedAdGroups.length > 0 && selectedAdGroups.length < adGroups.length) {
      result = result.filter((r) => r.ad_group_id && selectedAdGroups.includes(r.ad_group_id))
    }
    return result
  }, [googleAdsRows, selectedGaCampaigns, gaCampaigns.length, selectedAdGroups, adGroups.length])

  const filteredGaCompRows = useMemo(() => {
    let result = googleAdsComparisonRows
    if (selectedGaCampaigns.length > 0 && selectedGaCampaigns.length < gaCampaigns.length) {
      result = result.filter((r) => r.campaign_id && selectedGaCampaigns.includes(r.campaign_id))
    }
    if (selectedAdGroups.length > 0 && selectedAdGroups.length < adGroups.length) {
      result = result.filter((r) => r.ad_group_id && selectedAdGroups.includes(r.ad_group_id))
    }
    return result
  }, [googleAdsComparisonRows, selectedGaCampaigns, gaCampaigns.length, selectedAdGroups, adGroups.length])

  // Aggregated metrics based on selected platform
  const metrics = useMemo(() => {
    if (isMeta) return aggregateMetrics(filteredRows)
    if (isGoogleAds) return aggregateGoogleAdsMetrics(filteredGaRows)
    // "all" — combine both
    return mergeMetrics(aggregateMetrics(filteredRows), aggregateGoogleAdsMetrics(filteredGaRows))
  }, [filteredRows, filteredGaRows, platform])

  const derived = useMemo(() => deriveMetrics(metrics), [metrics])

  // Month-to-date pacing projection — only compute when the display range
  // aligns with "this_month" and the client has a monthly budget set.
  const pacing = useMemo(() => {
    if (!client.monthly_budget || client.monthly_budget <= 0) return null
    if (preset !== "this_month") return null
    // Build daily spend series for the current month from filteredRows
    const dailyMap = new Map<string, number>()
    for (const r of filteredRows) {
      if (!r.date) continue
      dailyMap.set(r.date, (dailyMap.get(r.date) || 0) + (r.spend || 0))
    }
    // Also include Google Ads spend if on All Platforms view
    if (isAll) {
      for (const r of filteredGaRows) {
        if (!r.date) continue
        dailyMap.set(r.date, (dailyMap.get(r.date) || 0) + (r.spend || 0))
      }
    }
    const dailySpend = Array.from(dailyMap.entries())
      .map(([date, spend]) => ({ date, spend }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const now = new Date()
    return calculatePacing(dailySpend, client.monthly_budget, now.getFullYear(), now.getMonth() + 1)
  }, [client.monthly_budget, preset, filteredRows, filteredGaRows, isAll])

  const compMetrics = useMemo(() => {
    if (isMeta) return aggregateMetrics(filteredCompRows)
    if (isGoogleAds) return aggregateGoogleAdsMetrics(filteredGaCompRows)
    return mergeMetrics(aggregateMetrics(filteredCompRows), aggregateGoogleAdsMetrics(filteredGaCompRows))
  }, [filteredCompRows, filteredGaCompRows, platform])

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

  // Helper: generate all dates in the selected range so charts always span the full range
  const allDates = useMemo(() => {
    const dates: string[] = []
    if (!from || !to) return dates
    const d = new Date(from + "T00:00:00")
    const end = new Date(to + "T00:00:00")
    if (isNaN(d.getTime()) || isNaN(end.getTime())) return dates
    // Safety: cap at 366 days to prevent infinite loops
    const maxDays = 366
    let count = 0
    while (d <= end && count < maxDays) {
      dates.push(d.toISOString().split("T")[0])
      d.setDate(d.getDate() + 1)
      count++
    }
    return dates
  }, [from, to])

  // Chart data — daily spend series (always covers full date range)
  const spendSeries = useMemo(() => {
    const byDate: Record<string, number> = {}
    if (!isGoogleAds) {
      for (const r of filteredRows) {
        if (!r.date) continue
        byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
      }
    }
    if (!isMeta) {
      for (const r of filteredGaRows) {
        if (!r.date) continue
        byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
      }
    }
    return allDates.map((date) => ({
      date,
      value: Math.round((byDate[date] || 0) * 100) / 100,
    }))
  }, [filteredRows, filteredGaRows, platform, allDates])

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

  // Creative volumes: spend share per ad, bucketed by current status (live/testing).
  // "Overall spend" denominator is the total spend of filteredRows in the selected range.
  const creativeVolumes = useMemo(() => {
    if (!isMeta) {
      return { totalSpend: 0, live: [], testing: [], liveSpend: 0, testingSpend: 0 }
    }
    const adSpend = new Map<string, { name: string; spend: number }>()
    let totalSpend = 0
    for (const r of filteredRows) {
      const spend = r.spend || 0
      totalSpend += spend
      if (!r.ad_id) continue
      const existing = adSpend.get(r.ad_id)
      if (existing) {
        existing.spend += spend
      } else {
        adSpend.set(r.ad_id, { name: r.ad_name || r.ad_id, spend })
      }
    }
    const live: { id: string; name: string; spend: number }[] = []
    const testing: { id: string; name: string; spend: number }[] = []
    adSpend.forEach((v, id) => {
      if (v.spend <= 0) return
      const status = entityStatusMap.get(id)
      if (status === "live") live.push({ id, name: v.name, spend: v.spend })
      else if (status === "testing") testing.push({ id, name: v.name, spend: v.spend })
    })
    live.sort((a, b) => b.spend - a.spend)
    testing.sort((a, b) => b.spend - a.spend)
    const liveSpend = live.reduce((s, a) => s + a.spend, 0)
    const testingSpend = testing.reduce((s, a) => s + a.spend, 0)
    return { totalSpend, live, testing, liveSpend, testingSpend }
  }, [filteredRows, entityStatusMap, isMeta])

  // Creative classification (winner/loser/viable/…) for the portfolio-health strip
  // and Coverage Analysis. Only computed for Meta — Google Ads has no ad-level rows.
  const classifiedAds = useMemo(
    () => (isMeta ? classifyAllAds(filteredRows, keyAction ?? undefined, namingConfig) : []),
    [filteredRows, keyAction, namingConfig, isMeta]
  )

  const classificationCounts = useMemo(
    () => countByClassification(classifiedAds),
    [classifiedAds]
  )

  const concentration = useMemo(
    () =>
      calculateConcentration(
        classifiedAds.map((a) => ({ adId: a.adId, adName: a.adName, spend: a.spend }))
      ),
    [classifiedAds]
  )

  const coverageAnalysisEligible = useMemo(
    () =>
      isMeta &&
      classifiedAds.length > 0 &&
      classifiedAds.some((a) => a.parsed?.stage || a.parsed?.job),
    [classifiedAds, isMeta]
  )

  // Google Ads CPA chart data (conversions bar + CPA line + 7-day rolling)
  const gaCpaChartData = useMemo(() => {
    if (!isGoogleAds) return []
    const byDate: Record<string, { spend: number; conversions: number }> = {}
    for (const r of filteredGaRows) {
      if (!r.date) continue
      if (!byDate[r.date]) byDate[r.date] = { spend: 0, conversions: 0 }
      byDate[r.date].spend += r.spend || 0
      byDate[r.date].conversions += r.conversions || 0
    }
    const sorted = Object.entries(byDate)
      .map(([date, d]) => ({
        date,
        count: d.conversions,
        cpa: d.conversions > 0 ? d.spend / d.conversions : null,
        spend: d.spend,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
    // 7-day rolling CPA
    return sorted.map((d, i) => {
      const window = sorted.slice(Math.max(0, i - 6), i + 1)
      const validCpa = window.filter((w) => w.cpa !== null).map((w) => w.cpa!)
      const rolling = validCpa.length > 0
        ? validCpa.reduce((a, b) => a + b, 0) / validCpa.length
        : null
      return { ...d, rolling }
    })
  }, [filteredGaRows, platform])

  // Google Ads spend by date (for CPA chart)
  const gaSpendByDate = useMemo(() => {
    const byDate: Record<string, number> = {}
    for (const r of filteredGaRows) {
      if (!r.date) continue
      byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
    }
    return byDate
  }, [filteredGaRows])

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

  // Parse ad names for dimension filtering at ad level
  const perfParsedAds = useMemo(() => {
    if (!isMeta || metaLevel !== "ad") return new Map<string, ParsedAdName>()
    const map = new Map<string, ParsedAdName>()
    for (const r of filteredRows) {
      if (!r.ad_name || !r.ad_id || map.has(r.ad_id)) continue
      const parsed = parseAdName(r.ad_name, namingConfig)
      if (parsed) map.set(r.ad_id, parsed)
    }
    return map
  }, [filteredRows, metaLevel, platform, namingConfig])

  const perfAvailableDims = useMemo(() => {
    if (perfParsedAds.size === 0) return [] as string[]
    return getAvailableDimensions(Array.from(perfParsedAds.values()), namingConfig)
  }, [perfParsedAds, namingConfig])

  // Compute unique values per dimension for filter dropdowns
  const perfDimValues = useMemo(() => {
    const result: Record<string, string[]> = {}
    for (const dim of perfAvailableDims) {
      const vals = new Set<string>()
      for (const parsed of Array.from(perfParsedAds.values())) {
        const v = getDimensionValue(parsed, dim)
        if (v) vals.add(v)
      }
      result[dim] = Array.from(vals).sort()
    }
    return result
  }, [perfAvailableDims, perfParsedAds])

  // Table data — apply drill-down filtering for Meta
  const groupedData = useMemo(() => {
    let base: { id: string; name: string; metrics: AggregatedMetrics; platform?: "meta" | "google" }[]
    if (isMeta) {
      let rows = filteredRows
      if (drillPath.length >= 1) rows = rows.filter(r => r.campaign_id === drillPath[0].id)
      if (drillPath.length >= 2) rows = rows.filter(r => r.adset_id === drillPath[1].id)

      // Apply dimension filters at ad level
      if (metaLevel === "ad") {
        const activeFilters = Object.entries(perfDimFilters).filter(([, vals]) => vals.length > 0)
        if (activeFilters.length > 0) {
          rows = rows.filter(r => {
            if (!r.ad_id) return true
            const parsed = perfParsedAds.get(r.ad_id)
            if (!parsed) return true
            return activeFilters.every(([dim, vals]) => {
              const v = getDimensionValue(parsed, dim)
              return v ? vals.includes(v) : false
            })
          })
        }
      }

      base = groupByLevel(rows, metaLevel)
    } else if (isGoogleAds) {
      base = groupGoogleAdsByLevel(filteredGaRows, gaLevel)
    } else {
      // "all" — combine both platforms grouped by campaign, tagged with platform
      const metaGroups = groupByLevel(filteredRows, "campaign").map(g => ({ ...g, platform: "meta" as const }))
      const gaGroups = groupGoogleAdsByLevel(filteredGaRows, "campaign").map(g => ({ ...g, platform: "google" as const }))
      base = [...metaGroups, ...gaGroups].sort((a, b) => b.metrics.spend - a.metrics.spend)
    }

    // Apply status filter
    if (tableStatusFilter !== "all") {
      base = base.filter((row) => entityStatusMap.get(row.id) === tableStatusFilter)
    }
    return base
  }, [filteredRows, filteredGaRows, metaLevel, drillPath, gaLevel, platform, perfDimFilters, perfParsedAds, tableStatusFilter, entityStatusMap])

  // Comparison grouped data — same grouping logic applied to comparison rows
  const compGroupedData = useMemo(() => {
    if (filteredCompRows.length === 0 && filteredGaCompRows.length === 0) return []
    if (isMeta) {
      // Note: drill-down filters by campaign/adset ID won't match comparison rows
      // (different date range), so comparison at drill level is approximate
      return groupByLevel(filteredCompRows, metaLevel)
    }
    if (isGoogleAds) return groupGoogleAdsByLevel(filteredGaCompRows, gaLevel)
    const metaGroups = groupByLevel(filteredCompRows, "campaign").map(g => ({ ...g, platform: "meta" as const }))
    const gaGroups = groupGoogleAdsByLevel(filteredGaCompRows, "campaign").map(g => ({ ...g, platform: "google" as const }))
    return [...metaGroups, ...gaGroups].sort((a, b) => b.metrics.spend - a.metrics.spend)
  }, [filteredCompRows, filteredGaCompRows, metaLevel, gaLevel, platform])

  // Has comparison data?
  const hasComp = compareType !== "none" && (filteredCompRows.length > 0 || filteredGaCompRows.length > 0)

  // Comparison spend series — built from comparison rows (aligned by day index)
  const compSpendSeries = useMemo(() => {
    if (!hasComp) return undefined
    if (isMeta) {
      return dailySpendSeries(filteredCompRows).map((d) => ({ date: d.date, value: d.spend }))
    }
    if (isGoogleAds) {
      const byDate: Record<string, number> = {}
      for (const r of filteredGaCompRows) {
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
    for (const r of filteredGaCompRows) {
      if (!r.date) continue
      byDate[r.date] = (byDate[r.date] || 0) + (r.spend || 0)
    }
    return Object.entries(byDate)
      .map(([date, spend]) => ({ date, value: Math.round(spend * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredCompRows, filteredGaCompRows, hasComp, platform])

  // Delta helper
  const delta = (current: number, prev: number) =>
    hasComp ? fmtDelta(current, prev) : null

  // Shopify aggregated metrics
  const hasShopify = shopifyOrders.length > 0
  const shopifyMetrics = useMemo(() => aggregateShopifyMetrics(shopifyOrders), [shopifyOrders])
  const shopifyCompMetrics = useMemo(() => aggregateShopifyMetrics(shopifyCompOrders), [shopifyCompOrders])
  const hasShopifyComp = hasComp && shopifyCompOrders.length > 0

  // Shopify AOV
  const shopifyAov = shopifyMetrics.orders > 0 ? shopifyMetrics.netRevenue / shopifyMetrics.orders : 0
  const shopifyCompAov = shopifyCompMetrics.orders > 0 ? shopifyCompMetrics.netRevenue / shopifyCompMetrics.orders : 0

  // CM3 from real Shopify data (total ad spend across all platforms)
  const totalAdSpend = metrics.spend
  const compTotalAdSpend = compMetrics.spend
  const shopifyCm3 = useMemo(
    () => hasShopify ? calculateCM3(shopifyMetrics, totalAdSpend) : null,
    [hasShopify, shopifyMetrics, totalAdSpend]
  )
  const shopifyCompCm3 = useMemo(
    () => hasShopifyComp ? calculateCM3(shopifyCompMetrics, compTotalAdSpend) : null,
    [hasShopifyComp, shopifyCompMetrics, compTotalAdSpend]
  )

  // Meta attribution comparison
  const hasMetaAndShopify = hasShopify && !!client.meta_account_id && shopifyAttribution.length > 0
  const metaAttribution = useMemo(
    () => hasMetaAndShopify
      ? calculateMetaAttribution(
          { purchases: metrics.purchases, revenue: metrics.revenue },
          shopifyAttribution
        )
      : null,
    [hasMetaAndShopify, metrics.purchases, metrics.revenue, shopifyAttribution]
  )
  const compMetaAttribution = useMemo(
    () => hasShopifyComp && hasMetaAndShopify
      ? calculateMetaAttribution(
          { purchases: compMetrics.purchases, revenue: compMetrics.revenue },
          shopifyCompAttribution
        )
      : null,
    [hasShopifyComp, hasMetaAndShopify, compMetrics.purchases, compMetrics.revenue, shopifyCompAttribution]
  )

  // Incremental Meta revenue metrics
  const metaSpend = useMemo(() => {
    return rows.reduce((sum, r) => sum + (r.spend || 0), 0)
  }, [rows])
  const shopifyMetaRevenue = metaAttribution?.shopifyAttributedRevenue ?? 0
  const metaBlendedRoas = metaSpend > 0 ? shopifyMetaRevenue / metaSpend : 0
  const blendedRoas = totalAdSpend > 0 ? shopifyMetrics.netRevenue / totalAdSpend : 0
  const metaRevenueSharePct = shopifyMetrics.netRevenue > 0 ? (shopifyMetaRevenue / shopifyMetrics.netRevenue) * 100 : 0

  // Comparison incremental metrics
  const compMetaSpend = useMemo(() => {
    return comparisonRows.reduce((sum, r) => sum + (r.spend || 0), 0)
  }, [comparisonRows])
  const compShopifyMetaRevenue = compMetaAttribution?.shopifyAttributedRevenue ?? 0
  const compMetaBlendedRoas = compMetaSpend > 0 ? compShopifyMetaRevenue / compMetaSpend : 0
  const compBlendedRoas = compTotalAdSpend > 0 ? shopifyCompMetrics.netRevenue / compTotalAdSpend : 0
  const compMetaRevenueSharePct = shopifyCompMetrics.netRevenue > 0 ? (compShopifyMetaRevenue / shopifyCompMetrics.netRevenue) * 100 : 0

  // Navigation helpers
  // Shallow route update: only change the URL without triggering a server
  // re-fetch. Safe when the new date range fits inside the fetched window
  // and the comparison range also fits (or compareType is "none").
  function canShallowRoute(newFrom: string, newTo: string, newCompare: ComparisonType): boolean {
    if (!fetchedFrom || !fetchedTo) return false
    if (newFrom < fetchedFrom || newTo > fetchedTo) return false
    if (newCompare === "none") return true
    const cr = getComparisonRange({ from: newFrom, to: newTo }, newCompare)
    if (!cr) return true
    // Need to have the comparison rows cached too — the server only widens
    // when comparison fits in 31-60 days ago. If the user has loaded the
    // wide window path, rawComparisonRows covers 31-60 days ago.
    const today = new Date().toISOString().split("T")[0]
    const sixtyAgo = new Date()
    sixtyAgo.setDate(sixtyAgo.getDate() - 60)
    const sixtyAgoStr = sixtyAgo.toISOString().split("T")[0]
    const thirtyAgo = new Date()
    thirtyAgo.setDate(thirtyAgo.getDate() - 30)
    const thirtyAgoStr = thirtyAgo.toISOString().split("T")[0]
    return cr.from >= sixtyAgoStr && cr.to <= thirtyAgoStr && today !== ""
  }

  function updateSearchParams(updates: Record<string, string>, opts?: { allowShallow?: boolean }) {
    const params = new URLSearchParams()
    const merged = { preset, from, to, compare: compareType, ...updates }
    for (const [key, val] of Object.entries(merged)) {
      if (val) params.set(key, val)
    }
    const newFrom = String(merged.from || from)
    const newTo = String(merged.to || to)
    const newCompare = (merged.compare || compareType) as ComparisonType
    const url = `/dashboard/clients/${client.id}?${params.toString()}`
    if (opts?.allowShallow && canShallowRoute(newFrom, newTo, newCompare)) {
      // Update URL in place without re-running the server component
      window.history.replaceState(null, "", url)
      // Tell Next.js about the change so useSearchParams updates
      router.replace(url, { scroll: false })
    } else {
      router.push(url)
    }
  }

  function handlePresetChange(p: DatePreset) {
    // Resolve the preset to a concrete range so we can decide whether to
    // shallow-route (fits in fetched window) or trigger a full fetch.
    const newRange = getPresetRange(p)
    updateSearchParams(
      { preset: p, from: newRange.from, to: newRange.to },
      { allowShallow: true }
    )
  }

  function handleCustomChange(newFrom: string, newTo: string) {
    updateSearchParams(
      { preset: "custom", from: newFrom, to: newTo },
      { allowShallow: true }
    )
  }

  function handleCompareChange(c: ComparisonType) {
    updateSearchParams({ compare: c }, { allowShallow: true })
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
  const gaMetrics = useMemo(() => aggregateGoogleAdsMetrics(filteredGaRows), [filteredGaRows])
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
    for (const r of filteredGaRows) {
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
  }, [filteredRows, filteredGaRows, platform, allKeyActionStep])

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
      setPerfDimFilters({}) // reset naming convention filters
    }
  }

  // Drill-down breadcrumb for Meta performance table
  const drillBreadcrumb = isMeta && drillPath.length > 0 ? [
    { label: "All Campaigns", onClick: () => { setDrillPath([]); setMetaLevel("campaign"); setPerfDimFilters({}) } },
    ...drillPath.map((crumb, i) => ({
      label: crumb.name,
      onClick: () => {
        setDrillPath(prev => prev.slice(0, i + 1))
        setMetaLevel(crumb.level === "campaign" ? "adset" : "ad")
        setPerfDimFilters({})
      },
    })),
  ] : undefined

  const handleDrillDown = isMeta && metaLevel !== "ad" ? (row: { id: string; name: string }) => {
    setDrillPath(prev => [...prev, { level: metaLevel, id: row.id, name: row.name }])
    setMetaLevel(metaLevel === "campaign" ? "adset" : "ad")
    setPerfDimFilters({}) // reset naming convention filters on drill
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
          <>
            <AdSetSelector
              items={campaigns}
              selected={selectedCampaigns}
              onChange={setSelectedCampaigns}
              label="campaigns"
            />
            <AdSetSelector
              items={adsets}
              selected={selectedAdSets}
              onChange={setSelectedAdSets}
              label="ad sets"
            />
          </>
        )}

        {isGoogleAds && (
          <>
            <AdSetSelector
              items={gaCampaigns}
              selected={selectedGaCampaigns}
              onChange={setSelectedGaCampaigns}
              label="campaigns"
            />
            <AdSetSelector
              items={adGroups}
              selected={selectedAdGroups}
              onChange={setSelectedAdGroups}
              label="ad groups"
            />
          </>
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
      <div className={`grid grid-cols-2 gap-3 ${showReach ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <MetricCard
          label="Spend"
          value={fmtCurrency(metrics.spend, currency)}
          delta={delta(metrics.spend, compMetrics.spend)}
          subValue={pacing && pacing.pacingPct !== null ? `Pacing ${pacing.pacingPct.toFixed(0)}%` : undefined}
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
        {showReach && (
          <MetricCard
            label="Frequency"
            value={derived.frequency > 0 ? `${derived.frequency.toFixed(2)}x` : "—"}
            delta={hasComp && compDerived.frequency > 0 ? delta(derived.frequency, compDerived.frequency) : null}
            invertDelta
          />
        )}
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

      {/* Creative Volumes — spend share of currently active ads (live + testing) */}
      {isMeta && (creativeVolumes.liveSpend + creativeVolumes.testingSpend) > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-400">Creative Volumes</h2>
            <span className="text-[10px] text-neutral-500">
              Share of spend across currently active ads
            </span>
          </div>
          {(() => {
            const activeTotal = creativeVolumes.liveSpend + creativeVolumes.testingSpend
            const livePct = (creativeVolumes.liveSpend / activeTotal) * 100
            const testingPct = (creativeVolumes.testingSpend / activeTotal) * 100
            const segments: {
              key: "live" | "testing"
              label: string
              color: string
              dot: string
              pct: number
              spend: number
              ads: { id: string; name: string; spend: number }[]
            }[] = [
              {
                key: "live",
                label: "Live",
                color: "#22c55e",
                dot: "bg-green-400",
                pct: livePct,
                spend: creativeVolumes.liveSpend,
                ads: creativeVolumes.live,
              },
              {
                key: "testing",
                label: "Testing",
                color: "#3b82f6",
                dot: "bg-blue-400",
                pct: testingPct,
                spend: creativeVolumes.testingSpend,
                ads: creativeVolumes.testing,
              },
            ]
            return (
              <div className="space-y-3">
                <div className="flex h-8 overflow-hidden rounded-lg bg-neutral-800">
                  {segments.map((seg) => {
                    if (seg.pct <= 0) return null
                    return (
                      <div
                        key={seg.key}
                        className="group relative flex items-center justify-center transition-opacity hover:opacity-80"
                        style={{
                          width: `${seg.pct}%`,
                          backgroundColor: seg.color,
                          minWidth: "24px",
                        }}
                      >
                        {seg.pct > 8 && (
                          <span className="text-xs font-medium text-black">
                            {seg.pct.toFixed(0)}%
                          </span>
                        )}
                        {/* Tooltip */}
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-neutral-100">
                              {seg.label} — {seg.ads.length} ad{seg.ads.length !== 1 ? "s" : ""}
                            </p>
                            <p className="text-[10px] text-neutral-400">
                              {fmtCurrency(seg.spend, currency)} · {seg.pct.toFixed(1)}%
                            </p>
                          </div>
                          <div className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto">
                            {seg.ads.slice(0, 10).map((ad) => {
                              const adPct = (ad.spend / activeTotal) * 100
                              return (
                                <div
                                  key={ad.id}
                                  className="flex items-center justify-between gap-2 text-[10px]"
                                >
                                  <span className="truncate text-neutral-300">{ad.name}</span>
                                  <span className="shrink-0 tabular-nums text-neutral-500">
                                    {adPct.toFixed(1)}%
                                  </span>
                                </div>
                              )
                            })}
                            {seg.ads.length > 10 && (
                              <p className="pt-1 text-[10px] text-neutral-500">
                                +{seg.ads.length - 10} more
                              </p>
                            )}
                          </div>
                          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-700" />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  {segments.map((seg) => (
                    <div key={seg.key} className="flex items-center gap-1.5">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${seg.dot}`} />
                      <span className="text-neutral-300">
                        {seg.label} ({seg.ads.length})
                      </span>
                      <span className="text-neutral-500">
                        {seg.pct.toFixed(1)}% · {fmtCurrency(seg.spend, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </Card>
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

      {/* Shopify Overview — shown when Shopify data exists */}
      {hasShopify && (
        <>
          <h2 className="text-sm font-medium text-neutral-400">Shopify Store</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricCard
              label="Shopify Orders"
              value={fmtNumber(shopifyMetrics.orders)}
              delta={hasShopifyComp ? fmtDelta(shopifyMetrics.orders, shopifyCompMetrics.orders) : undefined}
            />
            <MetricCard
              label="Net Revenue"
              value={fmtCurrency(shopifyMetrics.netRevenue, currency)}
              subValue="After discounts & refunds"
              delta={hasShopifyComp ? fmtDelta(shopifyMetrics.netRevenue, shopifyCompMetrics.netRevenue) : undefined}
            />
            <MetricCard
              label="Shopify AOV"
              value={fmtCurrency(shopifyAov, currency)}
              delta={hasShopifyComp ? fmtDelta(shopifyAov, shopifyCompAov) : undefined}
            />
          </div>
        </>
      )}

      {/* Meta: Platform vs Shopify Attribution — shown when both Meta and Shopify data exist */}
      {metaAttribution && (
        <>
          <h2 className="text-sm font-medium text-neutral-400">Meta: Platform vs Shopify Attribution</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Meta Reported Revenue"
              value={fmtCurrency(metaAttribution.metaReportedRevenue, currency)}
              subValue="Meta platform data"
              delta={compMetaAttribution ? fmtDelta(metaAttribution.metaReportedRevenue, compMetaAttribution.metaReportedRevenue) : undefined}
            />
            <MetricCard
              label="Shopify Attributed to Meta"
              value={fmtCurrency(metaAttribution.shopifyAttributedRevenue, currency)}
              subValue="Shopify UTM data"
              delta={compMetaAttribution ? fmtDelta(metaAttribution.shopifyAttributedRevenue, compMetaAttribution.shopifyAttributedRevenue) : undefined}
            />
            <MetricCard
              label="Revenue Gap"
              value={fmtCurrency(metaAttribution.revenueDiscrepancy, currency)}
              subValue={`${metaAttribution.revenueDiscrepancyPct >= 0 ? "+" : ""}${metaAttribution.revenueDiscrepancyPct.toFixed(1)}% ${metaAttribution.revenueDiscrepancyPct >= 0 ? "over" : "under"}-reported`}
            />
            <MetricCard
              label="Order Gap"
              value={fmtNumber(metaAttribution.metaReportedPurchases - metaAttribution.shopifyAttributedOrders)}
              subValue={`Meta: ${fmtNumber(metaAttribution.metaReportedPurchases)} · Shopify: ${fmtNumber(metaAttribution.shopifyAttributedOrders)}`}
            />
          </div>
        </>
      )}

      {/* CM3 — Contribution Margin 3 */}
      {/* Uses real Shopify COGS/shipping when available, falls back to cmPct when not */}
      {shopifyCm3 ? (
        <>
          <h2 className="text-sm font-medium text-neutral-400">Contribution Margin 3</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Net Revenue"
              value={fmtCurrency(shopifyCm3.netRevenue, currency)}
              subValue="Shopify store revenue"
              delta={shopifyCompCm3 ? fmtDelta(shopifyCm3.netRevenue, shopifyCompCm3.netRevenue) : undefined}
            />
            <MetricCard
              label="Gross Profit"
              value={fmtCurrency(shopifyCm3.grossProfit, currency)}
              subValue="After COGS & shipping"
              delta={shopifyCompCm3 ? fmtDelta(shopifyCm3.grossProfit, shopifyCompCm3.grossProfit) : undefined}
            />
            <MetricCard
              label="CM3"
              value={fmtCurrency(shopifyCm3.cm3, currency)}
              subValue={`CM3 margin: ${shopifyCm3.cm3Pct.toFixed(1)}%`}
              delta={shopifyCompCm3 ? fmtDelta(shopifyCm3.cm3, shopifyCompCm3.cm3) : undefined}
            />
            <MetricCard
              label="CM3 ROAS"
              value={shopifyCm3.totalAdSpend > 0 ? (shopifyCm3.cm3 / shopifyCm3.totalAdSpend).toFixed(2) + "x" : "—"}
              subValue="Profit per ad spend"
              delta={shopifyCompCm3 && shopifyCompCm3.totalAdSpend > 0
                ? fmtDelta(shopifyCm3.cm3 / shopifyCm3.totalAdSpend, shopifyCompCm3.cm3 / shopifyCompCm3.totalAdSpend)
                : undefined}
            />
          </div>
        </>
      ) : cmPct != null && metrics.revenue > 0 ? (() => {
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
      })() : null}

      {/* Meta Incremental Revenue — shown when both Meta and Shopify attribution exist */}
      {metaAttribution && hasShopify && (
        <>
          <h2 className="text-sm font-medium text-neutral-400">Meta Incremental Revenue</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricCard
              label="Blended ROAS"
              value={blendedRoas > 0 ? blendedRoas.toFixed(2) + "x" : "—"}
              subValue="Shopify revenue / all ad spend"
              delta={hasShopifyComp ? fmtDelta(blendedRoas, compBlendedRoas) : undefined}
            />
            <MetricCard
              label="Meta Blended ROAS"
              value={metaBlendedRoas > 0 ? metaBlendedRoas.toFixed(2) + "x" : "—"}
              subValue={`vs Meta reported: ${derived.roas.toFixed(2)}x`}
              delta={hasShopifyComp ? fmtDelta(metaBlendedRoas, compMetaBlendedRoas) : undefined}
            />
            <MetricCard
              label="Meta Revenue Share"
              value={fmtPercent(metaRevenueSharePct)}
              subValue={`${fmtCurrency(shopifyMetaRevenue, currency)} of ${fmtCurrency(shopifyMetrics.netRevenue, currency)}`}
              delta={hasShopifyComp ? fmtDelta(metaRevenueSharePct, compMetaRevenueSharePct) : undefined}
            />
          </div>
        </>
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

      {/* Google Ads summary metrics — 4 rows of 3 */}
      {isGoogleAds && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label="Clicks"
              value={fmtNumber(metrics.clicks)}
              delta={delta(metrics.clicks, compMetrics.clicks)}
            />
            <MetricCard
              label="CPC"
              value={fmtCurrency(derived.cpc, currency)}
              delta={delta(derived.cpc, compDerived.cpc)}
              invertDelta
            />
            <MetricCard
              label="CTR"
              value={fmtPercent(derived.ctr)}
              delta={delta(derived.ctr, compDerived.ctr)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label="Conversions"
              value={fmtNumber(metrics.purchases)}
              delta={delta(metrics.purchases, compMetrics.purchases)}
            />
            <MetricCard
              label="CPA"
              value={fmtCurrency(derived.cpa, currency)}
              delta={delta(derived.cpa, compDerived.cpa)}
              invertDelta
            />
            <MetricCard
              label="CVR"
              value={fmtPercent(derived.conversionRate)}
              delta={delta(derived.conversionRate, compDerived.conversionRate)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
        </div>
      )}

      {/* "All" platforms summary — key metric conversions + CPA */}
      {isAll && (
        <>
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
            <MetricCard
              label="Purchases"
              value={fmtNumber(allTotalKeyCount)}
              subValue={`Meta: ${fmtNumber(allMetaKeyCount)} · Google: ${fmtNumber(allGoogleKeyCount)}`}
              delta={delta(metrics.purchases, compMetrics.purchases)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="CPA"
              value={allCpa > 0 ? fmtCurrency(allCpa, currency) : "\u2014"}
              invertDelta
            />
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
        </>
      )}

      {/* Charts — Daily Spend + Spend Breakdown side by side */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_300px]">
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
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Spend Breakdown</h2>
          <SpendBreakdownPie
            metaRows={filteredRows}
            googleAdsRows={filteredGaRows}
            compMetaRows={hasComp ? filteredCompRows : []}
            compGoogleAdsRows={hasComp ? filteredGaCompRows : []}
            platform={platform}
            currency={currency}
          />
        </Card>
      </div>

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

      {/* CPA Chart (Google Ads view) */}
      {isGoogleAds && gaCpaChartData.length > 0 && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Cost Per Conversion
          </h2>
          <CPAChart
            data={gaCpaChartData.map((d) => ({ date: d.date, conversions: d.count }))}
            stepKey="conversions"
            stepLabel="Conversion"
            spendByDate={gaSpendByDate}
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

      {/* Portfolio health: classification strip (display-only) */}
      {isMeta && classifiedAds.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-400">Portfolio Health</h2>
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: CONCENTRATION_COLORS[concentration.level] }}
              />
              <span className="text-xs font-medium text-neutral-300">
                {concentration.level}
              </span>
              <span className="text-[10px] text-neutral-500">
                Top ad {concentration.topAdShare.toFixed(0)}% of spend
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(
              [
                "DIRECT_WINNER",
                "INDIRECT_WINNER",
                "VIABLE_UNDERSCALED",
                "LOSER",
                "LOSER_NON_CONTRIBUTING",
                "LOSER_NO_DELIVERY",
                "INSUFFICIENT_DATA",
              ] as ClassificationType[]
            ).map((type) => {
              const count = classificationCounts[type]
              if (!count) return null
              const def = CLASSIFICATIONS[type]
              return (
                <div key={type} className="group relative flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: def.color }}
                  />
                  <span className="text-xs text-neutral-300">{def.label}</span>
                  <span className="text-xs tabular-nums text-neutral-500">({count})</span>
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                    <p className="text-xs font-semibold text-neutral-100">{def.label}</p>
                    <p className="mt-0.5 text-[10px] text-neutral-400">{def.description}</p>
                    <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-700" />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Coverage Analysis — stage × job gap matrix (naming-config-gated, Meta only) */}
      {coverageAnalysisEligible && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Coverage Analysis</h2>
          <CoverageAnalysis ads={classifiedAds} currency={currency} />
        </Card>
      )}

      {/* Funnel drop-off (Meta only) */}
      {showFunnel && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Funnel Drop-Off</h2>
          <FunnelDropOffChart metrics={metrics} funnelSteps={funnelSteps} />
        </Card>
      )}

      {/* Alexia Clark — Campaign Structure Analysis */}
      {client.name === "Alexia" && (
        <AlexiaClarkStructureView rows={filteredRows} currency={currency} />
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
            {/* Dimension filters — only at ad level with naming config */}
            {isMeta && metaLevel === "ad" && perfAvailableDims.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                  Filter by
                </span>
                {perfAvailableDims.map((dim) => (
                  <PerfDimensionFilter
                    key={dim}
                    label={getDimensionLabel(dim, namingConfig)}
                    values={perfDimValues[dim] || []}
                    selected={perfDimFilters[dim] || []}
                    onChange={(vals) =>
                      setPerfDimFilters((prev) => ({ ...prev, [dim]: vals }))
                    }
                  />
                ))}
                {Object.values(perfDimFilters).some((v) => v.length > 0) && (
                  <button
                    onClick={() => setPerfDimFilters({})}
                    className="text-[10px] text-neutral-500 underline hover:text-neutral-300 transition"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
            {/* Status filter chips */}
            <div className="mb-3 flex items-center gap-1.5">
              <span className="text-[11px] text-neutral-500 mr-1">Show:</span>
              {(
                [
                  { key: "all", label: "All", dot: null },
                  { key: "live", label: "Live", dot: "bg-green-400" },
                  { key: "testing", label: "Testing", dot: "bg-blue-400" },
                  { key: "paused", label: "Paused", dot: "bg-red-400" },
                ] as const
              ).map((opt) => {
                const active = tableStatusFilter === opt.key
                return (
                  <button
                    key={opt.key}
                    onClick={() => setTableStatusFilter(opt.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? "border-brand-lime/40 bg-brand-lime/10 text-brand-lime"
                        : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-white"
                    }`}
                  >
                    {opt.dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${opt.dot}`} />}
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <PerformanceTable
              data={groupedData}
              comparisonData={hasComp ? compGroupedData : undefined}
              level={currentTableLevel}
              onLevelChange={handleTableLevelChange}
              funnelSteps={isMeta ? funnelSteps : []}
              levelOptions={tableLevelOptions}
              currency={currency}
              breadcrumb={drillBreadcrumb}
              onRowClick={handleDrillDown}
              newAdIds={isMeta && metaLevel === "ad" ? newAdIds : undefined}
              entityStatus={entityStatusMap}
            />
          </div>
        )}
      </Card>

      {/* Breakdowns section (Meta only, not All Platforms) */}
      {isMeta && (demographics.length > 0 || placements.length > 0) && (
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

/* ──────────────────────────────────────────────────────────────────────────── */
/*  PerfDimensionFilter — compact multi-select for perf tab dimension filters */
/* ──────────────────────────────────────────────────────────────────────────── */

function PerfDimensionFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string
  values: string[]
  selected: string[]
  onChange: (vals: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const displayLabel =
    selected.length === 0
      ? label
      : selected.length === 1
        ? selected[0]
        : `${label} (${selected.length})`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
          selected.length > 0
            ? "border-brand-lime/40 bg-brand-lime/10 text-brand-lime"
            : "border-neutral-700 bg-neutral-800/50 text-neutral-400 hover:text-neutral-200"
        }`}
      >
        <span className="max-w-[120px] truncate">{displayLabel}</span>
        <svg
          className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              {label}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => onChange(values)}
                className="text-[10px] text-neutral-400 hover:text-white"
              >
                All
              </button>
              <button
                onClick={() => onChange([])}
                className="text-[10px] text-neutral-400 hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {values.map((val) => {
              const checked = selected.includes(val)
              return (
                <label
                  key={val}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs transition hover:bg-neutral-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (checked) {
                        onChange(selected.filter((v) => v !== val))
                      } else {
                        onChange([...selected, val])
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-800 text-brand-lime focus:ring-brand-lime/30"
                  />
                  <span className={checked ? "text-white" : "text-neutral-400"}>
                    {val}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
