"use client"

import { useMemo } from "react"
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
  /** Comparison period data (aligned by day index, not by date) */
  comparisonData?: { date: string; value: number }[]
  /** Label for the comparison line in tooltip */
  comparisonLabel?: string
}

export default function MetricChart({
  data,
  label = "Value",
  color = "#CDFF00",
  format = "currency",
  currency = "GBP",
  height = 300,
  comparisonData,
  comparisonLabel = "Previous Period",
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

  // Merge comparison data by day index (dates won't match)
  const chartData = useMemo(() => {
    if (!comparisonData || comparisonData.length === 0) return data
    return data.map((d, i) => ({
      ...d,
      compValue: comparisonData[i]?.value ?? undefined,
    }))
  }, [data, comparisonData])

  const hasComparison = comparisonData && comparisonData.length > 0

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData}>
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
          formatter={(value: number, name: string) => {
            if (name === "compValue") return [formatter(value), comparisonLabel]
            return [formatter(value), label]
          }}
        />
        {/* Comparison area — rendered first so it appears behind */}
        {hasComparison && (
          <Area
            type="monotone"
            dataKey="compValue"
            stroke="#737373"
            strokeDasharray="5 5"
            fill="none"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
        )}
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
