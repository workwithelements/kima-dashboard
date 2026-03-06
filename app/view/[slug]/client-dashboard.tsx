"use client"

import { Card, MetricCard } from "@/components/ui/card"
import SpendChart from "@/components/charts/spend-chart"

type Row = {
  date: string
  spend: number
  impressions: number
  unique_link_clicks: number
  purchases: number
  purchase_value: number
}

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: decimals })
}

function fmtCurrency(n: number) {
  return `$${fmt(n, 2)}`
}

export default function ClientDashboard({
  clientName,
  data,
}: {
  clientName: string
  data: Row[]
}) {
  const totals = data.reduce(
    (acc, row) => ({
      spend: acc.spend + (row.spend || 0),
      impressions: acc.impressions + (row.impressions || 0),
      clicks: acc.clicks + (row.unique_link_clicks || 0),
      purchases: acc.purchases + (row.purchases || 0),
      revenue: acc.revenue + (row.purchase_value || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 }
  )

  const dailySpend = Object.entries(
    data.reduce<Record<string, number>>((acc, row) => {
      acc[row.date] = (acc[row.date] || 0) + (row.spend || 0)
      return acc
    }, {})
  )
    .map(([date, spend]) => ({ date, spend: Math.round(spend * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0

  return (
    <div className="min-h-screen bg-black p-6 lg:p-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{clientName}</h1>
            <p className="text-sm text-neutral-400">Last 30 days &middot; Meta Ads</p>
          </div>
          <span className="text-sm text-neutral-600">
            <span className="text-brand-lime">X</span> elements
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <MetricCard label="Spend" value={fmtCurrency(totals.spend)} />
          <MetricCard label="Impressions" value={fmt(totals.impressions)} />
          <MetricCard label="Clicks" value={fmt(totals.clicks)} />
          <MetricCard label="Purchases" value={fmt(totals.purchases)} />
          <MetricCard
            label="ROAS"
            value={`${roas.toFixed(2)}x`}
            subValue={`Revenue: ${fmtCurrency(totals.revenue)}`}
          />
        </div>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Spend</h2>
          <SpendChart data={dailySpend} />
        </Card>
      </div>
    </div>
  )
}
