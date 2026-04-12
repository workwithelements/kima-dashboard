"use client"

import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"
import {
  summariseByCampaignType,
  groupBodyPartLandingPages,
  buildAdsetDetailRows,
  type CampaignType,
  type AdsetDetailRow,
} from "@/lib/utils/alexia-clark-structure"
import type { MetaDailyRow } from "@/lib/utils/types"

type Props = {
  rows: Partial<MetaDailyRow>[]
  currency?: string
}

type FilterKey = "all" | `type:${CampaignType}` | `label:${string}`

export default function AlexiaClarkStructureView({ rows, currency = "GBP" }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all")
  const [sortKey, setSortKey] = useState<keyof AdsetDetailRow>("cpa")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const summaries = useMemo(() => summariseByCampaignType(rows), [rows])
  const bodyPartGroups = useMemo(() => groupBodyPartLandingPages(rows), [rows])

  // Best & worst CPA across summaries (for color coding)
  const { bestCpa, worstCpa } = useMemo(() => {
    const cpas = summaries.map((s) => s.cpa).filter((c): c is number => c !== null)
    if (cpas.length === 0) return { bestCpa: null, worstCpa: null }
    return { bestCpa: Math.min(...cpas), worstCpa: Math.max(...cpas) }
  }, [summaries])

  // Unique filter options
  const allAdsetRows = useMemo(() => buildAdsetDetailRows(rows), [rows])

  const filteredAdsetRows = useMemo(() => {
    let filtered = allAdsetRows
    if (filter !== "all") {
      if (filter.startsWith("type:")) {
        const type = filter.slice(5) as CampaignType
        filtered = filtered.filter((r) => r.campaignType === type)
      } else if (filter.startsWith("label:")) {
        const label = filter.slice(6)
        filtered = filtered.filter((r) => r.campaignLabel === label)
      }
    }
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va
      }
      const sa = String(va)
      const sb = String(vb)
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
    return sorted
  }, [allAdsetRows, filter, sortKey, sortDir])

  function toggleSort(key: keyof AdsetDetailRow) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir(key === "adsetName" || key === "campaignName" ? "asc" : "desc")
    }
  }

  if (summaries.length === 0) {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Campaign Structure Analysis</h2>
        <p className="text-xs text-neutral-500">
          Performance by campaign type, with landing page winners inside body-part campaigns.
        </p>
      </div>

      {/* ── Section 1: Campaign Type Summary ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summaries.map((s) => {
          const isBest = s.cpa !== null && s.cpa === bestCpa && summaries.length > 1
          const isWorst = s.cpa !== null && s.cpa === worstCpa && summaries.length > 1
          const cpaColor = isBest ? "text-green-400" : isWorst ? "text-red-400" : "text-white"
          const filterKey: FilterKey =
            s.type === "BodyPart" ? `label:${s.label}` : `type:${s.type}`
          const isActive = filter === filterKey
          return (
            <button
              key={`${s.type}-${s.label}`}
              onClick={() => setFilter(isActive ? "all" : filterKey)}
              className={`rounded-xl border p-4 text-left transition ${
                isActive
                  ? "border-brand-lime/40 bg-brand-lime/5"
                  : "border-neutral-800 bg-neutral-900 hover:border-neutral-700"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                {s.label}
              </p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${cpaColor}`}>
                {s.cpa !== null ? fmtCurrency(s.cpa, currency) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">
                {fmtCurrency(s.spend, currency)} spend &middot; {fmtNumber(s.purchases)} purchases
              </p>
            </button>
          )
        })}
      </div>

      {/* ── Section 2: Landing Page Winners per Body Part ── */}
      {bodyPartGroups.length > 0 && (
        <Card>
          <h3 className="mb-4 text-sm font-semibold">Landing Page Performance by Body Part</h3>
          <div className="space-y-6">
            {bodyPartGroups.map((group) => {
              // Max CPA for bar scaling (only non-null)
              const maxCpa = Math.max(
                ...group.landingPages.map((lp) => lp.cpa || 0),
                1
              )
              return (
                <div key={group.bodyPart}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h4 className="text-sm font-medium uppercase tracking-wider text-neutral-300">
                      {group.bodyPart}
                    </h4>
                    <span className="text-[11px] text-neutral-500">
                      {fmtCurrency(group.totalSpend, currency)} total &middot; {fmtNumber(group.totalPurchases)} purchases
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {group.landingPages.map((lp) => {
                      // Invert so LOWER CPA gets LONGER bar
                      const inverted = lp.cpa !== null ? 1 - lp.cpa / maxCpa : 0
                      const barWidth = Math.max(8, inverted * 100)
                      // Color: green for winner, amber for mid, red for worst
                      let barColor = "bg-neutral-700"
                      if (lp.isWinner) barColor = "bg-green-500/80"
                      else if (lp.cpa !== null) {
                        const ratio = lp.cpa / maxCpa
                        if (ratio < 0.6) barColor = "bg-brand-lime/60"
                        else if (ratio < 0.85) barColor = "bg-amber-500/60"
                        else barColor = "bg-red-500/50"
                      }
                      return (
                        <div key={lp.landingPage} className="flex items-center gap-3 text-xs">
                          <div className="w-14 shrink-0 font-medium text-neutral-300">
                            {lp.landingPage}
                          </div>
                          <div className="flex-1 overflow-hidden rounded bg-neutral-800">
                            <div
                              className={`h-5 rounded ${barColor} transition-all`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <div className="flex w-36 shrink-0 items-center justify-end gap-2 tabular-nums">
                            <span className={lp.isWinner ? "font-semibold text-green-400" : "text-neutral-300"}>
                              {lp.cpa !== null ? fmtCurrency(lp.cpa, currency) : "—"}
                            </span>
                            {lp.isWinner && (
                              <span className="rounded border border-green-500/30 bg-green-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-green-400">
                                WINNER
                              </span>
                            )}
                          </div>
                          <div className="hidden w-32 shrink-0 text-right text-[10px] text-neutral-500 sm:block">
                            {fmtCurrency(lp.spend, currency)} &middot; {fmtNumber(lp.purchases)} purch
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ── Section 3: Adset Breakdown Table ── */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Adset Breakdown</h3>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
            {summaries.find((s) => s.type === "ASC") && (
              <FilterChip
                label="ASC"
                active={filter === "type:ASC"}
                onClick={() => setFilter(filter === "type:ASC" ? "all" : "type:ASC")}
              />
            )}
            {summaries.find((s) => s.type === "Retargeting") && (
              <FilterChip
                label="Retargeting"
                active={filter === "type:Retargeting"}
                onClick={() => setFilter(filter === "type:Retargeting" ? "all" : "type:Retargeting")}
              />
            )}
            {summaries
              .filter((s) => s.type === "BodyPart")
              .map((s) => (
                <FilterChip
                  key={s.label}
                  label={s.label}
                  active={filter === `label:${s.label}`}
                  onClick={() => setFilter(filter === `label:${s.label}` ? "all" : `label:${s.label}`)}
                />
              ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500">
                <ThButton label="Campaign" col="campaignLabel" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <ThButton label="Adset" col="adsetName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <ThButton label="Landing Page" col="landingPage" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <ThButton label="Spend" col="spend" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <ThButton label="Purch" col="purchases" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <ThButton label="CPA" col="cpa" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <ThButton label="CVR" col="cvr" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <ThButton label="ROAS" col="roas" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {filteredAdsetRows.map((r) => (
                <tr key={r.adsetId} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                  <td className="py-2 pr-3 text-neutral-400">{r.campaignLabel}</td>
                  <td className="max-w-[280px] truncate py-2 pr-3 text-neutral-200" title={r.adsetName}>
                    {r.adsetName}
                  </td>
                  <td className="py-2 pr-3 text-neutral-300">{r.landingPage ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtCurrency(r.spend, currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(r.purchases)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.cpa !== null ? fmtCurrency(r.cpa, currency) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtPercent(r.cvr * 100)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.roas > 0 ? `${r.roas.toFixed(2)}x` : "—"}</td>
                </tr>
              ))}
              {filteredAdsetRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-neutral-500">
                    No adsets match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? "border-brand-lime/40 bg-brand-lime/10 text-brand-lime"
          : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-white"
      }`}
    >
      {label}
    </button>
  )
}

function ThButton({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string
  col: keyof AdsetDetailRow
  sortKey: keyof AdsetDetailRow
  sortDir: "asc" | "desc"
  onSort: (col: keyof AdsetDetailRow) => void
  align?: "left" | "right"
}) {
  const active = sortKey === col
  return (
    <th className={`py-2 pr-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 transition hover:text-white ${
          active ? "text-neutral-200" : ""
        }`}
      >
        {label}
        {active && <span className="text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  )
}
