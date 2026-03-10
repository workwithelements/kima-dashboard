"use client"

import { useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { ClassifiedAd } from "@/lib/utils/creative-classification"
import type { MetaDailyRow } from "@/lib/utils/types"

type Props = {
  rows: Partial<MetaDailyRow>[]
  classifiedAds: ClassifiedAd[]
  adsetId: string | null
}

// Vibrant color palette for stacking
const COLORS = [
  "#CDFF00", "#3b82f6", "#f59e0b", "#ef4444", "#22c55e",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16",
  "#6366f1", "#14b8a6",
]

/**
 * 100% stacked bar chart showing daily spend distribution across ads
 * within the selected ad set. Top 10 by spend, rest grouped as "Other".
 * Uses a compact external legend with color swatches to handle long ad names.
 */
export default function SpendShareChart({ rows, classifiedAds, adsetId }: Props) {
  const chartData = useMemo(() => {
    // Filter rows to selected adset
    const adsetRows = adsetId
      ? rows.filter((r) => r.adset_id === adsetId)
      : rows

    if (adsetRows.length === 0) return { data: [], adKeys: [] }

    // Find top 10 ads by total spend in this adset
    const spendByAd = new Map<string, { name: string; spend: number }>()
    for (const r of adsetRows) {
      if (!r.ad_id) continue
      const existing = spendByAd.get(r.ad_id)
      if (existing) {
        existing.spend += r.spend || 0
      } else {
        spendByAd.set(r.ad_id, {
          name: r.ad_name || r.ad_id,
          spend: r.spend || 0,
        })
      }
    }

    const sortedAds = Array.from(spendByAd.entries())
      .sort((a, b) => b[1].spend - a[1].spend)

    const topAds = sortedAds.slice(0, 10)
    const topAdIds = new Set(topAds.map(([id]) => id))
    const hasOther = sortedAds.length > 10

    // Build ad key list
    const adKeys = topAds.map(([id, { name }], index) => ({
      id,
      key: id,
      shortLabel: `Ad ${index + 1}`,
      fullName: name,
    }))
    if (hasOther) {
      adKeys.push({ id: "__other__", key: "__other__", shortLabel: "Other", fullName: "Other" })
    }

    // Group by date
    const byDate = new Map<string, Record<string, number>>()
    for (const r of adsetRows) {
      if (!r.date || !r.ad_id) continue
      const date = r.date
      if (!byDate.has(date)) byDate.set(date, {})
      const entry = byDate.get(date)!
      const spend = r.spend || 0

      if (topAdIds.has(r.ad_id)) {
        entry[r.ad_id] = (entry[r.ad_id] || 0) + spend
      } else {
        entry.__other__ = (entry.__other__ || 0) + spend
      }
    }

    // Use raw spend values — stackOffset="expand" handles normalization to 100%
    const data: Record<string, string | number>[] = []
    byDate.forEach((adSpend, date) => {
      const total = Object.values(adSpend).reduce((s, v) => s + v, 0)
      if (total === 0) return

      const point: Record<string, string | number> = { date }
      for (const ak of adKeys) {
        point[ak.key] = adSpend[ak.key] || 0
      }
      data.push(point)
    })

    // Sort by date
    data.sort((a, b) => String(a.date).localeCompare(String(b.date)))

    return { data, adKeys }
  }, [rows, adsetId])

  if (chartData.data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        No spend data for this ad set.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData.data} stackOffset="expand">
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#262626" }}
            tickFormatter={(v: string) => {
              const d = new Date(v + "T00:00:00")
              return `${d.getMonth() + 1}/${d.getDate()}`
            }}
          />
          <YAxis
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              // Only show ads with non-zero spend on this day
              const live = payload.filter(
                (p: any) => typeof p.value === "number" && p.value > 0
              )
              if (live.length === 0) return null
              return (
                <div
                  style={{
                    backgroundColor: "#171717",
                    border: "1px solid #262626",
                    borderRadius: "8px",
                    fontSize: "12px",
                    padding: "8px 10px",
                    maxWidth: "350px",
                  }}
                >
                  <p style={{ color: "#a3a3a3", marginBottom: 4 }}>{label}</p>
                  {live.map((entry: any) => {
                    const ak = chartData.adKeys.find((a) => a.key === entry.dataKey)
                    const name = ak?.fullName || entry.dataKey
                    const truncated = name.length > 40 ? name.slice(0, 37) + "..." : name
                    return (
                      <div key={entry.dataKey} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            backgroundColor: entry.color,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: "#d4d4d4" }}>{truncated}</span>
                        <span style={{ color: "#737373", marginLeft: "auto" }}>
                          {((entry.value as number) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            }}
          />
          {chartData.adKeys.map((ak, i) => (
            <Bar
              key={ak.key}
              dataKey={ak.key}
              stackId="spend"
              fill={COLORS[i % COLORS.length]}
              name={ak.key}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* External compact legend with full names */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {chartData.adKeys.map((ak, i) => (
          <div key={ak.key} className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span
              className="text-[11px] text-neutral-400 truncate"
              title={ak.fullName}
            >
              {ak.fullName}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
