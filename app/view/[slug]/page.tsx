export const dynamic = "force-dynamic"

import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import ClientDashboard from "./client-dashboard"
import PasswordGate from "./password-gate"
import {
  fetchClientData,
  fetchCreativeData,
  fetchReachData,
  fetchReachEfficiencyData,
  fetchCpmrFeedback,
  fetchBreakdownsData,
  fetchGoogleAdsData,
  fetchGoogleAdsQualityData,
  fetchConsolidatedSpend,
  consolidateDailySpend,
  fetchAllAdditionalSpend,
  expandAdditionalSpendDaily,
  mergeDailySpend,
} from "@/lib/data/fetch-client-data"
import { EMPTY_QUALITY_DATA } from "@/lib/utils/quality-score"
import { fetchShopifyData } from "@/lib/data/fetch-shopify-data"
import { getPresetRange, getComparisonRange, daysAgo, monthStart, today } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import type { WindowKey } from "@/lib/utils/reach-efficiency"
import type { ComparisonType } from "@/lib/utils/types"
import { calculatePacing } from "@/lib/utils/pacing"
import { synthesiseDefaultView, type FunnelView } from "@/lib/utils/funnel-views"

type Props = {
  params: { slug: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
    tab?: string
    compare?: string
    view?: string
    /** CPMr report window: 7d | 14d | 30d | 90d | custom */
    rw?: string
    rfrom?: string
    rto?: string
  }
}

export default async function ClientViewPage({ params, searchParams }: Props) {
  const { slug } = params
  const supabase = createServiceClient()

  // Look up client by slug
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, slug, meta_account_id, currency_code, monthly_budget, active, google_ads_customer_id, shopify_store_domain")
    .eq("slug", slug)
    .single()

  if (!client) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-neutral-400">Report not found.</p>
      </div>
    )
  }

  // Check if user has already authenticated via opaque session token
  const cookieStore = cookies()
  const authCookie = cookieStore.get(`kima_view_${slug}`)
  let isAuthenticated = false
  if (authCookie?.value) {
    const { data: session } = await supabase
      .from("view_sessions")
      .select("expires_at")
      .eq("token", authCookie.value)
      .eq("slug", slug)
      .single()
    isAuthenticated = !!session && new Date(session.expires_at) > new Date()
  }

  if (!isAuthenticated) {
    return <PasswordGate slug={slug} clientName={client.name} />
  }

  // Date range
  const preset = (searchParams.preset || "this_month") as DatePreset
  const range = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  // Comparison
  const compareType = (searchParams.compare || "previous_period") as ComparisonType
  const compRange = getComparisonRange(range, compareType)

  // Pacing data
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  // Fetch all data in parallel for all tabs
  const hasGoogle = !!client.google_ads_customer_id
  // CPMr report window params (independent of the page date range)
  const reportWindow = (searchParams.rw || "30d") as WindowKey
  const reportCustom =
    reportWindow === "custom" && searchParams.rfrom && searchParams.rto
      ? { from: searchParams.rfrom, to: searchParams.rto }
      : undefined

  const [
    perfData,
    creativeData,
    reachData,
    reachEfficiency,
    cpmrFeedback,
    breakdownsData,
    googleAdsRows,
    googleAdsComparisonRows,
    googleAdsQuality,
    scorecardConfigRes,
    funnelViewsRes,
    annotationsRes,
    currentMonthSpend,
    historicalSpend,
    shopifyData,
    shopifyCompData,
    additionalEntries,
  ] = await Promise.all([
    fetchClientData(client.id, range.from, range.to, compRange?.from, compRange?.to),
    fetchCreativeData(client.id, range.from, range.to),
    fetchReachData(client.id, range.from, range.to, compRange?.from, compRange?.to),
    fetchReachEfficiencyData(client.id, range.to, reportCustom?.from, reportCustom?.to),
    fetchCpmrFeedback(client.id),
    fetchBreakdownsData(client.id, range.from, range.to),
    hasGoogle ? fetchGoogleAdsData(client.id, range.from, range.to) : Promise.resolve([]),
    hasGoogle && compRange ? fetchGoogleAdsData(client.id, compRange.from, compRange.to) : Promise.resolve([]),
    hasGoogle ? fetchGoogleAdsQualityData(client.id, range.to) : Promise.resolve(EMPTY_QUALITY_DATA),
    supabase
      .from("client_scorecard_config")
      .select("funnel_steps, key_action, contribution_margin_pct")
      .eq("client_id", client.id)
      .single(),
    supabase
      .from("client_funnel_views")
      .select("id, name, sort_order, funnel_steps, key_action, linked_campaign_ids, is_default")
      .eq("client_id", client.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("annotations")
      .select("id, date, text, created_at")
      .eq("client_id", client.id)
      .gte("date", range.from)
      .lte("date", range.to)
      .order("date"),
    fetchConsolidatedSpend(client.id, monthStart(), today()),
    fetchConsolidatedSpend(client.id, daysAgo(90), today()),
    fetchShopifyData(client.id, range.from, range.to),
    compRange
      ? fetchShopifyData(client.id, compRange.from, compRange.to)
      : Promise.resolve({ orders: [], attribution: [] }),
    fetchAllAdditionalSpend(client.id),
  ])

  const funnelSteps = (scorecardConfigRes.data?.funnel_steps as string[]) || null
  const keyAction = (scorecardConfigRes.data?.key_action as string) || null
  const contributionMarginPct = scorecardConfigRes.data?.contribution_margin_pct != null
    ? Number(scorecardConfigRes.data.contribution_margin_pct)
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

  const additionalCurrentDaily = expandAdditionalSpendDaily(additionalEntries, monthStart(), today())
  const additionalHistoricalDaily = expandAdditionalSpendDaily(additionalEntries, daysAgo(90), today())
  const dailySpend = mergeDailySpend(consolidateDailySpend(currentMonthSpend), additionalCurrentDaily)
  const historicalDaily = mergeDailySpend(consolidateDailySpend(historicalSpend), additionalHistoricalDaily)

  const pacing = calculatePacing(
    dailySpend,
    client.monthly_budget || null,
    year,
    month,
    historicalDaily
  )

  return (
    <ClientDashboard
      client={client}
      tab={searchParams.tab || "performance"}
      preset={preset}
      from={range.from}
      to={range.to}
      compareType={compareType}
      /* Performance tab */
      perfRows={perfData?.rows || []}
      perfComparisonRows={perfData?.comparisonRows || []}
      googleAdsRows={googleAdsRows}
      googleAdsComparisonRows={googleAdsComparisonRows}
      googleAdsQuality={googleAdsQuality}
      baselineReach={perfData?.baselineReach || 0}
      lifetimeSpend={perfData?.lifetimeSpend || 0}
      lifetimeReach={perfData?.lifetimeReach || 0}
      funnelSteps={funnelSteps}
      keyAction={keyAction}
      funnelViews={funnelViews}
      activeFunnelViewId={searchParams.view || null}
      contributionMarginPct={contributionMarginPct}
      demographics={breakdownsData?.demographics ?? []}
      placements={breakdownsData?.placements ?? []}
      annotations={annotations}
      namingConfig={perfData?.namingConfig}
      createdDates={perfData?.createdDates || {}}
      shopifyOrders={shopifyData.orders}
      shopifyAttribution={shopifyData.attribution}
      shopifyCompOrders={shopifyCompData.orders}
      shopifyCompAttribution={shopifyCompData.attribution}
      /* Creative — thumbnails feed the Performance grid */
      thumbnails={creativeData?.thumbnails || {}}
      previewsEnabled={creativeData?.previewsEnabled || false}
      /* Reach tab */
      reachRows={reachData?.rows || []}
      reachBaselineReach={reachData?.baselineReach || 0}
      reachComparisonRows={reachData?.comparisonRows || []}
      reachLifetimeRows={reachData?.lifetimeRows || []}
      reachEfficiency={{
        windows: reachEfficiency.windows,
        thumbnails: reachEfficiency.thumbnails,
        keyAction: reachEfficiency.keyAction,
        initialWindow: reportWindow,
        customFrom: reportCustom?.from,
        customTo: reportCustom?.to,
        feedback: cpmrFeedback.feedback,
        typeRates: cpmrFeedback.typeRates,
      }}
      /* Pacing tab */
      pacing={pacing}
      monthlyBudget={client.monthly_budget || null}
      currentMonthDailySpend={dailySpend}
      additionalSpendEntries={additionalEntries}
    />
  )
}
