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
import { fmtNumber, fmtPercent } from "@/lib/utils/format"
import { formatBucketLabel, type Granularity, type PreparedReachPoint } from "@/lib/utils/reach"

type ReachChartProps = {
  data: PreparedReachPoint[]
  /** Bucket granularity — controls axis labels and the % line meaning */
  granularity?: Granularity
  /** Number of consecutive declining buckets (for fatigue warning) */
  fatigueDays?: number
  height?: number
}

export default function ReachChart({
  data,
  granularity = "day",
  fatigueDays = 0,
  height = 300,
}: ReachChartProps) {
  const isDaily = granularity === "day"

  // For daily view, smooth the new-reach % with a 7-day rolling average.
  // For week/month buckets, each point already represents the whole period's
  // new reach as a share of lifetime cumulative reach, so show it directly.
  const chartData = data.map((d, i) => {
    let pct = d.newReachPct
    if (isDaily) {
      const windowSize = Math.min(7, i + 1)
      const windowSlice = data.slice(Math.max(0, i - windowSize + 1), i + 1)
      pct = windowSlice.reduce((sum, p) => sum + p.newReachPct, 0) / windowSlice.length
    }
    return {
      date: d.date,
      existingReach: d.previousReach,
      newReach: d.newReach,
      rollingNewPct: pct,
    }
  })

  const pctLabel = isDaily ? "New Reach % (7d avg)" : "New Reach % of lifetime"
  const tickFormatter = (s: string) => formatBucketLabel(s, granularity)

  return (
    <div>
      {fatigueDays >= 7 && isDaily && (
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
            tickFormatter={tickFormatter}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmtNumber(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            domain={[0, "auto"]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#171717",
              border: "1px solid #262626",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#a3a3a3" }}
            labelFormatter={tickFormatter}
            formatter={(value: number, name: string) => {
              switch (name) {
                case "existingReach":
                  return [fmtNumber(value), "Existing Reach"]
                case "newReach":
                  return [fmtNumber(value), "New Reach"]
                case "rollingNewPct":
                  return [fmtPercent(value, 1), pctLabel]
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
                existingReach: "Existing Reach",
                newReach: "New Reach",
                rollingNewPct: pctLabel,
              }
              return (
                <span className="text-xs text-neutral-400">
                  {labels[value] || value}
                </span>
              )
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="existingReach"
            stackId="reach"
            fill="#1A1A4E"
            fillOpacity={0.8}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            yAxisId="left"
            dataKey="newReach"
            stackId="reach"
            fill="#CDFF00"
            fillOpacity={0.7}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="rollingNewPct"
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
