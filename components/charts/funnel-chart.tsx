"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { fmtDateShort } from "@/lib/utils/format"

export type FunnelSeriesDef = {
  key: string
  label: string
  color: string
}

/** Color palette for funnel step lines */
const FUNNEL_COLORS = [
  "#CDFF00", // lime
  "#FF69B4", // pink
  "#C8B8F0", // lavender
  "#3B82F6", // blue
  "#F59E0B", // amber
  "#10B981", // emerald
  "#EC4899", // rose
]

export function getFunnelColor(index: number): string {
  return FUNNEL_COLORS[index % FUNNEL_COLORS.length]
}

type Props = {
  data: Record<string, number | string>[]
  series: FunnelSeriesDef[]
}

export default function FunnelChart({ data, series }: Props) {
  if (series.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        <YAxis
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.toLocaleString()}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          labelFormatter={fmtDateShort}
          formatter={(value: number, name: string) => {
            const s = series.find((s) => s.key === name)
            return [value.toLocaleString(), s?.label || name]
          }}
        />
        <Legend
          verticalAlign="top"
          height={36}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => {
            const s = series.find((s) => s.key === value)
            return <span className="text-xs text-neutral-400">{s?.label || value}</span>
          }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
