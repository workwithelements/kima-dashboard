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
  compMetaRows?: Partial<MetaDailyRow>[]
  compGoogleAdsRows?: Partial<GoogleAdsDailyRow>[]
  platform: "meta" | "google_ads" | "all"
  currency?: string
}

// Elements brand palette — lime first, then complementary tones
const COLORS = [
  "#CDFF00", // brand lime
  "#FF69B4", // brand pink
  "#1A1A4E", // brand navy
  "#3b82f6",
  "#f59e0b",
  "#22c55e",
  "#a855f7",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#6366f1",
  "#14b8a6",
]

function buildSpendMap(
  metaRows: Partial<MetaDailyRow>[],
  googleAdsRows: Partial<GoogleAdsDailyRow>[],
  isMeta: boolean,
  isGoogleAds: boolean,
  level: BreakdownLevel
) {
  const map = new Map<string, { name: string; spend: number }>()

  if (!isGoogleAds) {
    for (const r of metaRows) {
      let id: string | undefined
      let name: string | undefined
      if (level === "campaign") { id = r.campaign_id; name = r.campaign_name }
      else if (level === "adset") { id = r.adset_id; name = r.adset_name }
      if (!id) continue
      const prev = map.get(id)
      map.set(id, { name: name || id, spend: (prev?.spend || 0) + (r.spend || 0) })
    }
  }

  if (!isMeta) {
    for (const r of googleAdsRows) {
      let id: string | undefined
      let name: string | undefined
      if (level === "campaign") { id = r.campaign_id; name = r.campaign_name }
      else if (level === "ad_group") { id = r.ad_group_id; name = r.ad_group_name }
      if (!id) continue
      const prev = map.get(id)
      map.set(id, { name: name || id, spend: (prev?.spend || 0) + (r.spend || 0) })
    }
  }

  return map
}

export default function SpendBreakdownPie({
  metaRows,
  googleAdsRows,
  compMetaRows = [],
  compGoogleAdsRows = [],
  platform,
  currency = "USD",
}: Props) {
  const isMeta = platform === "meta"
  const isGoogleAds = platform === "google_ads"

  const levelOptions: { key: BreakdownLevel; label: string }[] = useMemo(() => {
    if (isGoogleAds) return [
      { key: "campaign", label: "Campaign" },
      { key: "ad_group", label: "Ad Group" },
    ]
    if (isMeta) return [
      { key: "campaign", label: "Campaign" },
      { key: "adset", label: "Ad Set" },
    ]
    return [{ key: "campaign", label: "Campaign" }]
  }, [platform])

  const [level, setLevel] = useState<BreakdownLevel>("campaign")

  // Current period data
  const data = useMemo(() => {
    const map = buildSpendMap(metaRows, googleAdsRows, isMeta, isGoogleAds, level)

    const entries: { id: string; name: string; spend: number }[] = []
    map.forEach((d, id) => { if (d.spend > 0) entries.push({ id, name: d.name, spend: d.spend }) })
    entries.sort((a, b) => b.spend - a.spend)

    const top = entries.slice(0, 10)
    const otherSpend = entries.slice(10).reduce((s, d) => s + d.spend, 0)

    const items = top.map((d) => ({ id: d.id, name: d.name, spend: d.spend }))
    if (otherSpend > 0) items.push({ id: "__other__", name: "Other", spend: otherSpend })

    const total = items.reduce((s, d) => s + d.spend, 0)
    return items.map((d) => ({
      ...d,
      value: d.spend,
      pct: total > 0 ? (d.spend / total) * 100 : 0,
    }))
  }, [metaRows, googleAdsRows, platform, level])

  // Comparison period spend by id (for delta in tooltip)
  const compSpendById = useMemo(() => {
    if (compMetaRows.length === 0 && compGoogleAdsRows.length === 0) return null
    const map = buildSpendMap(compMetaRows, compGoogleAdsRows, isMeta, isGoogleAds, level)
    const result = new Map<string, number>()
    map.forEach((d, id) => result.set(id, d.spend))
    return result
  }, [compMetaRows, compGoogleAdsRows, platform, level])

  if (data.length === 0) {
    return (
      <p className="flex items-center justify-center py-8 text-xs text-neutral-500">
        No spend data
      </p>
    )
  }

  return (
    <div>
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

      {/* Pie chart — fixed height */}
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={85}
            paddingAngle={1}
            strokeWidth={0}
            label={({ pct }) => `${pct.toFixed(0)}%`}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              const compSpend = compSpendById?.get(d.id)
              return (
                <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-xl">
                  <p className="mb-1 max-w-[200px] text-neutral-300">{d.name}</p>
                  <p className="font-medium text-white">{fmtCurrency(d.value, currency)}</p>
                  {compSpend !== undefined && compSpend > 0 && (() => {
                    const pct = ((d.value - compSpend) / Math.abs(compSpend)) * 100
                    const sign = pct >= 0 ? "+" : ""
                    return (
                      <p className="mt-0.5">
                        <span className={pct > 0 ? "text-green-400" : pct < 0 ? "text-red-400" : "text-neutral-400"}>
                          {sign}{pct.toFixed(1)}%
                        </span>
                        <span className="ml-1 text-neutral-500">vs prev</span>
                      </p>
                    )
                  })()}
                  {compSpend !== undefined && compSpend === 0 && (
                    <p className="mt-0.5 text-neutral-500">New this period</p>
                  )}
                </div>
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-3 max-h-28 space-y-0.5 overflow-y-auto">
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
