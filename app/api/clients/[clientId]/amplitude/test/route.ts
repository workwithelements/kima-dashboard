import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"
import {
  fetchAmplitudeChart,
  type AmplitudeCredentials,
} from "@/lib/data/fetch-amplitude-data"

/**
 * POST /api/clients/[clientId]/amplitude/test
 *
 * Hits Amplitude's Dashboard REST API with the client's stored credentials
 * (or credentials supplied in the request body for pre-save validation) and
 * reports the actual HTTP status + body so misconfigured keys/region/charts
 * can be diagnosed without grepping server logs.
 *
 * Body: { api_key?: string, secret_key?: string, chart_id?: string }
 *   - When api_key/secret_key are present, they override the stored values
 *     (lets the user verify before saving).
 *   - chart_id defaults to the first saved chart on the client.
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
    chart_id?: string
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
      reason: "No credentials configured. Save your Amplitude API key + secret first, or pass them in the request body.",
    })
  }

  // Resolve chart ID — body overrides; otherwise pick the first saved chart.
  let chartId = body.chart_id?.trim()
  if (!chartId) {
    const { data: charts } = await db
      .from("amplitude_charts")
      .select("chart_id")
      .eq("client_id", params.clientId)
      .order("position", { ascending: true })
      .limit(1)
    chartId = charts?.[0]?.chart_id
  }
  if (!chartId) {
    return NextResponse.json({
      ok: false,
      reason: "No saved charts to test against. Add a chart ID first.",
    })
  }

  const result = await fetchAmplitudeChart(params.clientId, chartId, creds)
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      chart_id: chartId,
      status: result.error.status,
      code: result.error.code,
      reason: result.error.message,
    })
  }

  // Report the shape of the successful response so the user can see whether
  // the chart returned actual data or just an empty payload.
  const data = result.data?.data ?? {}
  const xValues = (data as { xValues?: unknown[] }).xValues ?? []
  const series = (data as { series?: unknown[] }).series ?? []
  return NextResponse.json({
    ok: true,
    chart_id: chartId,
    x_value_count: xValues.length,
    series_count: series.length,
    sample_x: xValues.slice(0, 3),
  })
}
