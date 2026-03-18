"use client"

import React, { useMemo, useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { Card } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import AdSetSelector from "@/components/ui/adset-selector"
import TagSelector, { UNTAGGED_FILTER_ID } from "@/components/ui/tag-selector"
import CreativeCardGrid, { type TagInfo } from "@/components/dashboard/creative-card-grid"
import {
  CREATIVE_METRICS,
  CREATIVE_METRIC_ORDER,
  DEFAULT_CARD_METRICS,
  DEFAULT_TABLE_METRICS,
  type CreativeMetricKey,
} from "@/lib/utils/creative-metrics"

// Lazy-load chart components
const SpendShareChart = dynamic(
  () => import("@/components/charts/spend-share-chart"),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded bg-neutral-800/50" /> }
)
const DimensionPieCharts = dynamic(
  () => import("@/components/charts/dimension-pie-charts"),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded bg-neutral-800/50" /> }
)
import TagManagerModal, { type Tag } from "@/components/dashboard/tag-manager-modal"
import MiniRetentionCurve from "@/components/charts/mini-retention-curve"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"
import {
  classifyAllAds,
  countByClassification,
  mergeClassificationWithFatigue,
  getUnifiedStatusLabel,
  CLASSIFICATIONS,
  type ClassifiedAd,
  type ClassificationType,
} from "@/lib/utils/creative-classification"
import { isVideoAd } from "@/lib/utils/video-retention"
import { FUNNEL_STEP_DEFS, type FunnelStepDef } from "@/lib/utils/funnel-steps"
import { detectFatigueAll, FATIGUE_CONFIG } from "@/lib/utils/fatigue-detection"
import { calculateConcentration, CONCENTRATION_COLORS } from "@/lib/utils/spend-concentration"
import {
  type NamingConfig,
  getAvailableDimensions,
  getDimensionLabel,
  getDimensionValue,
  type ParsedAdName,
} from "@/lib/utils/ad-name-parser"
import NamingConfigModal from "@/components/dashboard/naming-config-modal"
import type { MetaDailyRow, MetaDemographicsRow, MetaPlacementsRow } from "@/lib/utils/types"
import type { DatePreset } from "@/lib/utils/dates"

type ThumbnailMap = Record<string, string> // ad_id -> thumbnail_url

type Props = {
  rows: Partial<MetaDailyRow>[]
  preset: DatePreset
  from: string
  to: string
  clientId: string
  thumbnails?: ThumbnailMap
  previewsEnabled?: boolean
  currency?: string
  /** Meta ad account ID for Ads Manager links */
  metaAccountId?: string
  /** Key action from scorecard config — drives classification conversion metric */
  keyAction?: string
  /** Per-ad demographic breakdown rows */
  demographics?: MetaDemographicsRow[]
  /** Per-ad placement breakdown rows */
  placements?: MetaPlacementsRow[]
  /** Configured funnel steps from scorecard config */
  funnelSteps?: string[]
  /** Client-specific naming convention config */
  namingConfig?: NamingConfig
  /** Ad ID → created_time mapping for "test" badge */
  createdDates?: Record<string, string>
  /** Hide editing controls (tags, naming config) for client portal */
  readOnly?: boolean
}

type SortKey =
  | "adName"
  | "adsetName"
  | "classification"
  | CreativeMetricKey

type ViewMode = "table" | "grid"
type GroupBy = "none" | "tags" | `dimension:${string}`

type AdTagMap = Record<string, string[]> // ad_id -> tag_id[]

const CLASSIFICATION_ORDER: ClassificationType[] = [
  "DIRECT_WINNER",
  "INDIRECT_WINNER",
  "VIABLE_UNDERSCALED",
  "LOSER",
  "LOSER_NON_CONTRIBUTING",
  "LOSER_NO_DELIVERY",
  "INSUFFICIENT_DATA",
]

/** Simple error boundary to prevent chart crashes from breaking the whole page */
class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export default function CreativeAnalysisView({
  rows,
  preset,
  from,
  to,
  clientId,
  thumbnails = {},
  previewsEnabled = false,
  currency = "GBP",
  metaAccountId,
  keyAction,
  demographics = [],
  placements = [],
  funnelSteps = ["unique_link_clicks", "purchases"],
  namingConfig,
  createdDates = {},
  readOnly = false,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Convert raw CDN URLs to proxy URLs — Meta CDN URLs expire after ~24h,
  // so we proxy through our API which can re-fetch fresh URLs from Meta
  const proxyThumbnails = useMemo(() => {
    const map: ThumbnailMap = {}
    for (const [adId, url] of Object.entries(thumbnails)) {
      if (url) map[adId] = `/api/thumbnail?ad_id=${encodeURIComponent(adId)}`
    }
    return map
  }, [thumbnails])

  const [sortKey, setSortKey] = useState<SortKey>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [activeFilters, setActiveFilters] = useState<Set<ClassificationType>>(
    new Set()
  )
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [spendShareAdSet, setSpendShareAdSet] = useState<string | null>(null)

  // Dimension filter state
  const [dimensionFilters, setDimensionFilters] = useState<Record<string, string[]>>({})

  // Naming config modal state
  const [showNamingConfig, setShowNamingConfig] = useState(false)

  // Tag state
  const [tags, setTags] = useState<Tag[]>([])
  const [adTagMap, setAdTagMap] = useState<AdTagMap>({})
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([])
  const [showTagManager, setShowTagManager] = useState(false)
  const [tagDropdownAdId, setTagDropdownAdId] = useState<string | null>(null)
  const [tagDropdownAnchor, setTagDropdownAnchor] = useState<DOMRect | null>(null)

  // Detail modal state
  const [detailAd, setDetailAd] = useState<ClassifiedAd | null>(null)

  // Configurable metrics
  const [cardMetrics, setCardMetrics] = useState<CreativeMetricKey[]>(DEFAULT_CARD_METRICS)
  const [tableMetrics, setTableMetrics] = useState<CreativeMetricKey[]>(DEFAULT_TABLE_METRICS)
  const [showMetricPicker, setShowMetricPicker] = useState(false)

  // Fetch tags + ad-tag mappings
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/creative-tags")
      if (res.ok) setTags(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchAdTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/creative-ad-tags?client_id=${clientId}`)
      if (res.ok) {
        const data: { ad_id: string; tag_id: string }[] = await res.json()
        const map: AdTagMap = {}
        data.forEach((row) => {
          if (!map[row.ad_id]) map[row.ad_id] = []
          map[row.ad_id].push(row.tag_id)
        })
        setAdTagMap(map)
      }
    } catch { /* ignore */ }
  }, [clientId])

  useEffect(() => {
    fetchTags()
    fetchAdTags()
  }, [fetchTags, fetchAdTags])

  // Tag assignment
  async function assignTag(adId: string, tagId: string) {
    try {
      const res = await fetch("/api/creative-ad-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_id: adId, tag_id: tagId, client_id: clientId }),
      })
      if (res.ok) {
        setAdTagMap((prev) => ({
          ...prev,
          [adId]: [...(prev[adId] || []), tagId],
        }))
      }
    } catch { /* ignore */ }
    setTagDropdownAdId(null)
  }

  async function removeTag(adId: string, tagId: string) {
    try {
      const res = await fetch("/api/creative-ad-tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_id: adId, tag_id: tagId }),
      })
      if (res.ok) {
        setAdTagMap((prev) => ({
          ...prev,
          [adId]: (prev[adId] || []).filter((t) => t !== tagId),
        }))
      }
    } catch { /* ignore */ }
  }

  // Extract unique ad sets
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

  // Set default spend share ad set once adsets are known
  useMemo(() => {
    if (!spendShareAdSet && adsets.length > 0) {
      setSpendShareAdSet(adsets[0].id)
    }
  }, [adsets, spendShareAdSet])

  // Filter rows by selected ad sets
  const filteredRows = useMemo(() => {
    if (
      selectedAdSets.length === 0 ||
      selectedAdSets.length === adsets.length
    )
      return rows
    return rows.filter(
      (r) => r.adset_id && selectedAdSets.includes(r.adset_id)
    )
  }, [rows, selectedAdSets, adsets.length])

  // Classify all ads
  const classifiedAds = useMemo(
    () => classifyAllAds(filteredRows, keyAction, namingConfig),
    [filteredRows, keyAction, namingConfig]
  )

  // Fatigue detection
  const fatigueMap = useMemo(() => {
    const adIds = classifiedAds.map((a) => a.adId)
    return detectFatigueAll(filteredRows, adIds, 7, to, keyAction)
  }, [classifiedAds, filteredRows, to, keyAction])

  // Enrich classified ads with fatigue status
  const enrichedAds = useMemo(
    () => mergeClassificationWithFatigue(classifiedAds, fatigueMap),
    [classifiedAds, fatigueMap]
  )

  // Available parsed dimensions
  const availableDimensions = useMemo(() => {
    const parsed = enrichedAds
      .map((a) => a.parsed)
      .filter((p): p is ParsedAdName => p !== undefined)
    return getAvailableDimensions(parsed, namingConfig)
  }, [enrichedAds, namingConfig])

  // Compute per-dimension available values for filter dropdowns
  const dimensionValues = useMemo(() => {
    const result: Record<string, string[]> = {}
    for (const dim of availableDimensions) {
      const vals = new Set<string>()
      for (const ad of enrichedAds) {
        const v = getDimensionValue(ad.parsed, dim)
        if (v) vals.add(v)
      }
      result[dim] = Array.from(vals).sort()
    }
    return result
  }, [enrichedAds, availableDimensions])

  // New ad IDs — ads created within last 5 days
  const newAdIds = useMemo(() => {
    const ids = new Set<string>()
    const now = new Date()
    for (const [adId, created] of Object.entries(createdDates)) {
      const diff = (now.getTime() - new Date(created).getTime()) / 86400000
      if (diff <= 5) ids.add(adId)
    }
    return ids
  }, [createdDates])

  // Counts by type
  const counts = useMemo(
    () => countByClassification(enrichedAds),
    [enrichedAds]
  )

  // Filter by classification + tags + dimension filters
  const displayAds = useMemo(() => {
    let ads = enrichedAds
    if (activeFilters.size > 0) {
      ads = ads.filter((ad) => activeFilters.has(ad.classification.type))
    }
    if (selectedTagFilters.length > 0) {
      const wantUntagged = selectedTagFilters.includes(UNTAGGED_FILTER_ID)
      const tagFilterIds = selectedTagFilters.filter((t) => t !== UNTAGGED_FILTER_ID)
      ads = ads.filter((ad) => {
        const adTags = adTagMap[ad.adId] || []
        if (wantUntagged && adTags.length === 0) return true
        if (tagFilterIds.length > 0 && tagFilterIds.some((t) => adTags.includes(t))) return true
        return false
      })
    }
    // Dimension filters
    for (const [dim, selectedValues] of Object.entries(dimensionFilters)) {
      if (selectedValues.length === 0) continue
      ads = ads.filter((ad) => {
        const v = getDimensionValue(ad.parsed, dim)
        return v ? selectedValues.includes(v) : false
      })
    }
    return ads
  }, [enrichedAds, activeFilters, selectedTagFilters, adTagMap, dimensionFilters])

  // Video ads identification
  const videoAdIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ad of enrichedAds) {
      if (isVideoAd(filteredRows, ad.adId)) ids.add(ad.adId)
    }
    return ids
  }, [enrichedAds, filteredRows])

  // Sort
  const sortedAds = useMemo(() => {
    const sorted = [...displayAds]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "adName":
          cmp = a.adName.localeCompare(b.adName)
          break
        case "adsetName":
          cmp = a.adsetName.localeCompare(b.adsetName)
          break
        case "classification":
          cmp =
            CLASSIFICATION_ORDER.indexOf(a.classification.type) -
            CLASSIFICATION_ORDER.indexOf(b.classification.type)
          break
        default: {
          // Dynamic metric sort using CREATIVE_METRICS
          const metricDef = CREATIVE_METRICS[sortKey as CreativeMetricKey]
          if (metricDef) {
            const va = metricDef.getValue(a) ?? -Infinity
            const vb = metricDef.getValue(b) ?? -Infinity
            cmp = va - vb
          }
          break
        }
      }
      return sortDir === "desc" ? -cmp : cmp
    })
    return sorted
  }, [displayAds, sortKey, sortDir])

  // Summary metrics
  const totalCreatives = enrichedAds.length
  const activeAds = enrichedAds.filter((a) => a.impressions > 0).length

  // Spend concentration (HHI)
  const concentration = useMemo(
    () =>
      calculateConcentration(
        enrichedAds.map((a) => ({
          adId: a.adId,
          adName: a.adName,
          spend: a.spend,
        }))
      ),
    [enrichedAds]
  )

  // Build per-ad TagInfo lookup for card grid
  const adTagsLookup = useMemo(() => {
    const lookup: Record<string, TagInfo[]> = {}
    for (const [adId, tagIds] of Object.entries(adTagMap)) {
      lookup[adId] = tagIds
        .map((tid) => tags.find((t) => t.id === tid))
        .filter((t): t is Tag => t !== undefined)
    }
    return lookup
  }, [adTagMap, tags])

  // Grouped ads: split sortedAds into sections when groupBy !== "none"
  const groupedSections = useMemo(() => {
    if (groupBy === "none") return null

    // Group by dimension
    if (groupBy.startsWith("dimension:")) {
      const dim = groupBy.slice("dimension:".length)
      const dimMap = new Map<string, ClassifiedAd[]>()
      for (const ad of sortedAds) {
        const val = getDimensionValue(ad.parsed, dim) || "Unknown"
        if (!dimMap.has(val)) dimMap.set(val, [])
        dimMap.get(val)!.push(ad)
      }
      const sections: { label: string; color: string; ads: ClassifiedAd[] }[] = []
      for (const [value, ads] of Array.from(dimMap)) {
        sections.push({ label: value, color: "#525252", ads })
      }
      return sections
    }

    // Group by tags
    const tagMap = new Map<string, ClassifiedAd[]>()
    const untagged: ClassifiedAd[] = []
    for (const ad of sortedAds) {
      const adTags = adTagMap[ad.adId] || []
      if (adTags.length === 0) {
        untagged.push(ad)
      } else {
        for (const tid of adTags) {
          if (!tagMap.has(tid)) tagMap.set(tid, [])
          tagMap.get(tid)!.push(ad)
        }
      }
    }
    const sections: { label: string; color: string; ads: ClassifiedAd[] }[] = []
    for (const tag of tags) {
      const ads = tagMap.get(tag.id)
      if (ads && ads.length > 0) {
        sections.push({ label: tag.name, color: tag.color, ads })
      }
    }
    if (untagged.length > 0) {
      sections.push({ label: "Untagged", color: "#525252", ads: untagged })
    }
    return sections
  }, [groupBy, sortedAds, adTagMap, tags])

  // Navigation
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

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function toggleFilter(type: ClassificationType) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-neutral-400">
            Creative Analysis
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AdSetSelector
            items={adsets}
            selected={selectedAdSets}
            onChange={setSelectedAdSets}
            label="ad sets"
          />
          <TagSelector
            tags={tags}
            selected={selectedTagFilters}
            onChange={setSelectedTagFilters}
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

      {/* Meta creative analysis content */}
      {<>

      {/* Tag manager button — always visible so users can create first tags */}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTagManager(true)}
            className="flex items-center gap-1.5 text-xs text-neutral-500 transition hover:text-brand-lime"
            title="Manage Tags"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Manage Tags
          </button>
        </div>
      )}

      {/* Dimension filters */}
      {availableDimensions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Dimensions:</span>
          {availableDimensions.map((dim) => {
            const values = dimensionValues[dim] || []
            const selected = dimensionFilters[dim] || []
            const label = getDimensionLabel(dim, namingConfig)
            return (
              <DimensionFilterDropdown
                key={dim}
                label={label}
                values={values}
                selected={selected}
                onChange={(vals) =>
                  setDimensionFilters((prev) => ({ ...prev, [dim]: vals }))
                }
              />
            )
          })}
          {Object.values(dimensionFilters).some((v) => v.length > 0) && (
            <button
              onClick={() => setDimensionFilters({})}
              className="text-xs text-neutral-500 transition hover:text-white"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Classification overview */}
      <Card>
        {/* Compact overview row */}
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <span className="text-2xl font-semibold tabular-nums text-neutral-100">
              {totalCreatives}
            </span>
            <span className="ml-1.5 text-xs text-neutral-500">Creatives</span>
          </div>
          <div>
            <span className="text-2xl font-semibold tabular-nums text-neutral-100">
              {activeAds}
            </span>
            <span className="ml-1.5 text-xs text-neutral-500">Active</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: CONCENTRATION_COLORS[concentration.level] }}
            />
            <span className="text-xs font-medium text-neutral-300">
              {concentration.level}
            </span>
            <span className="text-[10px] text-neutral-500">
              Top ad: {concentration.topAdShare.toFixed(0)}% of spend
            </span>
          </div>
        </div>
        {totalCreatives > 0 ? (
          <div className="space-y-3">
            {/* Stacked bar */}
            <div className="flex h-8 overflow-hidden rounded-lg">
              {CLASSIFICATION_ORDER.map((type) => {
                const count = counts[type]
                if (count === 0) return null
                const pct = (count / totalCreatives) * 100
                const def = CLASSIFICATIONS[type]
                return (
                  <button
                    key={type}
                    onClick={() => toggleFilter(type)}
                    className="group relative flex items-center justify-center transition-opacity hover:opacity-80"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: def.color,
                      minWidth: count > 0 ? "24px" : 0,
                      opacity: activeFilters.size === 0 || activeFilters.has(type) ? 1 : 0.3,
                    }}
                  >
                    {pct > 8 && (
                      <span className="text-xs font-medium text-black">
                        {count}
                      </span>
                    )}
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                      <p className="text-xs font-semibold text-neutral-100">{def.label}</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">{def.description}</p>
                      <p className="text-[10px] text-neutral-500 mt-0.5">{count} creative{count !== 1 ? "s" : ""} ({pct.toFixed(0)}%)</p>
                      <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-700" />
                    </div>
                  </button>
                )
              })}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3">
              {CLASSIFICATION_ORDER.map((type) => {
                const count = counts[type]
                if (count === 0) return null
                const def = CLASSIFICATIONS[type]
                const pct = (count / totalCreatives) * 100
                return (
                  <button
                    key={type}
                    onClick={() => toggleFilter(type)}
                    className={`group relative flex items-center gap-1.5 text-xs transition-opacity ${
                      activeFilters.size === 0 || activeFilters.has(type)
                        ? "opacity-100"
                        : "opacity-40"
                    }`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: def.color }}
                    />
                    <span className="text-neutral-300">
                      {def.label} ({count})
                    </span>
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                      <p className="text-xs font-semibold text-neutral-100">{def.label}</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">{def.description}</p>
                      <p className="text-[10px] text-neutral-500 mt-0.5">{count} creative{count !== 1 ? "s" : ""} ({pct.toFixed(0)}%)</p>
                      <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-700" />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">No creative data available.</p>
        )}
      </Card>

      {/* Dimension overview pie charts — only render when parsed naming data exists */}
      {enrichedAds.length > 0 && enrichedAds.some((a) => a.parsed?.format) && (
        <ChartErrorBoundary>
          <DimensionPieCharts ads={enrichedAds} />
        </ChartErrorBoundary>
      )}

      {/* Spend Share Chart */}
      {adsets.length > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-400">
              Daily Spend Share
            </h2>
            <select
              value={spendShareAdSet || ""}
              onChange={(e) => setSpendShareAdSet(e.target.value || null)}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 focus:border-brand-lime focus:outline-none"
            >
              {adsets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <SpendShareChart
            rows={filteredRows}
            classifiedAds={classifiedAds}
            adsetId={spendShareAdSet}
          />
        </Card>
      )}

      {/* View toggle + Creative content */}
      <div className="space-y-4">
        {/* View mode toggle + Group By */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setViewMode("grid")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "grid"
                ? "bg-neutral-700 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "table"
                ? "bg-neutral-700 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Table
          </button>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-neutral-500">Group by</span>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-brand-lime focus:outline-none"
              >
                <option value="none">None</option>
                {tags.length > 0 && <option value="tags">Tags</option>}
                {availableDimensions.map((dim) => (
                  <option key={dim} value={`dimension:${dim}`}>
                    {getDimensionLabel(dim, namingConfig)}
                  </option>
                ))}
              </select>
            </div>
            {!readOnly && (
              <button
                onClick={() => setShowNamingConfig(true)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition flex items-center gap-1.5 text-neutral-500 hover:text-neutral-300"
                title="Naming Convention Config"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowMetricPicker((v) => !v)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition flex items-center gap-1.5 ${
                showMetricPicker
                  ? "bg-brand-lime/20 text-brand-lime"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              title="Configure metrics"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Metrics
            </button>
          </div>
        </div>

        {/* Metric picker panel */}
        {showMetricPicker && (
          <MetricPickerPanel
            cardMetrics={cardMetrics}
            tableMetrics={tableMetrics}
            onCardChange={setCardMetrics}
            onTableChange={setTableMetrics}
          />
        )}

        {/* Grouped sections or flat view */}
        {groupBy !== "none" && groupedSections ? (
          <div className="space-y-6">
            {groupedSections.map((section) => (
              <div key={section.label}>
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: section.color }}
                  />
                  <span className="text-sm font-medium text-neutral-200">
                    {section.label}
                  </span>
                  <span className="text-xs text-neutral-500">
                    ({section.ads.length})
                  </span>
                </div>
                {viewMode === "grid" ? (
                  <CreativeCardGrid
                    ads={section.ads}
                    thumbnails={proxyThumbnails}
                    videoAdIds={videoAdIds}
                    rows={filteredRows}
                    currency={currency}
                    adTags={adTagsLookup}
                    allTags={tags}
                    onAdClick={setDetailAd}
                    selectedMetrics={cardMetrics}
                    onAssignTag={assignTag}
                    onRemoveTag={removeTag}
                    newAdIds={newAdIds}
                  />
                ) : (
                  <CreativeTableInline
                    ads={section.ads}
                    tags={tags}
                    adTagMap={adTagMap}
                    currency={currency}
                    thumbnails={proxyThumbnails}
                    videoAdIds={videoAdIds}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    tagDropdownAdId={tagDropdownAdId}
                    setTagDropdownAdId={setTagDropdownAdId}
                    setTagDropdownAnchor={setTagDropdownAnchor}
                    tagDropdownAnchor={tagDropdownAnchor}
                    assignTag={assignTag}
                    removeTag={removeTag}
                    onAdClick={setDetailAd}
                    selectedMetrics={tableMetrics}
                    newAdIds={newAdIds}
                  />
                )}
              </div>
            ))}
          </div>
        ) : viewMode === "grid" ? (
          <CreativeCardGrid
            ads={sortedAds}
            thumbnails={proxyThumbnails}
            videoAdIds={videoAdIds}
            rows={filteredRows}
            currency={currency}
            adTags={adTagsLookup}
            allTags={tags}
            onAdClick={setDetailAd}
            selectedMetrics={cardMetrics}
            onAssignTag={assignTag}
            onRemoveTag={removeTag}
            newAdIds={newAdIds}
          />
        ) : (
          <CreativeTableInline
            ads={sortedAds}
            tags={tags}
            adTagMap={adTagMap}
            currency={currency}
            thumbnails={proxyThumbnails}
            videoAdIds={videoAdIds}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            tagDropdownAdId={tagDropdownAdId}
            setTagDropdownAdId={setTagDropdownAdId}
            setTagDropdownAnchor={setTagDropdownAnchor}
            tagDropdownAnchor={tagDropdownAnchor}
            assignTag={assignTag}
            removeTag={removeTag}
            onAdClick={setDetailAd}
            selectedMetrics={tableMetrics}
            newAdIds={newAdIds}
          />
        )}
      </div>

      {/* Tag manager modal */}
      {!readOnly && showTagManager && (
        <TagManagerModal
          tags={tags}
          onClose={() => setShowTagManager(false)}
          onTagsChanged={() => {
            fetchTags()
            fetchAdTags()
          }}
        />
      )}

      {/* Naming config modal */}
      {!readOnly && showNamingConfig && (
        <NamingConfigModal
          clientId={clientId}
          onClose={() => setShowNamingConfig(false)}
          onSaved={() => {
            // Reload the page to pick up new config
            router.refresh()
          }}
        />
      )}

      {/* Creative detail modal */}
      {detailAd && (
        <CreativeDetailModal
          ad={detailAd}
          thumbnailUrl={proxyThumbnails[detailAd.adId]}
          isVideo={videoAdIds.has(detailAd.adId)}
          rows={filteredRows}
          currency={currency}
          tags={adTagsLookup[detailAd.adId]}
          metaAccountId={metaAccountId}
          demographics={demographics}
          placements={placements}
          funnelSteps={funnelSteps}
          keyAction={keyAction}
          onClose={() => setDetailAd(null)}
        />
      )}

      </>}
    </div>
  )
}

// Extracted table component used by both flat and grouped views
function CreativeTableInline({
  ads,
  tags,
  adTagMap,
  currency,
  thumbnails = {},
  videoAdIds = new Set(),
  sortKey,
  sortDir,
  onSort,
  tagDropdownAdId,
  setTagDropdownAdId,
  setTagDropdownAnchor,
  tagDropdownAnchor,
  assignTag,
  removeTag,
  onAdClick,
  selectedMetrics = DEFAULT_TABLE_METRICS,
  newAdIds,
}: {
  ads: ClassifiedAd[]
  tags: Tag[]
  adTagMap: Record<string, string[]>
  currency: string
  thumbnails?: Record<string, string>
  videoAdIds?: Set<string>
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (key: SortKey) => void
  tagDropdownAdId: string | null
  setTagDropdownAdId: (id: string | null) => void
  setTagDropdownAnchor: (rect: DOMRect | null) => void
  tagDropdownAnchor: DOMRect | null
  assignTag: (adId: string, tagId: string) => void
  removeTag: (adId: string, tagId: string) => void
  onAdClick?: (ad: ClassifiedAd) => void
  selectedMetrics?: CreativeMetricKey[]
  newAdIds?: Set<string>
}) {
  // Fixed columns: 4 (Thumbnail, Name, Classification, Tags) + dynamic metrics
  const fixedColCount = 4 + selectedMetrics.length

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500">
              <th className="py-2 pr-2 font-medium w-10"></th>
              <ThButton col="adName" label="Ad Name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <ThButton col="classification" label="Classification" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <th className="py-2 pr-3 font-medium">Tags</th>
              {selectedMetrics.map((key) => {
                const m = CREATIVE_METRICS[key]
                return (
                  <ThButton
                    key={key}
                    col={key}
                    label={m.shortLabel}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    align={m.align as "left" | "right"}
                  />
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => {
              const def = CLASSIFICATIONS[ad.classification.type]
              const adTags = adTagMap[ad.adId] || []
              const assignedTags = tags.filter((t) => adTags.includes(t.id))
              const unassignedTags = tags.filter((t) => !adTags.includes(t.id))
              return (
                <tr
                  key={ad.adId}
                  className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
                >
                  {/* Thumbnail */}
                  <td className="py-1.5 pr-2 w-10">
                    <button
                      onClick={() => onAdClick?.(ad)}
                      className="block h-8 w-8 rounded overflow-hidden bg-neutral-800 flex-shrink-0"
                    >
                      {thumbnails[ad.adId] ? (
                        <img
                          src={thumbnails[ad.adId]}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-600">
                          {videoAdIds.has(ad.adId) ? "🎥" : "🖼"}
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="max-w-[200px] truncate py-2.5 pr-3" title={ad.adName}>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onAdClick?.(ad)}
                        className="text-neutral-200 hover:text-brand-lime transition truncate text-left"
                      >
                        {ad.adName}
                      </button>
                      {newAdIds?.has(ad.adId) && (
                        <span
                          className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-md border px-1 py-px text-[9px] font-semibold bg-purple-500/15 text-purple-400 border-purple-500/30"
                          title="Testing — first 5 days of activity"
                        >
                          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.572 4.483A2.25 2.25 0 0115.3 21H8.7a2.25 2.25 0 01-2.128-1.517L5 14.5m14 0H5" />
                          </svg>
                          Test
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${def.bgColor}`}
                    >
                      {getUnifiedStatusLabel(ad)}
                      {ad.fatigueStatus && ad.fatigueStatus !== "healthy" && (
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${FATIGUE_CONFIG.dot[ad.fatigueStatus]}`}
                          title={ad.fatigueReason}
                        />
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      {assignedTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-black"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                          <button
                            onClick={() => removeTag(ad.adId, tag.id)}
                            className="ml-0.5 opacity-60 hover:opacity-100"
                            title="Remove tag"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {tags.length > 0 && (
                        <div className="relative">
                          <button
                            data-tag-add-btn
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (tagDropdownAdId === ad.adId) {
                                setTagDropdownAdId(null)
                                setTagDropdownAnchor(null)
                              } else {
                                setTagDropdownAnchor(e.currentTarget.getBoundingClientRect())
                                setTagDropdownAdId(ad.adId)
                              }
                            }}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-700 text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-300"
                            title="Add tag"
                          >
                            +
                          </button>
                          {tagDropdownAdId === ad.adId && tagDropdownAnchor && (
                            <TagDropdown
                              tags={unassignedTags}
                              onSelect={(tagId) => assignTag(ad.adId, tagId)}
                              onClose={() => {
                                setTagDropdownAdId(null)
                                setTagDropdownAnchor(null)
                              }}
                              anchorRect={tagDropdownAnchor}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  {selectedMetrics.map((key) => {
                    const m = CREATIVE_METRICS[key]
                    return (
                      <td
                        key={key}
                        className={`py-2.5 pr-3 tabular-nums text-neutral-300 ${
                          m.align === "right" ? "text-right" : ""
                        }`}
                      >
                        {m.format(ad, currency)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {ads.length === 0 && (
              <tr>
                <td colSpan={fixedColCount} className="py-8 text-center text-neutral-500">
                  No creatives match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// Metric picker panel for card + table metric configuration
function MetricPickerPanel({
  cardMetrics,
  tableMetrics,
  onCardChange,
  onTableChange,
}: {
  cardMetrics: CreativeMetricKey[]
  tableMetrics: CreativeMetricKey[]
  onCardChange: (m: CreativeMetricKey[]) => void
  onTableChange: (m: CreativeMetricKey[]) => void
}) {
  function toggleMetric(
    current: CreativeMetricKey[],
    key: CreativeMetricKey,
    onChange: (m: CreativeMetricKey[]) => void
  ) {
    if (current.includes(key)) {
      // Don't allow removing all metrics
      if (current.length <= 1) return
      onChange(current.filter((k) => k !== key))
    } else {
      onChange([...current, key])
    }
  }

  return (
    <Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Card metrics */}
        <div>
          <p className="text-xs font-medium text-neutral-400 mb-2">Card Metrics</p>
          <div className="flex flex-wrap gap-1.5">
            {CREATIVE_METRIC_ORDER.map((key) => {
              const m = CREATIVE_METRICS[key]
              const active = cardMetrics.includes(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleMetric(cardMetrics, key, onCardChange)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition border ${
                    active
                      ? "bg-brand-lime/15 border-brand-lime/40 text-brand-lime"
                      : "border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600"
                  }`}
                >
                  {m.shortLabel}
                </button>
              )
            })}
          </div>
        </div>
        {/* Table metrics */}
        <div>
          <p className="text-xs font-medium text-neutral-400 mb-2">Table Columns</p>
          <div className="flex flex-wrap gap-1.5">
            {CREATIVE_METRIC_ORDER.map((key) => {
              const m = CREATIVE_METRICS[key]
              const active = tableMetrics.includes(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleMetric(tableMetrics, key, onTableChange)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition border ${
                    active
                      ? "bg-brand-lime/15 border-brand-lime/40 text-brand-lime"
                      : "border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600"
                  }`}
                >
                  {m.shortLabel}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

// Inline tag assignment dropdown — uses portal to escape overflow clipping
function TagDropdown({
  tags,
  onSelect,
  onClose,
  anchorRect,
}: {
  tags: Tag[]
  onSelect: (tagId: string) => void
  onClose: () => void
  anchorRect: DOMRect
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: globalThis.MouseEvent) {
      // Ignore clicks on tag-add buttons (they handle their own toggle)
      const target = e.target as HTMLElement
      if (target.closest?.("[data-tag-add-btn]")) return
      if (ref.current && !ref.current.contains(target)) {
        onClose()
      }
    }
    // Use setTimeout to avoid capturing the same click that opened the dropdown
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClick)
    }
  }, [onClose])

  // Position below anchor, clamp to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(anchorRect.bottom + 4, window.innerHeight - 200),
    left: Math.min(anchorRect.left, window.innerWidth - 170),
    zIndex: 9999,
  }

  const content =
    tags.length === 0 ? (
      <div ref={ref} className="w-44 rounded-lg border border-neutral-700 bg-neutral-800 p-2 shadow-xl" style={style}>
        <p className="text-xs text-neutral-500">All tags assigned</p>
        <p className="text-[10px] text-neutral-600 mt-0.5">Use "Manage Tags" to create more</p>
      </div>
    ) : (
      <div ref={ref} className="w-40 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl" style={style}>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => onSelect(tag.id)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 transition hover:bg-neutral-700"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </button>
        ))}
      </div>
    )

  return createPortal(content, document.body)
}

// Creative detail modal
function CreativeDetailModal({
  ad,
  thumbnailUrl,
  isVideo,
  rows,
  currency,
  tags,
  metaAccountId,
  demographics = [],
  placements = [],
  funnelSteps = ["unique_link_clicks", "purchases"],
  keyAction,
  onClose,
}: {
  ad: ClassifiedAd
  thumbnailUrl?: string
  isVideo: boolean
  rows: Partial<MetaDailyRow>[]
  currency: string
  tags?: TagInfo[]
  metaAccountId?: string
  demographics?: MetaDemographicsRow[]
  placements?: MetaPlacementsRow[]
  funnelSteps?: string[]
  keyAction?: string
  onClose: () => void
}) {
  const cls = CLASSIFICATIONS[ad.classification.type]
  const [detailImgError, setDetailImgError] = useState(false)
  const roas = ad.spend > 0 ? ad.revenue / ad.spend : 0

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg bg-neutral-800/80 p-1.5 text-neutral-400 transition hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Thumbnail */}
        <div className="bg-neutral-800 relative flex items-center justify-center overflow-hidden" style={{ minHeight: 200, maxHeight: 400 }}>
          {thumbnailUrl && !detailImgError ? (
            <img
              src={thumbnailUrl}
              alt={ad.adName}
              className="w-full object-contain"
              style={{ maxHeight: 400, imageRendering: "auto" }}
              loading="eager"
              referrerPolicy="no-referrer"
              onError={() => setDetailImgError(true)}
            />
          ) : (
            <div className="text-neutral-600 text-sm py-20">
              {isVideo ? "🎬" : "🖼"} No preview
            </div>
          )}
          {/* Video play icon overlay */}
          {isVideo && thumbnailUrl && !detailImgError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="h-12 w-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                <svg className="h-6 w-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}
          <span
            className={`absolute top-3 left-3 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border backdrop-blur-sm ${cls.bgColor}`}
          >
            {getUnifiedStatusLabel(ad)}
            {ad.fatigueStatus && ad.fatigueStatus !== "healthy" && (
              <span
                className={`inline-block h-2 w-2 rounded-full ${FATIGUE_CONFIG.dot[ad.fatigueStatus]}`}
                title={ad.fatigueReason}
              />
            )}
          </span>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Ad name + adset + View on Meta link */}
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-medium text-neutral-100 leading-snug">
                  {ad.adName}
                </h3>
                <p className="text-xs text-neutral-500 mt-1">{ad.adsetName}</p>
              </div>
              <a
                href={metaAccountId
                  ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAccountId}&search_value=${encodeURIComponent(ad.adName)}`
                  : `https://www.facebook.com/ads/library/?id=${ad.adId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:bg-neutral-700 hover:text-white"
                onClick={(e) => e.stopPropagation()}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View on Meta
              </a>
            </div>
            {tags && tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-black"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Core metrics */}
          <div className="grid grid-cols-3 gap-3">
            <DetailMetric label="Spend" value={fmtCurrency(ad.spend, currency)} />
            <DetailMetric label="Impressions" value={fmtNumber(ad.impressions)} />
            <DetailMetric label="Revenue" value={fmtCurrency(ad.revenue, currency)} />
            <DetailMetric label="ROAS" value={roas > 0 ? `${roas.toFixed(2)}x` : "—"} />
            <DetailMetric label="Spend Share" value={fmtPercent(ad.spendShare, 1)} />
          </div>

          {/* Dynamic funnel metrics */}
          {(() => {
            // Map ClassifiedAd fields to AggregatedMetrics-like object for funnel calcs
            const adMetrics: Record<string, number> = {
              spend: ad.spend,
              impressions: ad.impressions,
              clicks: ad.clicks,
              purchases: ad.conversions,
              landingPageViews: ad.landingPageViews ?? 0,
              addsToCart: ad.addsToCart ?? 0,
              checkoutsInitiated: ad.checkoutsInitiated ?? 0,
              registrationsCompleted: ad.registrationsCompleted ?? 0,
              appInstalls: ad.appInstalls ?? 0,
              mobileAppRegistrations: ad.mobileAppRegistrations ?? 0,
            }

            return (
              <div className="space-y-2">
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Funnel Metrics</p>
                <div className="grid grid-cols-3 gap-3">
                  {funnelSteps.map((stepKey, i) => {
                    const def = FUNNEL_STEP_DEFS[stepKey]
                    if (!def) return null
                    const count = adMetrics[def.field as string] ?? 0
                    // Rate denominator: use previous step in the funnel if available
                    const prevStepKey = i > 0 ? funnelSteps[i - 1] : undefined
                    const prevDef = prevStepKey ? FUNNEL_STEP_DEFS[prevStepKey] : undefined
                    const denomField = prevDef ? prevDef.field : def.rateDenominator
                    const denominator = adMetrics[denomField as string] ?? 0
                    const rate = denominator > 0 ? (count / denominator) * def.rateMultiplier : null
                    const costPer = count > 0 ? ad.spend / count : null
                    const isKey = stepKey === keyAction

                    return (
                      <div key={stepKey} className="col-span-3 grid grid-cols-3 gap-3">
                        <DetailMetric
                          label={def.label}
                          value={fmtNumber(count)}
                          highlight={isKey}
                        />
                        <DetailMetric
                          label={def.rateLabel}
                          value={rate !== null ? fmtPercent(rate, def.rateDecimals ?? 1) : "—"}
                          highlight={isKey}
                        />
                        <DetailMetric
                          label={def.costLabel}
                          value={costPer !== null ? fmtCurrency(costPer, currency) : "—"}
                          highlight={isKey}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Video retention */}
          {isVideo && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs text-neutral-500 mb-2">Video Retention</p>
              <MiniRetentionCurve rows={rows} adId={ad.adId} />
            </div>
          )}

          {/* Fatigue detail */}
          {ad.fatigueStatus && ad.fatigueStatus !== "healthy" && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs text-neutral-500 mb-1">Fatigue Analysis</p>
              <p className="text-xs text-neutral-300">{ad.fatigueReason}</p>
            </div>
          )}

          {/* Placement breakdown */}
          <AdPlacementBreakdown placements={placements} adId={ad.adId} currency={currency} />

          {/* Demographic breakdown */}
          <AdDemographicBreakdown demographics={demographics} adId={ad.adId} currency={currency} />
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Placement breakdown for a single ad in the detail modal */
function AdPlacementBreakdown({
  placements,
  adId,
  currency,
}: {
  placements: MetaPlacementsRow[]
  adId: string
  currency: string
}) {
  // Try ad-level first, then fall back to adset-level data
  let adPlacements = placements.filter((p) => p.ad_id === adId)
  let levelLabel = ""
  if (adPlacements.length === 0) {
    // No ad-level data — show a note
    return (
      <div className="border-t border-neutral-800 pt-3">
        <p className="text-xs text-neutral-500 mb-2">Placement Breakdown</p>
        <p className="text-[11px] text-neutral-600 italic">No placement data available for this ad</p>
      </div>
    )
  }

  // Aggregate by platform + position
  const agg = new Map<string, { spend: number; impressions: number; clicks: number }>()
  for (const p of adPlacements) {
    const key = `${p.publisher_platform || "unknown"} · ${p.platform_position || "unknown"}`
    const existing = agg.get(key) || { spend: 0, impressions: 0, clicks: 0 }
    existing.spend += p.spend || 0
    existing.impressions += p.impressions || 0
    existing.clicks += p.unique_link_clicks || 0
    agg.set(key, existing)
  }

  const sorted = Array.from(agg.entries()).sort((a, b) => b[1].spend - a[1].spend)
  const maxSpend = sorted[0]?.[1].spend || 1

  return (
    <div className="border-t border-neutral-800 pt-3">
      <p className="text-xs text-neutral-500 mb-2">Placement Breakdown</p>
      <div className="space-y-1.5">
        {sorted.slice(0, 8).map(([key, data]) => (
          <div key={key}>
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span className="text-neutral-300 truncate mr-2">{key}</span>
              <span className="text-neutral-400 tabular-nums shrink-0">
                {fmtCurrency(data.spend, currency)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500/60"
                style={{ width: `${(data.spend / maxSpend) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Demographic breakdown for a single ad in the detail modal */
function AdDemographicBreakdown({
  demographics,
  adId,
  currency,
}: {
  demographics: MetaDemographicsRow[]
  adId: string
  currency: string
}) {
  const adDemo = demographics.filter((d) => d.ad_id === adId)
  if (adDemo.length === 0) {
    return (
      <div className="border-t border-neutral-800 pt-3">
        <p className="text-xs text-neutral-500 mb-2">Demographic Breakdown</p>
        <p className="text-[11px] text-neutral-600 italic">No demographic data available for this ad</p>
      </div>
    )
  }

  // Aggregate by age group
  const ageGroups = new Map<string, { male: number; female: number; unknown: number }>()
  for (const d of adDemo) {
    const age = d.age || "Unknown"
    const existing = ageGroups.get(age) || { male: 0, female: 0, unknown: 0 }
    const spend = d.spend || 0
    if (d.gender === "male") existing.male += spend
    else if (d.gender === "female") existing.female += spend
    else existing.unknown += spend
    ageGroups.set(age, existing)
  }

  // Sort by standard age order
  const ageOrder = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
  const sorted = Array.from(ageGroups.entries()).sort((a, b) => {
    const ia = ageOrder.indexOf(a[0])
    const ib = ageOrder.indexOf(b[0])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const maxTotal = Math.max(...sorted.map(([, d]) => d.male + d.female + d.unknown), 1)

  return (
    <div className="border-t border-neutral-800 pt-3">
      <p className="text-xs text-neutral-500 mb-2">Demographic Breakdown</p>
      <div className="space-y-1.5">
        {sorted.map(([age, data]) => {
          const total = data.male + data.female + data.unknown
          return (
            <div key={age}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-neutral-300 w-10">{age}</span>
                <span className="text-neutral-400 tabular-nums">{fmtCurrency(total, currency)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden flex">
                {data.male > 0 && (
                  <div
                    className="h-full bg-blue-500/70"
                    style={{ width: `${(data.male / maxTotal) * 100}%` }}
                    title={`Male: ${fmtCurrency(data.male, currency)}`}
                  />
                )}
                {data.female > 0 && (
                  <div
                    className="h-full bg-pink-500/70"
                    style={{ width: `${(data.female / maxTotal) * 100}%` }}
                    title={`Female: ${fmtCurrency(data.female, currency)}`}
                  />
                )}
                {data.unknown > 0 && (
                  <div
                    className="h-full bg-neutral-600/70"
                    style={{ width: `${(data.unknown / maxTotal) * 100}%` }}
                    title={`Unknown: ${fmtCurrency(data.unknown, currency)}`}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-2">
        <div className="flex items-center gap-1 text-[10px] text-neutral-400">
          <span className="inline-block h-2 w-2 rounded-sm bg-blue-500/70" /> Male
        </div>
        <div className="flex items-center gap-1 text-[10px] text-neutral-400">
          <span className="inline-block h-2 w-2 rounded-sm bg-pink-500/70" /> Female
        </div>
      </div>
    </div>
  )
}

function DetailMetric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? "bg-[#CDFF00]/10 ring-1 ring-[#CDFF00]/30" : "bg-neutral-800/50"}`}>
      <p className={`text-[10px] ${highlight ? "text-[#CDFF00]/70" : "text-neutral-500"}`}>{label}</p>
      <p className={`text-sm font-medium tabular-nums ${highlight ? "text-[#CDFF00]" : "text-neutral-100"}`}>{value}</p>
    </div>
  )
}

// Sortable table header button
function ThButton({
  col,
  label,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  col: SortKey
  label: string
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (key: SortKey) => void
  align?: "left" | "right"
}) {
  return (
    <th
      className={`cursor-pointer whitespace-nowrap py-2 pr-3 font-medium transition hover:text-neutral-300 ${
        align === "right" ? "text-right" : ""
      }`}
      onClick={() => onSort(col)}
    >
      {label}
      {sortKey === col && (
        <span className="ml-1 text-brand-lime">
          {sortDir === "desc" ? "↓" : "↑"}
        </span>
      )}
    </th>
  )
}

// Compact dimension filter dropdown (multi-select)
function DimensionFilterDropdown({
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

  const displayLabel = selected.length === 0
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
        <svg className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
