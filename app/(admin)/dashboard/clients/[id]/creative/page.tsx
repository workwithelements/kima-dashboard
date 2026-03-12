export const dynamic = "force-dynamic"

import { fetchCreativeData } from "@/lib/data/fetch-client-data"
import { getPresetRange } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import CreativeAnalysisView from "@/components/dashboard/creative-analysis-view"
import { notFound } from "next/navigation"

type Props = {
  params: { id: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
  }
}

export default async function CreativeAnalysisPage({ params, searchParams }: Props) {
  const preset = (searchParams.preset || "last_30d") as DatePreset
  const range = searchParams.from && searchParams.to
    ? { from: searchParams.from, to: searchParams.to }
    : getPresetRange(preset)

  const data = await fetchCreativeData(params.id, range.from, range.to)
  if (!data) notFound()

  return (
    <CreativeAnalysisView
      rows={data.rows}
      preset={preset}
      from={range.from}
      to={range.to}
      clientId={params.id}
      thumbnails={data.thumbnails}
      previewsEnabled={data.previewsEnabled}
      currency={data.client.currency_code ?? "GBP"}
      metaAccountId={data.client.meta_account_id ?? undefined}
      keyAction={data.keyAction}
      funnelSteps={data.funnelSteps}
      demographics={data.demographics}
      placements={data.placements}
    />
  )
}
