"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import Logo from "@/components/ui/logo"
import ClientPerformanceView from "@/components/dashboard/client-performance-view"
import ReachAnalysisView from "@/components/dashboard/reach-analysis-view"
import PacingCard from "@/components/dashboard/pacing-card"
import AdditionalSpendList from "@/components/dashboard/additional-spend-list"
import { Card, MetricCard } from "@/components/ui/card"
import MetricChart from "@/components/charts/metric-chart"
import DateRangePicker from "@/components/ui/date-range-picker"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import { getPresetRange } from "@/lib/utils/dates"
import type { PacingResult } from "@/lib/utils/pacing"
import type { DatePreset } from "@/lib/utils/dates"
import type { ComparisonType, Client } from "@/lib/utils/types"
import type { Annotation } from "@/components/ui/annotations-bar"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"
import type { MetaDemographicsRow, MetaPlacementsRow, MetaDailyRow, GoogleAdsDailyRow, ShopifyDailyOrdersRow, ShopifyAttributionRow, AdditionalSpendEntry } from "@/lib/utils/types"
import type { FunnelView } from "@/lib/utils/funnel-views"

type Tab = "performance" | "pacing" | "reach"

const TABS: { label: string; value: Tab }[] = [
  { label: "Performance", value: "performance" },
  { label: "Budget & Pacing", value: "pacing" },
  { label: "Reach Analysis", value: "reach" },
]

type Props = {
  client: Client
  tab: string
  preset: DatePreset
  from: string
  to: string
  compareType: ComparisonType
  /* Performance */
  perfRows: Partial<MetaDailyRow>[]
  perfComparisonRows: Partial<MetaDailyRow>[]
  googleAdsRows?: Partial<GoogleAdsDailyRow>[]
  googleAdsComparisonRows?: Partial<GoogleAdsDailyRow>[]
  baselineReach: number
  lifetimeSpend: number
  lifetimeReach: number
  funnelSteps: string[] | null
  keyAction: string | null
  funnelViews: FunnelView[]
  activeFunnelViewId: string | null
  contributionMarginPct: number | null
  demographics: MetaDemographicsRow[]
  placements: MetaPlacementsRow[]
  annotations: Annotation[]
  namingConfig?: NamingConfig
  createdDates: Record<string, string>
  /* Shopify */
  shopifyOrders?: ShopifyDailyOrdersRow[]
  shopifyAttribution?: ShopifyAttributionRow[]
  shopifyCompOrders?: ShopifyDailyOrdersRow[]
  shopifyCompAttribution?: ShopifyAttributionRow[]
  /* Creative — thumbnails feed the Performance grid */
  thumbnails: Record<string, string>
  previewsEnabled: boolean
  /* Reach */
  reachRows: { date: string; reach: number; impressions: number; spend?: number; adset_id?: string; adset_name?: string }[]
  reachBaselineReach: number
  reachComparisonRows: { date: string; reach: number; impressions: number; spend?: number }[]
  reachLifetimeRows: { date: string; reach: number; impressions: number; spend?: number; adset_id?: string; adset_name?: string }[]
  /* Pacing */
  pacing: PacingResult
  monthlyBudget: number | null
  currentMonthDailySpend: { date: string; spend: number }[]
  additionalSpendEntries: AdditionalSpendEntry[]
}

export default function ClientDashboard(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const activeTab = (
    props.tab === "pacing" ? "pacing" :
    props.tab === "reach" ? "reach" :
    "performance"
  ) as Tab

  function handleTabChange(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    router.push(`${pathname}?${params.toString()}`)
  }

  function handlePresetChange(preset: DatePreset) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("preset", preset)
    params.delete("from")
    params.delete("to")
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleCustomDateChange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("preset", "custom")
    params.set("from", from)
    params.set("to", to)
    router.push(`${pathname}?${params.toString()}`)
  }

  const currency = props.client.currency_code ?? "GBP"

  // Pacing chart data
  const pacingSpendChartData = props.currentMonthDailySpend.map((d) => ({
    date: d.date,
    value: d.spend,
  }))

  let cumulative = 0
  const cumulativeSeries = props.currentMonthDailySpend.map((d) => {
    cumulative += d.spend
    return { date: d.date, value: Math.round(cumulative * 100) / 100 }
  })

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Logo className="text-white" />
            <div className="h-6 w-px bg-neutral-700" />
            <h1 className="text-lg font-semibold">{props.client.name}</h1>
          </div>
          <DateRangePicker
            preset={props.preset}
            from={props.from}
            to={props.to}
            onPresetChange={handlePresetChange}
            onCustomChange={handleCustomDateChange}
          />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Tab bar */}
        <div className="mb-6 flex gap-1 border-b border-neutral-800">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.value
                  ? "border-brand-lime text-brand-lime"
                  : "border-transparent text-neutral-400 hover:border-neutral-600 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "performance" && (
          <ClientPerformanceView
            client={props.client}
            rows={props.perfRows}
            comparisonRows={props.perfComparisonRows}
            googleAdsRows={props.googleAdsRows}
            googleAdsComparisonRows={props.googleAdsComparisonRows}
            preset={props.preset}
            from={props.from}
            to={props.to}
            compareType={props.compareType}
            baselineReach={props.baselineReach}
            lifetimeSpend={props.lifetimeSpend}
            lifetimeReach={props.lifetimeReach}
            funnelSteps={props.funnelSteps}
            keyAction={props.keyAction}
            funnelViews={props.funnelViews}
            activeFunnelViewId={props.activeFunnelViewId}
            contributionMarginPct={props.contributionMarginPct}
            demographics={props.demographics}
            placements={props.placements}
            annotations={props.annotations}
            namingConfig={props.namingConfig}
            createdDates={props.createdDates}
            shopifyOrders={props.shopifyOrders}
            shopifyAttribution={props.shopifyAttribution}
            shopifyCompOrders={props.shopifyCompOrders}
            shopifyCompAttribution={props.shopifyCompAttribution}
            thumbnails={props.thumbnails}
            previewsEnabled={props.previewsEnabled}
            readOnly
          />
        )}

        {activeTab === "pacing" && (
          <div className="space-y-6">
            <PacingCard pacing={props.pacing} />

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="mb-4 text-sm font-medium text-neutral-400">
                  Daily Spend (This Month)
                </h2>
                <MetricChart
                  data={pacingSpendChartData}
                  label="Spend"
                  color="#CDFF00"
                  format="currency"
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
                  height={260}
                />
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label="Days Elapsed"
                value={`${props.pacing.daysElapsed} / ${props.pacing.daysTotal}`}
                subValue={`${props.pacing.daysRemaining} remaining`}
              />
              <MetricCard
                label="Avg Daily Spend"
                value={fmtCurrency(
                  props.pacing.daysElapsed > 0
                    ? props.pacing.spentToDate / props.pacing.daysElapsed
                    : 0
                )}
                subValue={
                  props.pacing.idealDailySpend
                    ? `Ideal: ${fmtCurrency(props.pacing.idealDailySpend)}`
                    : undefined
                }
              />
              <MetricCard
                label="Remaining Projected"
                value={fmtCurrency(props.pacing.remainingProjected)}
              />
              <MetricCard
                label="Spend Days"
                value={fmtNumber(
                  props.currentMonthDailySpend.filter((d) => d.spend > 0).length
                )}
                subValue={`of ${props.pacing.daysElapsed} elapsed`}
              />
            </div>

            <AdditionalSpendList
              entries={props.additionalSpendEntries}
              currency={currency}
            />

            {!props.monthlyBudget && (
              <Card className="border-amber-900/50 bg-amber-950/20">
                <div className="flex items-start gap-3">
                  <span className="text-amber-500">⚠️</span>
                  <div>
                    <p className="text-sm font-medium text-amber-400">No budget set</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      Contact your account manager to set a monthly budget for pacing
                      projections and alerts.
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === "reach" && (
          <ReachAnalysisView
            clientId={props.client.id}
            rows={props.reachRows}
            baselineReach={props.reachBaselineReach}
            lifetimeRows={props.reachLifetimeRows}
            preset={props.preset}
            from={props.from}
            to={props.to}
            currency={currency}
            comparisonRows={props.reachComparisonRows}
            readOnly
          />
        )}
      </div>

      {/* Footer */}
      <footer className="mt-8 border-t border-neutral-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Logo className="text-neutral-600" />
          <p className="text-[10px] text-neutral-600">
            Report generated automatically · Data from Meta Ads
          </p>
        </div>
      </footer>
    </div>
  )
}
