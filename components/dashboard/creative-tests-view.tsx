"use client"

import { useMemo, useState } from "react"
import type {
  CreativeTest,
  CreativeTestResult,
  CreativeTestConfig,
  AdsetRank,
  TestEventTotals,
} from "@/lib/data/fetch-creative-tests"
import type { AdsetGoal } from "@/lib/data/fetch-adset-goals"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"
import { isConformingAdName, parseAdName } from "@/lib/utils/ad-name-parser"
import { CLASSIFICATIONS } from "@/lib/utils/creative-classification"
import { KEY_ACTIONS, isKeyAction, keyActionLabel, keyActionShort, type KeyAction } from "@/lib/utils/key-actions"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import AdCreativeMedia from "@/components/dashboard/ad-creative-media"
import AdHoverPreview from "@/components/dashboard/ad-hover-preview"

type Props = {
  tests: CreativeTest[]
  results: Record<string, CreativeTestResult[]>
  config: CreativeTestConfig | null
  currency: string
  keyAction: string
  /** True when a key action is configured anywhere (test config OR scorecard) */
  hasKeyAction: boolean
  clientId: string
  adNames: Record<string, string>
  namingConfig?: NamingConfig
  adsetRanks: Record<string, AdsetRank>
  recentAdSpend: Record<string, number>
  campaignNames: Record<string, string>
  adsetCampaigns: Record<string, string>
  testEventTotals: Record<string, TestEventTotals>
  adsetGoals: Record<string, AdsetGoal>
}

type ViewTab = "live" | "completed"

const OUTCOME_SECTIONS: { key: string; title: string; className: string }[] = [
  { key: "win", title: "\u{1F3C6} Wins", className: "text-green-400" },
  { key: "lose", title: "❌ Losses", className: "text-red-400" },
  { key: "inconclusive", title: "\u{1F50D} Inconclusive", className: "text-neutral-400" },
  { key: "none", title: "Analysed — awaiting outcome", className: "text-neutral-500" },
]

const OUTCOME_BADGES: Record<string, { label: string; emoji: string; className: string }> = {
  win: { label: "Win", emoji: "\u{1F3C6}", className: "bg-green-500/15 text-green-400 border-green-500/30" },
  lose: { label: "Lose", emoji: "❌", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  inconclusive: { label: "Inconclusive", emoji: "\u{1F50D}", className: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" },
}

/** Group of tests sharing the same concept name within one campaign */
type ConceptGroup = {
  conceptName: string
  /** Meta-concept-name segment parsed from the ad name (display name) */
  displayName: string
  campaignId: string
  tests: CreativeTest[]
  totalSpend: number
  allAdIds: string[]
  variantCount: number
}

type CampaignGroup = {
  campaignId: string
  campaignName: string
  concepts: ConceptGroup[]
  totalSpend: number
}

export default function CreativeTestsView({
  tests,
  results,
  config,
  currency,
  keyAction,
  hasKeyAction,
  clientId,
  adNames,
  namingConfig,
  adsetRanks,
  recentAdSpend,
  campaignNames,
  adsetCampaigns,
  testEventTotals,
  adsetGoals,
}: Props) {
  const [tab, setTab] = useState<ViewTab>("live")
  const [expandedConcept, setExpandedConcept] = useState<string | null>(null)
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [notionUrl, setNotionUrl] = useState("")
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [dismissingConcept, setDismissingConcept] = useState<string | null>(null)
  const [savingEventConcept, setSavingEventConcept] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showHiddenList, setShowHiddenList] = useState(false)

  const thresholds = {
    minDays: config?.min_days_live ?? 5,
    minSpend: config?.min_spend ?? 100,
    minConversions: config?.min_conversions ?? 10,
  }

  /** Effective optimisation event for one test:
   *  per-test override → ad set's Meta optimisation goal → client default. */
  function effectiveKeyAction(test: CreativeTest): {
    action: KeyAction | string
    source: "override" | "adset" | "client"
  } {
    const override = test.key_action_override
    if (override && isKeyAction(override)) return { action: override, source: "override" }
    const adsetDefault = adsetGoals[test.adset_id]?.keyAction
    if (adsetDefault && isKeyAction(adsetDefault)) return { action: adsetDefault, source: "adset" }
    return { action: keyAction, source: "client" }
  }

  /** Conversions for a test under a given event. The event-totals map is
   *  computed live from synced daily rows; the sync's own total_conversions
   *  is the fallback when the event matches the client key action. */
  function testConversions(test: CreativeTest, action: string): number | null {
    const totals = testEventTotals[test.id]
    if (totals && isKeyAction(action)) return totals.events[action]
    if (action === keyAction) return test.total_conversions
    return null
  }

  function testSpend(test: CreativeTest): number {
    return testEventTotals[test.id]?.spend ?? test.total_spend
  }

  /** Meta-concept-name segment from the ad name (falls back to the sync's
   *  concept_name when no variant name parses). */
  function conceptDisplayName(groupTests: CreativeTest[]): string {
    for (const test of groupTests) {
      for (const adId of test.variant_ad_ids) {
        const name = adNames[adId]
        if (!name) continue
        const parsed = parseAdName(name, namingConfig)
        if (parsed.conceptName && parsed.conceptName !== name) return parsed.conceptName
      }
    }
    return groupTests[0]?.concept_name ?? "—"
  }

  // Classify why a non-conforming test is hidden so the operator can
  // tell whether the issue is a naming convention problem (fix the ad
  // name) or unresolved ad names (kima-sync may not have a perf row
  // for a brand-new ad yet).
  type HideReason = "non-conforming" | "missing-name" | null
  function hideReason(test: CreativeTest): HideReason {
    if (test.variant_ad_ids.length === 0) return "missing-name"
    let sawMissing = false
    for (const adId of test.variant_ad_ids) {
      const name = adNames[adId]
      if (!name) {
        sawMissing = true
        continue
      }
      if (!isConformingAdName(name, namingConfig)) return "non-conforming"
    }
    return sawMissing ? "missing-name" : null
  }

  // When "Show all" is on, bypass the conformance filter so the
  // operator can see every creative_tests row kima-sync wrote to the
  // DB (useful for confirming whether something's missing because the
  // sync didn't pick it up, or because the dashboard filtered it).
  const conformingTests = useMemo(() => {
    if (showAll) return tests
    return tests.filter((test) => hideReason(test) === null)
  }, [tests, adNames, namingConfig, showAll])

  const hiddenTests = useMemo(() => {
    const out: { test: CreativeTest; reason: HideReason }[] = []
    for (const test of tests) {
      if (test.status === "analysed" || test.dismissed_at) continue
      const reason = hideReason(test)
      if (reason !== null) out.push({ test, reason })
    }
    return out
  }, [tests, adNames, namingConfig])

  // Split into live (not yet analysed) and completed (analysed). We trust
  // kima-sync's status here — a "monitoring" test should surface as soon as
  // it's detected, even before any variant has spent. Dismissed tests are
  // hidden by default and reappear via the toggle.
  const liveTests = useMemo(() =>
    conformingTests.filter((t) => t.status !== "analysed" && !t.dismissed_at),
    [conformingTests]
  )

  const dismissedLiveTests = useMemo(() =>
    conformingTests.filter((t) => t.status !== "analysed" && t.dismissed_at),
    [conformingTests]
  )

  const completedTests = useMemo(() =>
    conformingTests.filter((t) => t.status === "analysed"),
    [conformingTests]
  )

  function campaignIdOf(test: CreativeTest): string {
    return test.campaign_id || adsetCampaigns[test.adset_id] || "unknown"
  }

  /** concept_name → number of distinct (campaign, adset) placements across
   *  ALL live tests. Used for the "also runs in …" cross-placement badge. */
  const conceptPlacements = useMemo(() => {
    const map = new Map<string, { campaigns: Set<string>; adsets: Set<string> }>()
    for (const t of liveTests) {
      const entry = map.get(t.concept_name) || { campaigns: new Set(), adsets: new Set() }
      entry.campaigns.add(campaignIdOf(t))
      entry.adsets.add(t.adset_id)
      map.set(t.concept_name, entry)
    }
    return map
  }, [liveTests, adsetCampaigns])

  /** Readiness of one test: min progress across the three thresholds. */
  function testReadiness(test: CreativeTest): number {
    const action = effectiveKeyAction(test).action
    const conv = testConversions(test, action) ?? 0
    const days = thresholds.minDays > 0 ? test.days_live / thresholds.minDays : 1
    const spend = thresholds.minSpend > 0 ? testSpend(test) / thresholds.minSpend : 1
    const convs = thresholds.minConversions > 0 ? conv / thresholds.minConversions : 1
    return Math.min(1, days, spend, convs)
  }

  // Live tests grouped campaign → concept
  const campaignGroups = useMemo<CampaignGroup[]>(() => {
    const byCampaign = new Map<string, Map<string, ConceptGroup>>()
    for (const test of liveTests) {
      const campaignId = campaignIdOf(test)
      let concepts = byCampaign.get(campaignId)
      if (!concepts) {
        concepts = new Map()
        byCampaign.set(campaignId, concepts)
      }
      const existing = concepts.get(test.concept_name)
      if (existing) {
        existing.tests.push(test)
        existing.totalSpend += testSpend(test)
        existing.variantCount += test.variant_count
        existing.allAdIds.push(...test.variant_ad_ids)
      } else {
        concepts.set(test.concept_name, {
          conceptName: test.concept_name,
          displayName: "",
          campaignId,
          tests: [test],
          totalSpend: testSpend(test),
          variantCount: test.variant_count,
          allAdIds: [...test.variant_ad_ids],
        })
      }
    }
    const groups: CampaignGroup[] = []
    byCampaign.forEach((concepts, campaignId) => {
      const conceptList = Array.from(concepts.values()).map((c) => ({
        ...c,
        displayName: conceptDisplayName(c.tests),
      }))
      // Ready tests first, then closest to threshold
      conceptList.sort((a, b) => {
        const aReady = a.tests.some((t) => t.status === "ready") ? 1 : 0
        const bReady = b.tests.some((t) => t.status === "ready") ? 1 : 0
        if (aReady !== bReady) return bReady - aReady
        const aProg = Math.max(...a.tests.map(testReadiness))
        const bProg = Math.max(...b.tests.map(testReadiness))
        return bProg - aProg
      })
      groups.push({
        campaignId,
        campaignName:
          campaignNames[campaignId] ||
          (campaignId === "unknown" ? "Unassigned campaign" : campaignId),
        concepts: conceptList,
        totalSpend: conceptList.reduce((s, c) => s + c.totalSpend, 0),
      })
    })
    return groups.sort((a, b) => b.totalSpend - a.totalSpend)
  }, [liveTests, campaignNames, adsetCampaigns, testEventTotals, adsetGoals, adNames, namingConfig])

  const dismissedGroups = useMemo(() => {
    const map = new Map<string, CreativeTest[]>()
    for (const t of dismissedLiveTests) {
      map.set(t.concept_name, [...(map.get(t.concept_name) || []), t])
    }
    return Array.from(map.entries()).map(([conceptName, groupTests]) => ({
      conceptName,
      displayName: conceptDisplayName(groupTests),
      tests: groupTests,
    }))
  }, [dismissedLiveTests, adNames, namingConfig])

  // Completed tests grouped by outcome status
  const completedByOutcome = useMemo(() => {
    const map: Record<string, CreativeTest[]> = { win: [], lose: [], inconclusive: [], none: [] }
    for (const t of completedTests) {
      map[t.outcome && map[t.outcome] ? t.outcome : "none"].push(t)
    }
    return map
  }, [completedTests])

  const liveConceptCount = campaignGroups.reduce((s, g) => s + g.concepts.length, 0)
  const readyCount = liveTests.filter((t) => t.status === "ready").length

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

  async function handleSetDismissed(conceptName: string, groupTests: CreativeTest[], dismissed: boolean) {
    if (dismissed && !window.confirm(
      `Hide "${conceptName}" from creative tests? You can restore it from "Show dismissed".`
    )) return

    setDismissingConcept(conceptName)
    try {
      await Promise.all(groupTests.map((t) =>
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

  /** Set (or clear) the optimisation-event override for every test in a
   *  concept group. null = back to the ad set default. */
  async function handleSetKeyAction(group: ConceptGroup, action: string | null) {
    setSavingEventConcept(group.conceptName)
    try {
      await Promise.all(group.tests.map((t) =>
        fetch(`/api/creative-tests/${t.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key_action: action }),
        })
      ))
      window.location.reload()
    } catch (e) {
      console.error("Failed to update optimisation event:", e)
      setSavingEventConcept(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header: tabs + summary */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setTab("live")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === "live"
                ? "bg-brand-lime/10 text-brand-lime border border-brand-lime/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Live Tests
            {liveConceptCount > 0 && (
              <span className="ml-2 rounded-full bg-neutral-800 px-2 py-0.5 text-xs">
                {liveConceptCount}
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
        <div className="flex items-center gap-3">
          {tab === "live" && readyCount > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400">
              {readyCount} ready for review
            </span>
          )}
          {tab === "live" && dismissedGroups.length > 0 && (
            <button
              onClick={() => setShowDismissed((v) => !v)}
              className="text-xs text-neutral-500 hover:text-white"
            >
              {showDismissed ? "Hide" : "Show"} dismissed ({dismissedGroups.length})
            </button>
          )}
        </div>
      </div>

      {/* Warn only when no default can be resolved anywhere: no ad set
          optimisation goals AND no client-level key action. */}
      {!hasKeyAction && Object.keys(adsetGoals).length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
          No test optimisation event could be resolved. Ad set defaults need a
          Meta connection; otherwise set the scorecard&apos;s Key Action in Settings
          (e.g. Purchases, Add to Cart, Registration).
        </div>
      )}

      {/* Filter diagnostic — surfaces tests that kima-sync detected but
          the dashboard hid, so the operator can tell apart "the sync
          didn't see this" from "the dashboard filtered it". */}
      {tab === "live" && hiddenTests.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="text-neutral-400">
              <span className="text-neutral-200">{hiddenTests.length} test{hiddenTests.length === 1 ? "" : "s"} {showAll ? "non-conforming (shown)" : "filtered out"}</span>
              {" "}— {hiddenTests.filter((h) => h.reason === "non-conforming").length} bad name,
              {" "}{hiddenTests.filter((h) => h.reason === "missing-name").length} unresolved variant{hiddenTests.filter((h) => h.reason === "missing-name").length === 1 ? "" : "s"}.
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setShowHiddenList((v) => !v)}
                className="text-neutral-400 hover:text-white"
              >
                {showHiddenList ? "Hide" : "Show"} list
              </button>
              <label className="flex items-center gap-1.5 text-neutral-400">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  className="accent-brand-lime"
                />
                Show all (bypass filter)
              </label>
            </div>
          </div>
          {showHiddenList && (
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto font-mono text-[11px] text-neutral-400">
              {hiddenTests.map(({ test, reason }) => {
                const sampleAdId = test.variant_ad_ids[0]
                const sampleName = sampleAdId ? adNames[sampleAdId] : null
                return (
                  <li key={test.id} className="flex items-baseline gap-2 truncate">
                    <span className={reason === "missing-name" ? "text-amber-500" : "text-neutral-500"}>
                      {reason === "missing-name" ? "?" : "×"}
                    </span>
                    <span className="truncate">{test.concept_name}</span>
                    <span className="text-neutral-600 truncate">
                      ({test.adset_name || test.adset_id})
                    </span>
                    {sampleName && (
                      <span className="text-neutral-600 truncate ml-auto">{sampleName}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── LIVE TESTS TAB ── */}
      {tab === "live" && (
        <>
          {campaignGroups.length === 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8">
              {!config?.enabled ? (
                <p className="text-center text-neutral-500">
                  Creative test scanning is not enabled for this client. Enable it in Settings.
                </p>
              ) : hiddenTests.length > 0 ? (
                <div className="text-center text-sm">
                  <p className="text-neutral-300 mb-2">No tests pass the naming filter.</p>
                  <p className="text-xs text-neutral-500">
                    See the diagnostic banner above — check &quot;Show all&quot; to view them anyway.
                  </p>
                </div>
              ) : (
                <div className="text-center text-sm">
                  <p className="text-neutral-300 mb-2">No live tests detected.</p>
                  <p className="text-xs text-neutral-500">
                    Tests are detected after the daily Meta sync. New launches typically
                    appear within 24h of the next sync run.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-8">
            {campaignGroups.map((campaign) => (
              <div key={campaign.campaignId}>
                {/* Campaign section header */}
                <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-neutral-800 pb-2">
                  <h3 className="min-w-0 truncate text-sm font-medium text-white" title={campaign.campaignName}>
                    {campaign.campaignName}
                  </h3>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {campaign.concepts.length} test{campaign.concepts.length === 1 ? "" : "s"} ·{" "}
                    {fmtCurrency(campaign.totalSpend, currency)} spend
                  </span>
                </div>

                <div className="space-y-3">
                  {campaign.concepts.map((group) => {
                    const groupKey = `${campaign.campaignId}:${group.conceptName}`
                    const isExpanded = expandedConcept === groupKey
                    const placements = conceptPlacements.get(group.conceptName)
                    const otherCampaigns = (placements?.campaigns.size ?? 1) - 1
                    const thumbIds = group.allAdIds.slice(0, 3)

                    // Effective optimisation event across the group's tests
                    const effectives = group.tests.map((t) => effectiveKeyAction(t))
                    const uniqueActions = Array.from(new Set(effectives.map((e) => e.action)))
                    const mixed = uniqueActions.length > 1
                    const groupAction = uniqueActions[0]
                    const groupSource = effectives[0]?.source
                    const hasOverride = effectives.some((e) => e.source === "override")

                    const groupConversions = group.tests.reduce(
                      (s, t) => s + (testConversions(t, effectiveKeyAction(t).action) ?? 0), 0
                    )
                    const maxDaysLive = Math.max(...group.tests.map((t) => t.days_live))
                    const anyReady = group.tests.some((t) => t.status === "ready")

                    return (
                      <div
                        key={groupKey}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden"
                      >
                        {/* Concept header row */}
                        <div
                          className="flex items-center gap-4 p-4 cursor-pointer hover:bg-neutral-800/50 transition"
                          onClick={() => setExpandedConcept(isExpanded ? null : groupKey)}
                        >
                          {/* Previews — resolved per adId via /api/ad-preview
                              (same guaranteed-correct path as the reach tab),
                              full creative on hover */}
                          <div className="flex -space-x-2 shrink-0">
                            {thumbIds.map((adId) => (
                              <PreviewChip key={adId} adId={adId} />
                            ))}
                            {thumbIds.length === 0 && (
                              <div className="h-11 w-11 rounded-lg border-2 border-neutral-900 bg-neutral-800" />
                            )}
                          </div>

                          {/* Concept info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate" title={group.conceptName}>
                                {group.displayName}
                              </span>
                              <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                                {group.variantCount} variant{group.variantCount === 1 ? "" : "s"}
                              </span>
                              {group.tests.length > 1 && (
                                <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400 border border-blue-500/30">
                                  {group.tests.length} ad sets
                                </span>
                              )}
                              {otherCampaigns > 0 && (
                                <span
                                  className="shrink-0 rounded-full bg-purple-500/15 px-2 py-0.5 text-xs text-purple-400 border border-purple-500/30"
                                  title="This concept also has live tests in other campaigns — each is tracked separately"
                                >
                                  +{otherCampaigns} campaign{otherCampaigns === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                              <span className="truncate">
                                {group.tests.map((t) => t.adset_name || t.adset_id).join(", ")}
                              </span>
                              <EventPill
                                mixed={mixed}
                                action={groupAction}
                                source={groupSource}
                                hasOverride={hasOverride}
                                saving={savingEventConcept === group.conceptName}
                                onSelect={(action) => handleSetKeyAction(group, action)}
                              />
                            </div>
                          </div>

                          {/* Threshold progress */}
                          <div className="hidden md:block w-52 shrink-0">
                            <ThresholdMeters
                              days={maxDaysLive}
                              minDays={thresholds.minDays}
                              spend={group.totalSpend}
                              minSpend={thresholds.minSpend * group.tests.length}
                              conversions={mixed ? null : groupConversions}
                              minConversions={thresholds.minConversions * group.tests.length}
                              convLabel={mixed ? "mixed" : keyActionShort(groupAction)}
                              currency={currency}
                            />
                          </div>

                          {/* Status + actions */}
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
                            {anyReady ? (
                              <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400 border-amber-500/30">
                                Ready
                              </span>
                            ) : (
                              <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-400 border-blue-500/30">
                                Live
                              </span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSetDismissed(group.conceptName, group.tests, true) }}
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

                        {/* Expanded: per-adset breakdown */}
                        {isExpanded && (
                          <div className="border-t border-neutral-800">
                            {group.tests.map((test) => {
                              const eff = effectiveKeyAction(test)
                              const conv = testConversions(test, eff.action)
                              const totals = testEventTotals[test.id]
                              return (
                                <div key={test.id} className="border-b border-neutral-800 last:border-b-0 bg-neutral-800/30 px-4 py-3">
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-neutral-300 truncate">
                                          {test.adset_name || test.adset_id}
                                        </span>
                                        <span className="shrink-0 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                                          {test.variant_count} variant{test.variant_count === 1 ? "" : "s"}
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
                                      <div className="mt-0.5 text-[11px] text-neutral-500">
                                        Optimisation event:{" "}
                                        <span className="text-neutral-300">{keyActionLabel(eff.action)}</span>
                                        <span className="ml-1 text-neutral-600">
                                          ({eff.source === "adset" ? "ad set default" : eff.source === "override" ? "override" : "client default"})
                                        </span>
                                      </div>
                                    </div>

                                    <div className="w-52 shrink-0">
                                      <ThresholdMeters
                                        days={test.days_live}
                                        minDays={thresholds.minDays}
                                        spend={testSpend(test)}
                                        minSpend={thresholds.minSpend}
                                        conversions={conv}
                                        minConversions={thresholds.minConversions}
                                        convLabel={keyActionShort(eff.action)}
                                        currency={currency}
                                      />
                                    </div>

                                    {test.status === "ready" ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRunAnalysis(test.id) }}
                                        disabled={analyzingId === test.id}
                                        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                          analyzingId === test.id
                                            ? "bg-neutral-700 text-neutral-500 cursor-not-allowed"
                                            : "bg-brand-lime text-black hover:bg-brand-lime/90"
                                        }`}
                                      >
                                        {analyzingId === test.id ? "Queued" : "Run Analysis"}
                                      </button>
                                    ) : (
                                      <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-400 border-blue-500/30">
                                        Gathering data
                                      </span>
                                    )}
                                  </div>

                                  {/* Full-funnel counts so another conversion action can be
                                      eyeballed without switching the optimisation event */}
                                  {totals && (
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
                                      {KEY_ACTIONS.filter((a) =>
                                        a.value === eff.action || totals.events[a.value] > 0
                                      ).map((a) => (
                                        <span key={a.value} className={a.value === eff.action ? "text-neutral-200" : ""}>
                                          {a.short}: {fmtNumber(totals.events[a.value])}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
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
                      <span className="font-medium truncate text-neutral-300">{group.displayName}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500 truncate">
                      {group.tests.map((t) => t.adset_name || t.adset_id).join(", ")}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSetDismissed(group.conceptName, group.tests, false)}
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

          <div className="space-y-8">
            {OUTCOME_SECTIONS.filter((s) => completedByOutcome[s.key].length > 0).map((section) => (
              <div key={section.key}>
                <div className="mb-3 flex items-baseline gap-2 border-b border-neutral-800 pb-2">
                  <h3 className={`text-sm font-medium ${section.className}`}>{section.title}</h3>
                  <span className="text-xs text-neutral-500">
                    {completedByOutcome[section.key].length}
                  </span>
                </div>

                <div className="space-y-3">
                  {completedByOutcome[section.key].map((test) => {
                    const testResults = results[test.id] ?? []
                    const isExpanded = expandedTestId === test.id
                    const isLinking = linkingId === test.id
                    const campaignId = campaignIdOf(test)
                    const campaignName = campaignNames[campaignId]
                    const displayName = conceptDisplayName([test])

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
                          <div className="flex -space-x-2 shrink-0">
                            {test.variant_ad_ids.slice(0, 3).map((adId) => (
                              <PreviewChip key={adId} adId={adId} />
                            ))}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate" title={test.concept_name}>
                                {displayName}
                              </span>
                              <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                                {test.variant_count} variant{test.variant_count === 1 ? "" : "s"}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500 truncate">
                              {campaignName ? `${campaignName} · ` : ""}{test.adset_name || test.adset_id}
                            </div>
                          </div>

                          <div className="hidden sm:flex items-center gap-6 text-sm text-neutral-400">
                            <div>
                              <span className="text-neutral-500 text-xs">Spend</span>
                              <div>{fmtCurrency(test.total_spend, currency)}</div>
                            </div>
                            <div>
                              <span className="text-neutral-500 text-xs">{keyActionShort(keyAction)}</span>
                              <div>{fmtNumber(test.total_conversions)}</div>
                            </div>
                            <div>
                              <span className="text-neutral-500 text-xs">Days</span>
                              <div>{test.days_live}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {test.outcome && OUTCOME_BADGES[test.outcome] && (
                              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${OUTCOME_BADGES[test.outcome].className}`}>
                                {OUTCOME_BADGES[test.outcome].emoji} {OUTCOME_BADGES[test.outcome].label}
                              </span>
                            )}
                          </div>

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
                                    <th className="pb-2 pr-4 text-right">{keyActionShort(keyAction)}</th>
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
                                            <AdHoverPreview adId={r.ad_id}>
                                              <div className="flex items-center gap-2">
                                                {r.is_best_variant && (
                                                  <span className="text-green-400" title="Best variant">&#9733;</span>
                                                )}
                                                <span className="truncate max-w-[200px] cursor-default">
                                                  {r.hook_label || r.ad_name?.split("_").slice(3, 5).join(" ") || r.ad_id}
                                                </span>
                                              </div>
                                            </AdHoverPreview>
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function getResultConversions(r: CreativeTestResult, keyAction: string): number {
  switch (keyAction) {
    case "landing_page_views": return r.landing_page_views
    case "adds_to_cart": return r.adds_to_cart
    case "checkouts_initiated": return r.checkouts_initiated
    default: return r.purchases
  }
}

/** 44px variant chip resolved through /api/ad-preview (guaranteed-correct
 *  creative for exactly this adId — same path as the reach tab), with the
 *  full creative in a floating card on hover. */
function PreviewChip({ adId }: { adId: string }) {
  return (
    <AdHoverPreview adId={adId}>
      <div className="h-11 w-11 overflow-hidden rounded-lg border-2 border-neutral-900">
        <AdCreativeMedia
          adId={adId}
          aspectClass="aspect-square"
          className="h-full w-full"
          lazy
          videoMode="poster"
        />
      </div>
    </AdHoverPreview>
  )
}

/** Optimisation-event pill + dropdown. Defaults come from the ad set's Meta
 *  optimisation goal; picking another action stores a per-test override, and
 *  "ad set default" clears it. */
function EventPill({
  mixed,
  action,
  source,
  hasOverride,
  saving,
  onSelect,
}: {
  mixed: boolean
  action: string | undefined
  source: "override" | "adset" | "client" | undefined
  hasOverride: boolean
  saving: boolean
  onSelect: (action: string | null) => void
}) {
  const [open, setOpen] = useState(false)

  const label = mixed ? "Mixed events" : keyActionLabel(action)
  const sourceLabel = mixed
    ? "per ad set"
    : source === "adset" ? "ad set default"
    : source === "override" ? "override"
    : "client default"

  return (
    <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        title="Optimisation event used for this test's conversion threshold"
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
          source === "override"
            ? "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:border-purple-500/60"
            : "border-neutral-700 bg-neutral-800/60 text-neutral-300 hover:border-neutral-500"
        }`}
      >
        <span className="font-medium">{saving ? "Saving…" : label}</span>
        <span className="text-neutral-500">· {sourceLabel}</span>
        <svg className="h-3 w-3 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
              Optimisation event
            </div>
            {(hasOverride || mixed) && (
              <button
                onClick={() => { setOpen(false); onSelect(null) }}
                className="block w-full px-3 py-1.5 text-left text-xs text-brand-lime hover:bg-neutral-800"
              >
                Use ad set default
              </button>
            )}
            {KEY_ACTIONS.map((a) => (
              <button
                key={a.value}
                onClick={() => { setOpen(false); onSelect(a.value) }}
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-800 ${
                  !mixed && a.value === action ? "text-white font-medium" : "text-neutral-300"
                }`}
              >
                {a.label}
                {!mixed && a.value === action && <span className="ml-2 text-brand-lime">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

/** Three compact meters showing how far a test is through its readiness
 *  thresholds: days live, spend, and conversions on the optimisation event. */
function ThresholdMeters({
  days,
  minDays,
  spend,
  minSpend,
  conversions,
  minConversions,
  convLabel,
  currency,
}: {
  days: number
  minDays: number
  spend: number
  minSpend: number
  conversions: number | null
  minConversions: number
  convLabel: string
  currency: string
}) {
  return (
    <div className="space-y-1">
      <MeterRow
        label="Days"
        display={`${days} / ${minDays}`}
        pct={minDays > 0 ? days / minDays : 1}
      />
      <MeterRow
        label="Spend"
        display={`${fmtCurrency(spend, currency)} / ${fmtCurrency(minSpend, currency)}`}
        pct={minSpend > 0 ? spend / minSpend : 1}
      />
      <MeterRow
        label={convLabel}
        display={conversions === null ? "—" : `${fmtNumber(conversions)} / ${fmtNumber(minConversions)}`}
        pct={conversions === null ? 0 : minConversions > 0 ? conversions / minConversions : 1}
      />
    </div>
  )
}

function MeterRow({ label, display, pct }: { label: string; display: string; pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct))
  const met = pct >= 1
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 truncate text-[10px] uppercase tracking-wide text-neutral-500" title={label}>
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full rounded-full transition-all ${met ? "bg-brand-lime" : "bg-blue-500/70"}`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      <span className={`w-24 shrink-0 text-right text-[10px] tabular-nums ${met ? "text-brand-lime" : "text-neutral-400"}`}>
        {display}
      </span>
    </div>
  )
}
