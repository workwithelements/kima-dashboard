/**
 * Server-side data fetching for client performance pages.
 * Centralised here so both admin and client views can reuse it.
 */

import { unstable_cache } from "next/cache"
import { createServiceClient } from "@/lib/supabase/server"
import type { MetaDailyRow, MetaDemographicsRow, MetaPlacementsRow, GoogleAdsDailyRow, Client, AdPlatform, DailySpendRow } from "@/lib/utils/types"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"

/** Cache TTL for dashboard data fetches (5 minutes) */
const CACHE_TTL_SECONDS = 300

/**
 * Paginated Supabase fetch — works around the PostgREST 1000-row default cap.
 * `buildQuery` is called per page so the builder is fresh each time.
 */
async function fetchAllRows<T>(
  buildQuery: () => any,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1)
    if (error || !data) break
    all.push(...(data as T[]))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

/** Columns available in meta_daily_performance */
const PERF_COLUMNS =
  "date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, reach, unique_link_clicks, landing_page_views, adds_to_cart, registrations_completed, checkouts_initiated, purchases, purchase_value, app_installs, mobile_app_registrations, video_plays, video_3s_views, video_p25, video_p50, video_p75, video_p95, video_p100"

export type ClientData = {
  client: Client
  rows: Partial<MetaDailyRow>[]
  comparisonRows: Partial<MetaDailyRow>[]
  baselineReach: number
  namingConfig?: NamingConfig
  /** ad_id → ISO created_time from meta_ad_metadata */
  createdDates?: Record<string, string>
}

/**
 * Fetch all Meta performance data for a client within a date range,
 * plus an optional comparison range.
 *
 * Cached for 5 minutes per (clientId, from, to, compFrom, compTo) tuple.
 */
export async function fetchClientData(
  clientId: string,
  from: string,
  to: string,
  compFrom?: string,
  compTo?: string
): Promise<ClientData | null> {
  return unstable_cache(
    () => _fetchClientDataInner(clientId, from, to, compFrom, compTo),
    ["fetchClientData", clientId, from, to, compFrom ?? "", compTo ?? ""],
    { revalidate: CACHE_TTL_SECONDS, tags: [`client:${clientId}`] }
  )()
}

async function _fetchClientDataInner(
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
    .select("id, name, active, meta_account_id, google_ads_customer_id, shopify_store_domain, currency_code")
    .eq("id", clientId)
    .single()

  if (clientError && !fullClient) {
    const { data: fallback } = await supabase
      .from("clients")
      .select("id, name, active")
      .eq("id", clientId)
      .single()
    if (!fallback) return null
    client = { ...fallback, meta_account_id: null, google_ads_customer_id: null, shopify_store_domain: null, monthly_budget: null, currency_code: "GBP" }
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

  // Fetch primary range, comparison range, baseline reach, metadata, and naming config ALL in parallel
  // Uses fetchAllRows to paginate past the PostgREST 1000-row default cap.
  const [primaryRows, compRows, baselineRows, metadataResult, namingResult] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from("meta_daily_performance")
        .select(PERF_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
    ),
    compFrom && compTo
      ? fetchAllRows(() =>
          supabase
            .from("meta_daily_performance")
            .select(PERF_COLUMNS)
            .eq("client_id", clientId)
            .gte("date", compFrom)
            .lte("date", compTo)
            .order("date")
        )
      : Promise.resolve([] as any[]),
    fetchAllRows<{ reach: number; impressions: number }>(() =>
      supabase
        .from("meta_daily_performance")
        .select("reach, impressions")
        .eq("client_id", clientId)
        .gte("date", baselineStartStr)
        .lte("date", baselineEndStr)
    ),
    // Fetch RECENT ad metadata for test badge (last 6 days only)
    // Supabase PostgREST caps results at 1000 rows regardless of .limit(),
    // so we filter to recent ads to stay well under that cap.
    supabase
      .from("meta_ad_metadata")
      .select("ad_id, created_time")
      .eq("client_id", clientId)
      .gte("created_time", new Date(Date.now() - 6 * 86_400_000).toISOString()),
    // Fetch naming config
    supabase
      .from("client_naming_config")
      .select("positions, value_maps")
      .eq("client_id", clientId)
      .single(),
  ])

  let baselineReach = 0
  for (const row of baselineRows) {
    baselineReach += row.reach || 0
  }

  // Build created dates map
  const createdDates: Record<string, string> = {}
  if (metadataResult.error) {
    console.warn("[fetchClientData] meta_ad_metadata query error:", metadataResult.error.message)
  }
  for (const row of metadataResult.data || []) {
    if (row.created_time) {
      createdDates[row.ad_id] = row.created_time
    }
  }
  console.log(`[fetchClientData] client=${clientId} metadataRows=${metadataResult.data?.length ?? 0} createdDates=${Object.keys(createdDates).length}`)

  // Build naming config
  let namingConfig: NamingConfig | undefined
  const namingData = namingResult?.data
  if (namingResult?.error && namingResult.error.code !== "PGRST116") {
    // PGRST116 = "no rows returned" (expected when no config set) — only log real errors
    console.warn("[fetchClientData] naming config error:", namingResult.error.message)
  }
  if (namingData && namingData.positions) {
    namingConfig = {
      positions: namingData.positions as NamingConfig["positions"],
      valueMaps: (namingData.value_maps || {}) as NamingConfig["valueMaps"],
    }
  }

  return {
    client: client as Client,
    rows: primaryRows as Partial<MetaDailyRow>[],
    comparisonRows: compRows as Partial<MetaDailyRow>[],
    baselineReach,
    namingConfig,
    createdDates,
  }
}

/**
 * Fetch all active clients with their total spend for a given period.
 */
export async function fetchClientsList(from: string, to: string) {
  const supabase = createServiceClient()

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, active, meta_account_id, google_ads_customer_id, shopify_store_domain, currency_code")
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
      shopify_store_domain: null,
      monthly_budget: null,
      currency_code: "GBP",
    }))
  }

  if (!clientsList?.length) return []

  // Fetch spend per client from Meta, Google Ads, and Shopify in parallel
  // Wrap queries in .catch() in case tables don't exist yet
  const [metaSpendResult, gaSpendResult, shopifyResult] = await Promise.all([
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
    Promise.resolve(
      supabase
        .from("shopify_daily_orders")
        .select("client_id, orders, net_revenue")
        .gte("date", from)
        .lte("date", to)
    ).catch(() => ({ data: [] as any[] })),
  ])

  // Aggregate spend by client (combined across platforms)
  const spendByClient: Record<
    string,
    { spend: number; impressions: number; purchases: number; revenue: number; shopifyOrders: number; shopifyRevenue: number }
  > = {}

  for (const row of metaSpendResult.data || []) {
    if (!spendByClient[row.client_id]) {
      spendByClient[row.client_id] = { spend: 0, impressions: 0, purchases: 0, revenue: 0, shopifyOrders: 0, shopifyRevenue: 0 }
    }
    spendByClient[row.client_id].spend += row.spend || 0
    spendByClient[row.client_id].impressions += row.impressions || 0
    spendByClient[row.client_id].purchases += row.purchases || 0
    spendByClient[row.client_id].revenue += row.purchase_value || 0
  }

  for (const row of gaSpendResult.data || []) {
    if (!spendByClient[row.client_id]) {
      spendByClient[row.client_id] = { spend: 0, impressions: 0, purchases: 0, revenue: 0, shopifyOrders: 0, shopifyRevenue: 0 }
    }
    spendByClient[row.client_id].spend += row.spend || 0
    spendByClient[row.client_id].impressions += row.impressions || 0
    spendByClient[row.client_id].purchases += row.conversions || 0
    spendByClient[row.client_id].revenue += row.conversion_value || 0
  }

  for (const row of shopifyResult.data || []) {
    if (!spendByClient[row.client_id]) {
      spendByClient[row.client_id] = { spend: 0, impressions: 0, purchases: 0, revenue: 0, shopifyOrders: 0, shopifyRevenue: 0 }
    }
    spendByClient[row.client_id].shopifyOrders += row.orders || 0
    spendByClient[row.client_id].shopifyRevenue += row.net_revenue || 0
  }

  return clientsList.map((c) => ({
    ...c,
    spend: spendByClient[c.id]?.spend || 0,
    impressions: spendByClient[c.id]?.impressions || 0,
    purchases: spendByClient[c.id]?.purchases || 0,
    revenue: spendByClient[c.id]?.revenue || 0,
    shopifyOrders: spendByClient[c.id]?.shopifyOrders || 0,
    shopifyRevenue: spendByClient[c.id]?.shopifyRevenue || 0,
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
  return unstable_cache(
    () => _fetchReachDataInner(clientId, from, to, compFrom, compTo),
    ["fetchReachData", clientId, from, to, compFrom ?? "", compTo ?? ""],
    { revalidate: CACHE_TTL_SECONDS, tags: [`client:${clientId}`] }
  )()
}

async function _fetchReachDataInner(
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

  // Fetch all rows with pagination to avoid PostgREST 1000-row cap
  type ReachRow = { date: string; reach: number; impressions: number; spend?: number; adset_id?: string; adset_name?: string }

  const [reachRows, baselineRows, comparisonRows] = await Promise.all([
    fetchAllRows<ReachRow>(() =>
      supabase
        .from("meta_daily_performance")
        .select("date, reach, impressions, spend, adset_id, adset_name")
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
    ),
    fetchAllRows<{ reach: number; impressions: number }>(() =>
      supabase
        .from("meta_daily_performance")
        .select("reach, impressions")
        .eq("client_id", clientId)
        .gte("date", baselineStartStr)
        .lte("date", baselineEnd)
    ),
    compFrom && compTo
      ? fetchAllRows<ReachRow>(() =>
          supabase
            .from("meta_daily_performance")
            .select("date, reach, impressions, spend, adset_id, adset_name")
            .eq("client_id", clientId)
            .gte("date", compFrom)
            .lte("date", compTo)
            .order("date")
        )
      : Promise.resolve([] as ReachRow[]),
  ])

  let baselineReach = 0
  for (const row of baselineRows) {
    baselineReach += row.reach || 0
  }

  return {
    client,
    rows: reachRows,
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
  return unstable_cache(
    () => _fetchCreativeDataInner(clientId, from, to),
    ["fetchCreativeData", clientId, from, to],
    { revalidate: CACHE_TTL_SECONDS, tags: [`client:${clientId}`] }
  )()
}

async function _fetchCreativeDataInner(
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

  // Step 1: Fetch performance rows + config in parallel (these are fast/small)
  const [perfRows, recentMetaResult, configResult, namingResult2] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from("meta_daily_performance")
        .select(PERF_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
    ),
    // Recent created_times for test badge (last 6 days — avoids 1000-row cap)
    supabase
      .from("meta_ad_metadata")
      .select("ad_id, created_time")
      .eq("client_id", clientId)
      .gte("created_time", new Date(Date.now() - 6 * 86_400_000).toISOString()),
    supabase
      .from("client_scorecard_config")
      .select("creative_previews_enabled, key_action, funnel_steps")
      .eq("client_id", clientId)
      .single(),
    supabase
      .from("client_naming_config")
      .select("positions, value_maps")
      .eq("client_id", clientId)
      .single(),
  ])

  // Step 2: Extract unique ad IDs from perf rows, then fetch only those thumbnails
  // This avoids fetching ALL thumbnails (e.g. 30k rows for TouchNote) which would timeout.
  const adIdSet = new Set<string>()
  for (const r of perfRows as any[]) { if (r.ad_id) adIdSet.add(r.ad_id) }
  const activeAdIds = Array.from(adIdSet)

  // Fetch thumbnails in batches (Supabase .in() has a ~300 item limit)
  const thumbRows: any[] = []
  const BATCH = 300
  const thumbPromises: Promise<any[]>[] = []
  for (let i = 0; i < activeAdIds.length; i += BATCH) {
    const batch = activeAdIds.slice(i, i + BATCH)
    thumbPromises.push(
      fetchAllRows(() =>
        supabase
          .from("meta_ad_metadata")
          .select("ad_id, creative_thumbnail_url")
          .in("ad_id", batch)
          .not("creative_thumbnail_url", "is", null)
      )
    )
  }

  // Fetch thumbnails + demographics + placements in parallel
  const [thumbBatches, demoRows, placementRows] = await Promise.all([
    Promise.all(thumbPromises),
    fetchAllRows(() =>
      supabase
        .from("meta_daily_demographics")
        .select(DEMO_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
    ),
    fetchAllRows(() =>
      supabase
        .from("meta_daily_placements")
        .select(PLACEMENT_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
    ),
  ])
  for (const batch of thumbBatches) thumbRows.push(...batch)

  // Build thumbnail map (ad_id -> url)
  const thumbnails: Record<string, string> = {}
  for (const row of thumbRows as any[]) {
    if (row.creative_thumbnail_url) {
      thumbnails[row.ad_id] = row.creative_thumbnail_url
    }
  }
  console.log(`[fetchCreativeData] client=${clientId} activeAds=${activeAdIds.length} thumbRows=${thumbRows.length} thumbnailMap=${Object.keys(thumbnails).length} perfRows=${(perfRows as any[]).length}`)

  // Build created dates map (ad_id -> created_time) — only recent ads
  const createdDates: Record<string, string> = {}
  for (const row of recentMetaResult.data || []) {
    if (row.created_time) {
      createdDates[row.ad_id] = row.created_time
    }
  }

  const previewsEnabled = configResult.data?.creative_previews_enabled ?? false
  const keyAction = configResult.data?.key_action ?? undefined
  const funnelSteps: string[] = configResult.data?.funnel_steps ?? ["unique_link_clicks", "purchases"]

  // Build naming config if found
  let namingConfig: NamingConfig | undefined
  const namingData2 = namingResult2?.data
  if (namingData2 && namingData2.positions) {
    namingConfig = {
      positions: namingData2.positions as NamingConfig["positions"],
      valueMaps: (namingData2.value_maps || {}) as NamingConfig["valueMaps"],
    }
  }

  return {
    client,
    rows: perfRows as Partial<MetaDailyRow>[],
    thumbnails,
    createdDates,
    previewsEnabled,
    keyAction,
    funnelSteps,
    namingConfig,
    demographics: demoRows as MetaDemographicsRow[],
    placements: placementRows as MetaPlacementsRow[],
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

  const [demoRows, placementRows] = await Promise.all([
    fetchAllRows<MetaDemographicsRow>(() =>
      supabase
        .from("meta_daily_demographics")
        .select(DEMO_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
    ).catch(() => [] as MetaDemographicsRow[]),
    fetchAllRows<MetaPlacementsRow>(() =>
      supabase
        .from("meta_daily_placements")
        .select(PLACEMENT_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
    ).catch(() => [] as MetaPlacementsRow[]),
  ])

  return {
    client,
    demographics: demoRows,
    placements: placementRows,
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
    return await fetchAllRows<GoogleAdsDailyRow>(() =>
      supabase
        .from("google_ads_daily_performance")
        .select(GA_PERF_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
    )
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

  // Run both queries in parallel with pagination
  const [metaRows, gaRows] = await Promise.all([
    fetchAllRows<{ date: string; spend: number }>(() =>
      supabase
        .from("meta_daily_performance")
        .select("date, spend")
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
    ),
    fetchAllRows<{ date: string; spend: number }>(() =>
      supabase
        .from("google_ads_daily_performance")
        .select("date, spend")
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
    ).catch(() => [] as { date: string; spend: number }[]),
  ])

  const rows: DailySpendRow[] = []

  for (const r of metaRows) {
    rows.push({ date: r.date, spend: r.spend || 0, platform: "meta" })
  }
  for (const r of gaRows) {
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
