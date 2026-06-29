/**
 * Server-side data fetching for client performance pages.
 * Centralised here so both admin and client views can reuse it.
 */

import { unstable_cache } from "next/cache"
import { createServiceClient } from "@/lib/supabase/server"
import type { MetaDailyRow, MetaDemographicsRow, MetaPlacementsRow, GoogleAdsDailyRow, Client, AdPlatform, DailySpendRow, AdditionalSpendEntry } from "@/lib/utils/types"
import type { KeywordQualityRow } from "@/lib/utils/quality-score"
import type { NamingConfig } from "@/lib/utils/ad-name-parser"

/** Cache TTL for dashboard data fetches (5 minutes) */
const CACHE_TTL_SECONDS = 300

/**
 * Paginated Supabase fetch — works around the PostgREST 1000-row default cap.
 * `buildQuery` is called per page so the builder is fresh each time.
 */
export async function fetchAllRows<T>(
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
  "date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, reach, unique_link_clicks, landing_page_views, adds_to_cart, registrations_completed, trials_started, checkouts_initiated, purchases, purchase_value, app_installs, mobile_app_registrations, estimated_ad_recallers, video_plays, video_3s_views, video_p25, video_p50, video_p75, video_p95, video_p100"

export type ClientData = {
  client: Client
  rows: Partial<MetaDailyRow>[]
  comparisonRows: Partial<MetaDailyRow>[]
  baselineReach: number
  /** All-time spend & reach for the client, summed across every row in
   *  meta_daily_performance. Used as the denominator/numerator for the
   *  optional "Cost per Eyeball" funnel step so the metric stays stable
   *  regardless of the selected date range. */
  lifetimeSpend: number
  lifetimeReach: number
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

  // Fetch primary range, comparison range, baseline reach, lifetime totals,
  // metadata, and naming config ALL in parallel. Uses fetchAllRows to paginate
  // past the PostgREST 1000-row default cap.
  const [primaryRows, compRows, baselineRows, lifetimeRows, metadataResult, namingResult] = await Promise.all([
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
    // Lifetime totals — no date filter. Powers Cost-per-Eyeball.
    fetchAllRows<{ spend: number; reach: number }>(() =>
      supabase
        .from("meta_daily_performance")
        .select("spend, reach")
        .eq("client_id", clientId)
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
      .select("positions, value_maps, separator")
      .eq("client_id", clientId)
      .single(),
  ])

  let baselineReach = 0
  for (const row of baselineRows) {
    baselineReach += row.reach || 0
  }

  let lifetimeSpend = 0
  let lifetimeReach = 0
  for (const row of lifetimeRows) {
    lifetimeSpend += row.spend || 0
    lifetimeReach += row.reach || 0
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
  const namingData = namingResult?.data as { positions?: unknown; value_maps?: unknown; separator?: string | null } | undefined
  if (namingResult?.error && namingResult.error.code !== "PGRST116") {
    // PGRST116 = "no rows returned" (expected when no config set) — only log real errors
    console.warn("[fetchClientData] naming config error:", namingResult.error.message)
  }
  if (namingData && namingData.positions) {
    namingConfig = {
      positions: namingData.positions as NamingConfig["positions"],
      valueMaps: (namingData.value_maps || {}) as NamingConfig["valueMaps"],
      separator: namingData.separator || undefined,
    }
  }

  return {
    client: client as Client,
    rows: primaryRows as Partial<MetaDailyRow>[],
    comparisonRows: compRows as Partial<MetaDailyRow>[],
    baselineReach,
    lifetimeSpend,
    lifetimeReach,
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
  type ReachRow = { date: string; reach: number; impressions: number; spend?: number; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string }
  const REACH_COLS = "date, reach, impressions, spend, adset_id, adset_name, campaign_id, campaign_name"

  const [reachRows, baselineRows, comparisonRows, lifetimeRaw] = await Promise.all([
    fetchAllRows<ReachRow>(() =>
      supabase
        .from("meta_daily_performance")
        .select(REACH_COLS)
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
            .select(REACH_COLS)
            .eq("client_id", clientId)
            .gte("date", compFrom)
            .lte("date", compTo)
            .order("date")
        )
      : Promise.resolve([] as ReachRow[]),
    // Lifetime daily reach (inception → period end). Powers the weeks/months
    // toggle and the deduped "true new reach" calculation, which measures new
    // reach within a period against the campaign/ad set/ad lifetime reach.
    fetchAllRows<ReachRow>(() =>
      supabase
        .from("meta_daily_performance")
        .select(REACH_COLS)
        .eq("client_id", clientId)
        .lte("date", to)
        .order("date")
    ),
  ])

  let baselineReach = 0
  for (const row of baselineRows) {
    baselineReach += row.reach || 0
  }

  // Collapse lifetime rows to one row per (date, ad set) to keep the client
  // payload bounded while preserving ad-set-level filtering for the chart.
  const lifetimeByKey = new Map<string, ReachRow>()
  for (const row of lifetimeRaw) {
    if (!row.date) continue
    const key = `${row.date}|${row.adset_id ?? ""}`
    const existing = lifetimeByKey.get(key)
    if (existing) {
      existing.reach += row.reach || 0
      existing.impressions += row.impressions || 0
      existing.spend = (existing.spend || 0) + (row.spend || 0)
    } else {
      lifetimeByKey.set(key, {
        date: row.date,
        reach: row.reach || 0,
        impressions: row.impressions || 0,
        spend: row.spend || 0,
        adset_id: row.adset_id,
        adset_name: row.adset_name,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
      })
    }
  }
  const lifetimeRows = Array.from(lifetimeByKey.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  )

  return {
    client,
    rows: reachRows,
    baselineReach,
    comparisonRows,
    lifetimeRows,
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
      .select("positions, value_maps, separator")
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
  const namingData2 = namingResult2?.data as { positions?: unknown; value_maps?: unknown; separator?: string | null } | undefined
  if (namingData2 && namingData2.positions) {
    namingConfig = {
      positions: namingData2.positions as NamingConfig["positions"],
      valueMaps: (namingData2.value_maps || {}) as NamingConfig["valueMaps"],
      separator: namingData2.separator || undefined,
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

/** Columns in google_ads_keyword_quality consumed by the Quality Score section */
const GA_QUALITY_COLUMNS =
  "campaign_id, campaign_name, ad_group_id, ad_group_name, criterion_id, keyword_text, spend, impressions, quality_score, expected_ctr, ad_relevance, landing_page_experience"

/**
 * Fetch the latest Google Ads keyword Quality Score snapshot for a client.
 *
 * Quality Score is a point-in-time daily snapshot, NOT a date-segmentable
 * metric — each row's spend/impressions already cover a trailing 30-day window
 * ending on its snapshot_date. So we pick the single most recent snapshot on or
 * before the selected range's end date and return every keyword row for that
 * one snapshot. Summing across snapshots would double-count, so we never do.
 *
 * Returns [] when the client has no Quality Score data (e.g. Performance Max
 * accounts, which have no keywords) — the section hides itself in that case.
 */
export async function fetchGoogleAdsQualityData(
  clientId: string,
  to: string
): Promise<KeywordQualityRow[]> {
  try {
    const supabase = createServiceClient()

    // Latest snapshot on or before the range end.
    const { data: latest } = await supabase
      .from("google_ads_keyword_quality")
      .select("snapshot_date")
      .eq("client_id", clientId)
      .lte("snapshot_date", to)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle()

    const snapshotDate = (latest as { snapshot_date: string } | null)?.snapshot_date
    if (!snapshotDate) return []

    return await fetchAllRows<KeywordQualityRow>(() =>
      supabase
        .from("google_ads_keyword_quality")
        .select(GA_QUALITY_COLUMNS)
        .eq("client_id", clientId)
        .eq("snapshot_date", snapshotDate)
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

/**
 * Fetch manually-entered additional spend entries that overlap [from, to].
 * Returned amounts are entry totals (not daily). Use expandAdditionalSpendDaily
 * to convert to a per-day series.
 */
export async function fetchAdditionalSpend(
  clientId: string,
  from: string,
  to: string
): Promise<AdditionalSpendEntry[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("client_additional_spend")
    .select("id, client_id, start_date, end_date, amount, note")
    .eq("client_id", clientId)
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date", { ascending: false })

  if (error) {
    console.warn("[fetchAdditionalSpend]", error.message)
    return []
  }
  return (data || []).map((r) => ({
    id: r.id,
    client_id: r.client_id,
    start_date: r.start_date,
    end_date: r.end_date,
    amount: Number(r.amount) || 0,
    note: r.note ?? null,
  }))
}

/** All entries for a client (no date filter). Used by the admin manager UI. */
export async function fetchAllAdditionalSpend(
  clientId: string
): Promise<AdditionalSpendEntry[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("client_additional_spend")
    .select("id, client_id, start_date, end_date, amount, note")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false })

  if (error) {
    console.warn("[fetchAllAdditionalSpend]", error.message)
    return []
  }
  return (data || []).map((r) => ({
    id: r.id,
    client_id: r.client_id,
    start_date: r.start_date,
    end_date: r.end_date,
    amount: Number(r.amount) || 0,
    note: r.note ?? null,
  }))
}

/**
 * Expand entries to a daily { date, spend }[] series, distributing each
 * entry's total amount evenly across the days in its range that fall inside
 * [from, to]. Returns one row per date that has nonzero contribution, sorted
 * ascending. Entries outside the window contribute nothing.
 */
export function expandAdditionalSpendDaily(
  entries: AdditionalSpendEntry[],
  from: string,
  to: string
): { date: string; spend: number }[] {
  const byDate: Record<string, number> = {}
  const fromMs = Date.parse(from + "T00:00:00Z")
  const toMs = Date.parse(to + "T00:00:00Z")
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return []

  for (const e of entries) {
    const sMs = Date.parse(e.start_date + "T00:00:00Z")
    const eMs = Date.parse(e.end_date + "T00:00:00Z")
    if (Number.isNaN(sMs) || Number.isNaN(eMs) || eMs < sMs) continue
    const totalDays = Math.round((eMs - sMs) / 86_400_000) + 1
    if (totalDays <= 0) continue
    const perDay = e.amount / totalDays

    const startMs = Math.max(sMs, fromMs)
    const endMs = Math.min(eMs, toMs)
    if (endMs < startMs) continue

    for (let d = startMs; d <= endMs; d += 86_400_000) {
      const date = new Date(d).toISOString().slice(0, 10)
      byDate[date] = (byDate[date] || 0) + perDay
    }
  }

  return Object.entries(byDate)
    .map(([date, spend]) => ({ date, spend: Math.round(spend * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Sum two daily { date, spend }[] series by date. Returns sorted ascending. */
export function mergeDailySpend(
  a: { date: string; spend: number }[],
  b: { date: string; spend: number }[]
): { date: string; spend: number }[] {
  const byDate: Record<string, number> = {}
  for (const r of a) byDate[r.date] = (byDate[r.date] || 0) + r.spend
  for (const r of b) byDate[r.date] = (byDate[r.date] || 0) + r.spend
  return Object.entries(byDate)
    .map(([date, spend]) => ({ date, spend: Math.round(spend * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Re-export getClientPlatforms from types for backwards compat
export { getClientPlatforms } from "@/lib/utils/types"

// ──────────────────────────────────────────────────────────────────────────
// Ad-volume calculator
// ──────────────────────────────────────────────────────────────────────────

export type AdVolumeData = {
  clientId: string
  clientName: string
  currency: string
  /** Projected 30-day Meta spend at the current run-rate. */
  monthlySpend: number
  /** Daily spend run-rate the projection is based on. */
  dailyRunRate: number
  /** How many recent days the run-rate is averaged over (7, or 30 as fallback). */
  runRateDays: number
  /** Trailing-30-day CPA for the client's prioritised event (0 if none recorded). */
  cpa: number
  /** Event the CPA is measured on — the client's dashboard key action. */
  keyAction: string
  /** Distinct new creatives launched in the last 30 days. */
  newCreativePerMonth: number
  /** Distinct ads with delivery in the last 7 days (reference figure). */
  activeAdsNow: number
}

const KEY_ACTION_COLUMN: Record<string, string> = {
  unique_link_clicks: "unique_link_clicks",
  landing_page_views: "landing_page_views",
  adds_to_cart: "adds_to_cart",
  checkouts_initiated: "checkouts_initiated",
  registrations_completed: "registrations_completed",
  trials_started: "trials_started",
  app_installs: "app_installs",
  mobile_app_registrations: "mobile_app_registrations",
  estimated_ad_recallers: "estimated_ad_recallers",
  purchases: "purchases",
}

/**
 * Data for the per-client ad-volume calculator: projected monthly Meta spend
 * (a forward run-rate, not last-30-day actuals), trailing-30-day CPA on the
 * client's prioritised dashboard event, and how much new creative is actually
 * going in (distinct ad creation events in the last 30 days, with a fallback).
 */
export async function fetchAdVolumeData(clientId: string): Promise<AdVolumeData | null> {
  const supabase = createServiceClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, currency_code")
    .eq("id", clientId)
    .single()
  if (!client) return null

  const dayMs = 86_400_000
  const dateStr = (ms: number) => new Date(ms).toISOString().split("T")[0]
  const now = Date.now()
  const from30 = dateStr(now - 30 * dayMs)
  // Run-rate window: the last 7 *complete* days (yesterday back 7 days) — today
  // is partial so it's excluded.
  const runRateStart = dateStr(now - 7 * dayMs)
  const runRateEnd = dateStr(now - 1 * dayMs)
  const active7From = dateStr(now - 7 * dayMs)
  const from90 = dateStr(now - 90 * dayMs)
  const to = dateStr(now)

  const { data: scorecard } = await supabase
    .from("client_scorecard_config")
    .select("key_action")
    .eq("client_id", clientId)
    .maybeSingle()
  const keyAction = (scorecard?.key_action as string | undefined) || "purchases"
  const convColumn = KEY_ACTION_COLUMN[keyAction] || "purchases"

  const [perfRows, priorRows, metaRes] = await Promise.all([
    fetchAllRows<{ date: string; ad_id: string; spend: number } & Record<string, number>>(() =>
      supabase
        .from("meta_daily_performance")
        .select(`date, ad_id, spend, ${convColumn}`)
        .eq("client_id", clientId)
        .gte("date", from30)
        .lte("date", to)
    ),
    fetchAllRows<{ ad_id: string }>(() =>
      supabase
        .from("meta_daily_performance")
        .select("ad_id")
        .eq("client_id", clientId)
        .gte("date", from90)
        .lt("date", from30)
    ),
    supabase
      .from("meta_ad_metadata")
      .select("ad_id, created_time")
      .eq("client_id", clientId)
      .gte("created_time", new Date(now - 30 * dayMs).toISOString()),
  ])

  let trailing30Spend = 0
  let conversions = 0
  let runRateWindowSpend = 0
  const active30 = new Set<string>()
  const active7 = new Set<string>()
  for (const r of perfRows) {
    trailing30Spend += r.spend || 0
    conversions += Number(r[convColumn]) || 0
    if (r.date >= runRateStart && r.date <= runRateEnd) runRateWindowSpend += r.spend || 0
    if (r.ad_id) {
      active30.add(r.ad_id)
      if (r.date >= active7From) active7.add(r.ad_id)
    }
  }
  const cpa = conversions > 0 ? trailing30Spend / conversions : 0

  // Expected monthly spend = forward run-rate. Base it on the last 7 complete
  // days; if there's no recent spend at all (paused / sparse), fall back to the
  // trailing-30-day average so the figure is still meaningful.
  let runRateDays = 7
  let dailyRunRate = runRateWindowSpend / 7
  if (dailyRunRate <= 0) {
    runRateDays = 30
    dailyRunRate = trailing30Spend / 30
  }
  const monthlySpend = dailyRunRate * 30

  // New creative: prefer creation events from meta_ad_metadata; if that table
  // is empty/unavailable, fall back to "ads delivering in the last 30d that
  // weren't delivering in the prior 60d".
  const createdRecently = new Set<string>()
  for (const r of metaRes.data || []) {
    if (r.ad_id && r.created_time) createdRecently.add(r.ad_id)
  }
  let newCreativePerMonth: number
  if (createdRecently.size > 0) {
    newCreativePerMonth = createdRecently.size
  } else {
    const prior = new Set<string>()
    for (const r of priorRows) if (r.ad_id) prior.add(r.ad_id)
    let n = 0
    active30.forEach((id) => {
      if (!prior.has(id)) n++
    })
    newCreativePerMonth = n
  }

  return {
    clientId: client.id as string,
    clientName: client.name as string,
    currency: ((client as { currency_code?: string | null }).currency_code) || "GBP",
    monthlySpend,
    dailyRunRate,
    runRateDays,
    cpa,
    keyAction,
    newCreativePerMonth,
    activeAdsNow: active7.size,
  }
}
