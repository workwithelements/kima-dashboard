import { createServiceClient } from "@/lib/supabase/server"
import { Card, MetricCard } from "@/components/ui/card"
import SpendChart from "@/components/charts/spend-chart"
import ClientsOverviewTable from "@/components/tables/clients-overview-table"
import { aggregateMetrics, deriveMetrics, dailySpendSeries } from "@/lib/utils/aggregate"
import { fmtCurrency, fmtNumber, fmtPercent, fmtRoas } from "@/lib/utils/format"
import { daysAgo, today } from "@/lib/utils/dates"

export default async function DashboardPage() {
  const supabase = createServiceClient()

  // Fetch all clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, slug")
    .eq("active", true)
    .order("name")

  // Fetch last 30 days of Meta data across all clients
  const fromDate = daysAgo(29)
  const toDate = today()

  const { data: metaRows } = await supabase
    .from("meta_daily_performance")
    .select(
      "date, client_id, spend, impressions, reach, unique_link_clicks, landing_page_views, adds_to_cart, registrations_completed, checkouts_initiated, purchases, purchase_value, app_installs"
    )
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date")

  const rows = metaRows || []
  const totals = aggregateMetrics(rows)
  const derived = deriveMetrics(totals)
  const spendData = dailySpendSeries(rows)

  // Build per-client summary for the table
  const clientSpend: Record<string, { spend: number; impressions: number; purchases: number; revenue: number }> = {}
  for (const row of rows) {
    const cid = row.client_id
    if (!cid) continue
    if (!clientSpend[cid]) clientSpend[cid] = { spend: 0, impressions: 0, purchases: 0, revenue: 0 }
    clientSpend[cid].spend += row.spend || 0
    clientSpend[cid].impressions += row.impressions || 0
    clientSpend[cid].purchases += row.purchases || 0
    clientSpend[cid].revenue += row.purchase_value || 0
  }

  const clientRows = (clients || []).map((c) => ({
    id: c.id,
    name: c.name,
    spend: clientSpend[c.id]?.spend || 0,
    impressions: clientSpend[c.id]?.impressions || 0,
    purchases: clientSpend[c.id]?.purchases || 0,
    revenue: clientSpend[c.id]?.revenue || 0,
    roas: (clientSpend[c.id]?.spend || 0) > 0
      ? (clientSpend[c.id]?.revenue || 0) / (clientSpend[c.id]?.spend || 0)
      : 0,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-neutral-400">
          Last 30 days &middot; All clients &middot; Meta Ads
        </p>
      </div>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Total Spend" value={fmtCurrency(totals.spend)} />
        <MetricCard label="Total Revenue" value={fmtCurrency(totals.revenue)} />
        <MetricCard
          label="ROAS"
          value={fmtRoas(derived.roas)}
        />
        <MetricCard label="Purchases" value={fmtNumber(totals.purchases)} />
        <MetricCard label="Impressions" value={fmtNumber(totals.impressions)} />
      </div>

      {/* Spend chart */}
      <Card>
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Spend (All Clients)</h2>
        <SpendChart data={spendData} />
      </Card>

      {/* Clients table */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-400">
            Client Performance ({clients?.length || 0})
          </h2>
        </div>
        <ClientsOverviewTable clients={clientRows} />
      </Card>
    </div>
  )
}
