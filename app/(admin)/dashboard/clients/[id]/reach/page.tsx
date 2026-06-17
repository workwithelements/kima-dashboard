export const dynamic = "force-dynamic"

import { fetchReachData } from "@/lib/data/fetch-client-data"
import { createServiceClient } from "@/lib/supabase/server"
import { getPresetRange, getComparisonRange } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import ReachAnalysisView from "@/components/dashboard/reach-analysis-view"
import { notFound } from "next/navigation"

type Props = {
  params: { id: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
  }
}

export default async function ReachAnalysisPage({ params, searchParams }: Props) {
  const preset = (searchParams.preset || "last_30d") as DatePreset
  const range = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  // Calculate comparison range (previous period)
  const compRange = getComparisonRange(range, "previous_period")

  // Annotations cover ~6 months back from `to` so flags also show in the
  // Weeks/Months granularity windows (which look further back than the range).
  const annFromDate = new Date(range.to + "T00:00:00Z")
  annFromDate.setUTCMonth(annFromDate.getUTCMonth() - 6)
  const annFrom = annFromDate.toISOString().slice(0, 10)
  const supabase = createServiceClient()

  const [data, annotationsRes] = await Promise.all([
    fetchReachData(
      params.id,
      range.from,
      range.to,
      compRange?.from,
      compRange?.to
    ),
    supabase
      .from("annotations")
      .select("id, date, text, created_at")
      .eq("client_id", params.id)
      .gte("date", annFrom)
      .lte("date", range.to)
      .order("date"),
    new Promise((r) => setTimeout(r, 1000)),
  ])
  if (!data) notFound()

  const annotations = (annotationsRes.data || []).map(
    (a: { id: string; date: string; text: string; created_at: string }) => ({
      id: a.id,
      date: a.date,
      text: a.text,
      created_at: a.created_at,
    })
  )

  return (
    <ReachAnalysisView
      clientId={params.id}
      rows={data.rows}
      baselineReach={data.baselineReach}
      preset={preset}
      from={range.from}
      to={range.to}
      currency={data.client.currency_code ?? "GBP"}
      comparisonRows={data.comparisonRows}
      lifetimeRows={data.lifetimeRows}
      annotations={annotations}
    />
  )
}
