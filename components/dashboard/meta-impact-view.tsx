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
  buildMonthlySummaries,
  buildWeeklyPoints,
  lagCorrelationSeries,
  laggedRegression,
  DEFAULT_META_SPEND,
  MANAGEMENT_FEE_MONTHLY,
  type DailyRevenueRow,
  type MonthlySummary,
} from "@/lib/utils/meta-impact"

type Props = {
  clientId: string
}

const STORAGE_TOTAL = "meta-impact:total-csv"
const STORAGE_PAID = "meta-impact:paid-csv"

export default function MetaImpactView({ clientId }: Props) {
  const [totalCsv, setTotalCsv] = useState<string>("")
  const [paidCsv, setPaidCsv] = useState<string>("")

  // Load any cached CSVs from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    const t = localStorage.getItem(`${STORAGE_TOTAL}:${clientId}`)
    const p = localStorage.getItem(`${STORAGE_PAID}:${clientId}`)
    if (t) setTotalCsv(t)
    if (p) setPaidCsv(p)
  }, [clientId])

  const handleUpload = useCallback(
    (which: "total" | "paid") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const text = await file.text()
      if (which === "total") {
        setTotalCsv(text)
        localStorage.setItem(`${STORAGE_TOTAL}:${clientId}`, text)
      } else {
        setPaidCsv(text)
        localStorage.setItem(`${STORAGE_PAID}:${clientId}`, text)
      }
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

  const monthlySummaries: MonthlySummary[] = useMemo(
    () => buildMonthlySummaries(totalRows, paidRows, DEFAULT_META_SPEND),
    [totalRows, paidRows]
  )

  const weeklyPoints = useMemo(
    () => buildWeeklyPoints(totalRows, paidRows, DEFAULT_META_SPEND),
    [totalRows, paidRows]
  )

  const lagSeries = useMemo(() => lagCorrelationSeries(weeklyPoints, 3), [weeklyPoints])
  const reg0 = useMemo(() => laggedRegression(weeklyPoints, 0), [weeklyPoints])
  const reg1 = useMemo(() => laggedRegression(weeklyPoints, 1), [weeklyPoints])

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

  // Estimated incremental revenue from the lag-1 regression intercept
  const baselineWeekly = reg1.intercept
  const baselineTotal = baselineWeekly * weeklyPoints.length
  const incremental = totals.totalRevenue - baselineTotal

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

  const noData = totalRows.length === 0 && paidRows.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Meta Impact</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Quantifies the relationship between Meta Ads spend and total Shopify revenue
          to estimate the incremental impact of advertising on the business.
        </p>
      </div>

      {/* CSV upload */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Data Sources</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">
              Shopify Total Revenue (Weekly_orders_less_B2B.csv)
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleUpload("total")}
              className="block w-full text-xs text-neutral-400 file:mr-3 file:rounded file:border-0 file:bg-brand-lime/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-lime hover:file:bg-brand-lime/30"
            />
            {totalRows.length > 0 && (
              <p className="mt-1 text-[11px] text-green-400">
                Loaded {totalRows.length} daily rows
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">
              Shopify Paid Orders - last click (Paid_orders.csv)
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleUpload("paid")}
              className="block w-full text-xs text-neutral-400 file:mr-3 file:rounded file:border-0 file:bg-brand-lime/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-lime hover:file:bg-brand-lime/30"
            />
            {paidRows.length > 0 && (
              <p className="mt-1 text-[11px] text-green-400">
                Loaded {paidRows.length} daily rows
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-neutral-600">
          Meta spend is hard-coded for Jan-Mar 2026 (replace with Windsor.ai integration later).
          Files are cached in your browser, no upload to the server.
        </p>
      </Card>

      {noData && (
        <Card>
          <p className="text-sm text-neutral-500">
            Upload both CSV files above to see the analysis.
          </p>
        </Card>
      )}

      {!noData && (
        <>
          {/* ── Section 6 (top): ROAS gauge cards ── */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <RoasCard label="Headline ROAS" sub="Shopify total / Meta spend" value={headlineRoas} />
            <RoasCard label="True ROAS" sub="Shopify total / total marketing cost" value={trueRoas} />
            <RoasCard label="Last-Click ROAS" sub="Shopify paid / Meta spend" value={lastClickRoas} />
          </div>

          {/* ── Section 1: Monthly Revenue vs Cost Table ── */}
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

          {/* ── Section 2: Three-Way Attribution ── */}
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
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#171717",
                      border: "1px solid #404040",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Shopify Total Orders" fill="#CDFF00" />
                  <Bar dataKey="Meta Pixel Purchases" fill="#FF69B4" />
                  <Bar dataKey="Last-Click Paid Orders" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ── Section 3: Weekly trend dual axis ── */}
          {weeklyPoints.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Weekly Revenue vs Meta Spend</h3>
              <p className="mb-3 text-xs text-neutral-500">
                Shopify revenue against Meta spend at the same-week level. Meta spend is
                spread evenly across the days of each month.
              </p>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={weeklyPoints}>
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
                      tickFormatter={(v) => `£${(v / 1000).toFixed(1)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#171717",
                        border: "1px solid #404040",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => fmtCurrency(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="revenue"
                      name="Shopify Revenue"
                      stroke="#CDFF00"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="metaSpend"
                      name="Meta Spend"
                      stroke="#FF69B4"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* ── Section 4: Lag correlation ── */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Lag Correlation Analysis</h3>
            <p className="mb-3 text-xs text-neutral-500">
              How strongly does Meta spend in week N correlate with Shopify revenue in
              week N+lag? A peak at lag-1 suggests Meta drives purchases roughly a week
              after exposure.
            </p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lagSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis
                    dataKey="lagWeeks"
                    stroke="#737373"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v}w`}
                  />
                  <YAxis
                    stroke="#737373"
                    tick={{ fontSize: 11 }}
                    domain={[-1, 1]}
                    tickFormatter={(v) => v.toFixed(1)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#171717",
                      border: "1px solid #404040",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => v.toFixed(3)}
                    labelFormatter={(l) => `Lag ${l} weeks`}
                  />
                  <Bar dataKey="r" name="Pearson r" fill="#CDFF00" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ── Section 5: Regression summary ── */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Regression Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
              <Metric label="R² (same week)" value={reg0.rSquared.toFixed(3)} />
              <Metric label="R² (1-week lag)" value={reg1.rSquared.toFixed(3)} />
              <Metric label="Baseline weekly revenue" value={fmtCurrency(Math.max(0, baselineWeekly))} />
              <Metric
                label="Estimated incremental from Meta"
                value={fmtCurrency(Math.max(0, incremental))}
                positive={incremental > 0}
              />
            </div>
            <p className="mt-3 text-[11px] text-neutral-600">
              Baseline weekly revenue is the regression intercept (the level expected with
              zero Meta spend). Incremental is total revenue minus baseline scaled across
              the period. This is directional only - a holdout test would be needed for
              causal proof.
            </p>
          </Card>
        </>
      )}
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

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${positive ? "text-green-400" : "text-neutral-200"}`}>
        {value}
      </p>
    </div>
  )
}
