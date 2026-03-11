"use client"

import { useMemo } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import type { MetaDailyRow } from "@/lib/utils/types"
import {
  aggregateVideoMetrics,
  calculateRetentionCurve,
  videoKPIs,
} from "@/lib/utils/video-retention"
import { fmtPercent, fmtNumber } from "@/lib/utils/format"

const COLORS = ["#CDFF00", "#3b82f6", "#f59e0b", "#ef4444", "#22c55e"]

type AdSelection = {
  adId: string
  adName: string
}

type Props = {
  rows: Partial<MetaDailyRow>[]
  selectedAds: AdSelection[]
}

/**
 * Video retention curve chart.
 * Overlays retention curves for up to 5 selected ads.
 */
export default function VideoRetentionChart({ rows, selectedAds }: Props) {
  const { chartData, kpiData } = useMemo(() => {
    if (selectedAds.length === 0) return { chartData: [], kpiData: [] }

    // Build retention curves for each ad
    const curves = selectedAds.slice(0, 5).map((ad) => {
      const metrics = aggregateVideoMetrics(rows, ad.adId)
      const curve = calculateRetentionCurve(metrics)
      const kpis = videoKPIs(metrics)
      return { ad, curve, kpis, metrics }
    })

    // Merge into unified chart data
    // Each point has: label, ad1, ad2, ...
    const labels = ["Views", "25%", "50%", "75%", "95%", "100%"]
    const chartData = labels.map((label, i) => {
      const point: Record<string, string | number> = { label }
      for (const c of curves) {
        const p = c.curve[i]
        point[c.ad.adId] = p ? Number(p.percent.toFixed(1)) : 0
      }
      return point
    })

    const kpiData = curves.map((c) => ({
      adId: c.ad.adId,
      adName: c.ad.adName,
      hookRate: c.kpis.hookRate,
      completionRate: c.kpis.completionRate,
      holdRate: c.kpis.holdRate,
      impressions: c.metrics.impressions,
      threeSecViews: c.metrics.threeSecViews,
    }))

    return { chartData, kpiData }
  }, [rows, selectedAds])

  if (selectedAds.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        Select video ads to compare retention curves.
      </p>
    )
  }

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        No video retention data available.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpiData.map((k, i) => (
          <div
            key={k.adId}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 space-y-1"
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className="text-xs text-neutral-400 truncate" title={k.adName}>
                {k.adName.length > 20 ? k.adName.slice(0, 17) + "..." : k.adName}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-neutral-500">Hook</span>
                <span className="ml-1 text-neutral-200">{fmtPercent(k.hookRate, 1)}</span>
              </div>
              <div>
                <span className="text-neutral-500">Comp</span>
                <span className="ml-1 text-neutral-200">{fmtPercent(k.completionRate, 1)}</span>
              </div>
              <div>
                <span className="text-neutral-500">Hold</span>
                <span className="ml-1 text-neutral-200">{fmtPercent(k.holdRate, 1)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#262626" }}
          />
          <YAxis
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#171717",
              border: "1px solid #262626",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#a3a3a3" }}
            formatter={(value: number, name: string) => {
              const ad = selectedAds.find((a) => a.adId === name)
              const label = ad?.adName || name
              return [`${value.toFixed(1)}%`, label.length > 30 ? label.slice(0, 27) + "..." : label]
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
            formatter={(value: string) => {
              const ad = selectedAds.find((a) => a.adId === value)
              const name = ad?.adName || value
              return name.length > 25 ? name.slice(0, 22) + "..." : name
            }}
          />
          {selectedAds.slice(0, 5).map((ad, i) => (
            <Area
              key={ad.adId}
              type="monotone"
              dataKey={ad.adId}
              name={ad.adId}
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
