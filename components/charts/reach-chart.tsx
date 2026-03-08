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
import { fmtDateShort, fmtNumber } from "@/lib/utils/format"
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
  // Calculate trend line (simple moving average of newReachPct)
  const chartData = data.map((d, i) => {
    // 5-day moving average for trend
    const windowSize = Math.min(5, i + 1)
    const windowSlice = data.slice(Math.max(0, i - windowSize + 1), i + 1)
    const trendValue =
      windowSlice.reduce((sum, p) => sum + p.newReachPct, 0) / windowSlice.length

    return {
      ...d,
      trend: Math.round(trendValue * 10) / 10,
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
          <YAxis
            yAxisId="reach"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmtNumber(v)}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
            domain={[0, 100]}
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
                case "previousReach":
                  return [fmtNumber(value), "Previous Reach"]
                case "newReach":
                  return [fmtNumber(value), "New Reach"]
                case "trend":
                  return [`${value.toFixed(1)}%`, "New Reach % Trend"]
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
                previousReach: "Previous Reach",
                newReach: "New Reach",
                trend: "New Reach % Trend",
              }
              return (
                <span className="text-xs text-neutral-400">
                  {labels[value] || value}
                </span>
              )
            }}
          />
          <Bar
            yAxisId="reach"
            dataKey="previousReach"
            stackId="reach"
            fill="#3B3B5E"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            yAxisId="reach"
            dataKey="newReach"
            stackId="reach"
            fill="#CDFF00"
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="trend"
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
