"use client"

import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"
import {
  CLASSIFICATIONS,
  type ClassifiedAd,
} from "@/lib/utils/creative-classification"
import {
  type AdDimension,
  type ParsedAdName,
  DIMENSION_LABELS,
  getAvailableDimensions,
} from "@/lib/utils/ad-name-parser"

type Props = {
  classifiedAds: ClassifiedAd[]
}

type GroupRow = {
  value: string
  adCount: number
  totalSpend: number
  totalConversions: number
  totalRevenue: number
  avgCpa: number | null
  avgCvr: number
  winners: number
  losers: number
}

export default function CreativeGroupingView({ classifiedAds }: Props) {
  // Get available dimensions from parsed ads
  const availableDimensions = useMemo(() => {
    const parsed = classifiedAds
      .map((a) => a.parsed)
      .filter((p): p is ParsedAdName => p !== undefined)
    return getAvailableDimensions(parsed)
  }, [classifiedAds])

  const [selectedDimension, setSelectedDimension] = useState<AdDimension>(
    () => availableDimensions[0] || "format"
  )

  // Group ads by the selected dimension
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        ads: ClassifiedAd[]
        spend: number
        conversions: number
        revenue: number
      }
    >()

    for (const ad of classifiedAds) {
      const val = ad.parsed?.[selectedDimension] || "Unknown"
      const existing = map.get(val)
      if (existing) {
        existing.ads.push(ad)
        existing.spend += ad.spend
        existing.conversions += ad.conversions
        existing.revenue += ad.revenue
      } else {
        map.set(val, {
          ads: [ad],
          spend: ad.spend,
          conversions: ad.conversions,
          revenue: ad.revenue,
        })
      }
    }

    const rows: GroupRow[] = []
    map.forEach((group, value) => {
      const totalImpressions = group.ads.reduce(
        (s, a) => s + a.impressions,
        0
      )
      const winners = group.ads.filter(
        (a) =>
          a.classification.type === "DIRECT_WINNER" ||
          a.classification.type === "INDIRECT_WINNER"
      ).length
      const losers = group.ads.filter(
        (a) =>
          a.classification.type === "LOSER" ||
          a.classification.type === "LOSER_NON_CONTRIBUTING"
      ).length

      rows.push({
        value,
        adCount: group.ads.length,
        totalSpend: group.spend,
        totalConversions: group.conversions,
        totalRevenue: group.revenue,
        avgCpa:
          group.conversions > 0 ? group.spend / group.conversions : null,
        avgCvr:
          totalImpressions > 0
            ? (group.conversions / totalImpressions) * 100
            : 0,
        winners,
        losers,
      })
    })

    // Sort by spend descending
    rows.sort((a, b) => b.totalSpend - a.totalSpend)
    return rows
  }, [classifiedAds, selectedDimension])

  if (availableDimensions.length === 0) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-neutral-500">
          No structured naming convention detected. Ad names need
          underscore-delimited fields for dimension grouping.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-400">
          Performance by Dimension
        </h2>
        <select
          value={selectedDimension}
          onChange={(e) =>
            setSelectedDimension(e.target.value as AdDimension)
          }
          className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 focus:border-brand-lime focus:outline-none"
        >
          {availableDimensions.map((dim) => (
            <option key={dim} value={dim}>
              {DIMENSION_LABELS[dim]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500">
              <th className="py-2 pr-3 font-medium">
                {DIMENSION_LABELS[selectedDimension]}
              </th>
              <th className="py-2 pr-3 font-medium text-right">Ads</th>
              <th className="py-2 pr-3 font-medium text-right">Spend</th>
              <th className="py-2 pr-3 font-medium text-right">Conv.</th>
              <th className="py-2 pr-3 font-medium text-right">CPA</th>
              <th className="py-2 pr-3 font-medium text-right">CVR</th>
              <th className="py-2 pr-3 font-medium text-right">Revenue</th>
              <th className="py-2 pr-3 font-medium text-right">Winners</th>
              <th className="py-2 font-medium text-right">Losers</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.value}
                className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
              >
                <td className="py-2.5 pr-3 font-medium text-neutral-200">
                  {g.value}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                  {g.adCount}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-200">
                  {fmtCurrency(g.totalSpend)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                  {fmtNumber(g.totalConversions)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                  {g.avgCpa !== null ? fmtCurrency(g.avgCpa) : "—"}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
                  {fmtPercent(g.avgCvr, 2)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-200">
                  {fmtCurrency(g.totalRevenue)}
                </td>
                <td className="py-2.5 pr-3 text-right">
                  {g.winners > 0 && (
                    <span className="inline-block rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                      {g.winners}
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  {g.losers > 0 && (
                    <span className="inline-block rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                      {g.losers}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="py-8 text-center text-neutral-500"
                >
                  No data for this dimension.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
