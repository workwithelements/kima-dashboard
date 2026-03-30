"use client"

import { useState } from "react"
import type {
  CreativeTest,
  CreativeTestResult,
  CreativeTestConfig,
} from "@/lib/data/fetch-creative-tests"
import { CLASSIFICATIONS } from "@/lib/utils/creative-classification"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"

type Props = {
  tests: CreativeTest[]
  results: Record<string, CreativeTestResult[]>
  config: CreativeTestConfig | null
  thumbnails: Record<string, string>
  currency: string
  keyAction: string
  clientId: string
}

type StatusFilter = "all" | "monitoring" | "ready" | "analysed" | "flagged"

const STATUS_COLORS: Record<string, string> = {
  monitoring: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  ready: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  analysed: "bg-green-500/15 text-green-400 border-green-500/30",
  flagged: "bg-red-500/15 text-red-400 border-red-500/30",
}

const OUTCOME_BADGES: Record<string, { label: string; emoji: string; className: string }> = {
  win: { label: "Win", emoji: "\u{1F3C6}", className: "bg-green-500/15 text-green-400 border-green-500/30" },
  lose: { label: "Lose", emoji: "\u274C", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  inconclusive: { label: "Inconclusive", emoji: "\u{1F50D}", className: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" },
}

export default function CreativeTestsView({
  tests,
  results,
  config,
  thumbnails,
  currency,
  keyAction,
  clientId,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [notionUrl, setNotionUrl] = useState("")

  const thresholds = {
    minDays: config?.min_days_live ?? 7,
    minSpend: config?.min_spend ?? 100,
    minConversions: config?.min_conversions ?? 10,
  }

  // Counts by status
  const counts = { monitoring: 0, ready: 0, analysed: 0, flagged: 0 }
  for (const t of tests) counts[t.status]++

  const filtered = filter === "all" ? tests : tests.filter((t) => t.status === filter)

  const convLabel =
    keyAction === "adds_to_cart" ? "ATCs" :
    keyAction === "registrations_completed" ? "Regs" :
    keyAction === "checkouts_initiated" ? "Checkouts" :
    keyAction === "landing_page_views" ? "LPVs" :
    "Purchases"

  async function handleLinkNotion(testId: string) {
    if (!notionUrl.trim()) return
    try {
      await fetch(`/api/creative-tests/${testId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notion_page_url: notionUrl.trim() }),
      })
      window.location.reload()
    } catch (e) {
      console.error("Failed to link Notion card:", e)
    }
  }

  async function handleDismiss(testId: string) {
    try {
      await fetch(`/api/creative-tests/${testId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismiss: true }),
      })
      window.location.reload()
    } catch (e) {
      console.error("Failed to dismiss:", e)
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {(["monitoring", "ready", "analysed", "flagged"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? "all" : s)}
            className={`rounded-xl border p-4 text-left transition ${
              filter === s
                ? "border-brand-lime/40 bg-brand-lime/5"
                : "border-neutral-800 bg-neutral-900 hover:border-neutral-700"
            }`}
          >
            <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              {s === "monitoring" ? "Active" : s.charAt(0).toUpperCase() + s.slice(1)}
            </div>
            <div className="mt-1 text-2xl font-semibold">{counts[s]}</div>
          </button>
        ))}
      </div>

      {/* Empty state */}
      {tests.length === 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-12 text-center">
          <div className="text-neutral-500">
            {config?.enabled
              ? "No creative tests detected yet. Tests will appear after the next daily sync."
              : "Creative test scanning is not enabled for this client. Enable it in Settings."}
          </div>
        </div>
      )}

      {/* Test cards */}
      <div className="space-y-3">
        {filtered.map((test) => {
          const testResults = results[test.id] ?? []
          const isExpanded = expandedId === test.id
          const isLinking = linkingId === test.id

          return (
            <div
              key={test.id}
              className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden"
            >
              {/* Card header */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-neutral-800/50 transition"
                onClick={() => setExpandedId(isExpanded ? null : test.id)}
              >
                {/* Thumbnails */}
                <div className="flex -space-x-2 shrink-0">
                  {test.variant_ad_ids.slice(0, 4).map((adId) => (
                    thumbnails[adId] ? (
                      <img
                        key={adId}
                        src={thumbnails[adId]}
                        alt=""
                        className="h-10 w-10 rounded-lg border-2 border-neutral-900 object-cover"
                      />
                    ) : (
                      <div
                        key={adId}
                        className="h-10 w-10 rounded-lg border-2 border-neutral-900 bg-neutral-800"
                      />
                    )
                  ))}
                  {test.variant_count > 4 && (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-neutral-900 bg-neutral-800 text-xs text-neutral-400">
                      +{test.variant_count - 4}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{test.concept_name}</span>
                    <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                      {test.variant_count} variants
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500 truncate">
                    {test.adset_name || test.adset_id}
                  </div>
                </div>

                {/* Metrics summary */}
                <div className="hidden sm:flex items-center gap-6 text-sm text-neutral-400">
                  <div>
                    <span className="text-neutral-500 text-xs">Spend</span>
                    <div>{fmtCurrency(test.total_spend, currency)}</div>
                  </div>
                  <div>
                    <span className="text-neutral-500 text-xs">{convLabel}</span>
                    <div>{fmtNumber(test.total_conversions)}</div>
                  </div>
                  <div>
                    <span className="text-neutral-500 text-xs">Days</span>
                    <div>{test.days_live}</div>
                  </div>
                </div>

                {/* Status + outcome badges */}
                <div className="flex items-center gap-2 shrink-0">
                  {test.outcome && OUTCOME_BADGES[test.outcome] && (
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${OUTCOME_BADGES[test.outcome].className}`}>
                      {OUTCOME_BADGES[test.outcome].emoji} {OUTCOME_BADGES[test.outcome].label}
                    </span>
                  )}
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[test.status]}`}>
                    {test.status}
                  </span>
                </div>

                {/* Expand chevron */}
                <svg
                  className={`h-4 w-4 shrink-0 text-neutral-500 transition ${isExpanded ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Progress bars (for monitoring/ready) */}
              {(test.status === "monitoring" || test.status === "ready") && (
                <div className="grid grid-cols-3 gap-4 border-t border-neutral-800 px-4 py-3">
                  <ProgressBar
                    label="Days live"
                    value={test.days_live}
                    target={thresholds.minDays}
                    suffix={`/ ${thresholds.minDays}`}
                  />
                  <ProgressBar
                    label="Spend"
                    value={test.total_spend}
                    target={thresholds.minSpend}
                    displayValue={fmtCurrency(test.total_spend, currency)}
                    suffix={`/ ${fmtCurrency(thresholds.minSpend, currency)}`}
                  />
                  <ProgressBar
                    label={convLabel}
                    value={test.total_conversions}
                    target={thresholds.minConversions}
                    suffix={`/ ${thresholds.minConversions}`}
                  />
                </div>
              )}

              {/* Flag reason */}
              {test.flag_reason && (
                <div className="flex items-center gap-2 border-t border-neutral-800 bg-red-500/5 px-4 py-2.5 text-sm text-red-400">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  {test.flag_reason}
                </div>
              )}

              {/* Notion link / actions */}
              {(test.status === "analysed" || test.status === "flagged") && (
                <div className="flex items-center gap-3 border-t border-neutral-800 px-4 py-2.5">
                  {test.notion_page_url ? (
                    <a
                      href={test.notion_page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View Notion card &rarr;
                    </a>
                  ) : (
                    <>
                      {isLinking ? (
                        <div className="flex items-center gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Paste Notion page URL..."
                            value={notionUrl}
                            onChange={(e) => setNotionUrl(e.target.value)}
                            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                            autoFocus
                          />
                          <button
                            onClick={() => handleLinkNotion(test.id)}
                            className="rounded-lg bg-brand-lime px-3 py-1.5 text-sm font-medium text-black"
                          >
                            Link
                          </button>
                          <button
                            onClick={() => { setLinkingId(null); setNotionUrl("") }}
                            className="text-sm text-neutral-500 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setLinkingId(test.id); setNotionUrl("") }}
                          className="text-sm text-amber-400 hover:underline"
                        >
                          Link Notion card
                        </button>
                      )}
                    </>
                  )}

                  {test.status === "flagged" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDismiss(test.id) }}
                      className="ml-auto text-sm text-neutral-500 hover:text-white"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}

              {/* Expanded results table */}
              {isExpanded && testResults.length > 0 && (
                <div className="border-t border-neutral-800 p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                          <th className="pb-2 pr-4">Variant</th>
                          <th className="pb-2 pr-4 text-right">Spend</th>
                          <th className="pb-2 pr-4 text-right">Impr</th>
                          <th className="pb-2 pr-4 text-right">LPV</th>
                          <th className="pb-2 pr-4 text-right">ATC</th>
                          <th className="pb-2 pr-4 text-right">{convLabel}</th>
                          <th className="pb-2 pr-4 text-right">CPA</th>
                          <th className="pb-2 pr-4 text-right">ROAS</th>
                          <th className="pb-2 pr-4 text-right">Landing</th>
                          <th className="pb-2 pr-4">Status</th>
                          <th className="pb-2 pr-4">Class</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testResults
                          .sort((a, b) => (a.cpa ?? 9999) - (b.cpa ?? 9999))
                          .map((r) => {
                            const classKey = r.classification as keyof typeof CLASSIFICATIONS
                            const classDef = CLASSIFICATIONS[classKey]

                            return (
                              <tr
                                key={r.ad_id}
                                className={`border-t border-neutral-800 ${r.is_best_variant ? "bg-green-500/5" : ""}`}
                              >
                                <td className="py-2 pr-4">
                                  <div className="flex items-center gap-2">
                                    {r.is_best_variant && (
                                      <span className="text-green-400" title="Best variant">&#9733;</span>
                                    )}
                                    <span className="truncate max-w-[200px]">
                                      {r.hook_label || r.ad_name?.split("_").slice(3, 5).join(" ") || r.ad_id}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2 pr-4 text-right">{fmtCurrency(r.spend, currency)}</td>
                                <td className="py-2 pr-4 text-right">{fmtNumber(r.impressions)}</td>
                                <td className="py-2 pr-4 text-right">{fmtNumber(r.landing_page_views)}</td>
                                <td className="py-2 pr-4 text-right">{fmtNumber(r.adds_to_cart)}</td>
                                <td className="py-2 pr-4 text-right">{fmtNumber(r.purchases)}</td>
                                <td className="py-2 pr-4 text-right">
                                  {r.cpa != null ? fmtCurrency(r.cpa, currency) : "—"}
                                </td>
                                <td className="py-2 pr-4 text-right">
                                  {r.roas != null ? `${r.roas.toFixed(1)}x` : "—"}
                                </td>
                                <td className="py-2 pr-4 text-right">
                                  {r.landing_rate != null ? fmtPercent(r.landing_rate) : "—"}
                                </td>
                                <td className="py-2 pr-4">
                                  {r.fatigue_status && r.fatigue_status !== "healthy" && (
                                    <span className={`rounded-full border px-2 py-0.5 text-xs ${
                                      r.fatigue_status === "fatigued"
                                        ? "border-red-500/30 bg-red-500/15 text-red-400"
                                        : "border-amber-500/30 bg-amber-500/15 text-amber-400"
                                    }`}>
                                      {r.fatigue_status}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 pr-4">
                                  {classDef && (
                                    <span className={`rounded-full border px-2 py-0.5 text-xs ${classDef.bgColor}`}>
                                      {classDef.label}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  </div>

                  {/* Recent performance note */}
                  {testResults.some((r) => r.recent_spend > 0) && (
                    <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
                      <div className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-2">
                        Last 7 Days
                      </div>
                      <div className="flex gap-6 text-sm">
                        {testResults
                          .filter((r) => r.recent_spend > 0)
                          .sort((a, b) => (a.recent_cpa ?? 9999) - (b.recent_cpa ?? 9999))
                          .map((r) => (
                            <div key={r.ad_id} className="flex items-center gap-2">
                              <span className="text-neutral-400">{r.hook_label || "—"}</span>
                              <span className="text-neutral-500">
                                {fmtCurrency(r.recent_spend, currency)} spend
                              </span>
                              <span>
                                {r.recent_conversions} {convLabel.toLowerCase()}
                              </span>
                              {r.recent_cpa != null && (
                                <span className="text-neutral-400">
                                  CPA {fmtCurrency(r.recent_cpa, currency)}
                                </span>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Expanded empty state for non-analysed */}
              {isExpanded && testResults.length === 0 && test.status !== "analysed" && (
                <div className="border-t border-neutral-800 p-4 text-sm text-neutral-500">
                  Variant analysis will run automatically once this test reaches readiness thresholds.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProgressBar({
  label,
  value,
  target,
  displayValue,
  suffix,
}: {
  label: string
  value: number
  target: number
  displayValue?: string
  suffix: string
}) {
  const pct = Math.min((value / target) * 100, 100)
  const complete = value >= target

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-neutral-500">{label}</span>
        <span className={complete ? "text-green-400" : "text-neutral-400"}>
          {displayValue ?? value} {suffix}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-neutral-800">
        <div
          className={`h-1.5 rounded-full transition-all ${complete ? "bg-green-500" : "bg-brand-lime"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
