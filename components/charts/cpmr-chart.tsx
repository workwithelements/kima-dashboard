"use client"

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from "recharts"
import { fmtDateShort, fmtCurrency } from "@/lib/utils/format"
import type { CpmrDataPoint } from "@/lib/utils/reach"

type CpmrChartProps = {
  data: CpmrDataPoint[]
  height?: number
  currency?: string
  /** Axis/tooltip label formatter (defaults to short date) */
  labelFormatter?: (dateStr: string) => string
}

export default function CpmrChart({ data, height = 280, currency = "GBP", labelFormatter = fmtDateShort }: CpmrChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={labelFormatter}
        />
        <YAxis
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtCurrency(v, currency)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          labelFormatter={labelFormatter}
          formatter={(value: number, name: string) => {
            const label = name === "cpmr" ? "CPMr (per 1k reach)" : "CPM"
            return [fmtCurrency(value, currency), label]
          }}
        />
        <Legend
          verticalAlign="top"
          height={36}
          iconType="line"
          iconSize={14}
          formatter={(value: string) => {
            const labels: Record<string, string> = {
              cpm: "CPM",
              cpmr: "CPMr (per 1k reach)",
            }
            return (
              <span className="text-xs text-neutral-400">
                {labels[value] || value}
              </span>
            )
          }}
        />
        <Line
          type="monotone"
          dataKey="cpm"
          stroke="#737373"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Line
          type="monotone"
          dataKey="cpmr"
          stroke="#CDFF00"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: "#CDFF00" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
