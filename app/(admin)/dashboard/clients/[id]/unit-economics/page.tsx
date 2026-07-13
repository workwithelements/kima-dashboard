export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { fetchUnitEconomicsData } from "@/lib/data/fetch-client-data"
import { createClient } from "@/lib/supabase/server"
import { isAdminEmail } from "@/lib/auth/admin"
import { getPresetRange } from "@/lib/utils/dates"
import type { DatePreset } from "@/lib/utils/dates"
import UnitEconomicsView from "@/components/dashboard/unit-economics-view"

/** The Unit Economics view is built around this client's subscription model. */
const ENABLED_CLIENT_NAME = "Alexia"

type Props = {
  params: { id: string }
  searchParams: {
    preset?: string
    from?: string
    to?: string
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function UnitEconomicsPage({ params, searchParams }: Props) {
  const preset = (searchParams.preset || "this_month") as DatePreset
  // Malformed from/to (stale bookmark, hand-edited URL) would make the DB
  // query error and render as a silently empty view — fall back to the preset.
  const customValid =
    searchParams.from &&
    searchParams.to &&
    DATE_RE.test(searchParams.from) &&
    DATE_RE.test(searchParams.to) &&
    searchParams.from <= searchParams.to
  const range = customValid
    ? { from: searchParams.from!, to: searchParams.to! }
    : getPresetRange(preset)

  const supabase = createClient()
  const [data, userRes] = await Promise.all([
    fetchUnitEconomicsData(params.id, range.from, range.to),
    supabase.auth.getUser(),
    new Promise((r) => setTimeout(r, 1000)),
  ])

  // Tab hiding isn't access control — 404 for every other client.
  if (!data || data.clientName !== ENABLED_CLIENT_NAME) notFound()

  return (
    <UnitEconomicsView
      clientId={data.clientId}
      currency={data.currency}
      adGroups={data.adGroups}
      initialAssumptions={data.assumptions}
      initialUpdatedAt={data.assumptionsUpdatedAt}
      initialUpdatedBy={data.assumptionsUpdatedBy}
      applicationsColumnPresent={data.applicationsColumnPresent}
      isAdmin={isAdminEmail(userRes.data.user?.email)}
      preset={preset}
      from={range.from}
      to={range.to}
    />
  )
}
