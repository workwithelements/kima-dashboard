"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import type { AggregatedMetrics, HierarchyLevel } from "@/lib/utils/types"
import { deriveMetrics } from "@/lib/utils/aggregate"
import { calculateFunnelStep, FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"
import { fmtCurrency, fmtNumber, fmtPercent, fmtRoas } from "@/lib/utils/format"

type GroupRow = {
  id: string
  name: string
  metrics: AggregatedMetrics
}

type ColumnDef = {
  key: string
  label: string
  align?: "left" | "right"
  getValue: (row: GroupRow) => number | string
  format: (row: GroupRow) => string
}

/** Extra metric definitions that can be toggled on/off via column picker */
type ExtraMetricDef = {
  key: string
  label: string
  getValue: (row: GroupRow, currency: string) => number
  format: (row: GroupRow, currency: string) => string
}

const EXTRA_METRICS: ExtraMetricDef[] = [
  {
    key: "reach",
    label: "Reach",
    getValue: (row) => row.metrics.reach,
    format: (row) => fmtNumber(row.metrics.reach),
  },
  {
    key: "clicks",
    label: "Clicks",
    getValue: (row) => row.metrics.clicks,
    format: (row) => fmtNumber(row.metrics.clicks),
  },
  {
    key: "ctr",
    label: "CTR",
    getValue: (row) => deriveMetrics(row.metrics).ctr,
    format: (row) => fmtPercent(deriveMetrics(row.metrics).ctr),
  },
  {
    key: "cpm",
    label: "CPM",
    getValue: (row) => deriveMetrics(row.metrics).cpm,
    format: (row, cur) => fmtCurrency(deriveMetrics(row.metrics).cpm, cur),
  },
  {
    key: "cpc",
    label: "CPC",
    getValue: (row) => deriveMetrics(row.metrics).cpc,
    format: (row, cur) => fmtCurrency(deriveMetrics(row.metrics).cpc, cur),
  },
  {
    key: "purchases",
    label: "Purchases",
    getValue: (row) => row.metrics.purchases,
    format: (row) => fmtNumber(row.metrics.purchases),
  },
  {
    key: "revenue",
    label: "Revenue",
    getValue: (row) => row.metrics.revenue,
    format: (row, cur) => fmtCurrency(row.metrics.revenue, cur),
  },
  {
    key: "roas",
    label: "ROAS",
    getValue: (row) => deriveMetrics(row.metrics).roas,
    format: (row) => fmtRoas(deriveMetrics(row.metrics).roas),
  },
  {
    key: "frequency",
    label: "Frequency",
    getValue: (row) =>
      row.metrics.reach > 0 ? row.metrics.impressions / row.metrics.reach : 0,
    format: (row) => {
      const freq =
        row.metrics.reach > 0
          ? row.metrics.impressions / row.metrics.reach
          : 0
      return freq > 0 ? `${freq.toFixed(2)}x` : "—"
    },
  },
]

/** Build columns dynamically based on configured funnel steps + extra columns */
function buildColumns(
  funnelSteps: string[],
  extraCols: string[],
  currency = "GBP"
): ColumnDef[] {
  const cols: ColumnDef[] = [
    {
      key: "name",
      label: "Name",
      align: "left",
      getValue: (row) => row.name.toLowerCase(),
      format: (row) => row.name,
    },
    {
      key: "spend",
      label: "Spend",
      getValue: (row) => row.metrics.spend,
      format: (row) => fmtCurrency(row.metrics.spend, currency),
    },
    {
      key: "impressions",
      label: "Impr.",
      getValue: (row) => row.metrics.impressions,
      format: (row) => fmtNumber(row.metrics.impressions),
    },
  ]

  // Add columns for each configured funnel step
  for (const stepKey of funnelSteps) {
    const def = FUNNEL_STEP_DEFS[stepKey]
    if (!def) continue

    // Count column
    cols.push({
      key: `${stepKey}_count`,
      label: def.shortLabel,
      getValue: (row) => calculateFunnelStep(stepKey, row.metrics).count,
      format: (row) => fmtNumber(calculateFunnelStep(stepKey, row.metrics).count),
    })

    // Rate column
    cols.push({
      key: `${stepKey}_rate`,
      label: def.rateLabel,
      getValue: (row) => calculateFunnelStep(stepKey, row.metrics).rate ?? 0,
      format: (row) => {
        const v = calculateFunnelStep(stepKey, row.metrics).rate
        return v !== null ? fmtPercent(v) : "—"
      },
    })

    // Cost per column
    cols.push({
      key: `${stepKey}_cost`,
      label: def.costLabel,
      getValue: (row) => calculateFunnelStep(stepKey, row.metrics).costPer ?? 0,
      format: (row) => {
        const v = calculateFunnelStep(stepKey, row.metrics).costPer
        return v !== null ? fmtCurrency(v, currency) : "—"
      },
    })
  }

  // If no funnel steps, show default ROAS columns
  if (funnelSteps.length === 0) {
    cols.push(
      {
        key: "clicks",
        label: "Clicks",
        getValue: (row) => row.metrics.clicks,
        format: (row) => fmtNumber(row.metrics.clicks),
      },
      {
        key: "ctr",
        label: "CTR",
        getValue: (row) => deriveMetrics(row.metrics).ctr,
        format: (row) => fmtPercent(deriveMetrics(row.metrics).ctr),
      },
      {
        key: "purchases",
        label: "Purch.",
        getValue: (row) => row.metrics.purchases,
        format: (row) => fmtNumber(row.metrics.purchases),
      },
      {
        key: "revenue",
        label: "Revenue",
        getValue: (row) => row.metrics.revenue,
        format: (row) => fmtCurrency(row.metrics.revenue, currency),
      },
      {
        key: "roas",
        label: "ROAS",
        getValue: (row) => deriveMetrics(row.metrics).roas,
        format: (row) => fmtRoas(deriveMetrics(row.metrics).roas),
      },
    )
  }

  // Append any extra metric columns the user has toggled on
  // (skip if already present from funnel steps or defaults)
  const existingKeys = new Set(cols.map((c) => c.key))
  for (const key of extraCols) {
    if (existingKeys.has(key)) continue
    const def = EXTRA_METRICS.find((m) => m.key === key)
    if (!def) continue
    cols.push({
      key: def.key,
      label: def.label,
      getValue: (row) => def.getValue(row, currency),
      format: (row) => def.format(row, currency),
    })
  }

  return cols
}

export default function PerformanceTable({
  data,
  level,
  onLevelChange,
  funnelSteps = [],
  levelOptions,
  currency = "GBP",
  breadcrumb,
  onRowClick,
}: {
  data: GroupRow[]
  level: string
  onLevelChange: (level: any) => void
  funnelSteps?: string[]
  /** Override the default level tabs (for Google Ads, which uses campaign/ad_group) */
  levelOptions?: { key: string; label: string }[]
  currency?: string
  /** When provided, replaces level tabs with a breadcrumb trail */
  breadcrumb?: { label: string; onClick: () => void }[]
  /** Click handler for drill-down rows (campaigns→adsets, adsets→ads) */
  onRowClick?: (row: GroupRow) => void
}) {
  const [sortKey, setSortKey] = useState<string>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [extraCols, setExtraCols] = useState<string[]>([])
  const [showColPicker, setShowColPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false)
      }
    }
    if (showColPicker) {
      document.addEventListener("mousedown", handleClick)
      return () => document.removeEventListener("mousedown", handleClick)
    }
  }, [showColPicker])

  const columns = useMemo(
    () => buildColumns(funnelSteps, extraCols, currency),
    [funnelSteps, extraCols, currency]
  )

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return data
    const copy = [...data]
    copy.sort((a, b) => {
      const va = col.getValue(a)
      const vb = col.getValue(b)
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va)
      }
      return sortDir === "asc"
        ? (va as number) - (vb as number)
        : (vb as number) - (va as number)
    })
    return copy
  }, [data, sortKey, sortDir, columns])

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function toggleExtraCol(key: string) {
    setExtraCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  const levels = levelOptions || [
    { key: "campaign", label: "Campaigns" },
    { key: "adset", label: "Ad Sets" },
    { key: "ad", label: "Ads" },
  ]

  // Determine which extra metrics are already shown by default columns
  const defaultKeys = useMemo(() => {
    const base = buildColumns(funnelSteps, [], currency)
    return new Set(base.map((c) => c.key))
  }, [funnelSteps, currency])

  // Available extra metrics (those not already shown by default)
  const availableExtras = EXTRA_METRICS.filter((m) => !defaultKeys.has(m.key))

  return (
    <div>
      {/* Level tabs + column picker + optional breadcrumb */}
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Level tabs — always shown */}
            {levels.map((l) => (
              <button
                key={l.key}
                onClick={() => onLevelChange(l.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  level === l.key
                    ? "bg-brand-lime/10 text-brand-lime"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Column picker */}
        {availableExtras.length > 0 && (
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowColPicker(!showColPicker)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-[11px] font-medium text-neutral-400 transition hover:border-neutral-600 hover:text-white"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Columns
              {extraCols.length > 0 && (
                <span className="rounded-full bg-brand-lime/20 px-1.5 text-[10px] text-brand-lime">
                  {extraCols.length}
                </span>
              )}
            </button>

            {showColPicker && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
                {availableExtras.map((m) => {
                  const active = extraCols.includes(m.key)
                  return (
                    <button
                      key={m.key}
                      onClick={() => toggleExtraCol(m.key)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-neutral-800"
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          active
                            ? "border-brand-lime bg-brand-lime/20 text-brand-lime"
                            : "border-neutral-600"
                        }`}
                      >
                        {active && (
                          <svg
                            className="h-2.5 w-2.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </span>
                      <span className={active ? "text-white" : "text-neutral-400"}>
                        {m.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        </div>

        {/* Drill-down breadcrumb trail (shown below level tabs when drilling) */}
        {breadcrumb && (
          <div className="mt-1.5 flex items-center gap-0">
            {breadcrumb.map((crumb, i) => {
              const isLast = i === breadcrumb.length - 1
              return (
                <span key={i} className="flex items-center">
                  {i > 0 && (
                    <span className="mx-1.5 text-[11px] text-neutral-600">›</span>
                  )}
                  {isLast ? (
                    <span className="text-xs font-medium text-white">
                      {crumb.label}
                    </span>
                  ) : (
                    <button
                      onClick={crumb.onClick}
                      className="text-xs font-medium text-brand-lime transition hover:underline"
                    >
                      {crumb.label}
                    </button>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-neutral-800">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`cursor-pointer whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500 transition hover:text-neutral-300 ${
                    col.align === "left" ? "text-left" : "text-right"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      <svg
                        className={`h-3 w-3 transition ${sortDir === "asc" ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-neutral-800/50 transition ${
                  onRowClick
                    ? "cursor-pointer hover:bg-neutral-800/50"
                    : "hover:bg-neutral-800/30"
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2.5 text-xs tabular-nums ${
                      col.align === "left" ? "text-left" : "text-right whitespace-nowrap"
                    } ${col.key === "name" ? "max-w-[320px] truncate font-medium text-white" : "text-neutral-300"}`}
                    title={col.key === "name" ? row.name : undefined}
                  >
                    {col.key === "name" && onRowClick ? (
                      <span className="inline-flex items-center gap-1">
                        {col.format(row)}
                        <svg className="h-3 w-3 shrink-0 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    ) : (
                      col.format(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-xs text-neutral-500">
                  No data for this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
