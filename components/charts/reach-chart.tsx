"use client"

import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from "recharts"
import { fmtDateShort, fmtNumber, fmtPercent } from "@/lib/utils/format"
import type { PreparedReachPoint } from "@/lib/utils/reach"

type ReachChartProps = {
  data: PreparedReachPoint[]
  /** Number of consecutive declining days (for fatigue warning) */
  fatigueDays?: number
  height?: number
}

export default function ReachChart({
  data,
  fatigueDays = 0,
  height = 300,
}: ReachChartProps) {
  // Build chart data with 7-day rolling average of newReach %
  const chartData = data.map((d, i) => {
    const windowSize = Math.min(7, i + 1)
    const windowSlice = data.slice(Math.max(0, i - windowSize + 1), i + 1)
    const rollingAvgPct =
      windowSlice.reduce((sum, p) => sum + p.newReachPct, 0) / windowSlice.length

    return {
      date: d.date,
      newReach: d.newReach,
      newReachPct: d.newReachPct,
      rollingAvgPct: Math.round(rollingAvgPct * 10) / 10,
    }
  })

  return (
    <div>
      {fatigueDays >= 7 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-400">
          <span>⚠️</span>
          <span>
            New reach declining for {fatigueDays} consecutive days — audience fatigue detected
          </span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#262626" }}
            tickFormatter={fmtDateShort}
          />
          {/* Left Y-axis: new reach count */}
          <YAxis
            yAxisId="count"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmtNumber(v)}
          />
          {/* Right Y-axis: new reach % */}
          <YAxis
            yAxisId="pct"
            orientation="right"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
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
              switch (name) {
                case "newReach":
                  return [fmtNumber(value), "Est. New Reach"]
                case "rollingAvgPct":
                  return [fmtPercent(value, 1), "7d Avg New Reach %"]
                default:
                  return [fmtNumber(value), name]
              }
            }}
          />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="rect"
            iconSize={10}
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                newReach: "Est. New Reach",
                rollingAvgPct: "7d Avg New Reach %",
              }
              return (
                <span className="text-xs text-neutral-400">
                  {labels[value] || value}
                </span>
              )
            }}
          />
          <Bar
            yAxisId="count"
            dataKey="newReach"
            fill="#CDFF00"
            fillOpacity={0.6}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="rollingAvgPct"
            stroke="#FF69B4"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
