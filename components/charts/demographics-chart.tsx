"use client"

import { useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import type { MetaDemographicsRow } from "@/lib/utils/types"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"

type Props = {
  rows: MetaDemographicsRow[]
  metric: "spend" | "impressions" | "purchases"
}

const GENDER_COLORS: Record<string, string> = {
  male: "#3b82f6",
  female: "#ec4899",
  unknown: "#737373",
}

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  unknown: "Unknown",
}

const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]

export default function DemographicsChart({ rows, metric }: Props) {
  const { data, genders } = useMemo(() => {
    // Aggregate by age + gender
    const agg = new Map<string, Record<string, number>>()
    const genderSet = new Set<string>()

    for (const r of rows) {
      const age = r.age || "unknown"
      const gender = r.gender || "unknown"
      genderSet.add(gender)

      if (!agg.has(age)) agg.set(age, {})
      const entry = agg.get(age)!
      entry[gender] = (entry[gender] || 0) + (r[metric] || 0)
    }

    // Sort age buckets
    const sortedAges = Array.from(agg.keys()).sort(
      (a, b) => (AGE_ORDER.indexOf(a) === -1 ? 99 : AGE_ORDER.indexOf(a)) -
                (AGE_ORDER.indexOf(b) === -1 ? 99 : AGE_ORDER.indexOf(b))
    )

    const data = sortedAges.map((age) => ({
      age,
      ...agg.get(age),
    }))

    const genders = Array.from(genderSet).sort()

    return { data, genders }
  }, [rows, metric])

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-500">No demographic data available.</p>
  }

  const fmt = metric === "spend" ? fmtCurrency : fmtNumber

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="age"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
        />
        <YAxis
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => fmt(v)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#171717",
            border: "1px solid #262626",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#a3a3a3" }}
          formatter={(value: number, name: string) => [
            fmt(value),
            GENDER_LABELS[name] || name,
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
          formatter={(value: string) => GENDER_LABELS[value] || value}
        />
        {genders.map((g) => (
          <Bar
            key={g}
            dataKey={g}
            stackId="demo"
            fill={GENDER_COLORS[g] || "#737373"}
            name={g}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
