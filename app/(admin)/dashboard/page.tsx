import { createClient } from "@/lib/supabase/server"
import { Card, MetricCard } from "@/components/ui/card"
import SpendChart from "@/components/charts/spend-chart"

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: decimals })
}

function fmtCurrency(n: number) {
  return `$${fmt(n, 2)}`
}

export default async function DashboardPage() {
  const supabase = createClient()

  // Fetch all clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .eq("active", true)
    .order("name")

  // Fetch last 30 days of Meta data across all clients
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const fromDate = thirtyDaysAgo.toISOString().split("T")[0]

  const { data: metaRows } = await supabase
    .from("meta_daily_performance")
    .select("date, spend, impressions, unique_link_clicks, purchases, purchase_value")
    .gte("date", fromDate)
    .order("date")

  // Aggregate totals
  const totals = (metaRows || []).reduce(
    (acc, row) => ({
      spend: acc.spend + (row.spend || 0),
      impressions: acc.impressions + (row.impressions || 0),
      clicks: acc.clicks + (row.unique_link_clicks || 0),
      purchases: acc.purchases + (row.purchases || 0),
      revenue: acc.revenue + (row.purchase_value || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 }
  )

  // Daily spend for chart
  const dailySpend = Object.entries(
    (metaRows || []).reduce<Record<string, number>>((acc, row) => {
      acc[row.date] = (acc[row.date] || 0) + (row.spend || 0)
      return acc
    }, {})
  )
    .map(([date, spend]) => ({ date, spend: Math.round(spend * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-neutral-400">
          Last 30 days &middot; All clients &middot; Meta Ads
        </p>
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

      <Card>
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          Active Clients ({clients?.length || 0})
        </h2>
        <div className="flex flex-wrap gap-2">
          {(clients || []).map((c) => (
            <span
              key={c.id}
              className="rounded-full bg-brand-lime/10 px-3 py-1 text-xs text-brand-lime"
            >
              {c.name}
            </span>
          ))}
        </div>
      </Card>
    </div>
  )
}
