"use client"

import { useState, useMemo } from "react"
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

/** Build columns dynamically based on configured funnel steps */
function buildColumns(funnelSteps: string[]): ColumnDef[] {
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
      format: (row) => fmtCurrency(row.metrics.spend),
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
        return v !== null ? fmtCurrency(v) : "—"
      },
    })
  }

  // If no funnel steps, show default ROAS column
  if (funnelSteps.length === 0) {
    const derived = (row: GroupRow) => deriveMetrics(row.metrics)
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
        getValue: (row) => derived(row).ctr,
        format: (row) => fmtPercent(derived(row).ctr),
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
        format: (row) => fmtCurrency(row.metrics.revenue),
      },
      {
        key: "roas",
        label: "ROAS",
        getValue: (row) => derived(row).roas,
        format: (row) => fmtRoas(derived(row).roas),
      },
    )
  }

  return cols
}

export default function PerformanceTable({
  data,
  level,
  onLevelChange,
  funnelSteps = [],
}: {
  data: GroupRow[]
  level: HierarchyLevel
  onLevelChange: (level: HierarchyLevel) => void
  funnelSteps?: string[]
}) {
  const [sortKey, setSortKey] = useState<string>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const columns = useMemo(() => buildColumns(funnelSteps), [funnelSteps])

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

  const levels: { key: HierarchyLevel; label: string }[] = [
    { key: "campaign", label: "Campaigns" },
    { key: "adset", label: "Ad Sets" },
    { key: "ad", label: "Ads" },
  ]

  return (
    <div>
      {/* Level tabs */}
      <div className="mb-3 flex gap-1">
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
                className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2.5 text-xs tabular-nums ${
                      col.align === "left" ? "text-left" : "text-right"
                    } ${col.key === "name" ? "max-w-[200px] truncate font-medium text-white" : "text-neutral-300"}`}
                    title={col.key === "name" ? row.name : undefined}
                  >
                    {col.format(row)}
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
