"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { fmtDateShort, fmtCurrency, fmtNumber } from "@/lib/utils/format"

type MetricChartProps = {
  data: { date: string; value: number }[]
  /** Label shown in tooltip */
  label?: string
  /** Colour for the area/line */
  color?: string
  /** Format style for Y axis and tooltip */
  format?: "currency" | "number" | "percent"
  /** Currency code for currency formatting */
  currency?: string
  /** Height of the chart */
  height?: number
}

export default function MetricChart({
  data,
  label = "Value",
  color = "#CDFF00",
  format = "currency",
  currency = "GBP",
  height = 300,
}: MetricChartProps) {
  const formatter = (v: number) => {
    switch (format) {
      case "currency":
        return fmtCurrency(v, currency)
      case "percent":
        return `${v.toFixed(1)}%`
      default:
        return fmtNumber(v)
    }
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
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
          tickFormatter={formatter}
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
          formatter={(value: number) => [formatter(value), label]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.08}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
