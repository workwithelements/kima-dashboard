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
import { fmtDateShort } from "@/lib/utils/format"

type DataPoint = {
  date: string
  spend: number
}

export default function SpendChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        <YAxis
          tick={{ fill: "#737373", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `£${v.toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "13px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          labelFormatter={fmtDateShort}
          formatter={(value: number) => [`£${value.toLocaleString()}`, "Spend"]}
        />
        <Area
          type="monotone"
          dataKey="spend"
          stroke="#CDFF00"
          fill="#CDFF00"
          fillOpacity={0.1}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
