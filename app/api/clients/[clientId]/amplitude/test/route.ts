import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"
import {
  fetchAmplitudeSegmentation,
  collapseSegmentation,
  type AmplitudeCredentials,
} from "@/lib/data/fetch-amplitude-data"

/**
 * POST /api/clients/[clientId]/amplitude/test
 *
 * Calls /events/segmentation with the client's stored credentials (or
 * credentials supplied in the request body) over the last 30 days for a
 * single tracked event. Reports HTTP status, total count, and last few daily
 * values so the user can see whether the event name actually returns data.
 *
 * Body: { api_key?: string, secret_key?: string, event_name?: string }
 *   - When api_key/secret_key are present, they override the stored values
 *     (lets the user verify before saving).
 *   - event_name defaults to the first tracked event on the client.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = (await request.json().catch(() => ({}))) as {
    api_key?: string
    secret_key?: string
    event_name?: string
  }

  const db = createServiceClient()

  // Resolve credentials — body overrides DB.
  let creds: AmplitudeCredentials | undefined
  if (body.api_key?.trim() && body.secret_key?.trim()) {
    creds = { apiKey: body.api_key.trim(), secretKey: body.secret_key.trim() }
  } else {
    const { data, error } = await db
      .from("clients")
      .select("amplitude_api_key, amplitude_secret_key")
      .eq("id", params.clientId)
      .single()
    if (error) return safeError(error)
    if (data?.amplitude_api_key && data?.amplitude_secret_key) {
      creds = {
        apiKey: data.amplitude_api_key,
        secretKey: data.amplitude_secret_key,
      }
    }
  }

  if (!creds) {
    return NextResponse.json({
      ok: false,
      reason:
        "No credentials configured. Save your Amplitude API key + secret first, or pass them in the request body.",
    })
  }

  // Resolve event name — body overrides; otherwise pick the first tracked event.
  let eventName = body.event_name?.trim()
  if (!eventName) {
    const { data: rows } = await db
      .from("amplitude_events")
      .select("event_name")
      .eq("client_id", params.clientId)
      .order("position", { ascending: true })
      .limit(1)
    eventName = rows?.[0]?.event_name
  }
  if (!eventName) {
    return NextResponse.json({
      ok: false,
      reason: "No tracked events to test against. Add an event name first.",
    })
  }

  // Last 30 days window.
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(today.getUTCDate() - 30)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const from = iso(start)
  const to = iso(today)

  const result = await fetchAmplitudeSegmentation(
    params.clientId,
    eventName,
    from,
    to,
    creds
  )
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      event_name: eventName,
      window: { from, to },
      status: result.error.status,
      code: result.error.code,
      reason: result.error.message,
    })
  }

  const collapsed = collapseSegmentation(eventName, result.data)
  const lastDates = Object.keys(collapsed.byDate).sort().slice(-5)
  const samplePoints = lastDates.map((d) => ({ date: d, value: collapsed.byDate[d] }))

  return NextResponse.json({
    ok: true,
    event_name: eventName,
    window: { from, to },
    total: collapsed.total,
    days_with_data: Object.values(collapsed.byDate).filter((v) => v > 0).length,
    sample_points: samplePoints,
    warning: collapsed.error?.code,
  })
}
