"use client"

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
import { fmtDateShort } from "@/lib/utils/format"
import type { FunnelSeriesDef } from "./funnel-chart"

type Props = {
  data: Record<string, number | string>[]
  series: FunnelSeriesDef[]
}

/** Series whose peak is below this fraction of the dominant peak go to the right axis. */
const SECONDARY_AXIS_RATIO = 0.2

export default function FunnelBarChart({ data, series }: Props) {
  if (series.length === 0 || data.length === 0) return null

  // Compute per-series peak and bucket into primary (left) / secondary (right).
  const peaks = series.map((s) => {
    let max = 0
    for (const row of data) {
      const v = (row[s.key] as number) || 0
      if (v > max) max = v
    }
    return { series: s, max }
  })
  const topPeak = peaks.reduce((m, p) => (p.max > m ? p.max : m), 0)
  const threshold = topPeak * SECONDARY_AXIS_RATIO
  const primary = peaks.filter((p) => series.length === 1 || p.max >= threshold || topPeak === 0)
  const secondary = peaks.filter((p) => !primary.includes(p))
  const hasSecondary = secondary.length > 0

  const secondaryKeys = new Set(secondary.map((p) => p.series.key))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.toLocaleString()}
        />
        {hasSecondary && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v.toLocaleString()}
          />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          labelFormatter={fmtDateShort}
          formatter={(value: any, name: string) => {
            const s = series.find((s) => s.key === name)
            return [(value as number).toLocaleString(), s?.label || name]
          }}
        />
        <Legend
          verticalAlign="top"
          height={36}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => {
            const s = series.find((s) => s.key === value)
            const onRight = secondaryKeys.has(value)
            return (
              <span className="text-xs text-neutral-400">
                {s?.label || value}
                {onRight && <span className="ml-1 text-[10px] text-neutral-500">(right)</span>}
              </span>
            )
          }}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            yAxisId={secondaryKeys.has(s.key) ? "right" : "left"}
            dataKey={s.key}
            fill={s.color}
            fillOpacity={0.85}
            radius={[2, 2, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
