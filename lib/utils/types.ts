/**
 * Shared TypeScript types used across the dashboard.
 */

/** A row from meta_daily_performance */
export type MetaDailyRow = {
  date: string
  client_id: string
  campaign_id: string
  campaign_name: string
  adset_id: string
  adset_name: string
  ad_id: string
  ad_name: string
  spend: number
  impressions: number
  reach: number
  unique_link_clicks: number
  landing_page_views: number
  adds_to_cart: number
  registrations_completed: number
  checkouts_initiated: number
  purchases: number
  purchase_value: number
  app_installs: number
  mobile_app_registrations: number
  video_3s_views: number
  video_p25: number
  video_p50: number
  video_p75: number
  video_p95: number
  video_p100: number
}

/** Aggregated metrics for scorecards and summaries */
export type AggregatedMetrics = {
  spend: number
  impressions: number
  reach: number
  clicks: number
  landingPageViews: number
  addsToCart: number
  registrationsCompleted: number
  checkoutsInitiated: number
  purchases: number
  revenue: number
  appInstalls: number
  mobileAppRegistrations: number
}

/** Client record from the clients table */
export type Client = {
  id: string
  name: string
  slug?: string
  active: boolean
  view_password_hash?: string | null
  meta_account_id?: string | null
  google_ads_customer_id?: string | null
  monthly_budget?: number | null
  currency_code?: string | null
}

/** Date range for filters */
export type DateRange = {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
}

/** Comparison period type */
export type ComparisonType =
  | "previous_period"
  | "previous_month"
  | "previous_year"
  | "custom"
  | "none"

/** Data hierarchy level */
export type HierarchyLevel = "campaign" | "adset" | "ad"

/** Pacing status */
export type PacingStatus =
  | "on_track"
  | "slightly_over"
  | "slightly_under"
  | "significantly_over"
  | "significantly_under"
  | "no_budget"

/** Get pacing status from pacing percentage */
export function getPacingStatus(pacingPct: number | null): PacingStatus {
  if (pacingPct === null) return "no_budget"
  if (pacingPct > 115) return "significantly_over"
  if (pacingPct > 105) return "slightly_over"
  if (pacingPct < 85) return "significantly_under"
  if (pacingPct < 95) return "slightly_under"
  return "on_track"
}

/** Status display config */
export const PACING_STATUS_CONFIG: Record<PacingStatus, { label: string; color: string; icon: string }> = {
  on_track: { label: "On Track", color: "text-green-400", icon: "✅" },
  slightly_over: { label: "Over-pacing", color: "text-amber-400", icon: "🟡" },
  slightly_under: { label: "Slightly Under", color: "text-amber-400", icon: "🟡" },
  significantly_over: { label: "Significantly Over", color: "text-red-400", icon: "🔴" },
  significantly_under: { label: "Under-pacing", color: "text-red-400", icon: "🔴" },
  no_budget: { label: "No Budget", color: "text-neutral-500", icon: "—" },
}

/** Custom metric definition from DB */
export type CustomMetric = {
  id: string
  name: string
  numerator: string
  denominator: string
  multiplier: number
  format: "number" | "currency" | "percentage"
  decimals: number
  description: string | null
  is_preset: boolean
  created_by: string | null
  created_at: string
}

/** Base metric fields available for custom metric formulas */
export const BASE_METRIC_FIELDS = [
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "reach", label: "Reach" },
  { value: "unique_link_clicks", label: "Unique Link Clicks" },
  { value: "landing_page_views", label: "Landing Page Views" },
  { value: "adds_to_cart", label: "Adds to Cart" },
  { value: "registrations_completed", label: "Registrations Completed" },
  { value: "checkouts_initiated", label: "Checkouts Initiated" },
  { value: "purchases", label: "Purchases" },
  { value: "purchase_value", label: "Purchase Value (Revenue)" },
  { value: "app_installs", label: "App Installs" },
  { value: "mobile_app_registrations", label: "In-App Registrations" },
] as const

export type BaseMetricField = (typeof BASE_METRIC_FIELDS)[number]["value"]

/** Ad platform identifier */
export type AdPlatform = "meta" | "google_ads"

/** A row from google_ads_daily_performance */
export type GoogleAdsDailyRow = {
  client_id: string
  date: string
  campaign_id: string
  campaign_name: string
  ad_group_id: string
  ad_group_name: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversion_value: number
}

/** Unified spend row for pacing (platform-agnostic) */
export type DailySpendRow = {
  date: string
  spend: number
  platform: AdPlatform
}

/** Determine which ad platforms a client has configured */
export function getClientPlatforms(client: Client): AdPlatform[] {
  const platforms: AdPlatform[] = []
  if (client.meta_account_id) platforms.push("meta")
  if (client.google_ads_customer_id) platforms.push("google_ads")
  return platforms
}

/** A row from meta_daily_demographics */
export type MetaDemographicsRow = {
  date: string
  client_id: string
  campaign_id: string
  campaign_name: string
  adset_id: string
  adset_name: string
  ad_id: string
  ad_name: string
  age: string
  gender: string
  spend: number
  impressions: number
  reach: number
  unique_link_clicks: number
  landing_page_views: number
  purchases: number
  purchase_value: number
}

/** A row from meta_daily_placements */
export type MetaPlacementsRow = {
  date: string
  client_id: string
  campaign_id: string
  campaign_name: string
  adset_id: string
  adset_name: string
  ad_id: string
  ad_name: string
  publisher_platform: string
  platform_position: string
  impression_device: string
  spend: number
  impressions: number
  reach: number
  unique_link_clicks: number
  landing_page_views: number
  purchases: number
  purchase_value: number
}
