export const dynamic = "force-dynamic"

import Link from "next/link"
import { createServiceClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
import { monthStart, today, daysAgo } from "@/lib/utils/dates"
import { dailySpendSeries } from "@/lib/utils/aggregate"
import { calculatePacing } from "@/lib/utils/pacing"
import { fmtCurrency, fmtPercent } from "@/lib/utils/format"
import { PACING_STATUS_CONFIG } from "@/lib/utils/types"
import type { PacingResult } from "@/lib/utils/pacing"

type ClientPacingRow = {
  id: string
  name: string
  currency: string
  pacing: PacingResult
}

export default async function PacingOverviewPage() {
  const supabase = createServiceClient()

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  // Fetch all active clients with budgets
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, currency_code, monthly_budget")
    .eq("active", true)
    .order("name")

  if (!clients?.length) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Pacing Overview</h1>
          <p className="text-sm text-neutral-400">Monthly budget pacing across all clients</p>
        </div>
        <Card>
          <p className="text-center text-sm text-neutral-500">No active clients found.</p>
        </Card>
      </div>
    )
  }

  // Fetch current month + historical spend for all clients from both platforms
  // Wrap Google Ads queries in .catch() in case table doesn't exist yet
  const [metaCurrent, gaCurrent, metaHistorical, gaHistorical] = await Promise.all([
    supabase
      .from("meta_daily_performance")
      .select("date, client_id, spend")
      .gte("date", monthStart())
      .lte("date", today())
      .order("date")
      .limit(10000),
    Promise.resolve(
      supabase
        .from("google_ads_daily_performance")
        .select("date, client_id, spend")
        .gte("date", monthStart())
        .lte("date", today())
        .order("date")
        .limit(10000)
    ).catch(() => ({ data: [] as any[] })),
    supabase
      .from("meta_daily_performance")
      .select("date, client_id, spend")
      .gte("date", daysAgo(90))
      .lte("date", today())
      .order("date")
      .limit(50000),
    Promise.resolve(
      supabase
        .from("google_ads_daily_performance")
        .select("date, client_id, spend")
        .gte("date", daysAgo(90))
        .lte("date", today())
        .order("date")
        .limit(50000)
    ).catch(() => ({ data: [] as any[] })),
  ])

  // Combine Meta + Google Ads rows
  const currentMonthRows = [
    ...(metaCurrent.data || []),
    ...(gaCurrent.data || []),
  ]
  const historicalRows = [
    ...(metaHistorical.data || []),
    ...(gaHistorical.data || []),
  ]

  // Group by client
  function groupByClient(rows: { date: string; client_id: string; spend: number }[]) {
    const grouped: Record<string, { date: string; spend: number }[]> = {}
    for (const row of rows || []) {
      if (!grouped[row.client_id]) grouped[row.client_id] = []
      grouped[row.client_id].push({ date: row.date, spend: row.spend || 0 })
    }
    // Aggregate to daily per client
    const result: Record<string, { date: string; spend: number }[]> = {}
    for (const [clientId, clientRows] of Object.entries(grouped)) {
      result[clientId] = dailySpendSeries(clientRows)
    }
    return result
  }

  const currentByClient = groupByClient(currentMonthRows || [])
  const historicalByClient = groupByClient(historicalRows || [])

  // Calculate pacing for each client
  const clientPacing: ClientPacingRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    currency: (c as any).currency_code ?? "GBP",
    pacing: calculatePacing(
      currentByClient[c.id] || [],
      (c as any).monthly_budget || null,
      year,
      month,
      historicalByClient[c.id]
    ),
  }))

  // Sort: flagged statuses first, then by spend desc
  const statusOrder: Record<string, number> = {
    significantly_over: 0,
    significantly_under: 1,
    slightly_over: 2,
    slightly_under: 3,
    on_track: 4,
    no_budget: 5,
  }

  clientPacing.sort((a, b) => {
    const statusDiff = statusOrder[a.pacing.status] - statusOrder[b.pacing.status]
    if (statusDiff !== 0) return statusDiff
    return b.pacing.spentToDate - a.pacing.spentToDate
  })

  // Summary counts
  const onTrack = clientPacing.filter((c) => c.pacing.status === "on_track").length
  const flagged = clientPacing.filter((c) =>
    ["significantly_over", "significantly_under", "slightly_over", "slightly_under"].includes(c.pacing.status)
  ).length
  const noBudget = clientPacing.filter((c) => c.pacing.status === "no_budget").length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pacing Overview</h1>
        <p className="text-sm text-neutral-400">
          Monthly budget pacing &middot; {clients.length} client{clients.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg bg-green-950/30 px-4 py-2 text-sm">
          <span className="font-semibold text-green-400">{onTrack}</span>
          <span className="ml-1.5 text-neutral-400">On Track</span>
        </div>
        <div className="rounded-lg bg-amber-950/30 px-4 py-2 text-sm">
          <span className="font-semibold text-amber-400">{flagged}</span>
          <span className="ml-1.5 text-neutral-400">Flagged</span>
        </div>
        <div className="rounded-lg bg-neutral-800/50 px-4 py-2 text-sm">
          <span className="font-semibold text-neutral-400">{noBudget}</span>
          <span className="ml-1.5 text-neutral-500">No Budget</span>
        </div>
      </div>

      {/* Pacing table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Client
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Budget
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Spent
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Projected
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Pacing
                </th>
                <th className="px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Status
                </th>
                <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Progress
                </th>
              </tr>
            </thead>
            <tbody>
              {clientPacing.map((row) => {
                const config = PACING_STATUS_CONFIG[row.pacing.status]
                const progressPct = row.pacing.budget
                  ? Math.min(100, (row.pacing.spentToDate / row.pacing.budget) * 100)
                  : 0
                const expectedPct = row.pacing.budget
                  ? Math.min(100, (row.pacing.expectedSpend / row.pacing.budget) * 100)
                  : 0

                return (
                  <tr
                    key={row.id}
                    className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-xs font-medium">
                      <Link
                        href={`/dashboard/clients/${row.id}/pacing`}
                        className="text-white transition hover:text-brand-lime"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-neutral-300">
                      {row.pacing.budget ? fmtCurrency(row.pacing.budget, row.currency) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-neutral-300">
                      {fmtCurrency(row.pacing.spentToDate, row.currency)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-neutral-300">
                      {fmtCurrency(row.pacing.projectedSpend, row.currency)}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums font-medium ${config.color}`}>
                      {row.pacing.pacingPct !== null ? fmtPercent(row.pacing.pacingPct, 1) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-center text-xs">
                      <span className={`font-medium ${config.color}`}>
                        {config.icon} {config.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {row.pacing.budget ? (
                        <div className="relative h-2 w-24 overflow-hidden rounded-full bg-neutral-800">
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full ${
                              row.pacing.status === "on_track"
                                ? "bg-green-500"
                                : row.pacing.status.startsWith("slightly")
                                  ? "bg-amber-500"
                                  : row.pacing.status === "no_budget"
                                    ? "bg-neutral-600"
                                    : "bg-red-500"
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                          <div
                            className="absolute inset-y-0 w-px bg-white/40"
                            style={{ left: `${expectedPct}%` }}
                          />
                        </div>
                      ) : (
                        <span className="text-[10px] text-neutral-600">No budget</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
