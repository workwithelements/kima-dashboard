"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts"

type Row = {
  job: string
  roas: number
  spend: number
}

export default function RoasByJobChart({ data }: { data: Row[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="job"
          tick={{ fill: "#a3a3a3", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
        />
        <YAxis
          tick={{ fill: "#737373", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v.toFixed(1)}x`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "13px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          formatter={(value: number, name: string, props: any) => {
            if (name === "roas") {
              return [
                `${value.toFixed(2)}x (£${props.payload.spend.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} spend)`,
                "ROAS",
              ]
            }
            return [value, name]
          }}
        />
        <Bar dataKey="roas" fill="#CDFF00" fillOpacity={0.85} radius={[4, 4, 0, 0]}>
          <LabelList
            dataKey="roas"
            position="top"
            formatter={(v: number) => `${v.toFixed(2)}x`}
            fill="#e5e5e5"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
