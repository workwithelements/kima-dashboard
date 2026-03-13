/**
 * Server-side data fetching for client performance pages.
 * Centralised here so both admin and client views can reuse it.
 */

import { createServiceClient } from "@/lib/supabase/server"
import type { MetaDailyRow, MetaDemographicsRow, MetaPlacementsRow, GoogleAdsDailyRow, Client, AdPlatform, DailySpendRow } from "@/lib/utils/types"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"

/** Columns available in meta_daily_performance */
const PERF_COLUMNS =
  "date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, reach, unique_link_clicks, landing_page_views, adds_to_cart, registrations_completed, checkouts_initiated, purchases, purchase_value, app_installs, mobile_app_registrations, video_plays, video_3s_views, video_p25, video_p50, video_p75, video_p95, video_p100"

export type ClientData = {
  client: Client
  rows: Partial<MetaDailyRow>[]
  comparisonRows: Partial<MetaDailyRow>[]
  baselineReach: number
  namingConfig?: NamingConfig
}

/**
 * Fetch all Meta performance data for a client within a date range,
 * plus an optional comparison range.
 */
export async function fetchClientData(
  clientId: string,
  from: string,
  to: string,
  compFrom?: string,
  compTo?: string
): Promise<ClientData | null> {
  const supabase = createServiceClient()

  // Fetch client (try full select, fallback to minimal if columns don't exist)
  let client: any = null
  const { data: fullClient, error: clientError } = await supabase
    .from("clients")
    .select("id, name, active, meta_account_id, google_ads_customer_id, currency_code")
    .eq("id", clientId)
    .single()

  if (clientError && !fullClient) {
    const { data: fallback } = await supabase
      .from("clients")
      .select("id, name, active")
      .eq("id", clientId)
      .single()
    if (!fallback) return null
    client = { ...fallback, meta_account_id: null, google_ads_customer_id: null, monthly_budget: null, currency_code: "GBP" }
  } else {
    client = { ...fullClient, monthly_budget: (fullClient as any)?.monthly_budget ?? null }
  }

  if (!client) return null

  // Pre-compute baseline date range
  const baselineStart = new Date(from + "T00:00:00")
  baselineStart.setDate(baselineStart.getDate() - 30)
  const baselineStartStr = baselineStart.toISOString().split("T")[0]
  const dayBefore = new Date(from + "T00:00:00")
  dayBefore.setDate(dayBefore.getDate() - 1)
  const baselineEndStr = dayBefore.toISOString().split("T")[0]

  // Fetch primary range, comparison range, and baseline reach ALL in parallel
  const [primaryResult, compResult, baselineResult] = await Promise.all([
    supabase
      .from("meta_daily_performance")
      .select(PERF_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .limit(10000),
    compFrom && compTo
      ? supabase
          .from("meta_daily_performance")
          .select(PERF_COLUMNS)
          .eq("client_id", clientId)
          .gte("date", compFrom)
          .lte("date", compTo)
          .order("date")
          .limit(10000)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("meta_daily_performance")
      .select("reach, impressions")
      .eq("client_id", clientId)
      .gte("date", baselineStartStr)
      .lte("date", baselineEndStr)
      .limit(10000),
  ])

  let baselineReach = 0
  if (baselineResult.data?.length) {
    for (const row of baselineResult.data) {
      baselineReach += (row as { reach: number }).reach || 0
    }
  }

  return {
    client: client as Client,
    rows: primaryResult.data || [],
    comparisonRows: (compResult.data || []) as Partial<MetaDailyRow>[],
    baselineReach,
  }
}

/**
 * Fetch all active clients with their total spend for a given period.
 */
export async function fetchClientsList(from: string, to: string) {
  const supabase = createServiceClient()

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, active, meta_account_id, google_ads_customer_id, currency_code")
    .eq("active", true)
    .order("name")

  // If the full select failed (columns may not exist), fall back to minimal select
  let clientsList = clients
  if (clientsError) {
    const { data: fallback } = await supabase
      .from("clients")
      .select("id, name, active")
      .eq("active", true)
      .order("name")
    if (!fallback?.length) return []
    clientsList = fallback.map((c: any) => ({
      ...c,
      meta_account_id: null,
      google_ads_customer_id: null,
      monthly_budget: null,
      currency_code: "GBP",
    }))
  }

  if (!clientsList?.length) return []

  // Fetch spend per client from both Meta and Google Ads in parallel
  // Wrap Google Ads query in .catch() in case the table doesn't exist yet
  const [metaSpendResult, gaSpendResult] = await Promise.all([
    supabase
      .from("meta_daily_performance")
      .select("client_id, spend, impressions, purchases, purchase_value")
      .gte("date", from)
      .lte("date", to)
      .limit(10000),
    Promise.resolve(
      supabase
        .from("google_ads_daily_performance")
        .select("client_id, spend, impressions, clicks, conversions, conversion_value")
        .gte("date", from)
        .lte("date", to)
    ).catch(() => ({ data: [] as any[] })),
  ])

  // Aggregate spend by client (combined across platforms)
  const spendByClient: Record<
    string,
    { spend: number; impressions: number; purchases: number; revenue: number }
  > = {}

  for (const row of metaSpendResult.data || []) {
    if (!spendByClient[row.client_id]) {
      spendByClient[row.client_id] = { spend: 0, impressions: 0, purchases: 0, revenue: 0 }
    }
    spendByClient[row.client_id].spend += row.spend || 0
    spendByClient[row.client_id].impressions += row.impressions || 0
    spendByClient[row.client_id].purchases += row.purchases || 0
    spendByClient[row.client_id].revenue += row.purchase_value || 0
  }

  for (const row of gaSpendResult.data || []) {
    if (!spendByClient[row.client_id]) {
      spendByClient[row.client_id] = { spend: 0, impressions: 0, purchases: 0, revenue: 0 }
    }
    spendByClient[row.client_id].spend += row.spend || 0
    spendByClient[row.client_id].impressions += row.impressions || 0
    spendByClient[row.client_id].purchases += row.conversions || 0
    spendByClient[row.client_id].revenue += row.conversion_value || 0
  }

  return clientsList.map((c) => ({
    ...c,
    spend: spendByClient[c.id]?.spend || 0,
    impressions: spendByClient[c.id]?.impressions || 0,
    purchases: spendByClient[c.id]?.purchases || 0,
    revenue: spendByClient[c.id]?.revenue || 0,
    roas:
      (spendByClient[c.id]?.spend || 0) > 0
        ? (spendByClient[c.id]?.revenue || 0) / (spendByClient[c.id]?.spend || 0)
        : 0,
  }))
}

/**
 * Fetch reach-specific data for reach analysis page.
 * Includes daily reach, impressions within the date range,
 * plus a baseline query for reach before the range start.
 */
export async function fetchReachData(
  clientId: string,
  from: string,
  to: string,
  compFrom?: string,
  compTo?: string
) {
  const supabase = createServiceClient()

  // Fetch client name + currency
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, currency_code")
    .eq("id", clientId)
    .single()

  if (!client) return null

  // Pre-compute baseline date range
  const dayBefore = new Date(from + "T00:00:00")
  dayBefore.setDate(dayBefore.getDate() - 1)
  const baselineEnd = dayBefore.toISOString().split("T")[0]
  const baselineStart = new Date(from + "T00:00:00")
  baselineStart.setDate(baselineStart.getDate() - 30)
  const baselineStartStr = baselineStart.toISOString().split("T")[0]

  // Build parallel queries
  const queries: PromiseLike<any>[] = [
    supabase
      .from("meta_daily_performance")
      .select("date, reach, impressions, spend, adset_id, adset_name")
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .limit(10000),
    supabase
      .from("meta_daily_performance")
      .select("reach, impressions")
      .eq("client_id", clientId)
      .gte("date", baselineStartStr)
      .lte("date", baselineEnd)
      .limit(10000),
  ]

  // Add comparison range query if provided
  if (compFrom && compTo) {
    queries.push(
      supabase
        .from("meta_daily_performance")
        .select("date, reach, impressions, spend, adset_id, adset_name")
        .eq("client_id", clientId)
        .gte("date", compFrom)
        .lte("date", compTo)
        .order("date")
        .limit(10000)
    )
  }

  const results = await Promise.all(queries)
  const [rowsResult, baselineResult] = results

  let baselineReach = 0
  if (baselineResult.data?.length) {
    for (const row of baselineResult.data) {
      baselineReach += (row as { reach: number }).reach || 0
    }
  }

  // Comparison data
  const comparisonRows = results[2]?.data || []

  return {
    client,
    rows: rowsResult.data || [],
    baselineReach,
    comparisonRows,
  }
}

/**
 * Fetch ad-level performance data for creative analysis.
 * Returns all rows with ad_id/ad_name for classification,
 * plus thumbnail URLs and preview toggle state.
 */
export async function fetchCreativeData(
  clientId: string,
  from: string,
  to: string
) {
  const supabase = createServiceClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, currency_code, meta_account_id, google_ads_customer_id")
    .eq("id", clientId)
    .single()

  if (!client) return null

  // Fetch performance rows, thumbnails, config, naming config, and breakdowns in parallel
  // meta_ad_metadata may not exist yet — wrap in catch to be safe
  const [perfResult, thumbResult, configResult, namingResult, demoResult, placementResult] = await Promise.all([
    supabase
      .from("meta_daily_performance")
      .select(PERF_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .limit(10000),
    Promise.resolve(
      supabase
        .from("meta_ad_metadata")
        .select("ad_id, creative_thumbnail_url, created_time")
        .eq("client_id", clientId)
        .limit(50000)
    ).catch(() => ({ data: [] as any[] })),
    supabase
      .from("client_scorecard_config")
      .select("creative_previews_enabled, key_action, funnel_steps")
      .eq("client_id", clientId)
      .single(),
    Promise.resolve(
      supabase
        .from("client_naming_config")
        .select("positions, value_maps")
        .eq("client_id", clientId)
        .single()
    ).catch(() => ({ data: null as any })),
    Promise.resolve(
      supabase
        .from("meta_daily_demographics")
        .select(DEMO_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .limit(10000)
    ).then(r => (r.data || []) as MetaDemographicsRow[]).catch(() => [] as MetaDemographicsRow[]),
    Promise.resolve(
      supabase
        .from("meta_daily_placements")
        .select(PLACEMENT_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .limit(10000)
    ).then(r => (r.data || []) as MetaPlacementsRow[]).catch(() => [] as MetaPlacementsRow[]),
  ])

  // Build thumbnail map (ad_id -> url) and created dates map (ad_id -> created_time)
  const thumbnails: Record<string, string> = {}
  const createdDates: Record<string, string> = {}
  for (const row of thumbResult.data || []) {
    if (row.creative_thumbnail_url) {
      thumbnails[row.ad_id] = row.creative_thumbnail_url
    }
    if (row.created_time) {
      createdDates[row.ad_id] = row.created_time
    }
  }

  const previewsEnabled = configResult.data?.creative_previews_enabled ?? false
  const keyAction = configResult.data?.key_action ?? undefined
  const funnelSteps: string[] = configResult.data?.funnel_steps ?? ["unique_link_clicks", "purchases"]

  // Build naming config if found (table may not exist yet)
  let namingConfig: NamingConfig | undefined
  const namingData = namingResult?.data
  if (namingData && namingData.positions) {
    namingConfig = {
      positions: namingData.positions as NamingConfig["positions"],
      valueMaps: (namingData.value_maps || {}) as NamingConfig["valueMaps"],
    }
  }

  return {
    client,
    rows: perfResult.data || [],
    thumbnails,
    createdDates,
    previewsEnabled,
    keyAction,
    funnelSteps,
    namingConfig,
    demographics: demoResult,
    placements: placementResult,
  }
}

/** Columns for demographics table */
const DEMO_COLUMNS =
  "date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, age, gender, spend, impressions, reach, unique_link_clicks, landing_page_views, purchases, purchase_value"

/** Columns for placements table */
const PLACEMENT_COLUMNS =
  "date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, publisher_platform, platform_position, impression_device, spend, impressions, reach, unique_link_clicks, landing_page_views, purchases, purchase_value"

/**
 * Fetch demographic and placement breakdown data for a client.
 */
export async function fetchBreakdownsData(
  clientId: string,
  from: string,
  to: string
) {
  const supabase = createServiceClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, currency_code")
    .eq("id", clientId)
    .single()

  if (!client) return null

  // Queries may fail if tables don't exist yet (migration not run)
  // Wrap in Promise.resolve() so .catch() is available (Supabase returns PromiseLike)
  const [demoResult, placementResult] = await Promise.all([
    Promise.resolve(
      supabase
        .from("meta_daily_demographics")
        .select(DEMO_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .limit(10000)
    )
      .then((r) => (r.data || []) as MetaDemographicsRow[])
      .catch(() => [] as MetaDemographicsRow[]),
    Promise.resolve(
      supabase
        .from("meta_daily_placements")
        .select(PLACEMENT_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .limit(10000)
    )
      .then((r) => (r.data || []) as MetaPlacementsRow[])
      .catch(() => [] as MetaPlacementsRow[]),
  ])

  return {
    client,
    demographics: demoResult as MetaDemographicsRow[],
    placements: placementResult as MetaPlacementsRow[],
  }
}

/** Google Ads performance columns */
const GA_PERF_COLUMNS =
  "date, campaign_id, campaign_name, ad_group_id, ad_group_name, spend, impressions, clicks, conversions, conversion_value"

/**
 * Fetch Google Ads daily performance data for a client.
 */
export async function fetchGoogleAdsData(
  clientId: string,
  from: string,
  to: string
): Promise<GoogleAdsDailyRow[]> {
  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from("google_ads_daily_performance")
      .select(GA_PERF_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .limit(10000)

    if (error) return []
    return (data || []) as GoogleAdsDailyRow[]
  } catch {
    return []
  }
}

/**
 * Fetch consolidated daily spend across Meta + Google Ads for a client.
 * Used by pacing pages — platform-agnostic aggregation.
 */
export async function fetchConsolidatedSpend(
  clientId: string,
  from: string,
  to: string
): Promise<DailySpendRow[]> {
  const supabase = createServiceClient()

  // Run both queries in parallel (Google Ads table may not exist yet)
  const [metaResult, gaResult] = await Promise.all([
    supabase
      .from("meta_daily_performance")
      .select("date, spend")
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .limit(10000),
    Promise.resolve(
      supabase
        .from("google_ads_daily_performance")
        .select("date, spend")
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .limit(10000)
    ).catch(() => ({ data: [] as any[] })),
  ])

  const rows: DailySpendRow[] = []

  for (const r of metaResult.data || []) {
    rows.push({ date: r.date, spend: r.spend || 0, platform: "meta" })
  }
  for (const r of gaResult.data || []) {
    rows.push({ date: r.date, spend: r.spend || 0, platform: "google_ads" })
  }

  return rows
}

/**
 * Sum DailySpendRows by date (across platforms) for pacing calculations.
 */
export function consolidateDailySpend(
  rows: DailySpendRow[]
): { date: string; spend: number }[] {
  const byDate: Record<string, number> = {}
  for (const r of rows) {
    byDate[r.date] = (byDate[r.date] || 0) + r.spend
  }
  return Object.entries(byDate)
    .map(([date, spend]) => ({ date, spend: Math.round(spend * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Re-export getClientPlatforms from types for backwards compat
export { getClientPlatforms } from "@/lib/utils/types"
