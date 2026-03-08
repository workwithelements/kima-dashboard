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
import type { MetaPlacementsRow } from "@/lib/utils/types"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"

type Props = {
  rows: MetaPlacementsRow[]
  groupBy: "publisher_platform" | "platform_position"
  metric: "spend" | "impressions" | "purchases"
}

const PLATFORM_COLORS: Record<string, string> = {
  facebook: "#1877F2",
  instagram: "#E4405F",
  audience_network: "#f59e0b",
  messenger: "#0084FF",
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
}

export default function PlacementsChart({ rows, groupBy, metric }: Props) {
  const data = useMemo(() => {
    const agg = new Map<string, number>()

    for (const r of rows) {
      const key = r[groupBy] || "unknown"
      agg.set(key, (agg.get(key) || 0) + (r[metric] || 0))
    }

    return Array.from(agg.entries())
      .map(([name, value]) => ({
        name: PLATFORM_LABELS[name] || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value,
        rawName: name,
      }))
      .sort((a, b) => b.value - a.value)
  }, [rows, groupBy, metric])

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-500">No placement data available.</p>
  }

  const fmt = metric === "spend" ? fmtCurrency : fmtNumber

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={(v: number) => fmt(v)}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: "#a3a3a3", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={140}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          formatter={(value: number) => [fmt(value), metric.charAt(0).toUpperCase() + metric.slice(1)]}
        />
        <Bar
          dataKey="value"
          fill="#CDFF00"
          radius={[0, 4, 4, 0]}
          barSize={24}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
