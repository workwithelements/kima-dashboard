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

/** Group daily data into ISO weeks, summing reach values */
function groupByWeek(data: PreparedReachPoint[]): {
  date: string
  existingReach: number
  newReach: number
  totalReach: number
  avgNewReachPct: number
}[] {
  const weeks = new Map<
    string,
    { dates: string[]; existingReach: number; newReach: number; totalReach: number; newReachPctSum: number; count: number }
  >()

  for (const d of data) {
    const dt = new Date(d.date + "T00:00:00")
    // Get Monday of this week
    const day = dt.getDay()
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(dt)
    monday.setDate(diff)
    const weekKey = monday.toISOString().split("T")[0]

    const existing = weeks.get(weekKey) || {
      dates: [],
      existingReach: 0,
      newReach: 0,
      totalReach: 0,
      newReachPctSum: 0,
      count: 0,
    }
    existing.dates.push(d.date)
    existing.existingReach += d.previousReach
    existing.newReach += d.newReach
    existing.totalReach += d.totalReach
    existing.newReachPctSum += d.newReachPct
    existing.count += 1
    weeks.set(weekKey, existing)
  }

  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => ({
      date: weekStart,
      existingReach: w.existingReach,
      newReach: w.newReach,
      totalReach: w.totalReach,
      avgNewReachPct: w.count > 0 ? w.newReachPctSum / w.count : 0,
    }))
}

function formatWeekLabel(dateStr: string): string {
  const dt = new Date(dateStr + "T00:00:00")
  return `w/c ${dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
}

export default function ReachChart({
  data,
  fatigueDays = 0,
  height = 300,
}: ReachChartProps) {
  const useWeekly = data.length > 30

  // Build chart data
  const chartData = useWeekly
    ? groupByWeek(data).map((w) => ({
        date: w.date,
        existingReach: w.existingReach,
        newReach: w.newReach,
        rollingNewPct: w.avgNewReachPct,
      }))
    : data.map((d, i) => {
        // 7-day rolling average of newReachPct
        const windowSize = Math.min(7, i + 1)
        const windowSlice = data.slice(Math.max(0, i - windowSize + 1), i + 1)
        const rollingAvgPct =
          windowSlice.reduce((sum, p) => sum + p.newReachPct, 0) / windowSlice.length

        return {
          date: d.date,
          existingReach: d.previousReach,
          newReach: d.newReach,
          rollingNewPct: rollingAvgPct,
        }
      })

  const tickFormatter = useWeekly ? formatWeekLabel : fmtDateShort

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
                  return [fmtPercent(value, 1), useWeekly ? "Avg New Reach %" : "7d Avg New Reach %"]
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
                rollingNewPct: useWeekly ? "Avg New Reach %" : "7d Avg New Reach %",
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
