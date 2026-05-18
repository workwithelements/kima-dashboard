/**
 * Aggregate raw daily performance rows into summaries.
 * Used across all dashboard pages.
 */

import type {
  MetaDailyRow,
  GoogleAdsDailyRow,
  AggregatedMetrics,
  HierarchyLevel,
  ShopifyDailyOrdersRow,
  ShopifyAttributionRow,
  ShopifyAggregatedMetrics,
  ContributionMargin3,
  MetaAttributionComparison,
} from "./types"

/** Sum all metric rows into a single aggregate */
export function aggregateMetrics(rows: Partial<MetaDailyRow>[]): AggregatedMetrics {
  return rows.reduce<AggregatedMetrics>(
    (acc, row) => ({
      spend: acc.spend + (row.spend || 0),
      impressions: acc.impressions + (row.impressions || 0),
      reach: acc.reach + (row.reach || 0),
      clicks: acc.clicks + (row.unique_link_clicks || 0),
      landingPageViews: acc.landingPageViews + (row.landing_page_views || 0),
      addsToCart: acc.addsToCart + (row.adds_to_cart || 0),
      registrationsCompleted: acc.registrationsCompleted + (row.registrations_completed || 0),
      trialsStarted: acc.trialsStarted + (row.trials_started || 0),
      checkoutsInitiated: acc.checkoutsInitiated + (row.checkouts_initiated || 0),
      purchases: acc.purchases + (row.purchases || 0),
      revenue: acc.revenue + (row.purchase_value || 0),
      appInstalls: acc.appInstalls + (row.app_installs || 0),
      mobileAppRegistrations: acc.mobileAppRegistrations + (row.mobile_app_registrations || 0),
      video2SecViews: acc.video2SecViews + (row.video_3s_views || 0),
      // Lifetime fields stay 0 — callers overlay them from a date-unbounded query.
      lifetimeReach: 0,
      lifetimeSpend: 0,
    }),
    {
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      landingPageViews: 0,
      addsToCart: 0,
      registrationsCompleted: 0,
      trialsStarted: 0,
      checkoutsInitiated: 0,
      purchases: 0,
      revenue: 0,
      appInstalls: 0,
      mobileAppRegistrations: 0,
      video2SecViews: 0,
      lifetimeReach: 0,
      lifetimeSpend: 0,
    }
  )
}

/** Aggregate Google Ads rows into the common AggregatedMetrics shape */
export function aggregateGoogleAdsMetrics(rows: Partial<GoogleAdsDailyRow>[]): AggregatedMetrics {
  return rows.reduce<AggregatedMetrics>(
    (acc, row) => ({
      spend: acc.spend + (row.spend || 0),
      impressions: acc.impressions + (row.impressions || 0),
      reach: 0, // Google Ads doesn't report reach
      clicks: acc.clicks + (row.clicks || 0),
      landingPageViews: 0,
      addsToCart: 0,
      registrationsCompleted: 0,
      trialsStarted: 0,
      checkoutsInitiated: 0,
      purchases: acc.purchases + (row.conversions || 0),
      revenue: acc.revenue + (row.conversion_value || 0),
      appInstalls: 0,
      mobileAppRegistrations: 0,
      video2SecViews: 0,
      lifetimeReach: 0,
      lifetimeSpend: 0,
    }),
    {
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      landingPageViews: 0,
      addsToCart: 0,
      registrationsCompleted: 0,
      trialsStarted: 0,
      checkoutsInitiated: 0,
      purchases: 0,
      revenue: 0,
      appInstalls: 0,
      mobileAppRegistrations: 0,
      video2SecViews: 0,
      lifetimeReach: 0,
      lifetimeSpend: 0,
    }
  )
}

/** Group Google Ads rows by campaign for the data table */
export function groupGoogleAdsByLevel(
  rows: Partial<GoogleAdsDailyRow>[],
  level: "campaign" | "ad_group"
): {
  id: string
  name: string
  metrics: AggregatedMetrics
}[] {
  const groups: Record<string, { name: string; rows: Partial<GoogleAdsDailyRow>[] }> = {}

  for (const row of rows) {
    let id: string
    let name: string
    switch (level) {
      case "campaign":
        id = row.campaign_id || "unknown"
        name = row.campaign_name || id
        break
      case "ad_group":
        id = row.ad_group_id || "unknown"
        name = row.ad_group_name || id
        break
    }
    if (!groups[id]) groups[id] = { name, rows: [] }
    groups[id].rows.push(row)
  }

  return Object.entries(groups)
    .map(([id, { name, rows: groupRows }]) => ({
      id,
      name,
      metrics: aggregateGoogleAdsMetrics(groupRows),
    }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend)
}

/** Derived metrics from aggregated totals */
export function deriveMetrics(m: AggregatedMetrics) {
  return {
    roas: m.spend > 0 ? m.revenue / m.spend : 0,
    cpa: m.purchases > 0 ? m.spend / m.purchases : 0,
    cpm: m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0,
    cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
    ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
    cartRate: m.landingPageViews > 0 ? (m.addsToCart / m.landingPageViews) * 100 : 0,
    conversionRate: m.clicks > 0 ? (m.purchases / m.clicks) * 100 : 0,
    aov: m.purchases > 0 ? m.revenue / m.purchases : 0,
    costPerRegistration: m.registrationsCompleted > 0 ? m.spend / m.registrationsCompleted : 0,
    frequency: m.reach > 0 ? m.impressions / m.reach : 0,
  }
}

/** Group rows by date and sum spend, filling in zero-spend days across the full range */
export function dailySpendSeries(
  rows: Partial<MetaDailyRow>[],
  fromDate?: string,
  toDate?: string
): { date: string; spend: number }[] {
  const byDate: Record<string, number> = {}
  for (const row of rows) {
    if (!row.date) continue
    byDate[row.date] = (byDate[row.date] || 0) + (row.spend || 0)
  }

  // If date range is provided, fill in missing days with zero spend
  if (fromDate && toDate) {
    const cursor = new Date(fromDate + "T00:00:00")
    const end = new Date(toDate + "T00:00:00")
    while (cursor <= end) {
      const key = cursor.toISOString().split("T")[0]
      if (!(key in byDate)) byDate[key] = 0
      cursor.setDate(cursor.getDate() + 1)
    }
  }

  return Object.entries(byDate)
    .map(([date, spend]) => ({ date, spend: Math.round(spend * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Group rows by date and sum metrics for configured funnel steps.
 * stepKeys should be MetaDailyRow field names (e.g. "unique_link_clicks", "purchases").
 */
export function dailyFunnelSeries(
  rows: Partial<MetaDailyRow>[],
  stepKeys: string[]
): Record<string, number | string>[] {
  if (stepKeys.length === 0) return []

  const byDate: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    if (!row.date) continue
    if (!byDate[row.date]) {
      byDate[row.date] = {}
      for (const key of stepKeys) byDate[row.date][key] = 0
    }
    for (const key of stepKeys) {
      byDate[row.date][key] += ((row as Record<string, any>)[key] as number) || 0
    }
  }
  return Object.entries(byDate)
    .map(([date, values]) => ({ date, ...values }))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))
}

/** Group rows by hierarchy level for the data table */
export function groupByLevel(
  rows: Partial<MetaDailyRow>[],
  level: HierarchyLevel
): {
  id: string
  name: string
  metrics: AggregatedMetrics
}[] {
  const groups: Record<string, { name: string; rows: Partial<MetaDailyRow>[] }> = {}

  for (const row of rows) {
    let id: string
    let name: string
    switch (level) {
      case "campaign":
        id = row.campaign_id || "unknown"
        name = row.campaign_name || id
        break
      case "adset":
        id = row.adset_id || "unknown"
        name = row.adset_name || id
        break
      case "ad":
        id = row.ad_id || "unknown"
        name = row.ad_name || id
        break
    }
    if (!groups[id]) groups[id] = { name, rows: [] }
    groups[id].rows.push(row)
  }

  return Object.entries(groups)
    .map(([id, { name, rows: groupRows }]) => ({
      id,
      name,
      metrics: aggregateMetrics(groupRows),
    }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend) // Default sort by spend desc
}

/** Aggregate Shopify daily order rows into totals */
export function aggregateShopifyMetrics(rows: Partial<ShopifyDailyOrdersRow>[]): ShopifyAggregatedMetrics {
  return rows.reduce<ShopifyAggregatedMetrics>(
    (acc, row) => ({
      orders: acc.orders + (row.orders || 0),
      grossRevenue: acc.grossRevenue + (row.gross_revenue || 0),
      discounts: acc.discounts + (row.discounts || 0),
      refunds: acc.refunds + (row.refunds || 0),
      netRevenue: acc.netRevenue + (row.net_revenue || 0),
      cogs: acc.cogs + (row.cogs || 0),
      shippingCosts: acc.shippingCosts + (row.shipping_costs || 0),
    }),
    { orders: 0, grossRevenue: 0, discounts: 0, refunds: 0, netRevenue: 0, cogs: 0, shippingCosts: 0 }
  )
}

/** Calculate Contribution Margin 3 from Shopify metrics and total ad spend */
export function calculateCM3(shopify: ShopifyAggregatedMetrics, totalAdSpend: number): ContributionMargin3 {
  const grossProfit = shopify.netRevenue - shopify.cogs - shopify.shippingCosts
  const cm3 = grossProfit - totalAdSpend
  const cm3Pct = shopify.netRevenue > 0 ? (cm3 / shopify.netRevenue) * 100 : 0

  return {
    netRevenue: shopify.netRevenue,
    cogs: shopify.cogs,
    shippingCosts: shopify.shippingCosts,
    grossProfit,
    totalAdSpend,
    cm3,
    cm3Pct,
  }
}

/**
 * Patterns used to match Shopify UTM sources to Meta/Facebook traffic.
 * Matches common UTM source values from Meta campaigns.
 */
const META_SOURCE_PATTERNS = ["facebook", "fb", "meta", "ig", "instagram"]

/** Compare Meta platform-reported performance vs Shopify-attributed Meta performance */
export function calculateMetaAttribution(
  metaMetrics: { purchases: number; revenue: number },
  attributionRows: Partial<ShopifyAttributionRow>[]
): MetaAttributionComparison {
  // Filter attribution rows for Meta-sourced traffic
  let shopifyAttributedRevenue = 0
  let shopifyAttributedOrders = 0

  for (const row of attributionRows) {
    const source = (row.source || "").toLowerCase()
    if (META_SOURCE_PATTERNS.some((p) => source.includes(p))) {
      shopifyAttributedRevenue += row.revenue || 0
      shopifyAttributedOrders += row.orders || 0
    }
  }

  const revenueDiscrepancy = metaMetrics.revenue - shopifyAttributedRevenue
  const revenueDiscrepancyPct =
    shopifyAttributedRevenue > 0
      ? ((metaMetrics.revenue - shopifyAttributedRevenue) / shopifyAttributedRevenue) * 100
      : 0

  return {
    metaReportedRevenue: metaMetrics.revenue,
    metaReportedPurchases: metaMetrics.purchases,
    shopifyAttributedRevenue,
    shopifyAttributedOrders,
    revenueDiscrepancy,
    revenueDiscrepancyPct,
  }
}

/** Group Shopify daily orders by date for time-series charts */
export function dailyShopifySeries(
  rows: Partial<ShopifyDailyOrdersRow>[],
  fromDate?: string,
  toDate?: string
): { date: string; orders: number; netRevenue: number }[] {
  const byDate: Record<string, { orders: number; netRevenue: number }> = {}

  for (const row of rows) {
    if (!row.date) continue
    if (!byDate[row.date]) byDate[row.date] = { orders: 0, netRevenue: 0 }
    byDate[row.date].orders += row.orders || 0
    byDate[row.date].netRevenue += row.net_revenue || 0
  }

  // Fill in missing days with zeroes
  if (fromDate && toDate) {
    const cursor = new Date(fromDate + "T00:00:00")
    const end = new Date(toDate + "T00:00:00")
    while (cursor <= end) {
      const key = cursor.toISOString().split("T")[0]
      if (!(key in byDate)) byDate[key] = { orders: 0, netRevenue: 0 }
      cursor.setDate(cursor.getDate() + 1)
    }
  }

  return Object.entries(byDate)
    .map(([date, vals]) => ({
      date,
      orders: vals.orders,
      netRevenue: Math.round(vals.netRevenue * 100) / 100,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
