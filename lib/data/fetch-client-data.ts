/**
 * Server-side data fetching for client performance pages.
 * Centralised here so both admin and client views can reuse it.
 */

import { createServiceClient } from "@/lib/supabase/server"
import type { MetaDailyRow, MetaDemographicsRow, MetaPlacementsRow, Client } from "@/lib/utils/types"

/** Columns available in meta_daily_performance */
const PERF_COLUMNS =
  "date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, reach, unique_link_clicks, landing_page_views, adds_to_cart, registrations_completed, checkouts_initiated, purchases, purchase_value, app_installs, mobile_app_registrations, video_3s_views, video_p25, video_p50, video_p75, video_p95, video_p100"

export type ClientData = {
  client: Client
  rows: Partial<MetaDailyRow>[]
  comparisonRows: Partial<MetaDailyRow>[]
  baselineReach: number
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

  // Fetch client
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, active")
    .eq("id", clientId)
    .single()

  if (!client) return null

  // Fetch primary range
  const { data: rows } = await supabase
    .from("meta_daily_performance")
    .select(PERF_COLUMNS)
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .order("date")

  // Fetch comparison range if provided
  let comparisonRows: Partial<MetaDailyRow>[] = []
  if (compFrom && compTo) {
    const { data: compRows } = await supabase
      .from("meta_daily_performance")
      .select(PERF_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", compFrom)
      .lte("date", compTo)
      .order("date")

    comparisonRows = compRows || []
  }

  // Fetch baseline reach for Net New Reach calculation
  // (cumulative reach in the 30 days before the range start)
  const baselineStart = new Date(from + "T00:00:00")
  baselineStart.setDate(baselineStart.getDate() - 30)
  const baselineStartStr = baselineStart.toISOString().split("T")[0]

  const dayBefore = new Date(from + "T00:00:00")
  dayBefore.setDate(dayBefore.getDate() - 1)
  const baselineEndStr = dayBefore.toISOString().split("T")[0]

  const { data: baselineRows } = await supabase
    .from("meta_daily_performance")
    .select("reach, impressions")
    .eq("client_id", clientId)
    .gte("date", baselineStartStr)
    .lte("date", baselineEndStr)

  // Estimate baseline reach using simple sum (no frequency column available)
  let baselineReach = 0
  if (baselineRows?.length) {
    for (const row of baselineRows) {
      baselineReach += (row as { reach: number }).reach || 0
    }
  }

  return {
    client: client as Client,
    rows: rows || [],
    comparisonRows,
    baselineReach,
  }
}

/**
 * Fetch all active clients with their total spend for a given period.
 */
export async function fetchClientsList(from: string, to: string) {
  const supabase = createServiceClient()

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, active")
    .eq("active", true)
    .order("name")

  if (!clients?.length) return []

  // Fetch spend per client for the period
  const { data: spendRows } = await supabase
    .from("meta_daily_performance")
    .select("client_id, spend, impressions, purchases, purchase_value")
    .gte("date", from)
    .lte("date", to)

  // Aggregate spend by client
  const spendByClient: Record<
    string,
    { spend: number; impressions: number; purchases: number; revenue: number }
  > = {}

  for (const row of spendRows || []) {
    if (!spendByClient[row.client_id]) {
      spendByClient[row.client_id] = { spend: 0, impressions: 0, purchases: 0, revenue: 0 }
    }
    spendByClient[row.client_id].spend += row.spend || 0
    spendByClient[row.client_id].impressions += row.impressions || 0
    spendByClient[row.client_id].purchases += row.purchases || 0
    spendByClient[row.client_id].revenue += row.purchase_value || 0
  }

  return clients.map((c) => ({
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
  to: string
) {
  const supabase = createServiceClient()

  // Fetch client name
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .single()

  if (!client) return null

  // Fetch daily reach data for the range
  const { data: rows } = await supabase
    .from("meta_daily_performance")
    .select("date, reach, impressions")
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .order("date")

  // Fetch baseline reach (sum of reach before range start) for corrected day-1 calculation
  const dayBefore = new Date(from + "T00:00:00")
  dayBefore.setDate(dayBefore.getDate() - 1)
  const baselineEnd = dayBefore.toISOString().split("T")[0]

  // Get the last 30 days before range as baseline
  const baselineStart = new Date(from + "T00:00:00")
  baselineStart.setDate(baselineStart.getDate() - 30)
  const baselineStartStr = baselineStart.toISOString().split("T")[0]

  const { data: baselineRows } = await supabase
    .from("meta_daily_performance")
    .select("reach, impressions")
    .eq("client_id", clientId)
    .gte("date", baselineStartStr)
    .lte("date", baselineEnd)

  // Sum baseline reach
  let baselineReach = 0
  if (baselineRows?.length) {
    for (const row of baselineRows) {
      baselineReach += (row as { reach: number }).reach || 0
    }
  }

  return {
    client,
    rows: rows || [],
    baselineReach,
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
    .select("id, name")
    .eq("id", clientId)
    .single()

  if (!client) return null

  // Fetch performance rows, thumbnails, and config in parallel
  const [perfResult, thumbResult, configResult] = await Promise.all([
    supabase
      .from("meta_daily_performance")
      .select(PERF_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .order("date"),
    supabase
      .from("meta_ad_metadata")
      .select("ad_id, creative_thumbnail_url")
      .eq("client_id", clientId)
      .not("creative_thumbnail_url", "is", null),
    supabase
      .from("client_scorecard_config")
      .select("creative_previews_enabled")
      .eq("client_id", clientId)
      .single(),
  ])

  // Build thumbnail map: ad_id -> url
  const thumbnails: Record<string, string> = {}
  for (const row of thumbResult.data || []) {
    if (row.creative_thumbnail_url) {
      thumbnails[row.ad_id] = row.creative_thumbnail_url
    }
  }

  const previewsEnabled = configResult.data?.creative_previews_enabled ?? false

  return {
    client,
    rows: perfResult.data || [],
    thumbnails,
    previewsEnabled,
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
    .select("id, name")
    .eq("id", clientId)
    .single()

  if (!client) return null

  // Queries may fail if tables don't exist yet (migration not run)
  const [demoResult, placementResult] = await Promise.all([
    supabase
      .from("meta_daily_demographics")
      .select(DEMO_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .then((r) => r.data || [])
      .catch(() => [] as MetaDemographicsRow[]),
    supabase
      .from("meta_daily_placements")
      .select(PLACEMENT_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .then((r) => r.data || [])
      .catch(() => [] as MetaPlacementsRow[]),
  ])

  return {
    client,
    demographics: demoResult as MetaDemographicsRow[],
    placements: placementResult as MetaPlacementsRow[],
  }
}
