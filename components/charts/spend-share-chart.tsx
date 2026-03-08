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
  Legend,
} from "recharts"
import type { ClassifiedAd } from "@/lib/utils/creative-classification"
import { CLASSIFICATIONS } from "@/lib/utils/creative-classification"
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

    // Build ad key list (truncated names for display)
    const adKeys = topAds.map(([id, { name }]) => ({
      id,
      key: id,
      label: name.length > 25 ? name.slice(0, 22) + "..." : name,
      fullName: name,
    }))
    if (hasOther) {
      adKeys.push({ id: "__other__", key: "__other__", label: "Other", fullName: "Other" })
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

    // Convert to percentage
    const data: Record<string, string | number>[] = []
    byDate.forEach((adSpend, date) => {
      const total = Object.values(adSpend).reduce((s, v) => s + v, 0)
      if (total === 0) return

      const point: Record<string, string | number> = { date }
      for (const ak of adKeys) {
        point[ak.key] = total > 0 ? ((adSpend[ak.key] || 0) / total) * 100 : 0
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

  // Build classification color map for legend enhancement
  const classColorMap = new Map<string, string>()
  for (const ad of classifiedAds) {
    classColorMap.set(ad.adId, CLASSIFICATIONS[ad.classification.type].color)
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
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
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "12px",
            maxWidth: "300px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          formatter={(value: number, name: string) => {
            const ak = chartData.adKeys.find((a) => a.key === name)
            const label = ak?.fullName || name
            return [`${(value * 100).toFixed(1)}%`, label]
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
          formatter={(value: string) => {
            const ak = chartData.adKeys.find((a) => a.key === value)
            return ak?.label || value
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
  )
}
