import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

type AmplitudeEventRow = {
  id: string
  event_name: string
  display_title: string | null
  position: number
}

/**
 * GET /api/clients/[clientId]/amplitude — get Amplitude settings + tracked events
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data: client, error } = await db
    .from("clients")
    .select("id, amplitude_org, amplitude_api_key, amplitude_secret_key")
    .eq("id", params.clientId)
    .single()

  if (error) return safeError(error)

  const { data: events } = await db
    .from("amplitude_events")
    .select("id, event_name, display_title, position")
    .eq("client_id", params.clientId)
    .order("position", { ascending: true })

  const enabled = !!(client.amplitude_api_key && client.amplitude_secret_key)

  return NextResponse.json({
    enabled,
    org: client.amplitude_org || "",
    has_credentials: enabled,
    api_key_preview: client.amplitude_api_key
      ? `${client.amplitude_api_key.slice(0, 6)}…`
      : "",
    events: (events ?? []) as AmplitudeEventRow[],
  })
}

/**
 * PUT /api/clients/[clientId]/amplitude — update settings + tracked event list
 *
 * Body: {
 *   enabled: boolean,
 *   org?: string,
 *   api_key?: string,         // only update when provided (omit to keep existing)
 *   secret_key?: string,      // only update when provided (omit to keep existing)
 *   events?: Array<{ event_name: string; display_title?: string }>,
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { enabled, org, api_key, secret_key, events } = body as {
    enabled: boolean
    org?: string
    api_key?: string
    secret_key?: string
    events?: Array<{ event_name: string; display_title?: string }>
  }

  const db = createServiceClient()

  const update: Record<string, string | null> = {}
  if (!enabled) {
    update.amplitude_org = null
    update.amplitude_api_key = null
    update.amplitude_secret_key = null
  } else {
    if (typeof org === "string") update.amplitude_org = org.trim() || null
    if (typeof api_key === "string" && api_key.trim()) {
      update.amplitude_api_key = api_key.trim()
    }
    if (typeof secret_key === "string" && secret_key.trim()) {
      update.amplitude_secret_key = secret_key.trim()
    }
  }

  if (Object.keys(update).length > 0) {
    const { error: updateError } = await db
      .from("clients")
      .update(update)
      .eq("id", params.clientId)
    if (updateError) return safeError(updateError)
  }

  // Replace event list when provided. Existing rows are deleted first so the
  // UI is the source of truth — same pattern as the previous saved-charts list.
  if (Array.isArray(events)) {
    await db.from("amplitude_events").delete().eq("client_id", params.clientId)
    const cleaned = events
      .map((e, i) => ({
        client_id: params.clientId,
        event_name: (e.event_name || "").trim(),
        display_title: e.display_title?.trim() || null,
        position: i,
      }))
      .filter((e) => e.event_name.length > 0)
    if (cleaned.length > 0) {
      const { error: insertError } = await db
        .from("amplitude_events")
        .insert(cleaned)
      if (insertError) return safeError(insertError)
    }
  }

  const { data: client } = await db
    .from("clients")
    .select("id, amplitude_org, amplitude_api_key, amplitude_secret_key")
    .eq("id", params.clientId)
    .single()

  const { data: eventRows } = await db
    .from("amplitude_events")
    .select("id, event_name, display_title, position")
    .eq("client_id", params.clientId)
    .order("position", { ascending: true })

  return NextResponse.json({
    enabled: !!(client?.amplitude_api_key && client?.amplitude_secret_key),
    org: client?.amplitude_org || "",
    has_credentials: !!(client?.amplitude_api_key && client?.amplitude_secret_key),
    api_key_preview: client?.amplitude_api_key
      ? `${client.amplitude_api_key.slice(0, 6)}…`
      : "",
    events: (eventRows ?? []) as AmplitudeEventRow[],
  })
}
