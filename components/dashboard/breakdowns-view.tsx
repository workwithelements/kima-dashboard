"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { MetaDemographicsRow, MetaPlacementsRow } from "@/lib/utils/types"
import type { DatePreset } from "@/lib/utils/dates"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"
import { Card } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import DemographicsChart from "@/components/charts/demographics-chart"
import PlacementsChart from "@/components/charts/placements-chart"

type Props = {
  clientId: string
  demographics: MetaDemographicsRow[]
  placements: MetaPlacementsRow[]
  preset: DatePreset
  from: string
  to: string
}

type Tab = "demographics" | "placements"
type MetricKey = "spend" | "impressions" | "purchases"

const METRIC_OPTIONS: { value: MetricKey; label: string }[] = [
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "purchases", label: "Purchases" },
]

type DemoAgg = {
  spend: number
  impressions: number
  purchases: number
  purchase_value: number
  unique_link_clicks: number
}

export default function BreakdownsView({
  clientId,
  demographics,
  placements,
  preset,
  from,
  to,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("demographics")
  const [metric, setMetric] = useState<MetricKey>("spend")

  // Navigation
  function updateSearchParams(updates: Record<string, string>) {
    const params = new URLSearchParams()
    const merged = { preset, from, to, ...updates }
    for (const [key, val] of Object.entries(merged)) {
      if (val) params.set(key, val)
    }
    router.push(`/dashboard/clients/${clientId}/breakdowns?${params.toString()}`)
  }

  function handlePresetChange(p: DatePreset) {
    updateSearchParams({ preset: p, from: "", to: "" })
  }

  function handleCustomChange(newFrom: string, newTo: string) {
    updateSearchParams({ preset: "custom", from: newFrom, to: newTo })
  }

  // Demographics summary table
  const demoTable = useMemo(() => {
    const agg = new Map<string, DemoAgg>()

    for (const r of demographics) {
      const key = `${r.age}|${r.gender}`
      const existing = agg.get(key) || { spend: 0, impressions: 0, purchases: 0, purchase_value: 0, unique_link_clicks: 0 }
      existing.spend += r.spend || 0
      existing.impressions += r.impressions || 0
      existing.purchases += r.purchases || 0
      existing.purchase_value += r.purchase_value || 0
      existing.unique_link_clicks += r.unique_link_clicks || 0
      agg.set(key, existing)
    }

    return Array.from(agg.entries())
      .map(([key, vals]) => {
        const [age, gender] = key.split("|")
        const cpa = vals.purchases > 0 ? vals.spend / vals.purchases : null
        const roas = vals.spend > 0 ? vals.purchase_value / vals.spend : 0
        const ctr = vals.impressions > 0 ? (vals.unique_link_clicks / vals.impressions) * 100 : 0
        return { age, gender, ...vals, cpa, roas, ctr }
      })
      .sort((a, b) => b.spend - a.spend)
  }, [demographics])

  // Placements summary table
  const placementTable = useMemo(() => {
    const agg = new Map<string, DemoAgg & { platform: string; position: string }>()

    for (const r of placements) {
      const key = `${r.publisher_platform}|${r.platform_position}`
      const existing = agg.get(key) || {
        platform: r.publisher_platform,
        position: r.platform_position,
        spend: 0, impressions: 0, purchases: 0, purchase_value: 0, unique_link_clicks: 0,
      }
      existing.spend += r.spend || 0
      existing.impressions += r.impressions || 0
      existing.purchases += r.purchases || 0
      existing.purchase_value += r.purchase_value || 0
      existing.unique_link_clicks += r.unique_link_clicks || 0
      agg.set(key, existing)
    }

    return Array.from(agg.values())
      .map((vals) => {
        const cpm = vals.impressions > 0 ? (vals.spend / vals.impressions) * 1000 : 0
        const cpa = vals.purchases > 0 ? vals.spend / vals.purchases : null
        return { ...vals, cpm, cpa }
      })
      .sort((a, b) => b.spend - a.spend)
  }, [placements])

  const fmtPlatform = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Tabs */}
        <div className="flex rounded-lg border border-neutral-700 bg-neutral-800/50 p-0.5">
          {(["demographics", "placements"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === t
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {t === "demographics" ? "Demographics" : "Placements"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600"
          >
            {METRIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <DateRangePicker
            preset={preset}
            from={from}
            to={to}
            onPresetChange={handlePresetChange}
            onCustomChange={handleCustomChange}
          />
        </div>
      </div>

      {/* Demographics tab */}
      {tab === "demographics" && (
        <>
          {demographics.length === 0 ? (
            <Card>
              <p className="py-12 text-center text-sm text-neutral-500">
                No demographic data available. Run the demographics sync first.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <h2 className="mb-4 text-sm font-medium text-neutral-400">
                  {metric === "spend" ? "Spend" : metric === "impressions" ? "Impressions" : "Purchases"} by Age &amp; Gender
                </h2>
                <DemographicsChart rows={demographics} metric={metric} />
              </Card>

              <Card>
                <h2 className="mb-4 text-sm font-medium text-neutral-400">
                  Breakdown Table
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-800 text-neutral-500">
                        <th className="pb-2 pr-4 font-medium">Age</th>
                        <th className="pb-2 pr-4 font-medium">Gender</th>
                        <th className="pb-2 pr-4 font-medium text-right">Spend</th>
                        <th className="pb-2 pr-4 font-medium text-right">Impressions</th>
                        <th className="pb-2 pr-4 font-medium text-right">CTR</th>
                        <th className="pb-2 pr-4 font-medium text-right">Purchases</th>
                        <th className="pb-2 pr-4 font-medium text-right">CPA</th>
                        <th className="pb-2 font-medium text-right">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demoTable.map((row, i) => (
                        <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                          <td className="py-2 pr-4 text-neutral-300">{row.age}</td>
                          <td className="py-2 pr-4 capitalize text-neutral-300">{row.gender}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.spend)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.impressions)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtPercent(row.ctr)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.purchases)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{row.cpa !== null ? fmtCurrency(row.cpa) : "—"}</td>
                          <td className="py-2 text-right text-neutral-300">{row.roas.toFixed(2)}x</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}

      {/* Placements tab */}
      {tab === "placements" && (
        <>
          {placements.length === 0 ? (
            <Card>
              <p className="py-12 text-center text-sm text-neutral-500">
                No placement data available. Run the placements sync first.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-4 text-sm font-medium text-neutral-400">
                    {metric === "spend" ? "Spend" : metric === "impressions" ? "Impressions" : "Purchases"} by Platform
                  </h2>
                  <PlacementsChart rows={placements} groupBy="publisher_platform" metric={metric} />
                </Card>
                <Card>
                  <h2 className="mb-4 text-sm font-medium text-neutral-400">
                    {metric === "spend" ? "Spend" : metric === "impressions" ? "Impressions" : "Purchases"} by Position
                  </h2>
                  <PlacementsChart rows={placements} groupBy="platform_position" metric={metric} />
                </Card>
              </div>

              <Card>
                <h2 className="mb-4 text-sm font-medium text-neutral-400">
                  Placement Table
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-800 text-neutral-500">
                        <th className="pb-2 pr-4 font-medium">Platform</th>
                        <th className="pb-2 pr-4 font-medium">Position</th>
                        <th className="pb-2 pr-4 font-medium text-right">Spend</th>
                        <th className="pb-2 pr-4 font-medium text-right">Impressions</th>
                        <th className="pb-2 pr-4 font-medium text-right">CPM</th>
                        <th className="pb-2 pr-4 font-medium text-right">Purchases</th>
                        <th className="pb-2 font-medium text-right">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {placementTable.map((row, i) => (
                        <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                          <td className="py-2 pr-4 text-neutral-300">{fmtPlatform(row.platform)}</td>
                          <td className="py-2 pr-4 text-neutral-300">{fmtPlatform(row.position)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.spend)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.impressions)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtCurrency(row.cpm)}</td>
                          <td className="py-2 pr-4 text-right text-neutral-300">{fmtNumber(row.purchases)}</td>
                          <td className="py-2 text-right text-neutral-300">{row.cpa !== null ? fmtCurrency(row.cpa) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
