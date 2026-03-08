import { fetchReachData } from "@/lib/data/fetch-client-data"
import { getPresetRange } from "@/lib/utils/dates"
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

  const data = await fetchReachData(params.id, range.from, range.to)
  if (!data) notFound()

  return (
    <ReachAnalysisView
      rows={data.rows}
      baselineReach={data.baselineReach}
      preset={preset}
      from={range.from}
      to={range.to}
    />
  )
}
