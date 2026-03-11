export const dynamic = "force-dynamic"

import { createServiceClient } from "@/lib/supabase/server"
import { Card, MetricCard } from "@/components/ui/card"
import SpendChart from "@/components/charts/spend-chart"
import ClientsOverviewTable from "@/components/tables/clients-overview-table"
import { aggregateMetrics, deriveMetrics, dailySpendSeries } from "@/lib/utils/aggregate"
import { fmtCurrency, fmtNumber, fmtRoas } from "@/lib/utils/format"
import { getPresetRange } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import { FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"
import OverviewDatePicker from "@/components/ui/overview-date-picker"

type Props = {
  searchParams: {
    preset?: string
    from?: string
    to?: string
  }
}

export default async function DashboardPage({ searchParams }: Props) {
  const supabase = createServiceClient()

  // Resolve date range from search params — default to this_month
  const preset = (searchParams.preset || "this_month") as DatePreset
  const range = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  const fromDate = range.from
  const toDate = range.to

  // Fetch clients, scorecard configs, and performance data in parallel
  const [clientsResult, configResult, perfResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug")
      .eq("active", true)
      .order("name"),
    supabase
      .from("client_scorecard_config")
      .select("client_id, funnel_steps"),
    supabase
      .from("meta_daily_performance")
      .select(
        "date, client_id, spend, impressions, reach, unique_link_clicks, landing_page_views, adds_to_cart, registrations_completed, checkouts_initiated, purchases, purchase_value, app_installs"
      )
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date"),
  ])

  const clients = clientsResult.data || []
  const configs = configResult.data || []
  const allRows = perfResult.data || []

  // Build config map: client_id → first funnel step key (the "key action")
  const keyActionMap: Record<string, string | null> = {}
  for (const cfg of configs) {
    const steps = cfg.funnel_steps as string[] | null
    keyActionMap[cfg.client_id] = steps?.[0] || null
  }

  // Totals for KPI cards (same date range as chart)
  const totals = aggregateMetrics(allRows)
  const derived = deriveMetrics(totals)
  const cpmr = totals.reach > 0 ? (totals.spend / totals.reach) * 1000 : 0

  // Spend chart data
  const spendData = dailySpendSeries(allRows, fromDate, toDate)

  // Per-client aggregation (spend + all funnel step columns)
  const STEP_COLS = [
    "unique_link_clicks",
    "landing_page_views",
    "adds_to_cart",
    "registrations_completed",
    "checkouts_initiated",
    "purchases",
    "app_installs",
  ] as const

  const clientAgg: Record<string, Record<string, number>> = {}
  for (const row of allRows) {
    const cid = row.client_id
    if (!cid) continue
    if (!clientAgg[cid]) clientAgg[cid] = { spend: 0 }
    clientAgg[cid].spend += row.spend || 0
    for (const col of STEP_COLS) {
      clientAgg[cid][col] = (clientAgg[cid][col] || 0) + ((row as Record<string, any>)[col] || 0)
    }
  }

  // Per-client daily spend for sparklines
  const clientDailySpend: Record<string, Record<string, number>> = {}
  for (const row of allRows) {
    const cid = row.client_id
    if (!cid) continue
    if (!clientDailySpend[cid]) clientDailySpend[cid] = {}
    clientDailySpend[cid][row.date] = (clientDailySpend[cid][row.date] || 0) + (row.spend || 0)
  }

  // Build client rows for the table
  const clientRows = clients.map((c) => {
    const agg = clientAgg[c.id] || {}
    const spend = agg.spend || 0

    // Key action from scorecard config
    const keyActionKey = keyActionMap[c.id] || null
    const keyActionDef = keyActionKey ? FUNNEL_STEP_DEFS[keyActionKey] : null
    const keyActionCount = keyActionKey ? (agg[keyActionKey] || 0) : 0
    const costPerKeyAction = keyActionCount > 0 ? spend / keyActionCount : 0

    // Build sparkline data (sorted daily spend)
    const dailyMap = clientDailySpend[c.id] || {}
    const dailySpend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)

    return {
      id: c.id,
      name: c.name,
      spend,
      dailySpend,
      keyActionLabel: keyActionDef?.label || null,
      keyActionCount,
      costPerKeyAction,
    }
  })

  // Preset label for subtitle
  const presetLabels: Record<string, string> = {
    today: "Today",
    last_7d: "Last 7 days",
    last_30d: "Last 30 days",
    this_month: "Month to date",
    last_month: "Last month",
  }
  const rangeLabel = presetLabels[preset] || `${fromDate} — ${toDate}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-neutral-400">
            {rangeLabel} &middot; All clients &middot; Meta Ads
          </p>
        </div>
        <OverviewDatePicker preset={preset} />
      </div>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Total Spend" value={fmtCurrency(totals.spend)} />
        <MetricCard label="Total Revenue" value={fmtCurrency(totals.revenue)} />
        <MetricCard label="ROAS" value={fmtRoas(derived.roas)} />
        <MetricCard label="Purchases" value={fmtNumber(totals.purchases)} />
        <MetricCard
          label="CPMr"
          value={fmtCurrency(cpmr)}
          subValue="Cost per 1k reach"
        />
        <MetricCard label="Impressions" value={fmtNumber(totals.impressions)} />
      </div>

      {/* Spend chart */}
      <Card>
        <h2 className="mb-4 text-sm font-medium text-neutral-400">
          Daily Spend
        </h2>
        <SpendChart data={spendData} />
      </Card>

      {/* Clients table */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-400">
            Client Performance ({clients.length})
          </h2>
        </div>
        <ClientsOverviewTable clients={clientRows} />
      </Card>
    </div>
  )
}
