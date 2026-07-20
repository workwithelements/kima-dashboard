"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import type { AggregatedMetrics, HierarchyLevel } from "@/lib/utils/types"
import { deriveMetrics } from "@/lib/utils/aggregate"
import { calculateFunnelStep, FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"
import { fmtCurrency, fmtConversions, fmtNumber, fmtPercent, fmtRoas } from "@/lib/utils/format"

type GroupRow = {
  id: string
  name: string
  metrics: AggregatedMetrics
  platform?: "meta" | "google"
}

type ColumnDef = {
  key: string
  label: string
  align?: "left" | "right"
  getValue: (row: GroupRow) => number | string
  format: (row: GroupRow) => string
}

/** Keys where lower = better (costs). For these, negative delta is green. */
const LOWER_IS_BETTER = new Set(["cpm", "cpc", "cpa", "frequency"])

function DeltaBadge({ current, previous, colKey }: { current: number; previous: number; colKey: string }) {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return null // can't compute % change from zero

  const pctChange = ((current - previous) / Math.abs(previous)) * 100
  if (!isFinite(pctChange)) return null

  // For rate columns (ending in _rate) and cost columns, interpret direction
  const isCost = LOWER_IS_BETTER.has(colKey) || colKey.endsWith("_cost")
  const isPositive = isCost ? pctChange < 0 : pctChange > 0
  const isNeutral = Math.abs(pctChange) < 0.5

  const color = isNeutral
    ? "text-neutral-500"
    : isPositive
      ? "text-emerald-400"
      : "text-red-400"

  const arrow = pctChange > 0 ? "↑" : pctChange < 0 ? "↓" : ""

  return (
    <span className={`block text-[9px] font-medium leading-tight ${color}`}>
      {arrow} {Math.abs(pctChange).toFixed(1)}%
    </span>
  )
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
    key: "cpa",
    label: "Cost / Conv.",
    getValue: (row) => deriveMetrics(row.metrics).cpa,
    format: (row, cur) => fmtCurrency(deriveMetrics(row.metrics).cpa, cur),
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

/**
 * Format a conversion/purchase count for a row. Google rows carry fractional
 * conversions and are shown to 2 decimals (matching the Google Ads platform);
 * Meta purchases are whole counts. `googleConversions` covers the pure-Google
 * view where rows aren't tagged with a platform.
 */
function fmtConvCount(row: GroupRow, googleConversions: boolean): string {
  const isGoogle = row.platform === "google" || googleConversions
  return isGoogle ? fmtConversions(row.metrics.purchases) : fmtNumber(row.metrics.purchases)
}

/** Build columns dynamically based on configured funnel steps + extra columns */
function buildColumns(
  funnelSteps: string[],
  extraCols: string[],
  currency = "GBP",
  googleConversions = false
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
  for (let stepIdx = 0; stepIdx < funnelSteps.length; stepIdx++) {
    const stepKey = funnelSteps[stepIdx]
    const def = FUNNEL_STEP_DEFS[stepKey]
    if (!def) continue

    // Use previous funnel step as rate denominator (matches the funnel view above)
    const prevStepField = stepIdx > 0
      ? FUNNEL_STEP_DEFS[funnelSteps[stepIdx - 1]]?.field
      : undefined

    // Count column
    cols.push({
      key: `${stepKey}_count`,
      label: def.shortLabel,
      getValue: (row) => calculateFunnelStep(stepKey, row.metrics, prevStepField).count,
      format: (row) => fmtNumber(calculateFunnelStep(stepKey, row.metrics, prevStepField).count),
    })

    // Rate column
    const rateDecimals = def.rateDecimals ?? 1
    cols.push({
      key: `${stepKey}_rate`,
      label: def.rateLabel,
      getValue: (row) => calculateFunnelStep(stepKey, row.metrics, prevStepField).rate ?? 0,
      format: (row) => {
        const v = calculateFunnelStep(stepKey, row.metrics, prevStepField).rate
        return v !== null ? fmtPercent(v, rateDecimals) : "—"
      },
    })

    // Cost per column
    cols.push({
      key: `${stepKey}_cost`,
      label: def.costLabel,
      getValue: (row) => calculateFunnelStep(stepKey, row.metrics, prevStepField).costPer ?? 0,
      format: (row) => {
        const v = calculateFunnelStep(stepKey, row.metrics, prevStepField).costPer
        return v !== null ? fmtCurrency(v, currency) : "—"
      },
    })
  }

  // When funnel steps are configured, always show CPM + Frequency after the funnel columns
  if (funnelSteps.length > 0) {
    cols.push({
      key: "cpm",
      label: "CPM",
      getValue: (row) => deriveMetrics(row.metrics).cpm,
      format: (row) => fmtCurrency(deriveMetrics(row.metrics).cpm, currency),
    })
    cols.push({
      key: "frequency",
      label: "Freq.",
      getValue: (row) => deriveMetrics(row.metrics).frequency,
      format: (row) => {
        const freq = deriveMetrics(row.metrics).frequency
        return freq > 0 ? `${freq.toFixed(2)}x` : "—"
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
        key: "frequency",
        label: "Freq.",
        getValue: (row) => deriveMetrics(row.metrics).frequency,
        format: (row) => {
          const freq = deriveMetrics(row.metrics).frequency
          return freq > 0 ? `${freq.toFixed(2)}x` : "—"
        },
      },
      {
        key: "purchases",
        label: "Purch.",
        getValue: (row) => row.metrics.purchases,
        format: (row) => fmtConvCount(row, googleConversions),
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
      format:
        def.key === "purchases"
          ? (row) => fmtConvCount(row, googleConversions)
          : (row) => def.format(row, currency),
    })
  }

  return cols
}

export default function PerformanceTable({
  data,
  comparisonData,
  level,
  onLevelChange,
  funnelSteps = [],
  levelOptions,
  currency = "GBP",
  breadcrumb,
  onRowClick,
  newAdIds,
  entityStatus,
  googleConversions = false,
}: {
  data: GroupRow[]
  /** Comparison period data — same shape, matched by row ID for delta badges */
  comparisonData?: GroupRow[]
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
  /** Set of ad IDs in their first 5 days — shows "Test" beaker badge */
  newAdIds?: Set<string>
  /** Entity status: testing (blue), live (green), paused (red) */
  entityStatus?: Map<string, "testing" | "live" | "paused">
  /** Google Ads reports fractional conversions — show the Purch. count to 2dp */
  googleConversions?: boolean
}) {
  const [sortKey, setSortKey] = useState<string>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [extraCols, setExtraCols] = useState<string[]>([])
  const [showColPicker, setShowColPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Build comparison lookup by row ID
  const compMap = useMemo(() => {
    if (!comparisonData) return null
    const map = new Map<string, GroupRow>()
    for (const row of comparisonData) map.set(row.id, row)
    return map
  }, [comparisonData])

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
    () => buildColumns(funnelSteps, extraCols, currency, googleConversions),
    [funnelSteps, extraCols, currency, googleConversions]
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
    const base = buildColumns(funnelSteps, [], currency, googleConversions)
    return new Set(base.map((c) => c.key))
  }, [funnelSteps, currency, googleConversions])

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
                  } ${col.key === "name" ? "sticky left-0 z-10 bg-neutral-900" : ""}`}
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
            {sorted.map((row) => {
              const compRow = compMap?.get(row.id)
              return (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-neutral-800/50 transition ${
                  onRowClick
                    ? "cursor-pointer hover:bg-neutral-800/50"
                    : "hover:bg-neutral-800/30"
                }`}
              >
                {columns.map((col) => {
                  const isName = col.key === "name"
                  // Compute delta for non-name numeric columns
                  const currentVal = !isName ? col.getValue(row) : null
                  const prevVal = !isName && compRow ? col.getValue(compRow) : null

                  return (
                  <td
                    key={col.key}
                    className={`px-3 py-2.5 text-xs tabular-nums ${
                      col.align === "left" ? "text-left" : "text-right whitespace-nowrap"
                    } ${isName ? "sticky left-0 z-10 bg-neutral-900 max-w-[320px] truncate font-medium text-white" : "text-neutral-300"}`}
                    title={isName ? row.name : undefined}
                  >
                    {isName ? (
                      <span className="inline-flex items-center gap-1.5">
                        {entityStatus && (
                          <span
                            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                              entityStatus.get(row.id) === "testing"
                                ? "bg-blue-400"
                                : entityStatus.get(row.id) === "live"
                                  ? "bg-green-400"
                                  : "bg-red-400"
                            }`}
                            title={
                              entityStatus.get(row.id) === "testing"
                                ? "In testing"
                                : entityStatus.get(row.id) === "live"
                                  ? "Live"
                                  : "Paused"
                            }
                          />
                        )}
                        {row.platform && (
                          <span
                            className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                              row.platform === "meta"
                                ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                                : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                            }`}
                          >
                            {row.platform === "meta" ? "Meta" : "Google"}
                          </span>
                        )}
                        {col.format(row)}
                        {newAdIds?.has(row.id) && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-purple-500/30 bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-purple-400 backdrop-blur-sm"
                            title="Testing — first 5 days of activity"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714a2.25 2.25 0 0 0 .659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 5.527a.5.5 0 0 1-.457.298H7.927a.5.5 0 0 1-.457-.298L5 14.5m14 0H5" />
                            </svg>
                            Test
                          </span>
                        )}
                        {onRowClick && (
                          <svg className="h-3 w-3 shrink-0 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </span>
                    ) : (
                      <div>
                        {col.format(row)}
                        {compRow && typeof currentVal === "number" && typeof prevVal === "number" && (
                          <DeltaBadge current={currentVal} previous={prevVal} colKey={col.key} />
                        )}
                      </div>
                    )}
                  </td>
                  )
                })}
              </tr>
              )
            })}
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
