export const dynamic = "force-dynamic"

import { fetchBreakdownsData } from "@/lib/data/fetch-client-data"
import { getPresetRange } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import BreakdownsView from "@/components/dashboard/breakdowns-view"
import { notFound } from "next/navigation"

type Props = {
  params: { id: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
  }
}

export default async function BreakdownsPage({ params, searchParams }: Props) {
  const preset = (searchParams.preset || "last_30d") as DatePreset
  const range = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  const data = await fetchBreakdownsData(params.id, range.from, range.to)
  if (!data) notFound()

  return (
    <BreakdownsView
      clientId={params.id}
      demographics={data.demographics}
      placements={data.placements}
      preset={preset}
      from={range.from}
      to={range.to}
      currency={data.client.currency_code ?? "GBP"}
    />
  )
}
