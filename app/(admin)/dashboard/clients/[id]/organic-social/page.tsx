export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import { fetchOrganicSocialData } from "@/lib/data/fetch-organic-social-data"
import OrganicSocialView from "@/components/dashboard/organic-social-view"

type Props = {
  params: { id: string }
  searchParams: { from?: string; to?: string }
}

/** Monday of the ISO week containing date `d` (UTC), YYYY-MM-DD. */
function isoWeekMonday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay() || 7
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1))
  return x.toISOString().slice(0, 10)
}

export default async function OrganicSocialPage({ params, searchParams }: Props) {
  const supabase = createServiceClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, currency_code")
    .eq("id", params.id)
    .single()

  if (!client) notFound()

  // Default: last 12 ISO weeks ending on this week's Monday.
  const now = new Date()
  const thisMonday = isoWeekMonday(now)
  const twelveWeeksAgo = new Date(thisMonday + "T00:00:00Z")
  twelveWeeksAgo.setUTCDate(twelveWeeksAgo.getUTCDate() - 11 * 7)

  const from = searchParams.from || twelveWeeksAgo.toISOString().slice(0, 10)
  const to = searchParams.to || thisMonday

  const data = await fetchOrganicSocialData(params.id, from, to)

  return (
    <OrganicSocialView
      clientId={params.id}
      clientName={client.name}
      currency={client.currency_code ?? "USD"}
      range={{ from, to }}
      data={data}
    />
  )
}
