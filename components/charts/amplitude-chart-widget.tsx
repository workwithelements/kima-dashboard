"use client"

import { useEffect, useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import type { NormalisedAmplitudeChart } from "@/lib/data/fetch-amplitude-data"

type Props = {
  clientId: string
  chartId: string
  title?: string
  height?: number
}

const SERIES_COLORS = ["#CDFF00", "#60A5FA", "#F472B6", "#FBBF24", "#A78BFA", "#34D399"]

export default function AmplitudeChartWidget({
  clientId,
  chartId,
  title,
  height = 280,
}: Props) {
  const [data, setData] = useState<NormalisedAmplitudeChart | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/clients/${clientId}/amplitude/chart/${chartId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as NormalisedAmplitudeChart
      })
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId, chartId])

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-100">
          {title || "Amplitude Chart"}
        </h3>
        <a
          href={`https://app.amplitude.com/analytics/chart/${chartId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          Open in Amplitude →
        </a>
      </div>

      {loading && (
        <div className="flex items-center justify-center" style={{ height }}>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
        </div>
      )}

      {!loading && error && (
        <div
          className="flex items-center justify-center text-xs text-neutral-500"
          style={{ height }}
        >
          Couldn&apos;t load chart ({error})
        </div>
      )}

      {!loading && !error && data && data.points.length === 0 && (
        <div
          className="flex items-center justify-center text-xs text-neutral-500"
          style={{ height }}
        >
          No data returned for chart {chartId}
        </div>
      )}

      {!loading && !error && data && data.points.length > 0 && (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data.points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis
              dataKey="x"
              tick={{ fill: "#737373", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#262626" }}
            />
            <YAxis
              tick={{ fill: "#737373", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
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
                const idx = Number(name.replace("series_", ""))
                const label = data.seriesLabels[idx] ?? name
                return [value, label]
              }}
            />
            {data.seriesLabels.length > 1 && (
              <Legend
                wrapperStyle={{ fontSize: "11px", color: "#a3a3a3" }}
                formatter={(value: string) => {
                  const idx = Number(value.replace("series_", ""))
                  return data.seriesLabels[idx] ?? value
                }}
              />
            )}
            {data.seriesLabels.map((_, i) => (
              <Line
                key={i}
                type="monotone"
                dataKey={`series_${i}`}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
