import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"
import { fetchAmplitudeEventDaily } from "@/lib/data/fetch-amplitude-data"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/clients/[clientId]/amplitude/event/[eventId]?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Resolves a tracked event row by id, then proxies an Amplitude
 * /events/segmentation query for that event over the given window. Returns
 * the daily counts the dashboard needs for the funnel-step bar/card.
 *
 * The eventId is the row id from `amplitude_events`, not the event_name —
 * keeps funnel-step keys stable when an event is renamed in Amplitude.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { clientId: string; eventId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  if (!UUID_RE.test(params.eventId)) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 })
  }

  const url = new URL(request.url)
  const from = url.searchParams.get("from") || ""
  const to = url.searchParams.get("to") || ""
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD" },
      { status: 400 }
    )
  }

  const db = createServiceClient()
  const { data: row, error } = await db
    .from("amplitude_events")
    .select("event_name, display_title")
    .eq("id", params.eventId)
    .eq("client_id", params.clientId)
    .single()

  if (error || !row) return safeError(error ?? new Error("Event not found"))

  const result = await fetchAmplitudeEventDaily(
    params.clientId,
    row.event_name,
    from,
    to
  )

  return NextResponse.json({
    event_id: params.eventId,
    event_name: row.event_name,
    display_title: row.display_title,
    by_date: result.byDate,
    total: result.total,
    error: result.error,
  })
}
