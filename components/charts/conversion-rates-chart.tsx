"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { fmtDateShort, fmtPercent } from "@/lib/utils/format"
import { FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"
import type { FunnelSeriesDef } from "./funnel-chart"

type Props = {
  /** Daily funnel data: { date, landing_page_views, adds_to_cart, ... } */
  data: Record<string, number | string>[]
  series: FunnelSeriesDef[]
  /** Daily totals: { date, impressions, clicks, spend } */
  dailyTotals: Record<string, { impressions: number; clicks: number; spend: number }>
  /** Ordered funnel step keys — when provided, uses progressive denominators */
  funnelStepKeys?: string[]
}

/** Softer palette for rate lines (distinct from bar colors) */
const RATE_COLORS = [
  "#CDFF00", // lime
  "#FF69B4", // pink
  "#60A5FA", // sky
  "#34D399", // emerald
  "#C084FC", // purple
  "#FB923C", // orange
  "#F472B6", // rose
]

export default function ConversionRatesChart({
  data,
  series,
  dailyTotals,
  funnelStepKeys,
}: Props) {
  if (series.length === 0 || data.length === 0) return null

  // Build rate data: for each day, compute rate for each funnel step
  const rateData = data.map((d) => {
    const date = d.date as string
    const totals = dailyTotals[date] || { impressions: 0, clicks: 0, spend: 0 }
    const entry: Record<string, number | string | null> = { date }

    for (let i = 0; i < series.length; i++) {
      const stepKey = series[i].key
      const def = FUNNEL_STEP_DEFS[stepKey]
      if (!def) continue

      const count = (d[stepKey] as number) || 0
      let denominator = 0

      if (funnelStepKeys && funnelStepKeys.length > 0) {
        // Progressive: use previous funnel step as denominator
        const stepIdx = funnelStepKeys.indexOf(stepKey)
        if (stepIdx > 0) {
          const prevKey = funnelStepKeys[stepIdx - 1]
          denominator = (d[prevKey] as number) || 0
        } else {
          // First step: use impressions
          denominator = totals.impressions
        }
      } else {
        // Fallback: static denominator from step def
        const denomField = def.rateDenominator
        if (denomField === "impressions") denominator = totals.impressions
        else if (denomField === "clicks") denominator = totals.clicks
        else if (denomField === "landingPageViews") denominator = (d["landing_page_views"] as number) || 0
        else if (denomField === "addsToCart") denominator = (d["adds_to_cart"] as number) || 0
        else if (denomField === "checkoutsInitiated") denominator = (d["checkouts_initiated"] as number) || 0
      }

      const rate = denominator > 0 ? (count / denominator) * 100 : null
      entry[`${stepKey}_rate`] = rate
    }

    return entry
  })

  // Build progressive labels: "Purchases / Carts" instead of static "Purchase Rate"
  const getProgressiveLabel = (stepKey: string) => {
    const def = FUNNEL_STEP_DEFS[stepKey]
    if (!def) return stepKey
    if (funnelStepKeys && funnelStepKeys.length > 0) {
      const stepIdx = funnelStepKeys.indexOf(stepKey)
      if (stepIdx > 0) {
        const prevDef = FUNNEL_STEP_DEFS[funnelStepKeys[stepIdx - 1]]
        if (prevDef) return `${def.shortLabel} / ${prevDef.shortLabel}`
      }
      return `${def.shortLabel} / Impr.`
    }
    return def.rateLabel
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rateData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#262626" }}
          tickFormatter={fmtDateShort}
        />
        <YAxis
          tick={{ fill: "#737373", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v.toFixed(1)}%`}
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
            // name is like "landing_page_views_rate"
            const stepKey = name.replace(/_rate$/, "")
            const label = getProgressiveLabel(stepKey)
            return value != null ? [fmtPercent(value as number, 2), label] : ["—", label]
          }}
        />
        <Legend
          verticalAlign="top"
          height={36}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => {
            const stepKey = value.replace(/_rate$/, "")
            return (
              <span className="text-xs text-neutral-400">
                {getProgressiveLabel(stepKey)}
              </span>
            )
          }}
        />
        {series.map((s, i) => (
          <Line
            key={`${s.key}_rate`}
            type="monotone"
            dataKey={`${s.key}_rate`}
            stroke={RATE_COLORS[i % RATE_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
