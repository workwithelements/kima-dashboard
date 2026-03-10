import { createServiceClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { monthStart, today, daysAgo } from "@/lib/utils/dates"
import { dailySpendSeries } from "@/lib/utils/aggregate"
import { calculatePacing } from "@/lib/utils/pacing"
import { fetchConsolidatedSpend, consolidateDailySpend } from "@/lib/data/fetch-client-data"
import PacingCard from "@/components/dashboard/pacing-card"
import { Card, MetricCard } from "@/components/ui/card"
import MetricChart from "@/components/charts/metric-chart"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"

type Props = {
  params: { id: string }
}

export default async function ClientPacingPage({ params }: Props) {
  const supabase = createServiceClient()

  // Fetch client
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, monthly_budget, currency_code")
    .eq("id", params.id)
    .single()

  if (!client) notFound()

  const currency = (client as any).currency_code ?? "GBP"
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  // Fetch consolidated spend (Meta + Google Ads) for current month + historical
  const [currentMonthSpend, historicalSpend] = await Promise.all([
    fetchConsolidatedSpend(params.id, monthStart(), today()),
    fetchConsolidatedSpend(params.id, daysAgo(90), today()),
  ])

  const dailySpend = consolidateDailySpend(currentMonthSpend)
  const historicalDaily = consolidateDailySpend(historicalSpend)

  // Calculate pacing
  const pacing = calculatePacing(
    dailySpend,
    client.monthly_budget || null,
    year,
    month,
    historicalDaily
  )

  // Build daily spend chart data for the current month
  const spendChartData = dailySpend.map((d) => ({ date: d.date, value: d.spend }))

  // Cumulative spend series
  let cumulative = 0
  const cumulativeSeries = dailySpend.map((d) => {
    cumulative += d.spend
    return { date: d.date, value: Math.round(cumulative * 100) / 100 }
  })

  return (
    <div className="space-y-6">
      {/* Pacing card */}
      <PacingCard pacing={pacing} currency={currency} />

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Daily Spend (This Month)
          </h2>
          <MetricChart
            data={spendChartData}
            label="Spend"
            color="#CDFF00"
            format="currency"
            currency={currency}
            height={260}
          />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">
            Cumulative Spend
          </h2>
          <MetricChart
            data={cumulativeSeries}
            label="Cumulative Spend"
            color="#FF69B4"
            format="currency"
            currency={currency}
            height={260}
          />
        </Card>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Days Elapsed"
          value={`${pacing.daysElapsed} / ${pacing.daysTotal}`}
          subValue={`${pacing.daysRemaining} remaining`}
        />
        <MetricCard
          label="Avg Daily Spend"
          value={fmtCurrency(pacing.daysElapsed > 0 ? pacing.spentToDate / pacing.daysElapsed : 0, currency)}
          subValue={pacing.idealDailySpend ? `Ideal: ${fmtCurrency(pacing.idealDailySpend, currency)}` : undefined}
        />
        <MetricCard
          label="Remaining Projected"
          value={fmtCurrency(pacing.remainingProjected, currency)}
        />
        <MetricCard
          label="Spend Days"
          value={fmtNumber(dailySpend.filter((d) => d.spend > 0).length)}
          subValue={`of ${pacing.daysElapsed} elapsed`}
        />
      </div>

      {/* Info about budget */}
      {!client.monthly_budget && (
        <Card className="border-amber-900/50 bg-amber-950/20">
          <div className="flex items-start gap-3">
            <span className="text-amber-500">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-400">No budget set</p>
              <p className="mt-1 text-xs text-neutral-400">
                Set a monthly budget for this client in the Settings page to enable pacing projections and alerts.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
