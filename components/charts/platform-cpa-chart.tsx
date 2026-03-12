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
  /** Daily data per date: { date, metaConversions, googleConversions, totalConversions, cpa, rolling } */
  data: {
    date: string
    metaConversions: number
    googleConversions: number
    totalConversions: number
    cpa: number | null
    rolling: number | null
  }[]
  /** Label for the conversion metric (e.g. "Purchases", "Registrations") */
  conversionLabel?: string
  currency?: string
}

export default function PlatformCPAChart({
  data,
  conversionLabel = "Conversions",
  currency = "GBP",
}: Props) {
  if (data.length === 0) return null

  // Compute max CPA for right Y-axis (95th percentile x 1.2 to cut outliers)
  const cpaValues = data
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
      <ComposedChart data={data} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        {/* Left Y-axis: conversion count */}
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
            if (name === "metaConversions") {
              return [fmtNumber(value as number), `Meta ${conversionLabel}`]
            }
            if (name === "googleConversions") {
              return [fmtNumber(value as number), `Google ${conversionLabel}`]
            }
            if (name === "cpa") {
              return value != null
                ? [fmtCurrency(value as number, currency), "Daily CPA"]
                : ["\u2014", "Daily CPA"]
            }
            if (name === "rolling") {
              return value != null
                ? [fmtCurrency(value as number, currency), "7d Avg CPA"]
                : ["\u2014", "7d Avg CPA"]
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
            if (value === "metaConversions") {
              return (
                <span className="text-xs text-neutral-400">Meta {conversionLabel}</span>
              )
            }
            if (value === "googleConversions") {
              return (
                <span className="text-xs text-neutral-400">Google {conversionLabel}</span>
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
        {/* Stacked bars: Meta conversions (lime) + Google conversions (blue) */}
        <Bar
          yAxisId="count"
          dataKey="metaConversions"
          stackId="conversions"
          fill="#CDFF00"
          fillOpacity={0.4}
          radius={[0, 0, 0, 0]}
        />
        <Bar
          yAxisId="count"
          dataKey="googleConversions"
          stackId="conversions"
          fill="#4285F4"
          fillOpacity={0.5}
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
