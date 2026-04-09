import { createClient } from "@/lib/supabase/server"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"

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
}

/** Rank of a single ad within its ad set (by CPA, lower = better) */
export type AdsetRank = { rank: number; total: number }

export type CreativeTestsData = {
  tests: CreativeTest[]
  results: Record<string, CreativeTestResult[]>
  config: CreativeTestConfig | null
  thumbnails: Record<string, string>
  currency: string
  keyAction: string
  /** ad_id → ad_name for all variant ads */
  adNames: Record<string, string>
  /** Client naming convention config */
  namingConfig?: NamingConfig
  /** ad_id → rank within its ad set (by CPA) */
  adsetRanks: Record<string, AdsetRank>
  /** ad_id → total spend in last 14 days (0 = inactive) */
  recentAdSpend: Record<string, number>
}

/** Map key_action to the corresponding meta_daily_performance column */
function getConversionColumn(keyAction: string): string {
  switch (keyAction) {
    case "unique_link_clicks": return "unique_link_clicks"
    case "landing_page_views": return "landing_page_views"
    case "adds_to_cart": return "adds_to_cart"
    case "checkouts_initiated": return "checkouts_initiated"
    case "registrations_completed": return "registrations_completed"
    case "app_installs": return "app_installs"
    case "purchases":
    default: return "purchases"
  }
}

export async function fetchCreativeTests(
  clientId: string
): Promise<CreativeTestsData | null> {
  const supabase = createClient()

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
      .select("positions, value_maps")
      .eq("client_id", clientId)
      .maybeSingle(),
  ])

  if (!clientResp.data) return null

  const tests: CreativeTest[] = testsResp.data ?? []
  const config: CreativeTestConfig | null = configResp.data ?? null
  const keyAction = scorecardResp.data?.key_action ?? "purchases"

  // Build naming config
  let namingConfig: NamingConfig | undefined
  const nd = namingResp?.data
  if (nd && nd.positions) {
    namingConfig = {
      positions: nd.positions as NamingConfig["positions"],
      valueMaps: (nd.value_maps || {}) as NamingConfig["valueMaps"],
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

  // Fetch thumbnails, ad names, and adset performance data in parallel
  const thumbnails: Record<string, string> = {}
  const adNames: Record<string, string> = {}

  const BATCH = 300

  // Helper: wrap Supabase thenable into a real Promise
  async function fetchThumbnailBatch(chunk: string[]): Promise<void> {
    const { data } = await supabase
      .from("meta_ad_metadata")
      .select("ad_id, creative_thumbnail_url")
      .in("ad_id", chunk)
    for (const row of data ?? []) {
      if (row.creative_thumbnail_url) {
        thumbnails[row.ad_id] = row.creative_thumbnail_url
      }
    }
  }

  async function fetchNameBatch(chunk: string[]): Promise<void> {
    const { data } = await supabase
      .from("meta_daily_performance")
      .select("ad_id, ad_name")
      .in("ad_id", chunk)
      .limit(chunk.length)
    for (const row of data ?? []) {
      if (row.ad_name && !adNames[row.ad_id]) {
        adNames[row.ad_id] = row.ad_name
      }
    }
  }

  const fetchPromises: Promise<void>[] = []

  for (let i = 0; i < allAdIds.length; i += BATCH) {
    const chunk = allAdIds.slice(i, i + BATCH)
    fetchPromises.push(fetchThumbnailBatch(chunk))
    fetchPromises.push(fetchNameBatch(chunk))
  }

  // Fetch recent spend per variant ad (last 14 days) to detect inactive tests
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString().split("T")[0]
  const recentAdSpend: Record<string, number> = {}

  async function fetchRecentSpendBatch(chunk: string[]): Promise<void> {
    const { data } = await supabase
      .from("meta_daily_performance")
      .select("ad_id, spend")
      .in("ad_id", chunk)
      .gte("date", fourteenDaysAgo)
    for (const row of data ?? []) {
      recentAdSpend[row.ad_id] = (recentAdSpend[row.ad_id] || 0) + (row.spend || 0)
    }
  }

  for (let i = 0; i < allAdIds.length; i += BATCH) {
    const chunk = allAdIds.slice(i, i + BATCH)
    fetchPromises.push(fetchRecentSpendBatch(chunk))
  }

  // Fetch adset-level performance for ranking (all ads in each adset, last 30 days)
  const convCol = getConversionColumn(keyAction)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0]
  // ad_id → { spend, conversions, adsetId }
  const adsetPerfMap = new Map<string, { spend: number; conversions: number; adsetId: string }>()

  async function fetchAdsetPerfBatch(chunk: string[]): Promise<void> {
    // Always select spend + purchases; use purchases as the base column,
    // then read the actual key-action column via cast to any
    const { data } = await supabase
      .from("meta_daily_performance")
      .select("ad_id, adset_id, spend, purchases, landing_page_views, adds_to_cart, checkouts_initiated, registrations_completed, app_installs")
      .eq("client_id", clientId)
      .in("adset_id", chunk)
      .gte("date", thirtyDaysAgo)
    for (const row of data ?? []) {
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

  await Promise.all(fetchPromises)

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
    thumbnails,
    currency: clientResp.data.currency_code ?? "GBP",
    keyAction,
    adNames,
    namingConfig,
    adsetRanks,
    recentAdSpend,
  }
}
