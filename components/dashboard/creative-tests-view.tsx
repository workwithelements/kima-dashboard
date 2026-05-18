"use client"

import { useState, useMemo } from "react"
import type {
  CreativeTest,
  CreativeTestResult,
  CreativeTestConfig,
  AdsetRank,
} from "@/lib/data/fetch-creative-tests"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"
import { isConformingAdName } from "@/lib/utils/ad-name-parser"
import { CLASSIFICATIONS } from "@/lib/utils/creative-classification"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"

type Props = {
  tests: CreativeTest[]
  results: Record<string, CreativeTestResult[]>
  config: CreativeTestConfig | null
  thumbnails: Record<string, string>
  currency: string
  keyAction: string
  /** True when a key action is configured anywhere (test config OR scorecard) */
  hasKeyAction: boolean
  clientId: string
  adNames: Record<string, string>
  namingConfig?: NamingConfig
  adsetRanks: Record<string, AdsetRank>
  recentAdSpend: Record<string, number>
}

type ViewTab = "current" | "completed"

const OUTCOME_BADGES: Record<string, { label: string; emoji: string; className: string }> = {
  win: { label: "Win", emoji: "\u{1F3C6}", className: "bg-green-500/15 text-green-400 border-green-500/30" },
  lose: { label: "Lose", emoji: "\u274C", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  inconclusive: { label: "Inconclusive", emoji: "\u{1F50D}", className: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" },
}

/** Group of tests sharing the same concept name across different adsets */
type ConceptGroup = {
  conceptName: string
  tests: CreativeTest[]
  totalSpend: number
  totalConversions: number
  variantCount: number
  adsetCount: number
  allAdIds: string[]
}

function getResultConversions(r: CreativeTestResult, keyAction: string): number {
  switch (keyAction) {
    case "landing_page_views": return r.landing_page_views
    case "adds_to_cart": return r.adds_to_cart
    case "checkouts_initiated": return r.checkouts_initiated
    default: return r.purchases
  }
}

export default function CreativeTestsView({
  tests,
  results,
  config,
  thumbnails,
  currency,
  keyAction,
  hasKeyAction,
  clientId,
  adNames,
  namingConfig,
  adsetRanks,
  recentAdSpend,
}: Props) {
  const [tab, setTab] = useState<ViewTab>("current")
  const [expandedConcept, setExpandedConcept] = useState<string | null>(null)
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [notionUrl, setNotionUrl] = useState("")
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [dismissingConcept, setDismissingConcept] = useState<string | null>(null)

  const thresholds = {
    minDays: config?.min_days_live ?? 5,
    minSpend: config?.min_spend ?? 100,
    minConversions: config?.min_conversions ?? 10,
  }

  const convLabel =
    keyAction === "adds_to_cart" ? "ATCs" :
    keyAction === "registrations_completed" ? "Regs" :
    keyAction === "checkouts_initiated" ? "Checkouts" :
    keyAction === "landing_page_views" ? "LPVs" :
    "Purchases"

  // Always filter to conforming tests (correct naming conventions only)
  const conformingTests = useMemo(() => {
    return tests.filter((test) =>
      test.variant_ad_ids.length > 0 &&
      test.variant_ad_ids.every((adId) => {
        const name = adNames[adId]
        return name && isConformingAdName(name, namingConfig)
      })
    )
  }, [tests, adNames, namingConfig])

  // Split into current (not yet analysed) and completed (analysed). We trust
  // kima-sync's status here — a "monitoring" test should surface as soon as
  // it's detected, even before any variant has spent. New launches need time
  // to accumulate spend; gating on recent spend made them invisible.
  // Dismissed tests are hidden by default and reappear via the toggle.
  const currentTests = useMemo(() =>
    conformingTests.filter((t) => t.status !== "analysed" && !t.dismissed_at),
    [conformingTests]
  )

  const dismissedCurrentTests = useMemo(() =>
    conformingTests.filter((t) => t.status !== "analysed" && t.dismissed_at),
    [conformingTests]
  )

  const completedTests = useMemo(() =>
    conformingTests.filter((t) => t.status === "analysed"),
    [conformingTests]
  )

  // Diagnostics for the empty state — only consider non-analysed, non-dismissed
  // tests. When the empty state triggers we know every pending test failed the
  // conforming check, so pendingTests.length is the non-conforming count.
  const pendingTests = useMemo(
    () => tests.filter((t) => t.status !== "analysed" && !t.dismissed_at),
    [tests]
  )

  const sampleNonConformingNames = useMemo(() => {
    const names = new Set<string>()
    for (const test of pendingTests) {
      for (const adId of test.variant_ad_ids) {
        const name = adNames[adId]
        if (name && !isConformingAdName(name, namingConfig)) {
          names.add(name)
          if (names.size >= 5) return Array.from(names)
        }
      }
    }
    return Array.from(names)
  }, [pendingTests, adNames, namingConfig])

  function groupByConcept(testsToGroup: CreativeTest[]): ConceptGroup[] {
    const map = new Map<string, ConceptGroup>()
    for (const test of testsToGroup) {
      const existing = map.get(test.concept_name)
      if (existing) {
        existing.tests.push(test)
        existing.totalSpend += test.total_spend
        existing.totalConversions += test.total_conversions
        existing.variantCount += test.variant_count
        existing.adsetCount += 1
        existing.allAdIds.push(...test.variant_ad_ids)
      } else {
        map.set(test.concept_name, {
          conceptName: test.concept_name,
          tests: [test],
          totalSpend: test.total_spend,
          totalConversions: test.total_conversions,
          variantCount: test.variant_count,
          adsetCount: 1,
          allAdIds: [...test.variant_ad_ids],
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalSpend - a.totalSpend)
  }

  // Group current tests by concept name (across adsets)
  const conceptGroups = useMemo(() => groupByConcept(currentTests), [currentTests])
  const dismissedGroups = useMemo(() => groupByConcept(dismissedCurrentTests), [dismissedCurrentTests])

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

  async function handleRunAnalysis(testId: string) {
    setAnalyzingId(testId)
    try {
      await fetch(`/api/creative-tests/${testId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    } catch (e) {
      console.error("Failed to queue analysis:", e)
    }
  }

  async function handleSetDismissed(group: ConceptGroup, dismissed: boolean) {
    if (dismissed && !window.confirm(
      `Hide "${group.conceptName}" from creative tests? You can restore it from "Show dismissed".`
    )) return

    setDismissingConcept(group.conceptName)
    try {
      await Promise.all(group.tests.map((t) =>
        fetch(`/api/creative-tests/${t.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dismissed }),
        })
      ))
      window.location.reload()
    } catch (e) {
      console.error("Failed to update dismissed state:", e)
      setDismissingConcept(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header: tabs + naming filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setTab("current")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === "current"
                ? "bg-brand-lime/10 text-brand-lime border border-brand-lime/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Current Tests
            {currentTests.length > 0 && (
              <span className="ml-2 rounded-full bg-neutral-800 px-2 py-0.5 text-xs">
                {conceptGroups.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("completed")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === "completed"
                ? "bg-brand-lime/10 text-brand-lime border border-brand-lime/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Completed
            {completedTests.length > 0 && (
              <span className="ml-2 rounded-full bg-neutral-800 px-2 py-0.5 text-xs">
                {completedTests.length}
              </span>
            )}
          </button>
        </div>
        {tab === "current" && dismissedGroups.length > 0 && (
          <button
            onClick={() => setShowDismissed((v) => !v)}
            className="text-xs text-neutral-500 hover:text-white"
          >
            {showDismissed ? "Hide" : "Show"} dismissed ({dismissedGroups.length})
          </button>
        )}
      </div>

      {/* Warn only when no key action is configured anywhere — the dashboard
          falls back to client_scorecard_config.key_action, matching kima-sync. */}
      {!hasKeyAction && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
          No test optimisation event set. Go to Settings and set the scorecard&apos;s
          Key Action (e.g. Purchases, Add to Cart, Registration) — or override it
          per-test via Settings &gt; Creative Tests.
        </div>
      )}

      {/* ── CURRENT TESTS TAB ── */}
      {tab === "current" && (
        <>
          {conceptGroups.length === 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8">
              {!config?.enabled ? (
                <p className="text-center text-neutral-500">
                  Creative test scanning is not enabled for this client. Enable it in Settings.
                </p>
              ) : pendingTests.length === 0 ? (
                <div className="text-center text-sm">
                  <p className="text-neutral-300 mb-2">No tests detected yet.</p>
                  <p className="text-xs text-neutral-500">
                    Tests are detected after the daily Meta sync. New launches typically
                    appear within 24h of the next sync run.
                  </p>
                </div>
              ) : (
                <div className="text-sm">
                  <p className="text-neutral-300 mb-2">
                    {pendingTests.length} test{pendingTests.length !== 1 ? "s" : ""} detected,
                    but variant ad names don&apos;t match the naming convention.
                  </p>
                  <p className="text-xs text-neutral-500 mb-3">
                    Names need {namingConfig
                      ? "to match the configured positions in Settings > Naming Config"
                      : "at least 4 underscore-delimited parts with a non-empty conceptName at index 3"}.
                  </p>
                  {sampleNonConformingNames.length > 0 && (
                    <div className="rounded-lg bg-neutral-800/50 px-3 py-2 text-[11px] text-neutral-400">
                      <p className="text-neutral-500 mb-1">Sample non-conforming names:</p>
                      <ul className="space-y-0.5 font-mono">
                        {sampleNonConformingNames.map((n) => (
                          <li key={n} className="truncate">{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {conceptGroups.map((group) => {
              const isExpanded = expandedConcept === group.conceptName
              // Collect all thumbnails for the concept
              const thumbIds = group.allAdIds.filter((id) => thumbnails[id]).slice(0, 4)

              return (
                <div
                  key={group.conceptName}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden"
                >
                  {/* Concept header */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-neutral-800/50 transition"
                    onClick={() => setExpandedConcept(isExpanded ? null : group.conceptName)}
                  >
                    {/* Thumbnails */}
                    <div className="flex -space-x-2 shrink-0">
                      {thumbIds.map((adId) => (
                        <img
                          key={adId}
                          src={thumbnails[adId]}
                          alt=""
                          className="h-10 w-10 rounded-lg border-2 border-neutral-900 object-cover"
                        />
                      ))}
                      {thumbIds.length === 0 && (
                        <div className="h-10 w-10 rounded-lg border-2 border-neutral-900 bg-neutral-800" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{group.conceptName}</span>
                        <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                          {group.variantCount} variants
                        </span>
                        {group.adsetCount > 1 && (
                          <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400 border border-blue-500/30">
                            {group.adsetCount} ad sets
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-500 truncate">
                        {group.tests.map((t) => t.adset_name || t.adset_id).join(", ")}
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="hidden sm:flex items-center gap-6 text-sm text-neutral-400">
                      <div>
                        <span className="text-neutral-500 text-xs">Spend</span>
                        <div>{fmtCurrency(group.totalSpend, currency)}</div>
                      </div>
                      <div>
                        <span className="text-neutral-500 text-xs">{convLabel}</span>
                        <div>{fmtNumber(group.totalConversions)}</div>
                      </div>
                    </div>

                    {/* Status badges + Notion link */}
                    <div className="flex items-center gap-2 shrink-0">
                      {(() => {
                        const notionTest = group.tests.find((t) => t.notion_page_url)
                        return notionTest?.notion_page_url ? (
                          <a
                            href={notionTest.notion_page_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Notion &rarr;
                          </a>
                        ) : null
                      })()}
                      {group.tests.some((t) => t.status === "ready") && (
                        <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400 border-amber-500/30">
                          Ready
                        </span>
                      )}
                      {group.tests.every((t) => t.status === "monitoring") && (
                        <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-400 border-blue-500/30">
                          Monitoring
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSetDismissed(group, true) }}
                        disabled={dismissingConcept === group.conceptName}
                        title="Dismiss this test"
                        className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400 transition disabled:opacity-50"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <svg
                      className={`h-4 w-4 shrink-0 text-neutral-500 transition ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Expanded: show per-adset breakdown */}
                  {isExpanded && (
                    <div className="border-t border-neutral-800">
                      {group.tests.map((test) => (
                        <div key={test.id} className="border-b border-neutral-800 last:border-b-0">
                          <div className="flex items-center gap-4 px-4 py-3 bg-neutral-800/30">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-neutral-300">
                                  {test.adset_name || test.adset_id}
                                </span>
                                {test.notion_page_url && (
                                  <a
                                    href={test.notion_page_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-400 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Notion
                                  </a>
                                )}
                              </div>
                              <div className="text-xs text-neutral-500">
                                {test.variant_count} variants &middot; {test.days_live} days &middot; {fmtCurrency(test.total_spend, currency)} spend
                              </div>
                            </div>

                            {/* Progress or ready button */}
                            {test.status === "ready" ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRunAnalysis(test.id) }}
                                disabled={analyzingId === test.id}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                  analyzingId === test.id
                                    ? "bg-neutral-700 text-neutral-500 cursor-not-allowed"
                                    : "bg-brand-lime text-black hover:bg-brand-lime/90"
                                }`}
                              >
                                {analyzingId === test.id ? "Queued" : "Run Analysis"}
                              </button>
                            ) : (
                              <div className="flex items-center gap-3 text-xs text-neutral-500">
                                <span>{test.days_live} / {thresholds.minDays} days</span>
                                <span>{fmtCurrency(test.total_spend, currency)} / {fmtCurrency(thresholds.minSpend, currency)}</span>
                                <span>{test.total_conversions} / {thresholds.minConversions} {convLabel.toLowerCase()}</span>
                              </div>
                            )}

                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
                              test.status === "ready"
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                            }`}>
                              {test.status === "monitoring" ? "Active" : test.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {showDismissed && dismissedGroups.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Dismissed
              </div>
              {dismissedGroups.map((group) => (
                <div
                  key={group.conceptName}
                  className="flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate text-neutral-300">{group.conceptName}</span>
                      <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-500">
                        {group.variantCount} variants
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500 truncate">
                      {group.tests.map((t) => t.adset_name || t.adset_id).join(", ")}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSetDismissed(group, false)}
                    disabled={dismissingConcept === group.conceptName}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── COMPLETED TESTS TAB ── */}
      {tab === "completed" && (
        <>
          {completedTests.length === 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-12 text-center">
              <div className="text-neutral-500">
                No completed tests yet. Tests move here after analysis.
              </div>
            </div>
          )}

          <div className="space-y-3">
            {completedTests.map((test) => {
              const testResults = results[test.id] ?? []
              const isExpanded = expandedTestId === test.id
              const isLinking = linkingId === test.id

              return (
                <div
                  key={test.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden"
                >
                  {/* Card header */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-neutral-800/50 transition"
                    onClick={() => setExpandedTestId(isExpanded ? null : test.id)}
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

                    {/* Metrics */}
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

                    {/* Outcome badge */}
                    <div className="flex items-center gap-2 shrink-0">
                      {test.outcome && OUTCOME_BADGES[test.outcome] && (
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${OUTCOME_BADGES[test.outcome].className}`}>
                          {OUTCOME_BADGES[test.outcome].emoji} {OUTCOME_BADGES[test.outcome].label}
                        </span>
                      )}
                    </div>

                    {/* Notion link */}
                    {test.notion_page_url && (
                      <a
                        href={test.notion_page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-sm text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View &rarr;
                      </a>
                    )}

                    <svg
                      className={`h-4 w-4 shrink-0 text-neutral-500 transition ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Link Notion (if not linked) */}
                  {!test.notion_page_url && (
                    <div className="flex items-center gap-3 border-t border-neutral-800 px-4 py-2.5">
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
                              <th className="pb-2 pr-4 text-right">Rank</th>
                              <th className="pb-2 pr-4">Class</th>
                            </tr>
                          </thead>
                          <tbody>
                            {testResults
                              .sort((a, b) => (a.cpa ?? 9999) - (b.cpa ?? 9999))
                              .map((r) => {
                                const classKey = r.classification as keyof typeof CLASSIFICATIONS
                                const classDef = CLASSIFICATIONS[classKey]
                                const rank = adsetRanks[r.ad_id]

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
                                    <td className="py-2 pr-4 text-right">{fmtNumber(getResultConversions(r, keyAction))}</td>
                                    <td className="py-2 pr-4 text-right">
                                      {r.cpa != null ? fmtCurrency(r.cpa, currency) : "—"}
                                    </td>
                                    <td className="py-2 pr-4 text-right">
                                      {r.roas != null ? `${r.roas.toFixed(1)}x` : "—"}
                                    </td>
                                    <td className="py-2 pr-4 text-right text-neutral-400">
                                      {rank ? `${rank.rank} / ${rank.total}` : "—"}
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
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
