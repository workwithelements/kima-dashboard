"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
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
  laggedRegression,
  lagCorrelationMulti,
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
  type LagCorrelation,
} from "@/lib/utils/meta-impact"

type Props = {
  clientId: string
  dailyMetaSpend?: DailyMetaSpend[]
}

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
  const [adstockDecay, setAdstockDecay] = useState(0.6)

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

  // Per-section lag analyses for the funnel narrative
  const lagMetaToImpressions = useMemo(
    () => extendedWeekly.length >= 3 && hasSearch
      ? lagCorrelationMulti(extendedWeekly.map(p => p.adstockedSpend), extendedWeekly.map(p => p.searchImpressions), 4)
      : [],
    [extendedWeekly, hasSearch]
  )
  const lagClicksToRevenue = useMemo(
    () => extendedWeekly.length >= 3 && hasSearch
      ? lagCorrelationMulti(extendedWeekly.map(p => p.searchClicks), extendedWeekly.map(p => p.revenue), 4)
      : [],
    [extendedWeekly, hasSearch]
  )
  const lagMetaToRevenue = useMemo(
    () => extendedWeekly.length >= 3
      ? lagCorrelationMulti(extendedWeekly.map(p => p.adstockedSpend), extendedWeekly.map(p => p.revenue), 4)
      : [],
    [extendedWeekly]
  )
  const lagMetaToAmazon = useMemo(
    () => extendedWeekly.length >= 3 && hasAmazon
      ? lagCorrelationMulti(extendedWeekly.map(p => p.adstockedSpend), extendedWeekly.map(p => p.amazonSales), 4)
      : [],
    [extendedWeekly, hasAmazon]
  )

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

      {/* CSV upload */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Data Sources</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CsvUpload label="Shopify Total Revenue (Weekly_orders_less_B2B.csv)" onUpload={handleUpload("total")} rowCount={totalRows.length} hasContent={!!totalCsv} />
          <CsvUpload label="Shopify Paid Orders - last click (Paid_orders.csv)" onUpload={handleUpload("paid")} rowCount={paidRows.length} hasContent={!!paidCsv} />
          <CsvUpload label="GSC Search Data (impressions + clicks)" onUpload={handleUpload("search")} rowCount={searchRows.length} hasContent={!!searchCsv} />
          <CsvUpload label="Shopify Store Sessions" onUpload={handleUpload("sessions")} rowCount={sessionsRows.length} hasContent={!!sessionsCsv} />
          <CsvUpload label="Amazon Sales (optional)" onUpload={handleUpload("amazon")} rowCount={amazonRows.length} hasContent={!!amazonCsv} placeholder={!amazonCsv} />
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

      {!noData && (
        <>
          {/* ── 1. ROAS gauge cards ── */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <RoasCard label="Headline ROAS" sub="Shopify total / Meta spend" value={headlineRoas} />
            <RoasCard label="True ROAS" sub="Shopify total / total marketing cost" value={trueRoas} />
            <RoasCard label="Last-Click ROAS" sub="Shopify paid / Meta spend" value={lastClickRoas} />
          </div>

          {/* ── 3. Meta Spend vs Search (if GSC data) ── */}
          {hasSearch && extendedWeekly.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Meta Spend vs Search Impressions</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={extendedWeekly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="weekLabel" stroke="#737373" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#FF69B4" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNumber(v)} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="adstockedSpend" name="Meta Spend" stroke="#FF69B4" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="searchImpressions" name="Search Impressions" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3">
                <FindingCard lagSeries={lagMetaToImpressions} xName="Meta spend" yName="search impressions" />
              </div>
            </Card>
          )}

          {/* ── 4. Search vs Revenue (if GSC data) ── */}
          {hasSearch && extendedWeekly.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Search Clicks vs Shopify Revenue</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={extendedWeekly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="weekLabel" stroke="#737373" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#3b82f6" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNumber(v)} />
                    <YAxis yAxisId="right" orientation="right" stroke="#CDFF00" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="searchClicks" name="Search Clicks" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" name="Shopify Revenue" stroke="#CDFF00" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3">
                <FindingCard lagSeries={lagClicksToRevenue} xName="Search clicks" yName="Shopify revenue" />
              </div>
            </Card>
          )}

          {/* ── 5. Meta Spend vs Revenue (always) ── */}
          {extendedWeekly.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Meta Spend vs Shopify Revenue</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={extendedWeekly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="weekLabel" stroke="#737373" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#FF69B4" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#CDFF00" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="adstockedSpend" name="Meta Spend" stroke="#FF69B4" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" name="Shopify Revenue" stroke="#CDFF00" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3">
                <FindingCard lagSeries={lagMetaToRevenue} xName="Meta spend" yName="Shopify revenue" />
              </div>
            </Card>
          )}

          {/* ── 6. Amazon Impact ── */}
          {hasAmazon && extendedWeekly.length > 0 ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Meta Spend vs Amazon Sales</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={extendedWeekly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="weekLabel" stroke="#737373" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#FF69B4" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#f97316" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="adstockedSpend" name="Meta Spend" stroke="#FF69B4" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="amazonSales" name="Amazon Sales" stroke="#f97316" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3">
                <FindingCard lagSeries={lagMetaToAmazon} xName="Meta spend" yName="Amazon sales" />
              </div>
            </Card>
          ) : (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">Amazon Impact</h3>
              <p className="text-xs text-neutral-500">
                Amazon sales data not yet available. Upload a CSV above to analyse whether
                Meta advertising is driving demand to Amazon.
              </p>
            </Card>
          )}

          {/* ── 7. Weekly Trends (all channels, carry-over slider inline) ── */}
          {extendedWeekly.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">All Channels — Weekly View</h3>
              <p className="mb-3 text-xs text-neutral-500">
                Revenue and sales on the left axis, traffic and spend on the right.
              </p>
              <div className="mb-4 flex items-center gap-3">
                <label className="text-xs text-neutral-400">
                  Carry-over effect
                  <span
                    className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-neutral-600 text-[9px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-300"
                    title="Meta advertising has a carry-over effect — someone who sees an ad this week may not buy until next week. This slider controls how much of last week's impact carries forward. 0 = no carry-over; 0.9 = very long memory. Default 0.6 suits considered-purchase products."
                  >
                    ?
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={0.95}
                  step={0.05}
                  value={adstockDecay}
                  onChange={(e) => handleAdstockChange(parseFloat(e.target.value))}
                  className="h-1.5 w-40 cursor-pointer appearance-none rounded-lg bg-neutral-700 accent-brand-lime"
                />
                <span className="w-10 text-right text-xs font-semibold tabular-nums text-brand-lime">
                  {adstockDecay.toFixed(2)}
                </span>
              </div>
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
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="revenue" name="Shopify Revenue" stroke="#CDFF00" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="adstockedSpend" name="Meta Spend" stroke="#FF69B4" strokeWidth={2} dot={false} />
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

          {/* ── 8. Conversion Tracking Comparison ── */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">How Does Meta Show Up in Conversion Tracking?</h3>
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
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Shopify Total Orders" fill="#CDFF00" />
                  <Bar dataKey="Meta Pixel Purchases" fill="#FF69B4" />
                  <Bar dataKey="Last-Click Paid Orders" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ── 9. Monthly Detail Table ── */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Monthly Detail</h3>
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

          {/* ── 10. Regression / Incremental Estimate ── */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Incremental Revenue Estimate</h3>
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
                  `Regression-based counterfactual using the strongest lag in the data (${bestReg.lag === 0 ? "same week" : `${bestReg.lag}-week lag`}, R² = ${bestReg.reg.rSquared.toFixed(3)}). The y-intercept predicts revenue with zero Meta spend (${fmtCurrency(baselineWeekly)}/wk). Subtract that baseline from actual revenue to get the incremental estimate. Directional only — a holdout test would confirm causation.`
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
              the period. Directional only — a holdout test would confirm causation.
            </p>
          </Card>

          {/* Directional caveat */}
          <p className="text-[10px] text-neutral-600">
            All findings are directional. With ~{extendedWeekly.length} weeks of data, correlations
            indicate patterns but do not prove causation. A controlled holdout test would be needed
            for causal attribution.
          </p>
        </>
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

/* Formats tooltip values — currency for money-named series, count otherwise. */
function formatTooltipValue(v: number | string, name: string): [string, string] {
  const num = typeof v === "number" ? v : parseFloat(String(v))
  if (!isFinite(num)) return [String(v), name]
  const isCount = /click|impression|session|unit|order/i.test(name)
  return [isCount ? fmtNumber(num) : fmtCurrency(num), name]
}

/* ── Sub-components ── */

function CsvUpload({
  label,
  onUpload,
  rowCount,
  hasContent,
  placeholder,
}: {
  label: string
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  rowCount: number
  hasContent?: boolean
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
        <p className="mt-1 text-[11px] text-green-400">Loaded {rowCount} rows</p>
      ) : hasContent ? (
        <p className="mt-1 text-[11px] text-red-400">
          Couldn&apos;t parse this CSV — column names didn&apos;t match. Expected a date column (e.g. Day, Date, Week start) and a value column.
        </p>
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

function FindingCard({
  lagSeries,
  xName,
  yName,
}: {
  lagSeries: LagCorrelation[]
  xName: string
  yName: string
}) {
  const positives = lagSeries.filter((l) => l.r > 0)
  const best = positives.length > 0
    ? positives.reduce((a, b) => (b.r > a.r ? b : a))
    : lagSeries.length > 0
      ? lagSeries.reduce((a, b) => (b.r > a.r ? b : a))
      : null
  const [selectedLag, setSelectedLag] = useState<number | null>(best?.lagWeeks ?? null)

  // Reset selection when the underlying series changes (e.g. carry-over slider)
  useEffect(() => {
    setSelectedLag(best?.lagWeeks ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lagSeries])

  if (lagSeries.length === 0 || !best) return null
  const current = lagSeries.find((l) => l.lagWeeks === selectedLag) ?? best
  const strength = correlationStrength(current.r)
  const dotColor =
    strength === "strong" ? "bg-green-400" :
    strength === "moderate" ? "bg-amber-400" : "bg-neutral-500"
  const lagLabel = current.lagWeeks === 0 ? "in the same week" : `at a ${current.lagWeeks}-week delay`
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-800/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
        <div className="flex-1">
          <p className="text-xs font-medium text-neutral-200">
            {xName} shows a {strength} relationship with {yName} {lagLabel}.
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            r&nbsp;=&nbsp;{current.r.toFixed(3)} across {current.n} weekly observations.
            {" "}Directional only — a holdout test would confirm causation.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 pl-6">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Lag</span>
        {lagSeries.map((l) => {
          const isSelected = l.lagWeeks === current.lagWeeks
          const isBest = l.lagWeeks === best.lagWeeks
          return (
            <button
              key={l.lagWeeks}
              onClick={() => setSelectedLag(l.lagWeeks)}
              title={`r = ${l.r.toFixed(3)}`}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                isSelected
                  ? "bg-brand-lime text-black"
                  : isBest
                    ? "border border-brand-lime/40 text-brand-lime hover:bg-brand-lime/10"
                    : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {l.lagWeeks === 0 ? "Same week" : `${l.lagWeeks}w`}
            </button>
          )
        })}
      </div>
    </div>
  )
}
