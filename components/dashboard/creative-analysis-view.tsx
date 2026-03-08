"use client"

import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, MetricCard } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import AdSetSelector from "@/components/ui/adset-selector"
import SpendShareChart from "@/components/charts/spend-share-chart"
import CreativeGroupingView from "@/components/dashboard/creative-grouping-view"
import CreativeCardGrid from "@/components/dashboard/creative-card-grid"
import TagManagerModal, { type Tag } from "@/components/dashboard/tag-manager-modal"
import VideoRetentionChart from "@/components/charts/video-retention-chart"
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
}

type SortKey =
  | "adName"
  | "adsetName"
  | "classification"
  | "spend"
  | "impressions"
  | "conversions"
  | "cpa"
  | "cvr"
  | "spendShare"

type ViewMode = "table" | "grouped" | "grid"

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
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [sortKey, setSortKey] = useState<SortKey>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [activeFilters, setActiveFilters] = useState<Set<ClassificationType>>(
    new Set()
  )
  const [viewMode, setViewMode] = useState<ViewMode>("table")
  const [spendShareAdSet, setSpendShareAdSet] = useState<string | null>(null)

  // Tag state
  const [tags, setTags] = useState<Tag[]>([])
  const [adTagMap, setAdTagMap] = useState<AdTagMap>({})
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([])
  const [showTagManager, setShowTagManager] = useState(false)
  const [tagDropdownAdId, setTagDropdownAdId] = useState<string | null>(null)

  // Video retention state — track selected video ads for comparison
  const [selectedVideoAdIds, setSelectedVideoAdIds] = useState<Set<string>>(new Set())

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
        case "spend":
          cmp = a.spend - b.spend
          break
        case "impressions":
          cmp = a.impressions - b.impressions
          break
        case "conversions":
          cmp = a.conversions - b.conversions
          break
        case "cpa":
          cmp = (a.cpa ?? Infinity) - (b.cpa ?? Infinity)
          break
        case "cvr":
          cmp = a.cvr - b.cvr
          break
        case "spendShare":
          cmp = a.spendShare - b.spendShare
          break
      }
      return sortDir === "desc" ? -cmp : cmp
    })
    return sorted
  }, [displayAds, sortKey, sortDir])

  // Summary metrics
  const totalCreatives = classifiedAds.length
  const activeAds = classifiedAds.filter((a) => a.impressions > 0).length
  const winnersCount =
    counts.DIRECT_WINNER + counts.INDIRECT_WINNER
  const viableCount = counts.VIABLE_UNDERSCALED
  const losersCount =
    counts.LOSER + counts.LOSER_NON_CONTRIBUTING + counts.LOSER_NO_DELIVERY

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

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Total Creatives" value={String(totalCreatives)} />
        <MetricCard
          label="Active Ads"
          value={String(activeAds)}
          subValue={`${totalCreatives - activeAds} with no delivery`}
        />
        <MetricCard
          label="Winners"
          value={String(winnersCount)}
          subValue={`${counts.DIRECT_WINNER} direct, ${counts.INDIRECT_WINNER} indirect`}
        />
        <MetricCard
          label="Viable (Under-scaled)"
          value={String(viableCount)}
        />
        <MetricCard
          label="Losers"
          value={String(losersCount)}
          subValue={`${counts.LOSER} below median, ${counts.LOSER_NON_CONTRIBUTING} non-contributing`}
        />
      </div>

      {/* Classification distribution bar */}
      <Card>
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          Classification Distribution
        </h2>
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

      {/* Video Retention */}
      {videoAdIds.size > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-400">
              Video Retention Curves
            </h2>
            <span className="text-xs text-neutral-500">
              {selectedVideoAdIds.size}/{videoAdIds.size} video ads selected
            </span>
          </div>

          {/* Video ad selector */}
          <div className="mb-4 flex flex-wrap gap-2">
            {classifiedAds
              .filter((ad) => videoAdIds.has(ad.adId))
              .slice(0, 20)
              .map((ad) => {
                const selected = selectedVideoAdIds.has(ad.adId)
                return (
                  <button
                    key={ad.adId}
                    onClick={() => {
                      setSelectedVideoAdIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(ad.adId)) {
                          next.delete(ad.adId)
                        } else if (next.size < 5) {
                          next.add(ad.adId)
                        }
                        return next
                      })
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                      selected
                        ? "border-brand-lime/50 bg-brand-lime/10 text-brand-lime"
                        : "border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300"
                    }`}
                    title={ad.adName}
                  >
                    {ad.adName.length > 25 ? ad.adName.slice(0, 22) + "..." : ad.adName}
                  </button>
                )
              })}
          </div>

          <VideoRetentionChart
            rows={filteredRows}
            selectedAds={classifiedAds
              .filter((ad) => selectedVideoAdIds.has(ad.adId))
              .map((ad) => ({ adId: ad.adId, adName: ad.adName }))}
          />
        </Card>
      )}

      {/* View toggle + Creative content */}
      <div className="space-y-4">
        {/* View mode toggle */}
        <div className="flex items-center gap-2">
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
          {previewsEnabled && (
            <button
              onClick={() => setViewMode("grid")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                viewMode === "grid"
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Grid
            </button>
          )}
          <button
            onClick={() => setViewMode("grouped")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "grouped"
                ? "bg-neutral-700 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Grouped
          </button>
        </div>

        {viewMode === "grid" ? (
          /* Card grid view */
          <CreativeCardGrid ads={sortedAds} thumbnails={thumbnails} />
        ) : viewMode === "table" ? (
          /* Creative table */
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-400">
                All Creatives ({sortedAds.length})
              </h2>
              <div className="flex items-center gap-3">
                {(activeFilters.size > 0 || selectedTagFilters.length > 0) && (
                  <button
                    onClick={() => {
                      setActiveFilters(new Set())
                      setSelectedTagFilters([])
                    }}
                    className="text-xs text-neutral-500 transition hover:text-white"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-neutral-500">
                    <ThButton col="adName" label="Ad Name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <ThButton col="adsetName" label="Ad Set" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <ThButton col="classification" label="Classification" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <th className="py-2 pr-3 font-medium">Tags</th>
                    <ThButton col="spend" label="Spend" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                    <ThButton col="impressions" label="Impr." sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                    <ThButton col="conversions" label="Conv." sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                    <ThButton col="cpa" label="CPA" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                    <ThButton col="cvr" label="CVR" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                    <ThButton col="spendShare" label="Share" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                    <th className="py-2 pr-3 font-medium text-center">Fatigue</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAds.map((ad) => {
                    const def = CLASSIFICATIONS[ad.classification.type]
                    const adTags = adTagMap[ad.adId] || []
                    const assignedTags = tags.filter((t) => adTags.includes(t.id))
                    const unassignedTags = tags.filter((t) => !adTags.includes(t.id))
                    return (
                      <tr
                        key={ad.adId}
                        className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
                      >
                        <td className="max-w-[200px] truncate py-2.5 pr-3 text-neutral-200" title={ad.adName}>
                          {ad.adName}
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
                                onClick={() =>
                                  setTagDropdownAdId(
                                    tagDropdownAdId === ad.adId ? null : ad.adId
                                  )
                                }
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-700 text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-300"
                                title="Add tag"
                              >
                                +
                              </button>
                              {tagDropdownAdId === ad.adId && (
                                <TagDropdown
                                  tags={unassignedTags}
                                  onSelect={(tagId) => assignTag(ad.adId, tagId)}
                                  onClose={() => setTagDropdownAdId(null)}
                                />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-200">
                          {fmtCurrency(ad.spend)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                          {fmtNumber(ad.impressions)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                          {fmtNumber(ad.conversions)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                          {ad.cpa !== null ? fmtCurrency(ad.cpa) : "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                          {fmtPercent(ad.cvr * 100, 2)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-400">
                          {fmtPercent(ad.spendShare, 1)}
                        </td>
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
                  {sortedAds.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-neutral-500">
                        No creatives match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          /* Grouped view */
          <CreativeGroupingView classifiedAds={classifiedAds} />
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
    </div>
  )
}

// Inline tag assignment dropdown
function TagDropdown({
  tags,
  onSelect,
  onClose,
}: {
  tags: Tag[]
  onSelect: (tagId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [onClose])

  if (tags.length === 0) {
    return (
      <div
        ref={ref}
        className="absolute left-0 top-7 z-40 w-36 rounded-lg border border-neutral-700 bg-neutral-800 p-2 shadow-xl"
      >
        <p className="text-xs text-neutral-500">No more tags</p>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 top-7 z-40 w-40 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl"
    >
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
