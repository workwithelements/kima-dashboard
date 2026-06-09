export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import { fetchWeeklyPerformanceData } from "@/lib/data/fetch-weekly-performance-data"
import WeeklyPerformanceView from "@/components/dashboard/weekly-performance-view"

type Props = {
  params: { id: string }
}

export default async function WeeklyPerformancePage({ params }: Props) {
  const supabase = createServiceClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", params.id)
    .single()

  if (!client) notFound()

  // The attribution model behind this view is Ezra-only.
  if (client.name !== "Ezra") notFound()

  const rows = await fetchWeeklyPerformanceData(params.id)

  return <WeeklyPerformanceView clientName={client.name} rows={rows} />
}
