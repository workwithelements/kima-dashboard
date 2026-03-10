export const dynamic = "force-dynamic"

import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import ClientDashboard from "./client-dashboard"
import PasswordGate from "./password-gate"
import { daysAgo, today, monthStart } from "@/lib/utils/dates"
import { calculatePacing } from "@/lib/utils/pacing"
import { fetchConsolidatedSpend, consolidateDailySpend } from "@/lib/data/fetch-client-data"

type Props = {
  params: { slug: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
    tab?: string
  }
}

export default async function ClientViewPage({ params, searchParams }: Props) {
  const { slug } = params
  const supabase = createServiceClient()

  // Look up client by slug
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, view_password_hash, slug, monthly_budget")
    .eq("slug", slug)
    .single()

  if (!client) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-neutral-400">Report not found.</p>
      </div>
    )
  }

  // Check if user has already authenticated via cookie
  const cookieStore = cookies()
  const authCookie = cookieStore.get(`kima_view_${slug}`)
  const isAuthenticated = authCookie?.value === client.view_password_hash

  if (!isAuthenticated) {
    return <PasswordGate slug={slug} clientName={client.name} />
  }

  // Date range — default to last 30 days
  const preset = searchParams.preset || "last_30d"
  let from = searchParams.from || daysAgo(29)
  let to = searchParams.to || today()

  if (preset === "last_7d") {
    from = daysAgo(6)
    to = today()
  } else if (preset === "last_30d") {
    from = daysAgo(29)
    to = today()
  } else if (preset === "this_month") {
    from = monthStart()
    to = today()
  }

  // Fetch performance data (include adset fields for ad set selector)
  const { data: metaRows } = await supabase
    .from("meta_daily_performance")
    .select(
      "date, adset_id, adset_name, spend, impressions, reach, unique_link_clicks, landing_page_views, adds_to_cart, registrations_completed, checkouts_initiated, purchases, purchase_value, app_installs"
    )
    .eq("client_id", client.id)
    .gte("date", from)
    .lte("date", to)
    .order("date")

  // Fetch pacing data — current month spend + 90-day historical (Meta + Google Ads)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [currentMonthSpend, historicalSpend] = await Promise.all([
    fetchConsolidatedSpend(client.id, monthStart(), today()),
    fetchConsolidatedSpend(client.id, daysAgo(90), today()),
  ])

  const dailySpend = consolidateDailySpend(currentMonthSpend)
  const historicalDaily = consolidateDailySpend(historicalSpend)

  const pacing = calculatePacing(
    dailySpend,
    client.monthly_budget || null,
    year,
    month,
    historicalDaily
  )

  // Fetch funnel config + reach data in parallel
  const [scorecardConfigRes, reachRes] = await Promise.all([
    supabase
      .from("client_scorecard_config")
      .select("funnel_steps")
      .eq("client_id", client.id)
      .single(),
    supabase
      .from("meta_daily_performance")
      .select("date, reach, impressions")
      .eq("client_id", client.id)
      .gte("date", from)
      .lte("date", to)
      .order("date"),
  ])

  const funnelSteps = (scorecardConfigRes.data?.funnel_steps as string[]) || null
  const reachRows = reachRes.data || []

  // Baseline reach (30 days before range start)
  const dayBefore = new Date(from + "T00:00:00")
  dayBefore.setDate(dayBefore.getDate() - 1)
  const baselineEnd = dayBefore.toISOString().split("T")[0]
  const baselineStartDate = new Date(from + "T00:00:00")
  baselineStartDate.setDate(baselineStartDate.getDate() - 30)
  const baselineStartStr = baselineStartDate.toISOString().split("T")[0]

  const { data: baselineRows } = await supabase
    .from("meta_daily_performance")
    .select("reach, impressions")
    .eq("client_id", client.id)
    .gte("date", baselineStartStr)
    .lte("date", baselineEnd)

  let baselineReach = 0
  if (baselineRows?.length) {
    for (const row of baselineRows) {
      const reach = row.reach || 0
      const impressions = row.impressions || 0
      const freq = reach > 0 ? impressions / reach : 1
      const overlapFactor = Math.min(1, 1 / Math.max(1, freq))
      baselineReach += Math.round(reach * overlapFactor)
    }
  }

  return (
    <ClientDashboard
      clientName={client.name}
      data={metaRows || []}
      pacing={pacing}
      monthlyBudget={client.monthly_budget || null}
      currentMonthDailySpend={dailySpend}
      reachRows={reachRows}
      baselineReach={baselineReach}
      funnelSteps={funnelSteps}
      preset={preset}
      from={from}
      to={to}
      tab={searchParams.tab || "performance"}
    />
  )
}
