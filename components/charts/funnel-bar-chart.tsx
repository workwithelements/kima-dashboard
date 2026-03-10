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
import { fmtDateShort, fmtCurrency } from "@/lib/utils/format"
import type { FunnelSeriesDef } from "./funnel-chart"

type Props = {
  data: Record<string, number | string>[]
  series: FunnelSeriesDef[]
  /** Daily spend keyed by date, used to compute CPA */
  spendByDate?: Record<string, number>
  /** Which funnel step key to use for CPA denominator (usually "purchases") */
  cpaStepKey?: string
  currency?: string
}

export default function FunnelBarChart({
  data,
  series,
  spendByDate = {},
  cpaStepKey,
  currency = "GBP",
}: Props) {
  if (series.length === 0 || data.length === 0) return null

  // Determine CPA step: use explicit key, or last series entry
  const cpaDenomKey = cpaStepKey || series[series.length - 1]?.key
  const cpaSeries = series.find((s) => s.key === cpaDenomKey)

  // Enrich data with CPA
  const enriched = data.map((d) => {
    const date = d.date as string
    const spend = spendByDate[date] || 0
    const denominator = (d[cpaDenomKey] as number) || 0
    const cpa = denominator > 0 ? spend / denominator : null
    return { ...d, _cpa: cpa }
  })

  // Compute max CPA for Y-axis domain (filter outliers)
  const cpaValues = enriched
    .map((d) => d._cpa)
    .filter((v): v is number => v !== null && v > 0)
  const maxCpa = cpaValues.length > 0
    ? Math.ceil(cpaValues.sort((a, b) => a - b)[Math.floor(cpaValues.length * 0.95)] * 1.2)
    : 100

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={enriched} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        {/* Left Y-axis: volumes */}
        <YAxis
          yAxisId="left"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.toLocaleString()}
        />
        {/* Right Y-axis: CPA */}
        {cpaSeries && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            domain={[0, maxCpa]}
            tickFormatter={(v) => fmtCurrency(v, currency)}
          />
        )}
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
            if (name === "_cpa") {
              return value != null
                ? [fmtCurrency(value as number, currency), `CPA (${cpaSeries?.label || ""})`]
                : ["—", "CPA"]
            }
            const s = series.find((s) => s.key === name)
            return [(value as number).toLocaleString(), s?.label || name]
          }}
        />
        <Legend
          verticalAlign="top"
          height={36}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => {
            if (value === "_cpa") {
              return (
                <span className="text-xs text-neutral-400">
                  CPA ({cpaSeries?.label || ""})
                </span>
              )
            }
            const s = series.find((s) => s.key === value)
            return <span className="text-xs text-neutral-400">{s?.label || value}</span>
          }}
        />
        {/* Bars for each funnel step */}
        {series.map((s) => (
          <Bar
            key={s.key}
            yAxisId="left"
            dataKey={s.key}
            fill={s.color}
            fillOpacity={0.85}
            radius={[2, 2, 0, 0]}
          />
        ))}
        {/* CPA dashed line on right axis */}
        {cpaSeries && (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="_cpa"
            stroke="#F59E0B"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "#F59E0B" }}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
