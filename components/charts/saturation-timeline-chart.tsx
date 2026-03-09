"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts"
import { fmtDateShort } from "@/lib/utils/format"

type SaturationTimelineChartProps = {
  data: { date: string; score: number }[]
  height?: number
}

export default function SaturationTimelineChart({
  data,
  height = 280,
}: SaturationTimelineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        {/* Zone background areas */}
        <ReferenceArea y1={0} y2={30} fill="#22c55e" fillOpacity={0.04} />
        <ReferenceArea y1={30} y2={60} fill="#f59e0b" fillOpacity={0.04} />
        <ReferenceArea y1={60} y2={100} fill="#ef4444" fillOpacity={0.04} />

        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}`}
          ticks={[0, 30, 60, 100]}
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
          formatter={(value: number) => {
            let label = "Low"
            if (value > 60) label = "High"
            else if (value > 30) label = "Moderate"
            return [`${value}/100 (${label})`, "Saturation"]
          }}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="#CDFF00"
          fill="#CDFF00"
          fillOpacity={0.08}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: "#CDFF00" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
