import { notFound } from "next/navigation"
import { fetchClientData } from "@/lib/data/fetch-client-data"
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
  const preset = (searchParams.preset || "last_30d") as DatePreset
  const range = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  // Resolve comparison range
  const compareType = (searchParams.compare || "previous_period") as ComparisonType
  const compRange = getComparisonRange(range, compareType)

  // Fetch performance data + scorecard config in parallel
  const supabase = createServiceClient()

  const [data, configRes] = await Promise.all([
    fetchClientData(
      params.id,
      range.from,
      range.to,
      compRange?.from,
      compRange?.to
    ),
    supabase
      .from("client_scorecard_config")
      .select("funnel_steps")
      .eq("client_id", params.id)
      .single(),
  ])

  if (!data) notFound()

  const funnelSteps = (configRes.data?.funnel_steps as string[]) || null

  return (
    <ClientPerformanceView
      client={data.client}
      rows={data.rows}
      comparisonRows={data.comparisonRows}
      preset={preset}
      from={range.from}
      to={range.to}
      compareType={compareType}
      baselineReach={data.baselineReach}
      funnelSteps={funnelSteps}
    />
  )
}
