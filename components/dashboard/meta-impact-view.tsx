"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  BarChart,
} from "recharts"
import { Card } from "@/components/ui/card"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import {
  parseShopifyDaily,
  parseAmazonDaily,
  parseGscDaily,
  parseSessionsDaily,
  buildMonthlySummaries,
  buildWeeklyPoints,
  buildExtendedWeeklyPoints,
  lagCorrelationSeries,
  laggedRegression,
  lagCorrelationMulti,
  correlationMatrix,
  correlationStrength,
  dailyToMonthlyMetaSpend,
  DEFAULT_META_SPEND,
  MANAGEMENT_FEE_MONTHLY,
  type DailyMetaSpend,
  type DailyRevenueRow,
  type DailyAmazonRow,
  type DailySearchRow,
  type DailySessionsRow,
  type MonthlySummary,
  type ExtendedWeeklyPoint,
} from "@/lib/utils/meta-impact"

type Props = {
  clientId: string
  dailyMetaSpend?: DailyMetaSpend[]
}

type SubTab = "overview" | "trends" | "correlation"

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "trends", label: "Channel Trends" },
  { key: "correlation", label: "Correlation & Lag" },
]

const STORAGE_TOTAL = "meta-impact:total-csv"
const STORAGE_PAID = "meta-impact:paid-csv"
const STORAGE_SEARCH = "meta-impact:search-csv"
const STORAGE_SESSIONS = "meta-impact:sessions-csv"
const STORAGE_AMAZON = "meta-impact:amazon-csv"
const STORAGE_ADSTOCK = "meta-impact:adstock-decay"

export default function MetaImpactView({ clientId, dailyMetaSpend = [] }: Props) {
  const [totalCsv, setTotalCsv] = useState<string>("")
  const [paidCsv, setPaidCsv] = useState<string>("")
  const [searchCsv, setSearchCsv] = useState<string>("")
  const [sessionsCsv, setSessionsCsv] = useState<string>("")
  const [amazonCsv, setAmazonCsv] = useState<string>("")
  const [activeTab, setActiveTab] = useState<SubTab>("overview")
  const [adstockDecay, setAdstockDecay] = useState(0.6)
  const [lagTarget, setLagTarget] = useState<string>("revenue")

  // Load any cached CSVs from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    const t = localStorage.getItem(`${STORAGE_TOTAL}:${clientId}`)
    const p = localStorage.getItem(`${STORAGE_PAID}:${clientId}`)
    const s = localStorage.getItem(`${STORAGE_SEARCH}:${clientId}`)
    const ss = localStorage.getItem(`${STORAGE_SESSIONS}:${clientId}`)
    const a = localStorage.getItem(`${STORAGE_AMAZON}:${clientId}`)
    const d = localStorage.getItem(`${STORAGE_ADSTOCK}:${clientId}`)
    if (t) setTotalCsv(t)
    if (p) setPaidCsv(p)
    if (s) setSearchCsv(s)
    if (ss) setSessionsCsv(ss)
    if (a) setAmazonCsv(a)
    if (d) setAdstockDecay(parseFloat(d) || 0.6)
  }, [clientId])

  const handleUpload = useCallback(
    (which: "total" | "paid" | "search" | "sessions" | "amazon") =>
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const text = await file.text()
        const setters: Record<string, [React.Dispatch<React.SetStateAction<string>>, string]> = {
          total: [setTotalCsv, STORAGE_TOTAL],
          paid: [setPaidCsv, STORAGE_PAID],
          search: [setSearchCsv, STORAGE_SEARCH],
          sessions: [setSessionsCsv, STORAGE_SESSIONS],
          amazon: [setAmazonCsv, STORAGE_AMAZON],
        }
        const [setter, key] = setters[which]
        setter(text)
        localStorage.setItem(`${key}:${clientId}`, text)
      },
    [clientId]
  )

  const handleAdstockChange = useCallback(
    (val: number) => {
      setAdstockDecay(val)
      localStorage.setItem(`${STORAGE_ADSTOCK}:${clientId}`, String(val))
    },
    [clientId]
  )

  const totalRows: DailyRevenueRow[] = useMemo(
    () => (totalCsv ? parseShopifyDaily(totalCsv) : []),
    [totalCsv]
  )
  const paidRows: DailyRevenueRow[] = useMemo(
    () => (paidCsv ? parseShopifyDaily(paidCsv) : []),
    [paidCsv]
  )
  const searchRows: DailySearchRow[] = useMemo(
    () => (searchCsv ? parseGscDaily(searchCsv) : []),
    [searchCsv]
  )
  const sessionsRows: DailySessionsRow[] = useMemo(
    () => (sessionsCsv ? parseSessionsDaily(sessionsCsv) : []),
    [sessionsCsv]
  )
  const amazonRows: DailyAmazonRow[] = useMemo(
    () => (amazonCsv ? parseAmazonDaily(amazonCsv) : []),
    [amazonCsv]
  )

  // Use real daily Meta spend from Supabase if available, else fall back to hardcoded monthly
  const monthlyMetaSpend = useMemo(
    () =>
      dailyMetaSpend.length > 0
        ? dailyToMonthlyMetaSpend(dailyMetaSpend)
        : DEFAULT_META_SPEND,
    [dailyMetaSpend]
  )

  const monthlySummaries: MonthlySummary[] = useMemo(
    () => buildMonthlySummaries(totalRows, paidRows, monthlyMetaSpend),
    [totalRows, paidRows, monthlyMetaSpend]
  )

  const weeklyPoints = useMemo(
    () => buildWeeklyPoints(totalRows, paidRows, monthlyMetaSpend, dailyMetaSpend),
    [totalRows, paidRows, monthlyMetaSpend, dailyMetaSpend]
  )

  const lagSeries = useMemo(() => lagCorrelationSeries(weeklyPoints, 3), [weeklyPoints])
  const reg0 = useMemo(() => laggedRegression(weeklyPoints, 0), [weeklyPoints])
  const reg1 = useMemo(() => laggedRegression(weeklyPoints, 1), [weeklyPoints])
  const reg2 = useMemo(() => laggedRegression(weeklyPoints, 2), [weeklyPoints])
  const reg3 = useMemo(() => laggedRegression(weeklyPoints, 3), [weeklyPoints])

  // Pick the regression with the highest positive R across lags 0-3.
  // This reflects the strongest signal in the actual data rather than
  // hardcoding lag-1 which was the prior hypothesis.
  const bestReg = useMemo(() => {
    const candidates = [
      { lag: 0, reg: reg0 },
      { lag: 1, reg: reg1 },
      { lag: 2, reg: reg2 },
      { lag: 3, reg: reg3 },
    ]
    // Only consider positive correlations
    const positives = candidates.filter((c) => c.reg.r > 0)
    if (positives.length === 0) return candidates[0] // fall back to same-week
    return positives.reduce((a, b) => (b.reg.r > a.reg.r ? b : a))
  }, [reg0, reg1, reg2, reg3])

  // Aggregate totals across all months for headline ROAS cards
  const totals = useMemo(() => {
    return monthlySummaries.reduce(
      (acc, m) => ({
        metaSpend: acc.metaSpend + m.metaSpend,
        totalCost: acc.totalCost + m.totalCost,
        totalRevenue: acc.totalRevenue + m.totalRevenue,
        paidRevenue: acc.paidRevenue + m.paidRevenue,
      }),
      { metaSpend: 0, totalCost: 0, totalRevenue: 0, paidRevenue: 0 }
    )
  }, [monthlySummaries])

  const headlineRoas = totals.metaSpend > 0 ? totals.totalRevenue / totals.metaSpend : 0
  const trueRoas = totals.totalCost > 0 ? totals.totalRevenue / totals.totalCost : 0
  const lastClickRoas = totals.metaSpend > 0 ? totals.paidRevenue / totals.metaSpend : 0

  // Estimated incremental revenue from the best-lag regression intercept.
  // Use whichever lag has the strongest positive correlation in the data.
  const baselineWeekly = Math.max(0, bestReg.reg.intercept)
  const baselineTotal = baselineWeekly * weeklyPoints.length
  const incremental = totals.totalRevenue - baselineTotal
  // Contextual metrics for the incremental figure
  const actualWeeklyAvg =
    weeklyPoints.length > 0 ? totals.totalRevenue / weeklyPoints.length : 0
  const baselineUpliftPct =
    baselineWeekly > 0 ? ((actualWeeklyAvg - baselineWeekly) / baselineWeekly) * 100 : 0
  const incrementalSharePct =
    totals.totalRevenue > 0 ? (Math.max(0, incremental) / totals.totalRevenue) * 100 : 0

  // Attribution comparison data for stacked bars
  const attributionData = useMemo(
    () =>
      monthlySummaries.map((m) => ({
        month: m.monthLabel,
        "Shopify Total Orders": m.totalOrders,
        "Meta Pixel Purchases": m.metaPurchases,
        "Last-Click Paid Orders": m.paidOrders,
      })),
    [monthlySummaries]
  )

  // Extended weekly points with all channels + adstock
  const extendedWeekly: ExtendedWeeklyPoint[] = useMemo(
    () =>
      buildExtendedWeeklyPoints(
        totalRows, paidRows, monthlyMetaSpend, dailyMetaSpend,
        searchRows, sessionsRows, amazonRows, adstockDecay
      ),
    [totalRows, paidRows, monthlyMetaSpend, dailyMetaSpend, searchRows, sessionsRows, amazonRows, adstockDecay]
  )

  // Determine which extra channels have data
  const hasSearch = searchRows.length > 0
  const hasSessions = sessionsRows.length > 0
  const hasAmazon = amazonRows.length > 0

  // Correlation matrix across all available series
  const corrMatrix = useMemo(() => {
    if (extendedWeekly.length < 3) return []
    const series: Record<string, number[]> = {
      "Meta Spend (adstocked)": extendedWeekly.map((p) => p.adstockedSpend),
      "Shopify Revenue": extendedWeekly.map((p) => p.revenue),
    }
    if (hasSearch) series["GSC Clicks"] = extendedWeekly.map((p) => p.searchClicks)
    if (hasSearch) series["GSC Impressions"] = extendedWeekly.map((p) => p.searchImpressions)
    if (hasSessions) series["Store Sessions"] = extendedWeekly.map((p) => p.shopifySessions)
    if (hasAmazon) series["Amazon Sales"] = extendedWeekly.map((p) => p.amazonSales)
    return correlationMatrix(series)
  }, [extendedWeekly, hasSearch, hasSessions, hasAmazon])

  // Per-channel lag analysis (target selectable)
  const lagTargetOptions = useMemo(() => {
    const opts = [{ value: "revenue", label: "Shopify Revenue" }]
    if (hasSearch) opts.push({ value: "searchClicks", label: "GSC Clicks" })
    if (hasSessions) opts.push({ value: "shopifySessions", label: "Store Sessions" })
    if (hasAmazon) opts.push({ value: "amazonSales", label: "Amazon Sales" })
    return opts
  }, [hasSearch, hasSessions, hasAmazon])

  const multiLagSeries = useMemo(() => {
    if (extendedWeekly.length < 3) return []
    const x = extendedWeekly.map((p) => p.adstockedSpend)
    const y = extendedWeekly.map((p) => {
      const val = (p as unknown as Record<string, number>)[lagTarget]
      return typeof val === "number" ? val : p.revenue
    })
    return lagCorrelationMulti(x, y, 4)
  }, [extendedWeekly, lagTarget])

  // Auto-generated insight
  const strongestCorr = useMemo(() => {
    if (corrMatrix.length === 0) return null
    const metaCorrs = corrMatrix.filter((e: { xLabel: string }) => e.xLabel.includes("Meta"))
    if (metaCorrs.length === 0) return null
    return metaCorrs.reduce((best: typeof corrMatrix[0], c: typeof corrMatrix[0]) => (Math.abs(c.r) > Math.abs(best.r) ? c : best))
  }, [corrMatrix])

  const noData = totalRows.length === 0 && paidRows.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Marketing Impact</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Analyses the relationship between Meta Ads spend and business outcomes across
          channels to estimate the incremental impact of advertising.
        </p>
      </div>

      {/* Sub-tab navigation */}
      <div className="flex gap-1">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
              activeTab === tab.key
                ? "bg-brand-lime text-black"
                : "bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* CSV upload */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Data Sources</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CsvUpload label="Shopify Total Revenue (Weekly_orders_less_B2B.csv)" onUpload={handleUpload("total")} rowCount={totalRows.length} />
          <CsvUpload label="Shopify Paid Orders - last click (Paid_orders.csv)" onUpload={handleUpload("paid")} rowCount={paidRows.length} />
          <CsvUpload label="GSC Search Data (impressions + clicks)" onUpload={handleUpload("search")} rowCount={searchRows.length} />
          <CsvUpload label="Shopify Store Sessions" onUpload={handleUpload("sessions")} rowCount={sessionsRows.length} />
          <CsvUpload label="Amazon Sales (optional)" onUpload={handleUpload("amazon")} rowCount={amazonRows.length} placeholder={!amazonCsv} />
        </div>
        <p className="mt-3 text-[11px] text-neutral-600">
          {dailyMetaSpend.length > 0
            ? `Meta spend pulled from Supabase: ${dailyMetaSpend.length} daily rows. `
            : "Meta spend hard-coded for Jan-Mar 2026 (no Supabase data found). "}
          CSVs cached in your browser - no upload to the server.
        </p>
      </Card>

      {noData && (
        <Card>
          <p className="text-sm text-neutral-500">
            Upload Shopify CSV files above to see the analysis.
          </p>
        </Card>
      )}

      {!noData && activeTab === "overview" && (
        <>
          {/* ── ROAS gauge cards ── */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <RoasCard label="Headline ROAS" sub="Shopify total / Meta spend" value={headlineRoas} />
            <RoasCard label="True ROAS" sub="Shopify total / total marketing cost" value={trueRoas} />
            <RoasCard label="Last-Click ROAS" sub="Shopify paid / Meta spend" value={lastClickRoas} />
          </div>

          {/* ── Monthly Revenue vs Cost Table ── */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Monthly Revenue vs Cost</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-neutral-500">
                    <th className="py-2 pr-3 font-medium">Month</th>
                    <th className="py-2 pr-3 text-right font-medium">Meta Spend</th>
                    <th className="py-2 pr-3 text-right font-medium">Mgmt Fee</th>
                    <th className="py-2 pr-3 text-right font-medium">Total Cost</th>
                    <th className="py-2 pr-3 text-right font-medium">Shopify Revenue</th>
                    <th className="py-2 pr-3 text-right font-medium">Paid (LC)</th>
                    <th className="py-2 pr-3 text-right font-medium">Meta Purchases</th>
                    <th className="py-2 pr-3 text-right font-medium">Total Orders</th>
                    <th className="py-2 pr-3 text-right font-medium">ROAS (HL)</th>
                    <th className="py-2 pr-3 text-right font-medium">ROAS (True)</th>
                    <th className="py-2 pr-3 text-right font-medium">ROAS (LC)</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlySummaries.map((m) => (
                    <tr key={m.month} className="border-b border-neutral-800/50">
                      <td className="py-2 pr-3 text-neutral-200">{m.monthLabel}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtCurrency(m.metaSpend)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-neutral-400">
                        {fmtCurrency(m.managementFee)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtCurrency(m.totalCost)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-neutral-200">
                        {fmtCurrency(m.totalRevenue)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-neutral-400">
                        {fmtCurrency(m.paidRevenue)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(m.metaPurchases)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(m.totalOrders)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <RoasCell value={m.roasHeadline} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <RoasCell value={m.roasTrue} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <RoasCell value={m.roasLastClick} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Three-Way Attribution ── */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Three-Way Attribution Comparison</h3>
            <p className="mb-3 text-xs text-neutral-500">
              Last-click attribution dramatically undervalues Meta. The gap between Shopify
              total orders and last-click paid orders shows how much demand Meta is creating
              indirectly.
            </p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attributionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="month" stroke="#737373" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#737373" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Shopify Total Orders" fill="#CDFF00" />
                  <Bar dataKey="Meta Pixel Purchases" fill="#FF69B4" />
                  <Bar dataKey="Last-Click Paid Orders" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ── Regression summary ── */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Regression Summary</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
              <MetricCard label="R² (same week)" value={reg0.rSquared.toFixed(3)} />
              <MetricCard label="R² (1-week lag)" value={reg1.rSquared.toFixed(3)} />
              <MetricCard label="Baseline weekly revenue" value={fmtCurrency(baselineWeekly)} />
              <MetricCard
                label="Estimated incremental from Meta"
                value={fmtCurrency(Math.max(0, incremental))}
                positive={incremental > 0}
                tooltip={
                  `Regression-based counterfactual using the strongest lag in the data (${bestReg.lag === 0 ? "same week" : `${bestReg.lag}-week lag`}, R² = ${bestReg.reg.rSquared.toFixed(3)}). We fit a line between weekly Meta spend and Shopify revenue at that lag. The y-intercept is what the model predicts you'd earn with zero Meta spend (${fmtCurrency(baselineWeekly)}/wk baseline). Multiply by ${weeklyPoints.length} weeks, then subtract from actual total revenue to get the incremental estimate. Directional only - use with caution given the small sample and low R². A holdout test would be needed for causal proof.`
                }
              />
            </div>

            {incremental > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-800 bg-neutral-800/30 p-3 text-xs md:grid-cols-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Share of total revenue</p>
                  <p className="mt-0.5 font-semibold text-neutral-200">{incrementalSharePct.toFixed(1)}%</p>
                  <p className="mt-0.5 text-[10px] text-neutral-600">{fmtCurrency(Math.max(0, incremental))} of {fmtCurrency(totals.totalRevenue)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Uplift on baseline weekly</p>
                  <p className="mt-0.5 font-semibold text-neutral-200">+{baselineUpliftPct.toFixed(0)}%</p>
                  <p className="mt-0.5 text-[10px] text-neutral-600">Actual {fmtCurrency(actualWeeklyAvg)}/wk vs baseline {fmtCurrency(baselineWeekly)}/wk</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Confidence</p>
                  <p className={`mt-0.5 font-semibold ${bestReg.reg.rSquared >= 0.3 ? "text-green-400" : bestReg.reg.rSquared >= 0.1 ? "text-amber-400" : "text-red-400"}`}>
                    {bestReg.reg.rSquared >= 0.3 ? "Moderate" : bestReg.reg.rSquared >= 0.1 ? "Weak" : "Very low"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-neutral-600">
                    R² = {bestReg.reg.rSquared.toFixed(3)} on {bestReg.reg.n} weeks{" · "}{bestReg.lag === 0 ? "same week" : `${bestReg.lag}-week lag`}
                  </p>
                </div>
              </div>
            )}

            <p className="mt-3 text-[11px] text-neutral-600">
              Baseline weekly revenue is the regression intercept (the level expected with
              zero Meta spend). Incremental is total revenue minus baseline scaled across
              the period. Directional only - a holdout test would be needed for causal proof.
            </p>
          </Card>
        </>
      )}

      {/* ═══════════════ CHANNEL TRENDS TAB ═══════════════ */}
      {!noData && activeTab === "trends" && (
        <>
          {/* Adstock slider */}
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Adstock Decay</h3>
            <p className="mb-3 text-xs text-neutral-500">
              Meta advertising has a carry-over effect — someone who sees an ad this week may
              not buy until next week. The decay rate controls how much of last week&apos;s
              advertising impact carries forward.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={0.95}
                step={0.05}
                value={adstockDecay}
                onChange={(e) => handleAdstockChange(parseFloat(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-neutral-700 accent-brand-lime"
              />
              <span className="w-12 text-right text-sm font-semibold tabular-nums text-brand-lime">
                {adstockDecay.toFixed(2)}
              </span>
            </div>
            <p className="mt-2 text-[10px] text-neutral-600">
              0 = no carry-over (only this week&apos;s spend matters). 0.9 = very long memory.
              Default 0.6 suits considered-purchase products.
            </p>
          </Card>

          {/* Multi-channel weekly trend */}
          {extendedWeekly.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Multi-Channel Weekly Trends</h3>
              <p className="mb-3 text-xs text-neutral-500">
                All channels plotted weekly. Revenue/sales on the left axis, traffic/spend on the right.
              </p>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={extendedWeekly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="weekLabel" stroke="#737373" tick={{ fontSize: 10 }} />
                    <YAxis
                      yAxisId="left"
                      stroke="#CDFF00"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#FF69B4"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => fmtNumber(v)}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="revenue" name="Shopify Revenue" stroke="#CDFF00" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="adstockedSpend" name="Meta Spend (adstocked)" stroke="#FF69B4" strokeWidth={2} dot={false} />
                    {hasAmazon && (
                      <Line yAxisId="left" type="monotone" dataKey="amazonSales" name="Amazon Sales" stroke="#f97316" strokeWidth={2} dot={false} />
                    )}
                    {hasSearch && (
                      <Line yAxisId="right" type="monotone" dataKey="searchClicks" name="GSC Clicks" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    )}
                    {hasSessions && (
                      <Line yAxisId="right" type="monotone" dataKey="shopifySessions" name="Store Sessions" stroke="#737373" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Original weekly Revenue vs Spend (raw, no adstock) */}
          {weeklyPoints.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Weekly Revenue vs Meta Spend (raw)</h3>
              <p className="mb-3 text-xs text-neutral-500">
                Shopify revenue against raw Meta spend (no adstock) at the same-week level.
              </p>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={weeklyPoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="weekLabel" stroke="#737373" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#CDFF00" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#FF69B4" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(1)}k`} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="revenue" name="Shopify Revenue" stroke="#CDFF00" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="metaSpend" name="Meta Spend" stroke="#FF69B4" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════ CORRELATION & LAG TAB ═══════════════ */}
      {!noData && activeTab === "correlation" && (
        <>
          {/* Auto-generated insight */}
          {strongestCorr && (
            <Card>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                  correlationStrength(strongestCorr.r) === "strong" ? "bg-green-400" :
                  correlationStrength(strongestCorr.r) === "moderate" ? "bg-amber-400" : "bg-neutral-500"
                }`} />
                <div>
                  <p className="text-xs font-medium text-neutral-200">
                    {correlationStrength(strongestCorr.r) === "strong"
                      ? `Strong: Meta spend closely tracks ${strongestCorr.yLabel}`
                      : correlationStrength(strongestCorr.r) === "moderate"
                      ? `Moderate: some evidence of Meta driving ${strongestCorr.yLabel}`
                      : `Weak: no meaningful relationship detected with ${strongestCorr.yLabel}`}
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    r = {strongestCorr.r.toFixed(3)} across {strongestCorr.n} weekly observations.
                    {" "}This is directional — a holdout test would be needed for causal proof.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Correlation matrix */}
          {corrMatrix.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Correlation Matrix</h3>
              <p className="mb-3 text-xs text-neutral-500">
                Pairwise Pearson r between all channel metrics at weekly level.
                Green = positive correlation, red = negative.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-neutral-800">
                      <th className="py-2 pr-3 text-left font-medium text-neutral-500">Pair</th>
                      <th className="py-2 pr-3 text-right font-medium text-neutral-500">r</th>
                      <th className="py-2 pr-3 text-right font-medium text-neutral-500">Strength</th>
                      <th className="py-2 text-right font-medium text-neutral-500">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corrMatrix
                      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
                      .map((entry, i) => {
                        const strength = correlationStrength(entry.r)
                        const color = entry.r >= 0.3 ? "text-green-400" : entry.r <= -0.3 ? "text-red-400" : "text-neutral-400"
                        return (
                          <tr key={i} className="border-b border-neutral-800/50">
                            <td className="py-2 pr-3 text-neutral-200">
                              {entry.xLabel} / {entry.yLabel}
                            </td>
                            <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${color}`}>
                              {entry.r.toFixed(3)}
                            </td>
                            <td className="py-2 pr-3 text-right capitalize text-neutral-400">
                              {strength}
                            </td>
                            <td className="py-2 text-right tabular-nums text-neutral-500">
                              {entry.n}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Per-channel lag analysis */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Lag Correlation Analysis</h3>
            <p className="mb-3 text-xs text-neutral-500">
              How strongly does adstocked Meta spend in week N correlate with the selected
              outcome in week N+lag?
            </p>
            <div className="mb-4 flex items-center gap-3">
              <label className="text-xs text-neutral-400">Target:</label>
              <select
                value={lagTarget}
                onChange={(e) => setLagTarget(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 focus:border-brand-lime focus:outline-none"
              >
                {lagTargetOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {(() => {
              const positives = multiLagSeries.filter((l) => l.r > 0)
              const strongest = positives.length > 0
                ? positives.reduce((a, b) => (b.r > a.r ? b : a))
                : null
              return strongest ? (
                <div className="mb-3 rounded-lg border border-brand-lime/30 bg-brand-lime/5 px-3 py-2 text-xs">
                  <span className="text-neutral-400">Strongest positive correlation: </span>
                  <span className="font-semibold text-brand-lime">
                    {strongest.lagWeeks === 0 ? "same week" : `${strongest.lagWeeks}-week lag`}
                  </span>
                  <span className="text-neutral-400"> (r = {strongest.r.toFixed(3)})</span>
                </div>
              ) : null
            })()}
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={multiLagSeries} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="lagWeeks" stroke="#737373" tick={{ fontSize: 11 }} tickFormatter={(v) => (v === 0 ? "Same week" : `${v}w lag`)} />
                  <YAxis stroke="#737373" tick={{ fontSize: 11 }} domain={[-1, 1]} tickFormatter={(v) => v.toFixed(1)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(3), "r"]} labelFormatter={(l) => (l === 0 ? "Same week" : `Lag ${l} weeks`)} />
                  <Bar dataKey="r" name="Pearson r" label={{ position: "top", fontSize: 11, fill: "#a3a3a3", formatter: (v: number) => v.toFixed(2) }}>
                    {multiLagSeries.map((entry, idx) => (
                      <Cell key={idx} fill={entry.r >= 0.3 ? "#CDFF00" : entry.r > 0 ? "#86efac" : entry.r > -0.3 ? "#525252" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[10px] text-neutral-600">
              Lime = strong positive (r {"\u2265"} 0.3). Pale green = weak positive.
              Grey = no correlation. Red = negative. Uses adstocked Meta spend.
            </p>
          </Card>

          {/* Original Shopify-only lag for backward compat */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Shopify Revenue Lag (raw spend)</h3>
            <p className="mb-3 text-xs text-neutral-500">
              Original lag analysis using raw (non-adstocked) Meta spend vs Shopify revenue.
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lagSeries} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="lagWeeks" stroke="#737373" tick={{ fontSize: 11 }} tickFormatter={(v) => (v === 0 ? "Same week" : `${v}w lag`)} />
                  <YAxis stroke="#737373" tick={{ fontSize: 11 }} domain={[-1, 1]} tickFormatter={(v) => v.toFixed(1)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(3), "r"]} labelFormatter={(l) => (l === 0 ? "Same week" : `Lag ${l} weeks`)} />
                  <Bar dataKey="r" name="Pearson r" label={{ position: "top", fontSize: 11, fill: "#a3a3a3", formatter: (v: number) => v.toFixed(2) }}>
                    {lagSeries.map((entry, idx) => (
                      <Cell key={idx} fill={entry.r >= 0.3 ? "#CDFF00" : entry.r > 0 ? "#86efac" : entry.r > -0.3 ? "#525252" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}

      {/* Directional caveat — shown on all tabs */}
      {!noData && (
        <p className="text-[10px] text-neutral-600">
          All findings are directional. With ~{extendedWeekly.length} weeks of data, correlations
          indicate patterns but do not prove causation. A controlled holdout test would be needed
          for causal attribution.
        </p>
      )}
    </div>
  )
}

/* ── Shared tooltip style ── */
const TOOLTIP_STYLE = {
  backgroundColor: "#171717",
  border: "1px solid #404040",
  borderRadius: 8,
  fontSize: 12,
}

/* ── Sub-components ── */

function CsvUpload({
  label,
  onUpload,
  rowCount,
  placeholder,
}: {
  label: string
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  rowCount: number
  placeholder?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-neutral-400">{label}</label>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={onUpload}
        className="block w-full text-xs text-neutral-400 file:mr-3 file:rounded file:border-0 file:bg-brand-lime/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-lime hover:file:bg-brand-lime/30"
      />
      {rowCount > 0 ? (
        <p className="mt-1 text-[11px] text-green-400">Loaded {rowCount} daily rows</p>
      ) : placeholder ? (
        <p className="mt-1 text-[11px] text-neutral-600">No data yet</p>
      ) : null}
    </div>
  )
}

function RoasCard({ label, sub, value }: { label: string; sub: string; value: number }) {
  const color = value >= 2 ? "text-green-400" : value >= 1 ? "text-amber-400" : "text-red-400"
  const bg = value >= 2 ? "border-green-500/30" : value >= 1 ? "border-amber-500/30" : "border-red-500/30"
  return (
    <div className={`rounded-xl border ${bg} bg-neutral-900 p-4`}>
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>
        {value > 0 ? `${value.toFixed(2)}x` : "—"}
      </p>
      <p className="mt-1 text-[11px] text-neutral-600">{sub}</p>
    </div>
  )
}

function RoasCell({ value }: { value: number }) {
  if (!value) return <span className="text-neutral-600">—</span>
  const color = value >= 2 ? "text-green-400" : value >= 1 ? "text-amber-400" : "text-red-400"
  return <span className={color}>{value.toFixed(2)}x</span>
}

function MetricCard({
  label,
  value,
  positive,
  tooltip,
}: {
  label: string
  value: string
  positive?: boolean
  tooltip?: string
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-neutral-500">
        <span>{label}</span>
        {tooltip && (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-neutral-600 text-[9px] text-neutral-500 normal-case tracking-normal hover:border-neutral-400 hover:text-neutral-300"
            title={tooltip}
          >
            ?
          </span>
        )}
      </p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${positive ? "text-green-400" : "text-neutral-200"}`}>
        {value}
      </p>
    </div>
  )
}
