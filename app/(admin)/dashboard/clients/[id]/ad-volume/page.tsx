export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { fetchAdVolumeData } from "@/lib/data/fetch-client-data"
import AdVolumeCalculatorView from "@/components/dashboard/ad-volume-calculator-view"

type Props = {
  params: { id: string }
}

export default async function AdVolumePage({ params }: Props) {
  const [data] = await Promise.all([
    fetchAdVolumeData(params.id),
    new Promise((r) => setTimeout(r, 1000)),
  ])
  if (!data) notFound()

  return (
    <AdVolumeCalculatorView
      clientName={data.clientName}
      currency={data.currency}
      monthlySpend={data.monthlySpend}
      dailyRunRate={data.dailyRunRate}
      runRateDays={data.runRateDays}
      cpa={data.cpa}
      keyAction={data.keyAction}
      newCreativePerMonth={data.newCreativePerMonth}
      activeAdsNow={data.activeAdsNow}
    />
  )
}
