"use client"

import { useMemo, useState } from "react"
import { Card } from "../ui/card"
import AdSetSelector from "../ui/adset-selector"
import { buildMockQualityScores } from "@/lib/data/mock-quality-scores"
import {
  bandBadge,
  bandLabel,
  crucialAmends,
  drivers,
  qsColor,
} from "@/lib/utils/quality-score"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import type { AdGroupQualityScore, GoogleAdsDailyRow, QualityBand } from "@/lib/utils/types"

type SortKey = "ad_group" | "campaign" | "spend" | "impressions" | "quality_score" | "impact"

/**
 * Spend impact of a low score: spend × (10 − QS). Surfaces ad groups where a
 * poor Quality Score actually costs money, so the table doesn't draw the eye to
 * low-QS ad groups that spend next to nothing. Same ranking the crucial-amends
 * panel uses.
 */
function impactOf(ag: AdGroupQualityScore): number {
  return ag.spend * (10 - ag.quality_score)
}

function BandBadge({ band }: { band: QualityBand }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${bandBadge(band)}`}
    >
      {bandLabel(band)}
    </span>
  )
}

export default function GoogleAdsQualitySection({
  rows,
  currency,
}: {
  rows: Partial<GoogleAdsDailyRow>[]
  currency?: string
}) {
  // Phase 1: derive mock QS from the real GA rows already in scope.
  const allAdGroups = useMemo(() => buildMockQualityScores(rows), [rows])

  // Campaign filter — distinct campaigns present in the data.
  const campaigns = useMemo(() => {
    const map = new Map<string, string>()
    for (const ag of allAdGroups) map.set(ag.campaign_id, ag.campaign_name)
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [allAdGroups])

  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([])
  // Default to spend impact (spend × low-QS) so the costliest weak ad groups
  // surface first, rather than tiny-spend ad groups creating noise.
  const [sortKey, setSortKey] = useState<SortKey>("impact")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const filtered = useMemo(() => {
    if (selectedCampaigns.length === 0 || selectedCampaigns.length === campaigns.length) {
      return allAdGroups
    }
    const set = new Set(selectedCampaigns)
    return allAdGroups.filter((ag) => set.has(ag.campaign_id))
  }, [allAdGroups, selectedCampaigns, campaigns.length])

  const amends = useMemo(() => crucialAmends(filtered, 3), [filtered])

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "ad_group":
          return a.ad_group_name.localeCompare(b.ad_group_name) * dir
        case "campaign":
          return a.campaign_name.localeCompare(b.campaign_name) * dir
        case "spend":
          return (a.spend - b.spend) * dir
        case "impressions":
          return (a.impressions - b.impressions) * dir
        case "quality_score":
          return (a.quality_score - b.quality_score) * dir
        case "impact":
          return (impactOf(a) - impactOf(b)) * dir
      }
    })
  }, [filtered, sortKey, sortDir])

  const impactSorted = sortKey === "impact"

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  if (allAdGroups.length === 0) return null

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-400">Quality Score by Ad Group</h2>
          <p className="mt-0.5 text-[11px] text-neutral-600">
            Sample data — live Quality Score sync coming soon
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-600">
            {impactSorted ? (
              <span>Sorted by spend impact (spend × low score) — biggest opportunities first</span>
            ) : (
              <button
                onClick={() => {
                  setSortKey("impact")
                  setSortDir("desc")
                }}
                className="text-neutral-500 underline decoration-dotted underline-offset-2 transition hover:text-neutral-300"
              >
                Sort by spend impact
              </button>
            )}
          </p>
        </div>
        <AdSetSelector
          items={campaigns}
          selected={selectedCampaigns}
          onChange={setSelectedCampaigns}
          label="campaigns"
        />
      </div>

      {/* Crucial amends — top 3 most pressing (spend-weighted lowest QS) */}
      {amends.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            Crucial amends — most pressing fixes
          </p>
          <div className="space-y-2">
            {amends.map((ag) => (
              <AmendRow key={ag.ad_group_id} ag={ag} currency={currency} />
            ))}
          </div>
        </div>
      )}

      {/* Ad-group quality table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <Th label="Ad Group" col="ad_group" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Campaign" col="campaign" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Spend" col="spend" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Impr." col="impressions" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Quality Score" col="quality_score" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="px-2 py-2 font-medium">Expected CTR</th>
              <th className="px-2 py-2 font-medium">Ad Relevance</th>
              <th className="px-2 py-2 font-medium">Landing Page Exp.</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((ag) => (
              <tr
                key={ag.ad_group_id}
                className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
              >
                <td className="px-2 py-2 text-neutral-200">{ag.ad_group_name}</td>
                <td className="px-2 py-2 text-neutral-400">{ag.campaign_name}</td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                  {fmtCurrency(ag.spend, currency)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                  {fmtNumber(ag.impressions)}
                </td>
                <td className={`px-2 py-2 text-right font-semibold tabular-nums ${qsColor(ag.quality_score)}`}>
                  {ag.quality_score.toFixed(1)}
                </td>
                <td className="px-2 py-2">
                  <BandBadge band={ag.expected_ctr} />
                </td>
                <td className="px-2 py-2">
                  <BandBadge band={ag.ad_relevance} />
                </td>
                <td className="px-2 py-2">
                  <BandBadge band={ag.landing_page_experience} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function AmendRow({ ag, currency }: { ag: AdGroupQualityScore; currency?: string }) {
  const weak = drivers(ag)
  // Severity colour from the overall score.
  const tone =
    ag.quality_score < 5
      ? "bg-red-950/30 text-red-400"
      : ag.quality_score < 8
        ? "bg-amber-950/30 text-amber-400"
        : "bg-green-950/30 text-green-400"

  return (
    <div className={`rounded-lg px-3 py-2.5 text-xs ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-neutral-100">{ag.ad_group_name}</span>
        <span className="shrink-0 tabular-nums">
          QS <span className="font-semibold">{ag.quality_score.toFixed(1)}</span>
          <span className="ml-2 text-neutral-400">{fmtCurrency(ag.spend, currency)} spend</span>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        {ag.campaign_name}
      </p>
      {weak.length > 0 && (
        <p className="mt-1.5 text-[11px] text-neutral-300">
          <span className="text-neutral-500">Driven by:</span>{" "}
          {weak.map((w, i) => (
            <span key={w.label}>
              {i > 0 && <span className="text-neutral-600"> · </span>}
              <span className="font-medium">{w.label}</span>{" "}
              <span className="text-neutral-500">({bandLabel(w.band).toLowerCase()})</span> — {w.fix}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

function Th({
  label,
  col,
  align = "left",
  sortKey,
  sortDir,
  onSort,
}: {
  label: string
  col: SortKey
  align?: "left" | "right"
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (col: SortKey) => void
}) {
  const active = sortKey === col
  return (
    <th className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 transition hover:text-neutral-300 ${
          active ? "text-neutral-300" : ""
        }`}
      >
        <span>{label}</span>
        {active && (
          <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span>
        )}
      </button>
    </th>
  )
}
