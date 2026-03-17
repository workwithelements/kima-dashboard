"use client"

import { useMemo, useState } from "react"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { getDimensionValue } from "@/lib/utils/ad-name-parser"
import type { ParsedAdName } from "@/lib/utils/ad-name-parser"

type Ad = {
  adId: string
  adName: string
  parsed?: ParsedAdName
}

type Props = {
  ads: Ad[]
}

const COLORS = [
  "#CDFF00",
  "#FF69B4",
  "#3b82f6",
  "#f59e0b",
  "#22c55e",
  "#a855f7",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#6366f1",
  "#14b8a6",
  "#1A1A4E",
]

type ToggleGroup = {
  label: string
  options: { key: string; label: string }[]
}

const CHART_GROUPS: ToggleGroup[] = [
  {
    label: "Stage",
    options: [{ key: "stage", label: "Stage" }],
  },
  {
    label: "Format / Style",
    options: [
      { key: "format", label: "Format" },
      { key: "styleOfContent", label: "Style" },
    ],
  },
  {
    label: "Job / Use Case",
    options: [
      { key: "job", label: "Job" },
      { key: "useCase", label: "Use Case" },
    ],
  },
]

function buildDimensionData(ads: Ad[], dim: string) {
  const counts = new Map<string, number>()
  let total = 0
  for (const ad of ads) {
    const val = getDimensionValue(ad.parsed, dim)
    if (val) {
      counts.set(val, (counts.get(val) || 0) + 1)
      total++
    }
  }
  if (total === 0) return null

  const entries = Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count,
      pct: (count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count)

  return { entries, total }
}

function DimensionPie({ ads, group }: { ads: Ad[]; group: ToggleGroup }) {
  const [activeKey, setActiveKey] = useState(group.options[0].key)
  const hasToggle = group.options.length > 1

  const data = useMemo(() => buildDimensionData(ads, activeKey), [ads, activeKey])

  if (!data) {
    return (
      <div className="flex-1 min-w-[200px] rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="text-xs font-medium text-neutral-500 mb-2">{group.label}</p>
        <p className="text-[11px] text-neutral-600 py-8 text-center">No data</p>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-[200px] rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      {/* Header with optional toggle */}
      <div className="flex items-center justify-between mb-2">
        {hasToggle ? (
          <div className="flex gap-1">
            {group.options.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setActiveKey(opt.key)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                  activeKey === opt.key
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs font-medium text-neutral-400">{group.label}</p>
        )}
        <span className="text-[10px] text-neutral-600">{data.total} ads</span>
      </div>

      {/* Pie */}
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie
            data={data.entries}
            dataKey="count"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={52}
            paddingAngle={1}
            strokeWidth={0}
          >
            {data.entries.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-xl">
                  <p className="font-medium text-white">{d.name}</p>
                  <p className="text-neutral-400">{d.count} ads ({d.pct.toFixed(0)}%)</p>
                </div>
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-1 space-y-0.5 max-h-20 overflow-y-auto">
        {data.entries.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="min-w-0 truncate text-neutral-400">{d.name}</span>
            <span className="ml-auto shrink-0 text-neutral-500">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DimensionPieCharts({ ads }: Props) {
  // Only show charts that have data for at least one option in the group
  const visibleGroups = useMemo(() => {
    return CHART_GROUPS.filter((group) =>
      group.options.some((opt) => buildDimensionData(ads, opt.key) !== null)
    )
  }, [ads])

  if (visibleGroups.length === 0) return null

  return (
    <div className="flex gap-4 flex-wrap">
      {visibleGroups.map((group) => (
        <DimensionPie key={group.label} ads={ads} group={group} />
      ))}
    </div>
  )
}
