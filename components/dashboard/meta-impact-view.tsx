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

  // Aggregate gap between Shopify total orders and last-click paid orders —
  // this is the pool of orders Meta may have influenced but didn't get credited
  // for under last-click attribution.
  const attributionTotals = useMemo(() => {
    const totalOrders = monthlySummaries.reduce((s, m) => s + m.totalOrders, 0)
    const paidOrders = monthlySummaries.reduce((s, m) => s + m.paidOrders, 0)
    const metaPurchases = monthlySummaries.reduce((s, m) => s + m.metaPurchases, 0)
    const uncreditedOrders = Math.max(0, totalOrders - paidOrders)
    const uncreditedPct = totalOrders > 0 ? (uncreditedOrders / totalOrders) * 100 : 0
    return { totalOrders, paidOrders, metaPurchases, uncreditedOrders, uncreditedPct }
  }, [monthlySummaries])

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

      {/* Methodology banner — all findings on this page are correlational. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-[11px] leading-relaxed text-amber-200/90">
        <span className="mt-0.5 shrink-0 font-semibold text-amber-300">Note</span>
        <p>
          All findings below are <strong>directional</strong>, not causal. Correlations
          indicate patterns in historical data but don&apos;t prove that Meta spend caused
          the observed outcomes. A turn-off activity test or a geo holdout would be needed
          to confirm incrementality.
        </p>
      </div>

      {/* CSV upload */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Data Sources</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CsvUpload label="Shopify Total Revenue (Weekly_orders_less_B2B.csv)" onUpload={handleUpload("total")} rowCount={totalRows.length} hasContent={!!totalCsv} />
          <CsvUpload label="Shopify Paid Orders - last click (Paid_orders.csv)" onUpload={handleUpload("paid")} rowCount={paidRows.length} hasContent={!!paidCsv} />
          <CsvUpload label="GSC Search Data (optional)" onUpload={handleUpload("search")} rowCount={searchRows.length} hasContent={!!searchCsv} optional />
          <CsvUpload label="Shopify Store Sessions (optional)" onUpload={handleUpload("sessions")} rowCount={sessionsRows.length} hasContent={!!sessionsCsv} optional />
          <CsvUpload label="Amazon Sales (optional)" onUpload={handleUpload("amazon")} rowCount={amazonRows.length} hasContent={!!amazonCsv} placeholder={!amazonCsv} optional />
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
            <RoasCard
              label="Headline ROAS"
              sub="Shopify total / Meta spend"
              value={headlineRoas}
              tooltip="Total Shopify revenue divided by Meta ad spend. Credits Meta with every Shopify order whether or not Meta actually drove it. Good for a top-line read, but overstates Meta's impact because it ignores demand that would have existed without ads."
            />
            <RoasCard
              label="True ROAS"
              sub="Shopify total / total marketing cost"
              value={trueRoas}
              tooltip="Total Shopify revenue divided by total marketing cost (Meta spend + management fees). The most honest headline number — accounts for the full cost of running the campaigns, not just the media spend."
            />
            <RoasCard
              label="Last-Click ROAS"
              sub="Shopify paid / Meta spend"
              value={lastClickRoas}
              tooltip="Revenue from orders where a Meta ad was the last click before purchase, divided by Meta spend. Usually much lower than Headline ROAS — and the gap between them is roughly the 'indirect influence' Meta has on orders that end up getting credited to other channels."
            />
          </div>

          {/* ── 2. Summary & interpretation ── */}
          <SummaryCard
            lagMetaToRevenue={lagMetaToRevenue}
            lagMetaToAmazon={lagMetaToAmazon}
            lagMetaToImpressions={lagMetaToImpressions}
            lagClicksToRevenue={lagClicksToRevenue}
            hasSearch={hasSearch}
            hasAmazon={hasAmazon}
            weeksOfData={extendedWeekly.length}
            trueRoas={trueRoas}
            incrementalSharePct={incrementalSharePct}
            bestRegRsq={bestReg.reg.rSquared}
            bestRegLag={bestReg.lag}
          />

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
              <div className="mb-1 flex items-center gap-3">
                <label className="text-xs text-neutral-400">
                  Carry-over effect
                  <span
                    className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-neutral-600 text-[9px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-300"
                    title="Meta advertising has a carry-over effect — someone who sees an ad this week may not buy until next week. The slider controls how much of last week's impact persists into the current week. 0 = no carry-over (only this week's spend counts). 0.9 = very long memory. Default 0.6 suits considered-purchase products."
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
              <p className="mb-3 text-[11px] text-neutral-500">
                {`${Math.round(adstockDecay * 100)}% of a week's Meta impact carries forward into the next week.`}
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

            {/* Headline gap call-out — the argument of this section. */}
            {attributionTotals.totalOrders > 0 && (
              <div className="mb-4 rounded-lg border border-brand-lime/30 bg-brand-lime/5 p-4">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Orders Meta likely influenced but last-click didn&apos;t credit
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-brand-lime">
                  {fmtNumber(attributionTotals.uncreditedOrders)}
                </p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  {attributionTotals.uncreditedPct.toFixed(0)}% of all Shopify orders
                  ({fmtNumber(attributionTotals.totalOrders)} total) had no last-click
                  credit to a paid channel — but Meta was running during this window.
                </p>
              </div>
            )}

            <p className="mb-3 text-xs text-neutral-500">
              Three ways to count the same period: Shopify&apos;s total orders (lime), Meta
              pixel&apos;s reported purchases (pink), and last-click paid orders (blue). The
              gap between lime and blue is what last-click misses — organic, direct, and
              email orders that Meta may have nudged towards purchase.
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
            {incremental > 0 && (() => {
              // Rough uncertainty band: wider when model fit is weaker. At R² = 0.1
              // the range is ±90% of the point estimate; at R² = 0.6 it's ±40%.
              const r2 = bestReg.reg.rSquared
              const spreadPct = Math.min(0.9, Math.max(0.15, 1 - r2))
              const low = Math.max(0, incremental * (1 - spreadPct))
              const high = incremental * (1 + spreadPct)
              const confidenceLabel = r2 >= 0.3 ? "Moderate" : r2 >= 0.1 ? "Low" : "Very low"
              const confidenceColor = r2 >= 0.3 ? "text-green-400" : r2 >= 0.1 ? "text-amber-400" : "text-red-400"
              const confidenceBg = r2 >= 0.3 ? "border-green-500/30 bg-green-500/5" : r2 >= 0.1 ? "border-amber-500/30 bg-amber-500/5" : "border-red-500/30 bg-red-500/5"
              const isDim = r2 < 0.3
              return (
                <div className={`mb-4 rounded-lg border ${confidenceBg} p-4`}>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                        Estimated incremental from Meta
                      </p>
                      <p className={`mt-1 text-3xl font-semibold tabular-nums ${isDim ? "text-neutral-400" : "text-green-400"}`}>
                        {fmtCurrency(Math.max(0, incremental))}
                      </p>
                      <p className="mt-1 text-[11px] text-neutral-500">
                        Likely range: {fmtCurrency(low)}&nbsp;–&nbsp;{fmtCurrency(high)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-neutral-500">Confidence</p>
                      <p className={`mt-1 text-lg font-semibold ${confidenceColor}`}>
                        {confidenceLabel}
                      </p>
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        R²&nbsp;=&nbsp;{r2.toFixed(2)} on {bestReg.reg.n} weeks
                      </p>
                    </div>
                  </div>
                  {isDim && (
                    <p className="mt-3 text-[11px] leading-relaxed text-amber-300/80">
                      The model fit is weak, so the point estimate is sensitive to a handful of
                      weeks. Treat the range as the meaningful output — don&apos;t quote the
                      midpoint without it. A turn-off activity test or geo holdout would tighten
                      this considerably.
                    </p>
                  )}
                </div>
              )
            })()}

            <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
              <MetricCard
                label="R² (same week)"
                value={reg0.rSquared.toFixed(3)}
                tooltip="R² is the share of weekly revenue variation the model explains from Meta spend alone. 1.00 = perfect fit; 0.10 = spend explains ~10% of the weekly ups and downs. With small samples, anything below ~0.3 should be treated as weak."
              />
              <MetricCard
                label="R² (best lag)"
                value={`${bestReg.reg.rSquared.toFixed(3)} · ${bestReg.lag === 0 ? "same week" : `${bestReg.lag}w`}`}
                tooltip="The R² at whichever lag gave the strongest fit (same week, 1-, 2-, or 3-week delay). Used as the basis for the incremental estimate above."
              />
              <MetricCard
                label="Baseline weekly revenue"
                value={fmtCurrency(baselineWeekly)}
                tooltip="The regression's estimate of what weekly revenue would be if Meta spend dropped to zero — the y-intercept of the best-fit line. Treat as a counterfactual: 'this is roughly what we'd earn without Meta, holding everything else the same'. A turn-off activity test would prove or disprove this directly."
              />
              <MetricCard
                label="Share of total revenue"
                value={incremental > 0 ? `${incrementalSharePct.toFixed(1)}%` : "—"}
                tooltip={`${fmtCurrency(Math.max(0, incremental))} of ${fmtCurrency(totals.totalRevenue)} total revenue is attributable to Meta under this model.`}
              />
            </div>

            {incremental > 0 && (
              <p className="mt-4 text-[11px] text-neutral-600">
                Actual weekly average: {fmtCurrency(actualWeeklyAvg)}. That&apos;s +{baselineUpliftPct.toFixed(0)}% above the
                baseline weekly revenue the model predicts with zero Meta spend.
              </p>
            )}

          </Card>
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
  optional,
}: {
  label: string
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  rowCount: number
  hasContent?: boolean
  placeholder?: boolean
  optional?: boolean
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
        // Muted note for optional sources; more prominent for required ones.
        <p className={`mt-1 text-[11px] ${optional ? "text-neutral-500" : "text-amber-400"}`}>
          Couldn&apos;t read this file — skipping. Expected a date column and a value column.
        </p>
      ) : placeholder ? (
        <p className="mt-1 text-[11px] text-neutral-600">No data yet</p>
      ) : null}
    </div>
  )
}

function RoasCard({ label, sub, value, tooltip }: { label: string; sub: string; value: number; tooltip?: string }) {
  const color = value >= 2 ? "text-green-400" : value >= 1 ? "text-amber-400" : "text-red-400"
  const bg = value >= 2 ? "border-green-500/30" : value >= 1 ? "border-amber-500/30" : "border-red-500/30"
  return (
    <div className={`rounded-xl border ${bg} bg-neutral-900 p-4`}>
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

/**
 * Frames a correlation finding around where the signal is strongest, not just
 * whether it's above some threshold. Returns headline + optional hypothesis
 * for weak or negative cases so a client can't read "weak" as nothing to say.
 */
function describeFinding(
  lag: LagCorrelation,
  xName: string,
  yName: string
): { dotColor: string; headline: string; hypothesis: string | null } {
  const when = lag.lagWeeks === 0 ? "in the same week" : `at a ${lag.lagWeeks}-week delay`
  const r = lag.r
  const absR = Math.abs(r)

  if (r >= 0.6) {
    return {
      dotColor: "bg-green-400",
      headline: `${xName} closely tracks ${yName} ${when}.`,
      hypothesis: null,
    }
  }
  if (r >= 0.3) {
    return {
      dotColor: "bg-amber-400",
      headline: `${xName} moderately tracks ${yName} ${when}.`,
      hypothesis: null,
    }
  }
  if (r >= 0.1) {
    return {
      dotColor: "bg-neutral-500",
      headline: `${xName}'s strongest link to ${yName} is ${when} — but only a weak positive signal.`,
      hypothesis: `Could be noise from the small sample, or a real effect that longer data would sharpen. Strongest effects often need a controlled test to surface.`,
    }
  }
  if (absR < 0.1) {
    return {
      dotColor: "bg-neutral-500",
      headline: `No clear relationship between ${xName} and ${yName} at any lag tested (best: ${when}).`,
      hypothesis: `Either genuinely independent over this window, or a real effect buried in weekly noise. A longer time series or a geo holdout would help separate the two.`,
    }
  }
  if (r <= -0.3) {
    return {
      dotColor: "bg-red-400",
      headline: `${xName} and ${yName} moved in opposite directions ${when} (r = ${r.toFixed(2)}).`,
      hypothesis: `Could reflect cannibalisation (Meta capturing demand that would otherwise flow to ${yName.includes("search") ? "organic search" : yName}), a seasonal mismatch, or reverse timing of scale-ups. Worth inspecting the weeks driving this pattern.`,
    }
  }
  // -0.3 < r < -0.1 — weakly negative
  return {
    dotColor: "bg-neutral-500",
    headline: `${xName} and ${yName} drifted slightly in opposite directions ${when} (r = ${r.toFixed(2)}).`,
    hypothesis: `Likely noise in a short sample. Could also reflect a timing mismatch where Meta ramps and ${yName} peaks don't overlap, or Meta pulling volume from overlapping channels.`,
  }
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
  // Pick the lag with the highest absolute r — speaks to where the signal is
  // strongest, whether positive or negative.
  const best = lagSeries.length > 0
    ? lagSeries.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a))
    : null
  const [selectedLag, setSelectedLag] = useState<number | null>(best?.lagWeeks ?? null)

  // Reset selection when the underlying series changes (e.g. carry-over slider)
  useEffect(() => {
    setSelectedLag(best?.lagWeeks ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lagSeries])

  if (lagSeries.length === 0 || !best) return null
  const current = lagSeries.find((l) => l.lagWeeks === selectedLag) ?? best
  const { dotColor, headline, hypothesis } = describeFinding(current, xName, yName)

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-800/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
        <div className="flex-1">
          <p className="text-xs font-medium text-neutral-200">{headline}</p>
          <p className="mt-1 text-[11px] text-neutral-500">
            r&nbsp;=&nbsp;{current.r.toFixed(3)} across {current.n} weekly observations.
          </p>
          {hypothesis && (
            <p className="mt-1 text-[11px] italic text-neutral-500">{hypothesis}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 pl-6">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
          <span>Lag</span>
          <span
            className="inline-flex h-3 w-3 shrink-0 cursor-help items-center justify-center rounded-full border border-neutral-700 text-[8px] normal-case tracking-normal hover:border-neutral-500 hover:text-neutral-300"
            title="How many weeks we shift one series against the other before measuring correlation. 'Same week' = no shift; '2w' = this week's Meta spend compared against revenue 2 weeks later. Tests for delayed effects."
          >
            ?
          </span>
        </span>
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

/** Lag with the highest absolute r — where the signal is strongest, positive or negative. */
function bestLag(series: LagCorrelation[]): LagCorrelation | null {
  if (series.length === 0) return null
  return series.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a))
}

function SummaryCard({
  lagMetaToRevenue,
  lagMetaToAmazon,
  lagMetaToImpressions,
  lagClicksToRevenue,
  hasSearch,
  hasAmazon,
  weeksOfData,
  trueRoas,
  incrementalSharePct,
  bestRegRsq,
  bestRegLag,
}: {
  lagMetaToRevenue: LagCorrelation[]
  lagMetaToAmazon: LagCorrelation[]
  lagMetaToImpressions: LagCorrelation[]
  lagClicksToRevenue: LagCorrelation[]
  hasSearch: boolean
  hasAmazon: boolean
  weeksOfData: number
  trueRoas: number
  incrementalSharePct: number
  bestRegRsq: number
  bestRegLag: number
}) {
  const bestRev = bestLag(lagMetaToRevenue)
  const bestAmz = bestLag(lagMetaToAmazon)
  const bestImp = bestLag(lagMetaToImpressions)
  const bestClkRev = bestLag(lagClicksToRevenue)

  // Build findings list — each row uses describeFinding so it speaks to where
  // the signal is strongest and includes a hypothesis for weak/negative cases.
  const findings: { dotColor: string; headline: string; hypothesis: string | null; r: number }[] = []
  const addFinding = (lag: LagCorrelation | null, xName: string, yName: string) => {
    if (!lag) return
    const desc = describeFinding(lag, xName, yName)
    findings.push({ ...desc, r: lag.r })
  }
  addFinding(bestRev, "Meta spend", "Shopify revenue")
  if (hasAmazon) addFinding(bestAmz, "Meta spend", "Amazon sales")
  if (hasSearch) {
    addFinding(bestImp, "Meta spend", "search impressions")
    addFinding(bestClkRev, "Search clicks", "Shopify revenue")
  }

  // Headline — based on the strongest absolute signal across series
  const strongestOverall = [bestRev, bestAmz, bestImp, bestClkRev]
    .filter((l): l is LagCorrelation => l !== null)
    .reduce<LagCorrelation | null>(
      (a, b) => (a === null || Math.abs(b.r) > Math.abs(a.r) ? b : a),
      null
    )
  const headline = !strongestOverall
    ? "Not enough data yet to form a view."
    : strongestOverall.r >= 0.6
      ? "Meta spend closely tracks at least one downstream outcome in this window — suggestive but not conclusive. See the caveats below."
      : strongestOverall.r >= 0.3
        ? "Meta spend has a moderate relationship with downstream activity — consistent with some incremental impact but not a clean causal signal."
        : "No strong relationships surface between Meta spend and outcomes over this window. Either the signal is buried in weekly noise or effects are smaller than typical week-to-week variation."

  // Alternative explanation flags
  const alternatives: { key: string; title: string; body: string }[] = []

  // Carry-over effect — best lag > 0 and r >= 0.3 for any series
  const hasLaggedSignal =
    (bestRev && bestRev.lagWeeks >= 1 && bestRev.r >= 0.3) ||
    (bestAmz && bestAmz.lagWeeks >= 1 && bestAmz.r >= 0.3) ||
    (bestImp && bestImp.lagWeeks >= 1 && bestImp.r >= 0.3)
  if (hasLaggedSignal) {
    alternatives.push({
      key: "carry-over",
      title: "Carry-over effect (plausible)",
      body:
        "Lagged correlation is what you'd expect if Meta is building awareness that converts weeks later. Consistent with the story, but a lag can also reflect coincidence over a short window.",
    })
  }

  // Seasonality — always flag when sample is short, or when the strongest lag
  // overlaps with known seasonal windows (Jan / Nov-Dec)
  const shortSample = weeksOfData > 0 && weeksOfData < 26
  if (shortSample || alternatives.length > 0) {
    alternatives.push({
      key: "seasonality",
      title: "Seasonal demand (possible confound)",
      body: shortSample
        ? `With only ~${weeksOfData} weeks of data and no prior-year comparison, we can't separate ad-induced demand from seasonal demand. If spend was scaled up into a period where customers were going to buy anyway (New Year, Black Friday, back-to-school, etc.), the correlation reflects timing overlap rather than ad causation. The cleanest way to disambiguate: a turn-off activity test — pause Meta spend for a defined window and see whether revenue drops in line. A geo holdout (spend zero in one region, keep it on elsewhere) achieves the same without fully going dark.`
        : "Some of the observed correlation may reflect external demand drivers (seasonal, PR, promotions) that happen to coincide with spend changes rather than being caused by them. A turn-off or geo-holdout test would separate them.",
    })
  }

  // Reverse causation — same-week r dominates (bestLag === 0)
  const sameWeekDominates =
    (bestRev && bestRev.lagWeeks === 0 && bestRev.r >= 0.3) ||
    (bestAmz && bestAmz.lagWeeks === 0 && bestAmz.r >= 0.3)
  if (sameWeekDominates) {
    alternatives.push({
      key: "reverse",
      title: "Reverse causation (worth ruling out)",
      body:
        "The strongest correlation sits at the same-week mark, with no visible delay. That's consistent with ads driving immediate purchases, but also with the opposite: spend being ramped up in weeks where revenue was already rising. A planned test where spend is set independently of recent revenue would separate the two.",
    })
  }

  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Summary</h3>
      <p className="mb-4 text-xs text-neutral-300">{headline}</p>

      {findings.length > 0 && (
        <>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Key findings</p>
          <ul className="mb-5 space-y-2.5">
            {findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-neutral-200">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${f.dotColor}`} />
                <div className="flex-1">
                  <p>{f.headline}</p>
                  {f.hypothesis && (
                    <p className="mt-0.5 text-[11px] italic text-neutral-500">{f.hypothesis}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Context strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 rounded-lg border border-neutral-800 bg-neutral-800/30 p-3 text-[11px] md:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">True ROAS</p>
          <p className={`mt-0.5 font-semibold tabular-nums ${trueRoas >= 2 ? "text-green-400" : trueRoas >= 1 ? "text-amber-400" : "text-red-400"}`}>
            {trueRoas > 0 ? `${trueRoas.toFixed(2)}x` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Est. incremental share</p>
          <p className="mt-0.5 font-semibold tabular-nums text-neutral-200">
            {incrementalSharePct > 0 ? `${incrementalSharePct.toFixed(0)}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Model fit</p>
          <p className={`mt-0.5 font-semibold tabular-nums ${bestRegRsq >= 0.3 ? "text-green-400" : bestRegRsq >= 0.1 ? "text-amber-400" : "text-red-400"}`}>
            R² = {bestRegRsq.toFixed(2)}{" · "}
            <span className="font-normal text-neutral-500">
              {bestRegLag === 0 ? "same week" : `${bestRegLag}w lag`}
            </span>
          </p>
        </div>
      </div>

      {alternatives.length > 0 && (
        <>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
            Alternative explanations to consider
          </p>
          <div className="space-y-2.5">
            {alternatives.map((a) => (
              <div key={a.key} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-xs font-medium text-amber-300">{a.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{a.body}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
