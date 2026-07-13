"use client"

import { useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, MetricCard } from "@/components/ui/card"
import DateRangePicker from "@/components/ui/date-range-picker"
import PaybackSparkline from "@/components/charts/payback-sparkline"
import LtvAssumptionsModal from "@/components/dashboard/ltv-assumptions-modal"
import {
  aggregateAdEcon,
  STATUS_META,
  type AdStatus,
  type EconDailyRow,
  type LtvAssumptions,
  type ScoredAdRow,
} from "@/lib/utils/unit-economics"
import { fmtCurrencyWhole, fmtDateFull, fmtNumber, fmtPercent } from "@/lib/utils/format"
import type { DatePreset } from "@/lib/utils/dates"

const STATUS_BADGE: Record<AdStatus, string> = {
  self_funding: "border-green-500/30 bg-green-500/15 text-green-400",
  healthy: "border-teal-500/30 bg-teal-500/15 text-teal-300",
  acceptable: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  over_ceiling: "border-red-500/30 bg-red-500/15 text-red-400",
}

const STATUS_DOT: Record<AdStatus, string> = {
  self_funding: "bg-green-400",
  healthy: "bg-teal-300",
  acceptable: "bg-amber-400",
  over_ceiling: "bg-red-400",
}

const STATUS_ORDER: AdStatus[] = ["self_funding", "healthy", "acceptable", "over_ceiling"]

type SortKey = "net" | "value" | "spend" | "cpa" | "ltvCac" | "payback"

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "net", label: "Est. net" },
  { key: "value", label: "Est. value" },
  { key: "spend", label: "Spend" },
  { key: "cpa", label: "CPA" },
  { key: "ltvCac", label: "LTV:CAC" },
  { key: "payback", label: "Payback" },
]

function fmtPayback(m: number | null): string {
  if (m === null) return ">24 mo"
  if (m === 0) return "day 0"
  return `${m.toFixed(1)} mo`
}

function mixSourceNote(row: ScoredAdRow): string | null {
  if (row.mixSource === "account_average") return "Account-average annual mix — no applications data for this ad"
  if (row.mixSource === "manual_fallback") return "Manual fallback annual mix from Assumptions — no applications data synced"
  if (row.mixClamped) return "Applications exceeded purchases (attribution lag) — mix clamped to 100%"
  return null
}

type Props = {
  clientId: string
  currency: string
  dailyRows: EconDailyRow[]
  initialAssumptions: LtvAssumptions
  initialUpdatedAt: string | null
  initialUpdatedBy: string | null
  applicationsColumnPresent: boolean
  isAdmin: boolean
  preset: DatePreset
  from: string
  to: string
}

export default function UnitEconomicsView({
  clientId,
  currency,
  dailyRows,
  initialAssumptions,
  initialUpdatedAt,
  initialUpdatedBy,
  applicationsColumnPresent,
  isAdmin,
  preset,
  from,
  to,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [assumptions, setAssumptions] = useState(initialAssumptions)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [updatedBy, setUpdatedBy] = useState(initialUpdatedBy)
  const [showAssumptions, setShowAssumptions] = useState(false)
  const [statusFilter, setStatusFilter] = useState<AdStatus | "all">("all")
  const [sortKey, setSortKey] = useState<SortKey>("net")
  const [sortDesc, setSortDesc] = useState(true)
  const [expandedAdId, setExpandedAdId] = useState<string | null>(null)

  function handlePresetChange(newPreset: DatePreset) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("preset", newPreset)
    params.delete("from")
    params.delete("to")
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleCustomChange(newFrom: string, newTo: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("preset", "custom")
    params.set("from", newFrom)
    params.set("to", newTo)
    router.push(`${pathname}?${params.toString()}`)
  }

  const { rows, summary, applicationsDataAvailable } = useMemo(
    () => aggregateAdEcon(dailyRows, assumptions),
    [dailyRows, assumptions]
  )

  const visibleRows = useMemo(() => {
    const filtered = rows.filter(
      (r) => statusFilter === "all" || (!r.noData && r.score?.status === statusFilter)
    )
    const dir = sortDesc ? -1 : 1
    const val = (r: ScoredAdRow): number => {
      if (r.noData || !r.score) return sortDesc ? -Infinity : Infinity
      switch (sortKey) {
        case "net":
          return r.score.estTotalNet
        case "value":
          return r.score.estTotalValue
        case "spend":
          return r.spend
        case "cpa":
          return r.cpa ?? 0
        case "ltvCac":
          return r.score.ltvCac
        case "payback":
          // null payback (>horizon) is the worst outcome regardless of direction
          return r.score.paybackMonth === null ? assumptions.horizonMonths + 1 : r.score.paybackMonth
      }
    }
    return [...filtered].sort((a, b) => {
      // no-data rows always sink to the bottom
      if (a.noData !== b.noData) return a.noData ? 1 : -1
      return (val(a) - val(b)) * dir
    })
  }, [rows, statusFilter, sortKey, sortDesc, assumptions.horizonMonths])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      // Cost-like columns default ascending (lower is better)
      setSortDesc(!(key === "cpa" || key === "payback"))
    }
  }

  const statusChipText = STATUS_ORDER.filter((s) => summary.statusCounts[s] > 0)
    .map((s) => `${summary.statusCounts[s]} ${STATUS_META[s].label.toLowerCase()}`)
    .join(", ")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium text-neutral-400">Unit Economics — LTV Model</h2>
          <p className="mt-0.5 text-[11px] text-neutral-600">
            {updatedAt
              ? `Assumptions last updated ${fmtDateFull(updatedAt.split("T")[0])}${updatedBy ? ` by ${updatedBy}` : ""}`
              : "Assumptions: using defaults (never saved)"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowAssumptions(true)}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-brand-lime/60 hover:text-brand-lime"
          >
            {isAdmin ? "Edit assumptions" : "View assumptions"}
          </button>
          <DateRangePicker
            preset={preset}
            from={from}
            to={to}
            onPresetChange={handlePresetChange}
            onCustomChange={handleCustomChange}
          />
        </div>
      </div>

      {/* Modelled-data disclaimer */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-[11px] text-neutral-500">
        All values are <span className="text-neutral-300">modelled estimates</span> from the LTV
        assumptions (median LTVs, sampled renewal rates) — a decisioning tool, not booked revenue.
      </div>

      {/* Applications data not yet synced */}
      {!applicationsDataAvailable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          {applicationsColumnPresent
            ? "No annual-plan (applications submitted) data in this range yet — every ad is using the manual fallback annual mix"
            : "Annual-plan (applications submitted) data is not synced yet — every ad is using the manual fallback annual mix"}{" "}
          ({fmtPercent(assumptions.fallbackAnnualMix * 100, 0)}, editable in Assumptions). Blended
          LTVs are understated if the real annual mix is higher.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Total Spend" value={fmtCurrencyWhole(summary.totalSpend, currency)} />
        <MetricCard label="Total Conversions" value={fmtNumber(summary.totalConversions)} />
        <MetricCard
          label="Blended Annual Mix"
          value={
            summary.blendedAnnualMix !== null
              ? fmtPercent(summary.blendedAnnualMix * 100, 0)
              : "—"
          }
          subValue="conversion-weighted"
        />
        <MetricCard
          label="Est. Total Value"
          value={fmtCurrencyWhole(summary.aggEstValue, currency)}
          subValue="blended LTV × conversions"
        />
        <Card>
          <p className="text-xs text-neutral-400">Est. Net Contribution</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              summary.aggEstNet >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {fmtCurrencyWhole(summary.aggEstNet, currency)}
          </p>
          <p className="mt-1 text-xs text-neutral-500">value − spend, scored ads</p>
        </Card>
      </div>

      {/* Status counts + filter pills */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setStatusFilter("all")}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              statusFilter === "all"
                ? "border-brand-lime/60 bg-brand-lime/10 text-brand-lime"
                : "border-neutral-700 text-neutral-400 hover:text-white"
            }`}
          >
            All ({rows.length - summary.noDataCount})
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              title={STATUS_META[s].explanation}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                statusFilter === s
                  ? STATUS_BADGE[s]
                  : "border-neutral-700 text-neutral-400 hover:text-white"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]}`} />
              {STATUS_META[s].label} ({summary.statusCounts[s]})
            </button>
          ))}
          {summary.noDataCount > 0 && (
            <span className="px-1 text-[11px] text-neutral-600">
              +{summary.noDataCount} no data
            </span>
          )}
        </div>
        {statusChipText && (
          <p className="text-[11px] text-neutral-600">{statusChipText}</p>
        )}
      </div>

      {/* Per-ad table */}
      <Card className="overflow-x-auto !p-0">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Ad</th>
              {[
                { key: "spend" as SortKey, label: "Spend" },
                { key: null, label: "Conv." },
                { key: "cpa" as SortKey, label: "CPA" },
                { key: null, label: "Annual Mix" },
                { key: null, label: "Blended LTV" },
                { key: "ltvCac" as SortKey, label: "LTV:CAC" },
                { key: "payback" as SortKey, label: "Payback" },
                { key: null, label: "" },
                { key: "value" as SortKey, label: "Est. Value" },
                { key: "net" as SortKey, label: "Est. Net" },
                { key: null, label: "Status" },
              ].map((col, i) =>
                col.key ? (
                  <th key={i} className="px-3 py-3 text-right font-medium">
                    <button
                      onClick={() => toggleSort(col.key!)}
                      className={`transition hover:text-white ${sortKey === col.key ? "text-brand-lime" : ""}`}
                    >
                      {col.label}
                      {sortKey === col.key && <span className="ml-0.5">{sortDesc ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                ) : (
                  <th key={i} className={`px-3 py-3 font-medium ${col.label ? "text-right" : ""}`}>
                    {col.label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-xs text-neutral-500">
                  No ads in this range{statusFilter !== "all" ? " with this status" : ""}.
                </td>
              </tr>
            )}
            {visibleRows.map((r) => {
              const expanded = expandedAdId === r.adId
              const note = mixSourceNote(r)
              return (
                <FragmentRow
                  key={r.adId}
                  row={r}
                  currency={currency}
                  ltvCacTarget={assumptions.ltvCacTarget}
                  expanded={expanded}
                  note={note}
                  onToggle={() => setExpandedAdId(expanded ? null : r.adId)}
                />
              )
            })}
          </tbody>
        </table>
      </Card>

      {/* Three-tier CAC legend */}
      <Card className="text-xs">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
          How the verdicts work
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="flex items-start gap-2">
              <span
                className={`mt-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s]}`}
              >
                {STATUS_META[s].label}
              </span>
              <span className="text-neutral-500">{STATUS_META[s].explanation}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-neutral-600">
          Each ad&apos;s CPA is checked against three ceilings: <span className="text-neutral-400">immediate</span>{" "}
          (day-0 cash: annual upfront + discounted first month), <span className="text-neutral-400">in-between</span>{" "}
          (annual year-1 + full monthly LTV, no renewal risk), and <span className="text-neutral-400">max</span>{" "}
          (full blended LTV keeping the target margin). Expand any row to see its ceilings.
        </p>
      </Card>

      {showAssumptions && (
        <LtvAssumptionsModal
          clientId={clientId}
          currency={currency}
          assumptions={assumptions}
          updatedAt={updatedAt}
          updatedBy={updatedBy}
          canEdit={isAdmin}
          onClose={() => setShowAssumptions(false)}
          onSaved={(cfg, at, by) => {
            setAssumptions(cfg)
            setUpdatedAt(at)
            setUpdatedBy(by)
            setShowAssumptions(false)
          }}
        />
      )}
    </div>
  )
}

function FragmentRow({
  row: r,
  currency,
  ltvCacTarget,
  expanded,
  note,
  onToggle,
}: {
  row: ScoredAdRow
  currency: string
  ltvCacTarget: number
  expanded: boolean
  note: string | null
  onToggle: () => void
}) {
  const s = r.score
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-neutral-800/60 transition hover:bg-neutral-800/30 ${
          r.noData ? "opacity-40" : ""
        }`}
      >
        <td className="max-w-[220px] px-4 py-2.5">
          <p className="truncate text-xs text-white" title={r.adName}>
            {r.adName}
          </p>
          <p className="truncate text-[10px] text-neutral-500" title={r.campaignName}>
            {r.campaignName}
          </p>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{fmtCurrencyWhole(r.spend, currency)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{fmtNumber(r.conversions)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {r.cpa !== null ? fmtCurrencyWhole(r.cpa, currency) : "—"}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {r.annualMix !== null ? (
            <span className="inline-flex items-center gap-1" title={note ?? undefined}>
              {r.usedFallbackMix && <span className="text-[10px] text-amber-400">~</span>}
              {fmtPercent(r.annualMix * 100, 0)}
              {(r.usedFallbackMix || r.mixClamped) && (
                <span className={`h-1.5 w-1.5 rounded-full ${r.mixClamped ? "bg-red-400" : "bg-amber-400"}`} />
              )}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {s ? fmtCurrencyWhole(s.blendedLTV, currency) : "—"}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {s ? (
            <span className={s.ltvCac >= ltvCacTarget ? "text-brand-lime" : ""}>
              {s.ltvCac.toFixed(1)}x
              <span className="ml-0.5 text-[10px] text-neutral-600">/{ltvCacTarget.toFixed(1)}x</span>
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{s ? fmtPayback(s.paybackMonth) : "—"}</td>
        <td className="px-2 py-2.5">
          {s && r.cpa !== null && (
            <PaybackSparkline curve={s.curve} cpa={r.cpa} paybackMonth={s.paybackMonth} />
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {s ? fmtCurrencyWhole(s.estTotalValue, currency) : "—"}
        </td>
        <td
          className={`px-3 py-2.5 text-right tabular-nums ${
            s ? (s.estTotalNet >= 0 ? "text-green-400" : "text-red-400") : ""
          }`}
        >
          {s ? fmtCurrencyWhole(s.estTotalNet, currency) : "—"}
        </td>
        <td className="px-3 py-2.5">
          {s ? (
            <span
              className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s.status]}`}
              title={STATUS_META[s.status].explanation}
            >
              {STATUS_META[s.status].label}
            </span>
          ) : (
            <span className="whitespace-nowrap rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-500">
              no data
            </span>
          )}
        </td>
      </tr>
      {expanded && s && r.cpa !== null && (
        <tr className="border-b border-neutral-800/60 bg-neutral-800/20">
          <td colSpan={12} className="px-4 py-3">
            <CeilingLadder row={r} currency={currency} note={note} />
          </td>
        </tr>
      )}
    </>
  )
}

/** The three CAC ceilings with the ad's CPA positioned against them. */
function CeilingLadder({
  row: r,
  currency,
  note,
}: {
  row: ScoredAdRow
  currency: string
  note: string | null
}) {
  const s = r.score!
  const cpa = r.cpa!
  const max = Math.max(s.maxCAC, cpa) * 1.1
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`

  const ceilings = [
    { label: "Self-funding ceiling", sub: "day-0 cash only", value: s.immCAC, color: "bg-green-400" },
    { label: "Healthy ceiling", sub: "annual yr-1 + monthly LTV", value: s.midCAC, color: "bg-teal-300" },
    { label: "Max CAC", sub: `full LTV − target margin`, value: s.maxCAC, color: "bg-amber-400" },
  ]

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-neutral-400">
        <span>
          CPA <span className="font-semibold text-white">{fmtCurrencyWhole(cpa, currency)}</span>
        </span>
        <span>
          Blended LTV <span className="font-semibold text-white">{fmtCurrencyWhole(s.blendedLTV, currency)}</span>
        </span>
        <span>
          Net / customer{" "}
          <span className={`font-semibold ${s.netPerCustomer >= 0 ? "text-green-400" : "text-red-400"}`}>
            {fmtCurrencyWhole(s.netPerCustomer, currency)}
          </span>
        </span>
        {r.applicationsSubmitted !== null && (
          <span>
            Annual conversions{" "}
            <span className="font-semibold text-white">
              {fmtNumber(Math.min(r.applicationsSubmitted, r.purchases))} of {fmtNumber(r.purchases)}
            </span>
          </span>
        )}
      </div>

      {/* Ladder bar */}
      <div className="relative mt-1 h-8">
        <div className="absolute inset-x-0 top-3 h-2 rounded bg-neutral-800" />
        {ceilings.map((c) => (
          <div key={c.label} className="absolute top-2" style={{ left: pct(c.value) }} title={`${c.label}: ${fmtCurrencyWhole(c.value, currency)} — ${c.sub}`}>
            <div className={`h-4 w-0.5 ${c.color}`} />
          </div>
        ))}
        {/* CPA marker */}
        <div className="absolute top-0" style={{ left: pct(cpa) }}>
          <div className="h-8 w-0.5 bg-white" />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span className="text-neutral-500">
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-white align-middle" /> CPA
        </span>
        {ceilings.map((c) => (
          <span key={c.label} className="text-neutral-500">
            <span className={`mr-1 inline-block h-2 w-2 rounded-sm align-middle ${c.color}`} />
            {c.label}: <span className="text-neutral-300">{fmtCurrencyWhole(c.value, currency)}</span>
            <span className="ml-1 text-neutral-600">({c.sub})</span>
          </span>
        ))}
      </div>

      {note && <p className="text-[11px] text-amber-400/90">{note}</p>}
    </div>
  )
}
