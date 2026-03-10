"use client"

import { useMemo, useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { Card } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import AdSetSelector from "@/components/ui/adset-selector"
import CreativeCardGrid, { type TagInfo } from "@/components/dashboard/creative-card-grid"
import {
  CREATIVE_METRICS,
  CREATIVE_METRIC_ORDER,
  DEFAULT_CARD_METRICS,
  DEFAULT_TABLE_METRICS,
  type CreativeMetricKey,
} from "@/lib/utils/creative-metrics"

// Lazy-load chart component
const SpendShareChart = dynamic(
  () => import("@/components/charts/spend-share-chart"),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded bg-neutral-800/50" /> }
)
import TagManagerModal, { type Tag } from "@/components/dashboard/tag-manager-modal"
import MiniRetentionCurve from "@/components/charts/mini-retention-curve"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"
import {
  classifyAllAds,
  countByClassification,
  CLASSIFICATIONS,
  type ClassifiedAd,
  type ClassificationType,
} from "@/lib/utils/creative-classification"
import { isVideoAd } from "@/lib/utils/video-retention"
import { detectFatigueAll, FATIGUE_CONFIG, type FatigueResult } from "@/lib/utils/fatigue-detection"
import { calculateConcentration, CONCENTRATION_COLORS } from "@/lib/utils/spend-concentration"
import type { MetaDailyRow } from "@/lib/utils/types"
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
}

type SortKey =
  | "adName"
  | "adsetName"
  | "classification"
  | CreativeMetricKey

type ViewMode = "table" | "grid"
type GroupBy = "none" | "tags"

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

export default function CreativeAnalysisView({
  rows,
  preset,
  from,
  to,
  clientId,
  thumbnails = {},
  previewsEnabled = false,
  currency = "GBP",
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [sortKey, setSortKey] = useState<SortKey>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [activeFilters, setActiveFilters] = useState<Set<ClassificationType>>(
    new Set()
  )
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [spendShareAdSet, setSpendShareAdSet] = useState<string | null>(null)

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
      await fetch("/api/creative-ad-tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_id: adId, tag_id: tagId }),
      })
      setAdTagMap((prev) => ({
        ...prev,
        [adId]: (prev[adId] || []).filter((t) => t !== tagId),
      }))
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
    () => classifyAllAds(filteredRows),
    [filteredRows]
  )

  // Counts by type
  const counts = useMemo(
    () => countByClassification(classifiedAds),
    [classifiedAds]
  )

  // Filter by classification + tags
  const displayAds = useMemo(() => {
    let ads = classifiedAds
    if (activeFilters.size > 0) {
      ads = ads.filter((ad) => activeFilters.has(ad.classification.type))
    }
    if (selectedTagFilters.length > 0) {
      ads = ads.filter((ad) => {
        const adTags = adTagMap[ad.adId] || []
        return selectedTagFilters.some((t) => adTags.includes(t))
      })
    }
    return ads
  }, [classifiedAds, activeFilters, selectedTagFilters, adTagMap])

  // Fatigue detection
  const fatigueMap = useMemo(() => {
    const adIds = classifiedAds.map((a) => a.adId)
    return detectFatigueAll(filteredRows, adIds, 7, to)
  }, [classifiedAds, filteredRows, to])

  // Video ads identification
  const videoAdIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ad of classifiedAds) {
      if (isVideoAd(filteredRows, ad.adId)) ids.add(ad.adId)
    }
    return ids
  }, [classifiedAds, filteredRows])

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
  const totalCreatives = classifiedAds.length
  const activeAds = classifiedAds.filter((a) => a.impressions > 0).length

  // Spend concentration (HHI)
  const concentration = useMemo(
    () =>
      calculateConcentration(
        classifiedAds.map((a) => ({
          adId: a.adId,
          adName: a.adName,
          spend: a.spend,
        }))
      ),
    [classifiedAds]
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
    // group by tags
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

  function toggleTagFilter(tagId: string) {
    setSelectedTagFilters((prev) =>
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId]
    )
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-400">
          Creative Analysis
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <AdSetSelector
            adsets={adsets}
            selected={selectedAdSets}
            onChange={setSelectedAdSets}
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

      {/* Tag filters */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Tags:</span>
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => toggleTagFilter(tag.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                selectedTagFilters.includes(tag.id)
                  ? "border-white/30 text-white"
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
            </button>
          ))}
          <button
            onClick={() => setShowTagManager(true)}
            className="text-xs text-neutral-500 transition hover:text-brand-lime"
            title="Manage Tags"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          {selectedTagFilters.length > 0 && (
            <button
              onClick={() => setSelectedTagFilters([])}
              className="text-xs text-neutral-500 transition hover:text-white"
            >
              Clear
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
                    className="relative flex items-center justify-center transition-opacity hover:opacity-80"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: def.color,
                      minWidth: count > 0 ? "24px" : 0,
                      opacity: activeFilters.size === 0 || activeFilters.has(type) ? 1 : 0.3,
                    }}
                    title={`${def.label}: ${count} (${pct.toFixed(0)}%)`}
                  >
                    {pct > 8 && (
                      <span className="text-xs font-medium text-black">
                        {count}
                      </span>
                    )}
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
                return (
                  <button
                    key={type}
                    onClick={() => toggleFilter(type)}
                    className={`flex items-center gap-1.5 text-xs transition-opacity ${
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
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">No creative data available.</p>
        )}
      </Card>

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
              </select>
            </div>
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
                    thumbnails={thumbnails}
                    videoAdIds={videoAdIds}
                    fatigueMap={fatigueMap}
                    rows={filteredRows}
                    currency={currency}
                    adTags={adTagsLookup}
                    onAdClick={setDetailAd}
                    selectedMetrics={cardMetrics}
                  />
                ) : (
                  <CreativeTableInline
                    ads={section.ads}
                    tags={tags}
                    adTagMap={adTagMap}
                    fatigueMap={fatigueMap}
                    currency={currency}
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
                  />
                )}
              </div>
            ))}
          </div>
        ) : viewMode === "grid" ? (
          <CreativeCardGrid
            ads={sortedAds}
            thumbnails={thumbnails}
            videoAdIds={videoAdIds}
            fatigueMap={fatigueMap}
            rows={filteredRows}
            currency={currency}
            adTags={adTagsLookup}
            onAdClick={setDetailAd}
            selectedMetrics={cardMetrics}
          />
        ) : (
          <CreativeTableInline
            ads={sortedAds}
            tags={tags}
            adTagMap={adTagMap}
            fatigueMap={fatigueMap}
            currency={currency}
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
          />
        )}
      </div>

      {/* Tag manager modal */}
      {showTagManager && (
        <TagManagerModal
          tags={tags}
          onClose={() => setShowTagManager(false)}
          onTagsChanged={() => {
            fetchTags()
            fetchAdTags()
          }}
        />
      )}

      {/* Creative detail modal */}
      {detailAd && (
        <CreativeDetailModal
          ad={detailAd}
          thumbnailUrl={thumbnails[detailAd.adId]}
          isVideo={videoAdIds.has(detailAd.adId)}
          fatigue={fatigueMap[detailAd.adId]}
          rows={filteredRows}
          currency={currency}
          tags={adTagsLookup[detailAd.adId]}
          onClose={() => setDetailAd(null)}
        />
      )}
    </div>
  )
}

// Extracted table component used by both flat and grouped views
function CreativeTableInline({
  ads,
  tags,
  adTagMap,
  fatigueMap,
  currency,
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
}: {
  ads: ClassifiedAd[]
  tags: Tag[]
  adTagMap: Record<string, string[]>
  fatigueMap: Record<string, FatigueResult>
  currency: string
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
}) {
  // Fixed columns: 4 (Name, AdSet, Classification, Tags) + dynamic metrics + Fatigue
  const fixedColCount = 4 + selectedMetrics.length + 1

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500">
              <ThButton col="adName" label="Ad Name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <ThButton col="adsetName" label="Ad Set" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
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
              <th className="py-2 pr-3 font-medium text-center">Fatigue</th>
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
                  <td className="max-w-[200px] truncate py-2.5 pr-3" title={ad.adName}>
                    <button
                      onClick={() => onAdClick?.(ad)}
                      className="text-neutral-200 hover:text-brand-lime transition truncate text-left"
                    >
                      {ad.adName}
                    </button>
                  </td>
                  <td className="max-w-[150px] truncate py-2.5 pr-3 text-neutral-400" title={ad.adsetName}>
                    {ad.adsetName}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium ${def.bgColor}`}
                    >
                      {def.label}
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
                      <div className="relative">
                        <button
                          onClick={(e) => {
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
                  <td className="py-2.5 text-center">
                    {(() => {
                      const f = fatigueMap[ad.adId]
                      if (!f || f.status === "healthy") return <span className="text-neutral-600">—</span>
                      const cfg = FATIGUE_CONFIG
                      return (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-medium ${cfg.color[f.status]}`}
                          title={f.reason}
                        >
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot[f.status]}`} />
                          {cfg.label[f.status]}
                        </span>
                      )
                    })()}
                  </td>
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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [onClose])

  // Position below anchor, clamp to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(anchorRect.bottom + 4, window.innerHeight - 200),
    left: Math.min(anchorRect.left, window.innerWidth - 170),
    zIndex: 50,
  }

  const content =
    tags.length === 0 ? (
      <div ref={ref} className="w-36 rounded-lg border border-neutral-700 bg-neutral-800 p-2 shadow-xl" style={style}>
        <p className="text-xs text-neutral-500">No more tags</p>
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
  fatigue,
  rows,
  currency,
  tags,
  onClose,
}: {
  ad: ClassifiedAd
  thumbnailUrl?: string
  isVideo: boolean
  fatigue?: FatigueResult
  rows: Partial<MetaDailyRow>[]
  currency: string
  tags?: TagInfo[]
  onClose: () => void
}) {
  const cls = CLASSIFICATIONS[ad.classification.type]
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
        <div className="aspect-video bg-neutral-800 relative flex items-center justify-center">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={ad.adName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-neutral-600 text-sm">
              {isVideo ? "🎬" : "🖼"} No preview
            </div>
          )}
          <span
            className={`absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-lg border backdrop-blur-sm ${cls.bgColor}`}
          >
            {cls.label}
          </span>
          {fatigue && fatigue.status !== "healthy" && (
            <span
              className={`absolute top-3 right-3 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-neutral-900/80 backdrop-blur-sm ${FATIGUE_CONFIG.color[fatigue.status]}`}
              title={fatigue.reason}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${FATIGUE_CONFIG.dot[fatigue.status]}`} />
              {FATIGUE_CONFIG.label[fatigue.status]}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Ad name + adset */}
          <div>
            <h3 className="text-base font-medium text-neutral-100 leading-snug">
              {ad.adName}
            </h3>
            <p className="text-xs text-neutral-500 mt-1">{ad.adsetName}</p>
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

          {/* Metrics grid */}
          <div className="grid grid-cols-3 gap-3">
            <DetailMetric label="Spend" value={fmtCurrency(ad.spend, currency)} />
            <DetailMetric label="Impressions" value={fmtNumber(ad.impressions)} />
            <DetailMetric label="Clicks" value={fmtNumber(ad.clicks)} />
            <DetailMetric label="Conversions" value={fmtNumber(ad.conversions)} />
            <DetailMetric label="CPA" value={ad.cpa !== null ? fmtCurrency(ad.cpa, currency) : "—"} />
            <DetailMetric label="CVR" value={fmtPercent(ad.cvr * 100, 2)} />
            <DetailMetric label="Revenue" value={fmtCurrency(ad.revenue, currency)} />
            <DetailMetric label="ROAS" value={roas > 0 ? `${roas.toFixed(2)}x` : "—"} />
            <DetailMetric label="Spend Share" value={fmtPercent(ad.spendShare, 1)} />
          </div>

          {/* Video retention */}
          {isVideo && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs text-neutral-500 mb-2">Video Retention</p>
              <MiniRetentionCurve rows={rows} adId={ad.adId} />
            </div>
          )}

          {/* Fatigue detail */}
          {fatigue && fatigue.status !== "healthy" && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs text-neutral-500 mb-1">Fatigue Analysis</p>
              <p className="text-xs text-neutral-300">{fatigue.reason}</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-800/50 px-3 py-2">
      <p className="text-[10px] text-neutral-500">{label}</p>
      <p className="text-sm font-medium tabular-nums text-neutral-100">{value}</p>
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
