import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

type AmplitudeChartRow = {
  id: string
  chart_id: string
  title: string | null
  position: number
}

/**
 * GET /api/clients/[clientId]/amplitude — get Amplitude settings + saved charts
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

  const { data: charts } = await db
    .from("amplitude_charts")
    .select("id, chart_id, title, position")
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
    charts: (charts ?? []) as AmplitudeChartRow[],
  })
}

/**
 * PUT /api/clients/[clientId]/amplitude — update Amplitude settings + chart list
 *
 * Body: {
 *   enabled: boolean,
 *   org?: string,
 *   api_key?: string,         // only update when provided (omit to keep existing)
 *   secret_key?: string,      // only update when provided (omit to keep existing)
 *   charts?: Array<{ chart_id: string; title?: string }>,
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { enabled, org, api_key, secret_key, charts } = body as {
    enabled: boolean
    org?: string
    api_key?: string
    secret_key?: string
    charts?: Array<{ chart_id: string; title?: string }>
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

  if (Array.isArray(charts)) {
    await db.from("amplitude_charts").delete().eq("client_id", params.clientId)
    const cleaned = charts
      .map((c, i) => ({
        client_id: params.clientId,
        chart_id: (c.chart_id || "").trim(),
        title: c.title?.trim() || null,
        position: i,
      }))
      .filter((c) => c.chart_id.length > 0)
    if (cleaned.length > 0) {
      const { error: insertError } = await db
        .from("amplitude_charts")
        .insert(cleaned)
      if (insertError) return safeError(insertError)
    }
  }

  const { data: client } = await db
    .from("clients")
    .select("id, amplitude_org, amplitude_api_key, amplitude_secret_key")
    .eq("id", params.clientId)
    .single()

  const { data: chartRows } = await db
    .from("amplitude_charts")
    .select("id, chart_id, title, position")
    .eq("client_id", params.clientId)
    .order("position", { ascending: true })

  return NextResponse.json({
    enabled: !!(client?.amplitude_api_key && client?.amplitude_secret_key),
    org: client?.amplitude_org || "",
    has_credentials: !!(client?.amplitude_api_key && client?.amplitude_secret_key),
    api_key_preview: client?.amplitude_api_key
      ? `${client.amplitude_api_key.slice(0, 6)}…`
      : "",
    charts: (chartRows ?? []) as AmplitudeChartRow[],
  })
}
