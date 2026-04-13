export const dynamic = "force-dynamic"

import { createServiceClient } from "@/lib/supabase/server"
import MetaImpactView from "@/components/dashboard/meta-impact-view"
import type { DailyMetaSpend } from "@/lib/utils/meta-impact"

type Props = {
  params: { id: string }
}

/** Fetch daily Meta spend (and pixel purchases) for a client over the last 365 days. */
async function fetchDailyMetaSpend(clientId: string): Promise<DailyMetaSpend[]> {
  const supabase = createServiceClient()
  const yearAgo = new Date()
  yearAgo.setDate(yearAgo.getDate() - 365)
  const fromDate = yearAgo.toISOString().split("T")[0]

  // Aggregate spend + purchases per day across all campaigns/adsets
  const all: DailyMetaSpend[] = []
  let offset = 0
  const PAGE = 1000
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("meta_daily_performance")
      .select("date, spend, purchases")
      .eq("client_id", clientId)
      .gte("date", fromDate)
      .order("date")
      .range(offset, offset + PAGE - 1)
    if (error || !data) break
    for (const row of data) {
      all.push({
        date: row.date as string,
        spend: (row.spend as number) || 0,
        purchases: (row.purchases as number) || 0,
      })
    }
    if (data.length < PAGE) break
    offset += PAGE
  }

  // Aggregate by date (multiple ad rows per day need summing)
  const byDate = new Map<string, { spend: number; purchases: number }>()
  for (const r of all) {
    const cur = byDate.get(r.date) || { spend: 0, purchases: 0 }
    cur.spend += r.spend
    cur.purchases += r.purchases
    byDate.set(r.date, cur)
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, spend: v.spend, purchases: v.purchases }))
}

export default async function MetaImpactPage({ params }: Props) {
  const dailyMetaSpend = await fetchDailyMetaSpend(params.id)

  return <MetaImpactView clientId={params.id} dailyMetaSpend={dailyMetaSpend} />
}
