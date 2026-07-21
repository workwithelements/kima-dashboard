import { unstable_cache } from "next/cache"
import { createServiceClient } from "@/lib/supabase/server"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"
import { fetchAdsetGoals, type AdsetGoal } from "@/lib/data/fetch-adset-goals"
import { KEY_ACTIONS, type KeyAction } from "@/lib/utils/key-actions"

const CACHE_TTL_SECONDS = 300

export type CreativeTest = {
  id: string
  client_id: string
  concept_name: string
  adset_id: string
  adset_name: string | null
  campaign_id: string | null
  variant_ad_ids: string[]
  variant_count: number
  first_live_date: string | null
  days_live: number
  total_spend: number
  total_conversions: number
  status: "monitoring" | "ready" | "analysed" | "flagged"
  outcome: "win" | "lose" | "inconclusive" | null
  ready_at: string | null
  analysed_at: string | null
  notion_page_id: string | null
  notion_page_url: string | null
  notion_matched: boolean
  flag_reason: string | null
  dismissed_at: string | null
  /** Per-test optimisation event override (replaces the adset default).
   *  Optional — column exists only after the adset-goals migration. */
  key_action_override?: string | null
  created_at: string
  updated_at: string
}

export type CreativeTestResult = {
  id: string
  test_id: string
  ad_id: string
  ad_name: string | null
  hook_label: string | null
  spend: number
  impressions: number
  landing_page_views: number
  adds_to_cart: number
  checkouts_initiated: number
  purchases: number
  purchase_value: number
  cpa: number | null
  roas: number | null
  landing_rate: number | null
  cart_rate: number | null
  purchase_rate: number | null
  spend_share: number | null
  classification: string | null
  fatigue_status: string | null
  is_best_variant: boolean
  recent_spend: number
  recent_conversions: number
  recent_cpa: number | null
}

export type CreativeTestConfig = {
  client_id: string
  enabled: boolean
  min_days_live: number
  min_spend: number
  min_conversions: number
  high_spend_alert: number
  notion_board_id: string | null
  slack_channel_id: string | null
  test_key_action: string | null
}

/** Rank of a single ad within its ad set (by CPA, lower = better) */
export type AdsetRank = { rank: number; total: number }

/** Lifetime totals for a test's variants within the test's own ad set —
 *  one number per conversion event so the optimisation-event selector can
 *  re-derive threshold progress without another fetch. */
export type TestEventTotals = {
  spend: number
  events: Record<KeyAction, number>
}

export type CreativeTestsData = {
  tests: CreativeTest[]
  results: Record<string, CreativeTestResult[]>
  config: CreativeTestConfig | null
  currency: string
  keyAction: string
  /** True when either creative_test_config.test_key_action OR
   *  client_scorecard_config.key_action is explicitly set. False means we
   *  fell back to the "purchases" default and the operator should set one. */
  hasKeyAction: boolean
  /** ad_id → ad_name for all variant ads */
  adNames: Record<string, string>
  /** Client naming convention config */
  namingConfig?: NamingConfig
  /** ad_id → rank within its ad set (by CPA) */
  adsetRanks: Record<string, AdsetRank>
  /** ad_id → total spend in last 14 days (0 = inactive) */
  recentAdSpend: Record<string, number>
  /** campaign_id → campaign_name (for grouping live tests by campaign) */
  campaignNames: Record<string, string>
  /** test.adset_id → campaign_id fallback when creative_tests.campaign_id is null */
  adsetCampaigns: Record<string, string>
  /** test_id → lifetime spend + per-event conversion totals (scoped to the
   *  test's ad set, so an ad running in several ad sets is attributed
   *  correctly to each test) */
  testEventTotals: Record<string, TestEventTotals>
  /** adset_id → Meta optimisation goal (default optimisation event source) */
  adsetGoals: Record<string, AdsetGoal>
}

const EVENT_COLUMNS = KEY_ACTIONS.map((a) => a.value)

function emptyEvents(): Record<KeyAction, number> {
  const out = {} as Record<KeyAction, number>
  for (const col of EVENT_COLUMNS) out[col] = 0
  return out
}

export async function fetchCreativeTests(
  clientId: string
): Promise<CreativeTestsData | null> {
  return unstable_cache(
    () => _fetchCreativeTestsInner(clientId),
    ["fetchCreativeTests", clientId],
    { revalidate: CACHE_TTL_SECONDS, tags: [`client:${clientId}`] }
  )()
}

async function _fetchCreativeTestsInner(
  clientId: string
): Promise<CreativeTestsData | null> {
  const supabase = createServiceClient()

  // Parallel fetches — client, tests, config, scorecard, naming config
  const [clientResp, testsResp, configResp, scorecardResp, namingResp] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, currency_code")
      .eq("id", clientId)
      .single(),
    supabase
      .from("creative_tests")
      .select("*")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("creative_test_config")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_scorecard_config")
      .select("key_action")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_naming_config")
      .select("positions, value_maps, separator")
      .eq("client_id", clientId)
      .maybeSingle(),
  ])

  if (!clientResp.data) return null

  const tests: CreativeTest[] = testsResp.data ?? []
  const config: CreativeTestConfig | null = configResp.data ?? null
  // Use the test-specific key action if set, otherwise fall back to scorecard
  const scorecardKeyAction = scorecardResp.data?.key_action ?? null
  const hasKeyAction = !!(config?.test_key_action || scorecardKeyAction)
  const keyAction = config?.test_key_action || scorecardKeyAction || "purchases"

  // Build naming config
  let namingConfig: NamingConfig | undefined
  const nd = namingResp?.data as { positions?: unknown; value_maps?: unknown; separator?: string | null } | undefined
  if (nd && nd.positions) {
    namingConfig = {
      positions: nd.positions as NamingConfig["positions"],
      valueMaps: (nd.value_maps || {}) as NamingConfig["valueMaps"],
      separator: nd.separator || undefined,
    }
  }

  // Fetch results for all analysed tests
  const analysedIds = tests
    .filter((t) => t.status === "analysed")
    .map((t) => t.id)

  let allResults: CreativeTestResult[] = []
  if (analysedIds.length > 0) {
    const resultsResp = await supabase
      .from("creative_test_results")
      .select("*")
      .in("test_id", analysedIds)
    allResults = resultsResp.data ?? []
  }

  // Group results by test_id
  const results: Record<string, CreativeTestResult[]> = {}
  for (const r of allResults) {
    if (!results[r.test_id]) results[r.test_id] = []
    results[r.test_id].push(r)
  }

  // Collect all variant ad IDs and all unique adset IDs
  const allAdIds = tests.flatMap((t) => t.variant_ad_ids)
  const adsetIdSet = new Set(tests.map((t) => t.adset_id))
  const adsetIds = Array.from(adsetIdSet)

  const BATCH = 300
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString().split("T")[0]

  const adNames: Record<string, string> = {}
  const recentAdSpend: Record<string, number> = {}
  const campaignNames: Record<string, string> = {}
  const adsetCampaigns: Record<string, string> = {}
  // (ad_id → adset_id → lifetime spend + event totals). Keyed per adset so an
  // ad appearing in multiple ad sets contributes only its own adset's rows to
  // each test.
  const perAdAdset = new Map<string, Map<string, TestEventTotals>>()

  /** One paginated pass per chunk of variant ads: newest-first so the first
   *  ad_name seen is the freshest, while lifetime totals and campaign lookups
   *  accumulate across every row. meta_daily_performance has one row per
   *  (ad_id, date) so a chunk can far exceed one page — paginate to the end. */
  async function fetchVariantPerfBatch(chunk: string[]): Promise<void> {
    const PAGE = 1000
    let offset = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await supabase
        .from("meta_daily_performance")
        .select(`date, ad_id, ad_name, adset_id, campaign_id, campaign_name, spend, ${EVENT_COLUMNS.join(", ")}`)
        .in("ad_id", chunk)
        .order("date", { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (!data || data.length === 0) break
      for (const raw of data) {
        const row = raw as Record<string, any>
        if (row.ad_name && !adNames[row.ad_id]) adNames[row.ad_id] = row.ad_name
        if (row.date >= fourteenDaysAgo) {
          recentAdSpend[row.ad_id] = (recentAdSpend[row.ad_id] || 0) + (row.spend || 0)
        }
        if (row.campaign_id && row.campaign_name) {
          campaignNames[row.campaign_id] = row.campaign_name
        }
        if (row.adset_id && row.campaign_id && !adsetCampaigns[row.adset_id]) {
          adsetCampaigns[row.adset_id] = row.campaign_id
        }
        if (row.adset_id) {
          let byAdset = perAdAdset.get(row.ad_id)
          if (!byAdset) {
            byAdset = new Map()
            perAdAdset.set(row.ad_id, byAdset)
          }
          let totals = byAdset.get(row.adset_id)
          if (!totals) {
            totals = { spend: 0, events: emptyEvents() }
            byAdset.set(row.adset_id, totals)
          }
          totals.spend += row.spend || 0
          for (const col of EVENT_COLUMNS) {
            totals.events[col] += row[col] || 0
          }
        }
      }
      if (data.length < PAGE) break
      offset += PAGE
    }
  }

  const fetchPromises: Promise<void>[] = []

  for (let i = 0; i < allAdIds.length; i += BATCH) {
    const chunk = allAdIds.slice(i, i + BATCH)
    fetchPromises.push(fetchVariantPerfBatch(chunk))
  }

  // Fetch adset-level performance for ranking (all ads in each adset, last 30 days)
  const convCol = EVENT_COLUMNS.includes(keyAction as KeyAction) ? keyAction : "purchases"
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0]
  // ad_id → { spend, conversions, adsetId }
  const adsetPerfMap = new Map<string, { spend: number; conversions: number; adsetId: string }>()

  async function fetchAdsetPerfBatch(chunk: string[]): Promise<void> {
    const { data } = await supabase
      .from("meta_daily_performance")
      .select("ad_id, adset_id, campaign_id, campaign_name, spend, purchases, landing_page_views, adds_to_cart, checkouts_initiated, registrations_completed, app_installs, unique_link_clicks, trials_started")
      .eq("client_id", clientId)
      .in("adset_id", chunk)
      .gte("date", thirtyDaysAgo)
    for (const row of data ?? []) {
      if (row.campaign_id && row.campaign_name) {
        campaignNames[row.campaign_id] = row.campaign_name
      }
      if (row.adset_id && row.campaign_id && !adsetCampaigns[row.adset_id]) {
        adsetCampaigns[row.adset_id] = row.campaign_id
      }
      const conv = (row as Record<string, any>)[convCol] || 0
      const existing = adsetPerfMap.get(row.ad_id)
      if (existing) {
        existing.spend += row.spend || 0
        existing.conversions += conv
      } else {
        adsetPerfMap.set(row.ad_id, {
          spend: row.spend || 0,
          conversions: conv,
          adsetId: row.adset_id,
        })
      }
    }
  }

  for (let i = 0; i < adsetIds.length; i += BATCH) {
    const chunk = adsetIds.slice(i, i + BATCH)
    fetchPromises.push(fetchAdsetPerfBatch(chunk))
  }

  // Adset optimisation goals — only needed for tests still in flight (the
  // default optimisation event of each live test). Runs concurrently with
  // the perf batches; failures degrade to {}.
  const liveAdsetIds = Array.from(
    new Set(tests.filter((t) => t.status !== "analysed").map((t) => t.adset_id))
  )
  let adsetGoals: Record<string, AdsetGoal> = {}
  fetchPromises.push(
    fetchAdsetGoals(clientId, liveAdsetIds).then((g) => {
      adsetGoals = g
    })
  )

  await Promise.all(fetchPromises)

  // Per-test lifetime totals, scoped to the test's own ad set
  const testEventTotals: Record<string, TestEventTotals> = {}
  for (const test of tests) {
    const totals: TestEventTotals = { spend: 0, events: emptyEvents() }
    let sawRows = false
    for (const adId of test.variant_ad_ids) {
      const adTotals = perAdAdset.get(adId)?.get(test.adset_id)
      if (!adTotals) continue
      sawRows = true
      totals.spend += adTotals.spend
      for (const col of EVENT_COLUMNS) {
        totals.events[col] += adTotals.events[col]
      }
    }
    if (sawRows) testEventTotals[test.id] = totals
  }

  // Compute adset rankings (rank by CPA ascending, no-conversion ads last)
  const adsetRanks: Record<string, AdsetRank> = {}
  // Group perf data by adset
  const byAdset = new Map<string, { adId: string; cpa: number | null }[]>()
  adsetPerfMap.forEach((perf, adId) => {
    const cpa = perf.conversions > 0 ? perf.spend / perf.conversions : null
    const group = byAdset.get(perf.adsetId) || []
    group.push({ adId, cpa })
    byAdset.set(perf.adsetId, group)
  })
  byAdset.forEach((ads) => {
    // Sort: lowest CPA first, nulls (no conversions) last
    ads.sort((a: { cpa: number | null }, b: { cpa: number | null }) => {
      if (a.cpa === null && b.cpa === null) return 0
      if (a.cpa === null) return 1
      if (b.cpa === null) return -1
      return a.cpa - b.cpa
    })
    const total = ads.length
    ads.forEach((ad: { adId: string }, idx: number) => {
      adsetRanks[ad.adId] = { rank: idx + 1, total }
    })
  })

  return {
    tests,
    results,
    config,
    currency: clientResp.data.currency_code ?? "GBP",
    keyAction,
    hasKeyAction,
    adNames,
    namingConfig,
    adsetRanks,
    recentAdSpend,
    campaignNames,
    adsetCampaigns,
    testEventTotals,
    adsetGoals,
  }
}
