export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { fetchClientData, fetchGoogleAdsData, fetchBreakdownsData } from "@/lib/data/fetch-client-data"
import { createServiceClient } from "@/lib/supabase/server"
import { getPresetRange, getComparisonRange } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import type { ComparisonType } from "@/lib/utils/types"
import ClientPerformanceView from "@/components/dashboard/client-performance-view"

type Props = {
  params: { id: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
    compare?: string
  }
}

export default async function ClientDetailPage({ params, searchParams }: Props) {
  // Resolve date range from search params
  const preset = (searchParams.preset || "this_month") as DatePreset
  const range = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  // Resolve comparison range
  const compareType = (searchParams.compare || "previous_period") as ComparisonType
  const compRange = getComparisonRange(range, compareType)

  // Fetch performance data + scorecard config + Google Ads data in parallel
  const supabase = createServiceClient()

  const [data, configRes, gaRows, gaCompRows, breakdownsData, annotationsRes] = await Promise.all([
    fetchClientData(
      params.id,
      range.from,
      range.to,
      compRange?.from,
      compRange?.to
    ),
    supabase
      .from("client_scorecard_config")
      .select("funnel_steps, key_action")
      .eq("client_id", params.id)
      .single(),
    fetchGoogleAdsData(params.id, range.from, range.to),
    compRange
      ? fetchGoogleAdsData(params.id, compRange.from, compRange.to)
      : Promise.resolve([]),
    fetchBreakdownsData(params.id, range.from, range.to),
    supabase
      .from("annotations")
      .select("id, date, text, created_at")
      .eq("client_id", params.id)
      .gte("date", range.from)
      .lte("date", range.to)
      .order("date"),
  ])

  if (!data) notFound()

  const funnelSteps = (configRes.data?.funnel_steps as string[]) || null
  const keyAction = (configRes.data?.key_action as string) || null
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
      preset={preset}
      from={range.from}
      to={range.to}
      compareType={compareType}
      baselineReach={data.baselineReach}
      funnelSteps={funnelSteps}
      keyAction={keyAction}
      demographics={breakdownsData?.demographics ?? []}
      placements={breakdownsData?.placements ?? []}
      annotations={annotations}
    />
  )
}
