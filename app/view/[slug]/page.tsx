export const dynamic = "force-dynamic"

import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import ClientDashboard from "./client-dashboard"
import PasswordGate from "./password-gate"
import {
  fetchClientData,
  fetchCreativeData,
  fetchReachData,
  fetchBreakdownsData,
  fetchGoogleAdsData,
  fetchConsolidatedSpend,
  consolidateDailySpend,
} from "@/lib/data/fetch-client-data"
import { fetchShopifyData } from "@/lib/data/fetch-shopify-data"
import { getPresetRange, getComparisonRange, daysAgo, monthStart, today } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
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
  const [
    perfData,
    creativeData,
    reachData,
    breakdownsData,
    googleAdsRows,
    googleAdsComparisonRows,
    scorecardConfigRes,
    funnelViewsRes,
    annotationsRes,
    currentMonthSpend,
    historicalSpend,
    shopifyData,
    shopifyCompData,
  ] = await Promise.all([
    fetchClientData(client.id, range.from, range.to, compRange?.from, compRange?.to),
    fetchCreativeData(client.id, range.from, range.to),
    fetchReachData(client.id, range.from, range.to, compRange?.from, compRange?.to),
    fetchBreakdownsData(client.id, range.from, range.to),
    hasGoogle ? fetchGoogleAdsData(client.id, range.from, range.to) : Promise.resolve([]),
    hasGoogle && compRange ? fetchGoogleAdsData(client.id, compRange.from, compRange.to) : Promise.resolve([]),
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

  const dailySpend = consolidateDailySpend(currentMonthSpend)
  const historicalDaily = consolidateDailySpend(historicalSpend)

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
      baselineReach={perfData?.baselineReach || 0}
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
      /* Creative tab */
      creativeRows={creativeData?.rows || []}
      thumbnails={creativeData?.thumbnails || {}}
      previewsEnabled={creativeData?.previewsEnabled || false}
      creativeFunnelSteps={creativeData?.funnelSteps || undefined}
      creativeKeyAction={creativeData?.keyAction || undefined}
      creativeDemographics={creativeData?.demographics || []}
      creativePlacements={creativeData?.placements || []}
      creativeNamingConfig={creativeData?.namingConfig}
      creativeCreatedDates={creativeData?.createdDates || {}}
      /* Reach tab */
      reachRows={reachData?.rows || []}
      reachBaselineReach={reachData?.baselineReach || 0}
      reachComparisonRows={reachData?.comparisonRows || []}
      /* Pacing tab */
      pacing={pacing}
      monthlyBudget={client.monthly_budget || null}
      currentMonthDailySpend={dailySpend}
    />
  )
}
