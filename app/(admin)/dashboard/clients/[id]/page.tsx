export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { fetchClientData, fetchGoogleAdsData, fetchGoogleAdsQualityData, fetchBreakdownsData, fetchCreativeData } from "@/lib/data/fetch-client-data"
import { fetchShopifyData } from "@/lib/data/fetch-shopify-data"
import { createServiceClient } from "@/lib/supabase/server"
import { getPresetRange, getComparisonRange } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import type { ComparisonType } from "@/lib/utils/types"
import ClientPerformanceView from "@/components/dashboard/client-performance-view"
import { synthesiseDefaultView, type FunnelView } from "@/lib/utils/funnel-views"

type Props = {
  params: { id: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
    compare?: string
    view?: string
  }
}

export default async function ClientDetailPage({ params, searchParams }: Props) {
  // Resolve display date range from search params
  const preset = (searchParams.preset || "this_month") as DatePreset
  const displayRange = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  // Resolve comparison range
  const compareType = (searchParams.compare || "previous_period") as ComparisonType
  const compRange = getComparisonRange(displayRange, compareType)

  // Widen the fetch window to the last 30 days (from today) whenever the
  // display range fits inside that window. This way switching between short
  // date presets becomes instant client-side - no server round trip.
  const todayStr = new Date().toISOString().split("T")[0]
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0]

  // Previous 30 days (for comparison windows within 30 days)
  const sixtyDaysAgo = new Date()
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
  const sixtyDaysAgoStr = sixtyDaysAgo.toISOString().split("T")[0]

  const displayInWindow =
    displayRange.from >= thirtyDaysAgoStr && displayRange.to <= todayStr

  const compInWindow =
    compRange && compRange.from >= sixtyDaysAgoStr && compRange.to <= thirtyDaysAgoStr

  // If both the display range and the comparison range fit in the wide
  // window, fetch the wide data (cached & shared). Otherwise fetch the
  // exact range the user asked for.
  const fetchFrom = displayInWindow ? thirtyDaysAgoStr : displayRange.from
  const fetchTo = displayInWindow ? todayStr : displayRange.to
  const fetchCompFrom = compInWindow ? sixtyDaysAgoStr : compRange?.from
  const fetchCompTo = compInWindow ? thirtyDaysAgoStr : compRange?.to

  const range = { from: fetchFrom, to: fetchTo }

  // Fetch performance data + scorecard config + Google Ads data in parallel
  const supabase = createServiceClient()

  const minDelay = new Promise((r) => setTimeout(r, 1000))
  const [data, configRes, funnelViewsRes, gaRows, gaCompRows, gaQuality, breakdownsData, annotationsRes, shopifyData, shopifyCompData, creativeData] = await Promise.all([
    fetchClientData(
      params.id,
      range.from,
      range.to,
      fetchCompFrom,
      fetchCompTo
    ),
    supabase
      .from("client_scorecard_config")
      .select("funnel_steps, key_action, contribution_margin_pct")
      .eq("client_id", params.id)
      .single(),
    supabase
      .from("client_funnel_views")
      .select("id, name, sort_order, funnel_steps, key_action, linked_campaign_ids, is_default")
      .eq("client_id", params.id)
      .order("sort_order", { ascending: true }),
    fetchGoogleAdsData(params.id, range.from, range.to),
    fetchCompFrom && fetchCompTo
      ? fetchGoogleAdsData(params.id, fetchCompFrom, fetchCompTo)
      : Promise.resolve([]),
    fetchGoogleAdsQualityData(params.id, range.to),
    fetchBreakdownsData(params.id, range.from, range.to),
    supabase
      .from("annotations")
      .select("id, date, text, created_at")
      .eq("client_id", params.id)
      .gte("date", range.from)
      .lte("date", range.to)
      .order("date"),
    fetchShopifyData(params.id, range.from, range.to),
    fetchCompFrom && fetchCompTo
      ? fetchShopifyData(params.id, fetchCompFrom, fetchCompTo)
      : Promise.resolve({ orders: [], attribution: [] }),
    fetchCreativeData(params.id, range.from, range.to),
    minDelay,
  ])

  if (!data) notFound()

  const funnelSteps = (configRes.data?.funnel_steps as string[]) || null
  const keyAction = (configRes.data?.key_action as string) || null
  const contributionMarginPct = configRes.data?.contribution_margin_pct != null
    ? Number(configRes.data.contribution_margin_pct)
    : null
  const persistedViews = (funnelViewsRes.data || []) as FunnelView[]
  const funnelViews: FunnelView[] =
    persistedViews.length > 0
      ? persistedViews
      : [synthesiseDefaultView(funnelSteps, keyAction)]
  const annotations = (annotationsRes.data || []).map((a: { id: string; date: string; text: string; created_at: string }) => ({
    id: a.id,
    date: a.date,
    text: a.text,
    created_at: a.created_at,
  }))

  return (
    <ClientPerformanceView
      client={data.client}
      rows={data.rows}
      comparisonRows={data.comparisonRows}
      googleAdsRows={gaRows}
      googleAdsComparisonRows={gaCompRows}
      googleAdsQuality={gaQuality}
      preset={preset}
      from={displayRange.from}
      to={displayRange.to}
      fetchedFrom={range.from}
      fetchedTo={range.to}
      compareType={compareType}
      baselineReach={data.baselineReach}
      lifetimeSpend={data.lifetimeSpend}
      lifetimeReach={data.lifetimeReach}
      funnelSteps={funnelSteps}
      keyAction={keyAction}
      funnelViews={funnelViews}
      activeFunnelViewId={searchParams.view || null}
      contributionMarginPct={contributionMarginPct}
      demographics={breakdownsData?.demographics ?? []}
      placements={breakdownsData?.placements ?? []}
      annotations={annotations}
      namingConfig={data.namingConfig}
      createdDates={data.createdDates}
      shopifyOrders={shopifyData.orders}
      shopifyAttribution={shopifyData.attribution}
      shopifyCompOrders={shopifyCompData.orders}
      shopifyCompAttribution={shopifyCompData.attribution}
      thumbnails={creativeData?.thumbnails || {}}
      previewsEnabled={creativeData?.previewsEnabled || false}
    />
  )
}
