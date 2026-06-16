"use client"

import { useMemo, useState } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, MetricCard } from "@/components/ui/card"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import type { WeeklyPerformanceRow } from "@/lib/utils/types"

type Props = {
  clientName: string
  rows: WeeklyPerformanceRow[]
}

const C = {
  grid: "#262626",
  axis: "#737373",
  tooltipBg: "#171717",
  tooltipBorder: "#262626",
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: C.tooltipBg,
    border: `1px solid ${C.tooltipBorder}`,
    borderRadius: "8px",
    fontSize: "13px",
  },
  labelStyle: { color: "#a3a3a3" },
}

/** The 7 modeled channel contributions, ordered for the stack + table. */
const CHANNELS: { key: keyof WeeklyPerformanceRow; label: string; color: string }[] = [
  { key: "meta", label: "Meta", color: "#60A5FA" },
  { key: "paid_search_brand", label: "Paid Search (Brand)", color: "#CDFF00" },
  { key: "paid_search_nonbrand", label: "Paid Search (Non-brand)", color: "#A3E635" },
  { key: "organic_branded", label: "Organic (Branded)", color: "#FBBF24" },
  { key: "organic_nonbranded", label: "Organic (Non-branded)", color: "#FB923C" },
  { key: "organic_social", label: "Organic Social", color: "#FF69B4" },
  { key: "pr", label: "PR", color: "#A78BFA" },
]

/** Approximate USD→GBP rate for the optional reporting toggle. */
const USD_TO_GBP = 0.79

const MATURITY_TOOLTIP =
  "still maturing — carryover from this week's spend is still landing; CAC/CPA provisional."

/** Bookings to 1 dp; blanks render as an em dash. */
function fmtBookings(n: number | null): string {
  if (n === null || !isFinite(n)) return "—"
  return n.toFixed(1)
}

export default function WeeklyPerformanceView({ clientName, rows }: Props) {
  // Signup decomposition isn't reliable yet — this tab is Bookings-only.
  const outcome = "Booking"
  const [currency, setCurrency] = useState<"USD" | "GBP">("USD")

  // Convert a USD value into the chosen reporting currency.
  const conv = (usd: number | null): number => {
    if (usd === null || !isFinite(usd)) return NaN
    return currency === "GBP" ? usd * USD_TO_GBP : usd
  }
  const money = (usd: number | null): string => fmtCurrency(conv(usd), currency)

  /* ─── chart series: stacked channels + variance band + CAC ──────────── */
  const chartData = useMemo(
    () =>
      rows.map((r) => {
        const row: Record<string, number | string | number[]> = {
          week: r.week_start.slice(5), // MM-DD
          band: [r.modeled_low, r.modeled_high], // ranged area
          blended_cac: r.blended_cac === null ? NaN : conv(r.blended_cac),
        }
        for (const ch of CHANNELS) row[ch.key] = (r[ch.key] as number) ?? 0
        return row
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, currency],
  )

  /* ─── summary cards ─────────────────────────────────────────────────── */
  const totals = useMemo(() => {
    const weeks = rows.length
    const totalActual = rows.reduce((s, r) => s + (r.actual ?? 0), 0)
    const totalSpend = rows.reduce((s, r) => s + r.paid_spend, 0)
    const overallCac = totalActual > 0 ? totalSpend / totalActual : null
    const latest = rows.length ? rows[rows.length - 1] : null
    return { weeks, totalActual, totalSpend, overallCac, latest }
  }, [rows])

  /* ─── per-channel breakdown (what the stacked area represents) ───────── */
  const channelBreakdown = useMemo(() => {
    const latestRow = rows.length ? rows[rows.length - 1] : null
    const perChannel = CHANNELS.map((ch) => {
      const total = rows.reduce((s, r) => s + ((r[ch.key] as number) ?? 0), 0)
      const latest = latestRow ? ((latestRow[ch.key] as number) ?? 0) : 0
      return { ...ch, total, latest }
    })
    const grandTotal = perChannel.reduce((s, c) => s + c.total, 0)
    const latestTotal = perChannel.reduce((s, c) => s + c.latest, 0)
    return {
      channels: perChannel.sort((a, b) => b.total - a.total),
      grandTotal,
      latestTotal,
      latestWeek: latestRow?.week_start ?? null,
    }
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <Header outcome={outcome} />
        <Card>
          <p className="py-10 text-center text-sm text-neutral-500">
            No weekly performance rows available.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header outcome={outcome} />

      {/* Caveat banner */}
      <div className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
        <span className="mt-0.5 text-neutral-500">i</span>
        <p className="flex-1">
          Bookings are low-volume, so these figures are directional — always read the shaded
          variance band, not just the point estimate. Recent weeks are provisional (Meta maturity
          below 100%): carryover from spend is still landing, so their CAC/CPA will move. The
          Signups channel-split isn&apos;t trustworthy yet, so this tab is limited to Bookings.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Outcome:</span>
          <div className="flex gap-1">
            <button
              className="rounded-lg bg-brand-lime px-3 py-1.5 text-xs font-medium text-neutral-900"
              disabled
            >
              Booking
            </button>
            <button
              className="cursor-not-allowed rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-600"
              disabled
              title="Signup decomposition isn't reliable yet."
            >
              Signup (experimental)
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Currency:</span>
          <div className="flex gap-1">
            {(["USD", "GBP"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  currency === c
                    ? "bg-brand-lime text-neutral-900"
                    : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {currency === "GBP" && (
            <span className="text-xs text-neutral-600" title={`Converted from USD @ ${USD_TO_GBP}`}>
              approx @ {USD_TO_GBP}
            </span>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Weeks" value={fmtNumber(totals.weeks)} />
        <MetricCard label="Total Bookings (actual)" value={fmtBookings(totals.totalActual)} />
        <MetricCard label="Paid Spend" value={money(totals.totalSpend)} />
        <MetricCard
          label="Blended CAC (overall)"
          value={totals.overallCac === null ? "—" : money(totals.overallCac)}
          subValue="paid spend ÷ actual bookings"
        />
      </div>

      {/* Stacked contributions + variance band + CAC */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-300">
            Modeled channel contributions over time
          </h3>
          <span className="text-xs text-neutral-500">
            stack = channels · shaded = variance band · line = blended CAC (right)
          </span>
        </div>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
            <XAxis dataKey="week" tick={{ fill: C.axis, fontSize: 11 }} />
            <YAxis
              yAxisId="left"
              tick={{ fill: C.axis, fontSize: 11 }}
              label={{ value: "bookings", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: C.axis, fontSize: 11 }}
              tickFormatter={(v: number) => money(v)}
            />
            <Tooltip
              {...tooltipStyle}
              formatter={(value: unknown, name: string) => {
                if (name === "Variance band") {
                  const [lo, hi] = value as number[]
                  return [`${fmtBookings(lo)} – ${fmtBookings(hi)}`, name]
                }
                if (name === "Blended CAC") return [money(value as number), name]
                return [fmtBookings(value as number), name]
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {/* Variance band (rendered first, light translucent fill) */}
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="band"
              name="Variance band"
              stroke="#737373"
              strokeWidth={1}
              strokeDasharray="4 3"
              fill="#737373"
              fillOpacity={0.12}
              connectNulls
              activeDot={false}
            />
            {/* Stacked channel contributions */}
            {CHANNELS.map((ch) => (
              <Area
                key={ch.key as string}
                yAxisId="left"
                type="monotone"
                dataKey={ch.key as string}
                name={ch.label}
                stackId="channels"
                stroke={ch.color}
                fill={ch.color}
                fillOpacity={0.7}
              />
            ))}
            {/* Blended CAC line on the right axis */}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="blended_cac"
              name="Blended CAC"
              stroke="#FFFFFF"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Channel breakdown — explains the stacked area */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-300">Breakdown by channel</h3>
          <span className="text-xs text-neutral-500">
            what the stacked area represents · {totals.weeks} weeks
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-xs text-neutral-500">
                <th className="px-2 py-2 text-left">Channel</th>
                <th className="px-2 py-2 text-right">Total bookings</th>
                <th className="px-2 py-2 text-right">Share</th>
                <th className="px-2 py-2 text-right">Avg / week</th>
                <th className="px-2 py-2 text-right whitespace-nowrap">
                  Latest wk{channelBreakdown.latestWeek ? ` (${channelBreakdown.latestWeek})` : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {channelBreakdown.channels.map((ch) => {
                const share =
                  channelBreakdown.grandTotal > 0
                    ? (ch.total / channelBreakdown.grandTotal) * 100
                    : 0
                return (
                  <tr
                    key={ch.key as string}
                    className="border-b border-neutral-900 text-neutral-300 hover:bg-neutral-900"
                  >
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: ch.color }}
                        />
                        {ch.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtBookings(ch.total)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{share.toFixed(1)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                      {fmtBookings(totals.weeks > 0 ? ch.total / totals.weeks : 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                      {fmtBookings(ch.latest)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-800 font-medium text-neutral-200">
                <td className="px-2 py-2">Modeled total</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtBookings(channelBreakdown.grandTotal)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">100.0%</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtBookings(totals.weeks > 0 ? channelBreakdown.grandTotal / totals.weeks : 0)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtBookings(channelBreakdown.latestTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Modeled contributions are the model&apos;s attribution of bookings to each channel — they
          sum to the modeled total (the top of the stack), which is directional and sits within the
          variance band rather than matching actuals exactly.
        </p>
      </Card>

      {/* Weekly table */}
      <Card>
        <h3 className="mb-3 text-sm font-medium text-neutral-300">Weekly detail</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-xs text-neutral-500">
                <th className="px-2 py-2 text-left">Week</th>
                <th className="px-2 py-2 text-right">Actual</th>
                {CHANNELS.map((ch) => (
                  <th key={ch.key as string} className="px-2 py-2 text-right whitespace-nowrap">
                    {ch.label}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Paid Spend</th>
                <th className="px-2 py-2 text-right">Blended CAC</th>
                <th className="px-2 py-2 text-right">Meta CPA</th>
                <th className="px-2 py-2 text-right">Maturity</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r) => {
                  const provisional = r.meta_maturity_pct < 100
                  return (
                    <tr
                      key={r.week_start}
                      className={`border-b border-neutral-900 hover:bg-neutral-900 ${
                        provisional ? "text-neutral-500" : "text-neutral-300"
                      }`}
                    >
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                        {r.week_start}
                        {provisional && (
                          <span className="ml-1 text-neutral-500" title={MATURITY_TOOLTIP}>
                            *
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtBookings(r.actual)}</td>
                      {CHANNELS.map((ch) => (
                        <td key={ch.key as string} className="px-2 py-2 text-right tabular-nums">
                          {fmtBookings(r[ch.key] as number)}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right tabular-nums">{money(r.paid_spend)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(r.blended_cac)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(r.meta_cpa)}</td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={provisional ? MATURITY_TOOLTIP : undefined}
                      >
                        {r.meta_maturity_pct.toFixed(0)}%{provisional && <span className="ml-0.5">*</span>}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          * still maturing — carryover from this week&apos;s spend is still landing; CAC/CPA
          provisional. Showing {clientName} bookings, most recent week first.
        </p>
      </Card>
    </div>
  )
}

function Header({ outcome }: { outcome: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold">Weekly Performance</h2>
        <p className="text-sm text-neutral-400">
          Ezra attribution model — modeled channel contributions vs actuals · {outcome}s
        </p>
      </div>
    </div>
  )
}
