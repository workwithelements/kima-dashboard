"use client"

import { useMemo, useState } from "react"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { MetaDailyRow, GoogleAdsDailyRow } from "@/lib/utils/types"
import { fmtCurrency } from "@/lib/utils/format"

type BreakdownLevel = "campaign" | "adset" | "ad_group"

type Props = {
  metaRows: Partial<MetaDailyRow>[]
  googleAdsRows: Partial<GoogleAdsDailyRow>[]
  platform: "meta" | "google_ads" | "all"
  currency?: string
}

const COLORS = [
  "#CDFF00", "#3b82f6", "#f59e0b", "#ef4444", "#22c55e",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16",
  "#6366f1", "#14b8a6",
]

export default function SpendBreakdownPie({
  metaRows,
  googleAdsRows,
  platform,
  currency = "USD",
}: Props) {
  const isMeta = platform === "meta"
  const isGoogleAds = platform === "google_ads"

  // Available levels depend on platform
  const levelOptions: { key: BreakdownLevel; label: string }[] = useMemo(() => {
    if (isGoogleAds) {
      return [
        { key: "campaign", label: "Campaign" },
        { key: "ad_group", label: "Ad Group" },
      ]
    }
    if (isMeta) {
      return [
        { key: "campaign", label: "Campaign" },
        { key: "adset", label: "Ad Set" },
      ]
    }
    // "all" — only campaign makes sense across platforms
    return [{ key: "campaign", label: "Campaign" }]
  }, [platform])

  const [level, setLevel] = useState<BreakdownLevel>("campaign")

  const data = useMemo(() => {
    const map = new Map<string, { name: string; spend: number }>()

    // Meta rows
    if (!isGoogleAds) {
      for (const r of metaRows) {
        let id: string | undefined
        let name: string | undefined
        if (level === "campaign") {
          id = r.campaign_id; name = r.campaign_name
        } else if (level === "adset") {
          id = r.adset_id; name = r.adset_name
        }
        if (!id) continue
        const prev = map.get(id)
        map.set(id, {
          name: name || id,
          spend: (prev?.spend || 0) + (r.spend || 0),
        })
      }
    }

    // Google Ads rows
    if (!isMeta) {
      for (const r of googleAdsRows) {
        let id: string | undefined
        let name: string | undefined
        if (level === "campaign") {
          id = r.campaign_id; name = r.campaign_name
        } else if (level === "ad_group") {
          id = r.ad_group_id; name = r.ad_group_name
        }
        if (!id) continue
        const prev = map.get(id)
        map.set(id, {
          name: name || id,
          spend: (prev?.spend || 0) + (r.spend || 0),
        })
      }
    }

    // Sort by spend descending, top 10 + Other
    const sorted = Array.from(map.values())
      .filter((d) => d.spend > 0)
      .sort((a, b) => b.spend - a.spend)

    const top = sorted.slice(0, 10)
    const otherSpend = sorted.slice(10).reduce((s, d) => s + d.spend, 0)
    if (otherSpend > 0) {
      top.push({ name: "Other", spend: otherSpend })
    }

    const total = top.reduce((s, d) => s + d.spend, 0)
    return top.map((d) => ({
      name: d.name,
      value: d.spend,
      pct: total > 0 ? (d.spend / total) * 100 : 0,
    }))
  }, [metaRows, googleAdsRows, platform, level])

  if (data.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-xs text-neutral-500">
        No spend data
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Level toggle */}
      {levelOptions.length > 1 && (
        <div className="mb-3 flex gap-1">
          {levelOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setLevel(opt.key)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition ${
                level === opt.key
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Pie chart */}
      <div className="flex-1" style={{ minHeight: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="75%"
              paddingAngle={1}
              strokeWidth={0}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload
                return (
                  <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-xl">
                    <p className="mb-1 text-neutral-300">{d.name}</p>
                    <p className="text-white">
                      {fmtCurrency(d.value, currency)} ({d.pct.toFixed(1)}%)
                    </p>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="min-w-0 truncate text-neutral-400" title={d.name}>
              {d.name}
            </span>
            <span className="ml-auto shrink-0 text-neutral-500">
              {d.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
