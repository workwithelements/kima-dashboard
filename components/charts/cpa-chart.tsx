"use client"

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { fmtDateShort, fmtCurrency, fmtNumber } from "@/lib/utils/format"

type Props = {
  /** Daily funnel data: { date, [stepKey]: count } */
  data: Record<string, number | string>[]
  /** The funnel step key used as CPA denominator */
  stepKey: string
  /** Label for the step (e.g. "Purchases") */
  stepLabel: string
  /** Daily spend keyed by date */
  spendByDate: Record<string, number>
  currency?: string
}

export default function CPAChart({
  data,
  stepKey,
  stepLabel,
  spendByDate,
  currency = "GBP",
}: Props) {
  if (data.length === 0) return null

  // Build enriched data: event count + daily CPA + 7-day rolling average CPA
  const enriched = data.map((d) => {
    const date = d.date as string
    const spend = spendByDate[date] || 0
    const count = (d[stepKey] as number) || 0
    const cpa = count > 0 ? spend / count : null
    return { date, count, cpa, spend }
  })

  const withRolling = enriched.map((d, i) => {
    const window = enriched.slice(Math.max(0, i - 6), i + 1)
    const validCpa = window.filter((w) => w.cpa !== null).map((w) => w.cpa!)
    const rolling =
      validCpa.length > 0
        ? validCpa.reduce((a, b) => a + b, 0) / validCpa.length
        : null
    return { ...d, rolling }
  })

  // Compute max CPA for right Y-axis (95th percentile × 1.2 to cut outliers)
  const cpaValues = withRolling
    .map((d) => d.cpa)
    .filter((v): v is number => v !== null && v > 0)
  const maxCpa =
    cpaValues.length > 0
      ? Math.ceil(
          cpaValues.sort((a, b) => a - b)[
            Math.floor(cpaValues.length * 0.95)
          ] * 1.2
        )
      : 100

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={withRolling} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        {/* Left Y-axis: event count */}
        <YAxis
          yAxisId="count"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtNumber(v)}
        />
        {/* Right Y-axis: CPA currency */}
        <YAxis
          yAxisId="cpa"
          orientation="right"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          domain={[0, maxCpa]}
          tickFormatter={(v) => fmtCurrency(v, currency)}
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
          formatter={(value: any, name: string) => {
            if (name === "count") {
              return [fmtNumber(value as number), stepLabel]
            }
            if (name === "cpa") {
              return value != null
                ? [fmtCurrency(value as number, currency), "Daily CPA"]
                : ["—", "Daily CPA"]
            }
            if (name === "rolling") {
              return value != null
                ? [fmtCurrency(value as number, currency), "7d Avg CPA"]
                : ["—", "7d Avg CPA"]
            }
            return [value, name]
          }}
        />
        <Legend
          verticalAlign="top"
          height={36}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => {
            if (value === "count") {
              return (
                <span className="text-xs text-neutral-400">{stepLabel}</span>
              )
            }
            if (value === "cpa") {
              return (
                <span className="text-xs text-neutral-400">Daily CPA</span>
              )
            }
            if (value === "rolling") {
              return (
                <span className="text-xs text-neutral-400">7d Avg CPA</span>
              )
            }
            return (
              <span className="text-xs text-neutral-400">{value}</span>
            )
          }}
        />
        {/* Bars: event count (lime, semi-transparent) */}
        <Bar
          yAxisId="count"
          dataKey="count"
          fill="#CDFF00"
          fillOpacity={0.3}
          radius={[2, 2, 0, 0]}
        />
        {/* Line 1: daily CPA (pink) */}
        <Line
          yAxisId="cpa"
          type="monotone"
          dataKey="cpa"
          stroke="#FF69B4"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: "#FF69B4" }}
          connectNulls
        />
        {/* Line 2: 7d rolling average CPA (white dashed) */}
        <Line
          yAxisId="cpa"
          type="monotone"
          dataKey="rolling"
          stroke="#a3a3a3"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: "#a3a3a3" }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
