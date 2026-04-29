import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

const VALID_METRICS = [
  "spend", "impressions", "reach", "unique_link_clicks",
  "landing_page_views", "adds_to_cart", "registrations_completed",
  "trials_started", "checkouts_initiated", "purchases", "purchase_value",
  "app_installs", "mobile_app_registrations",
  "video_plays", "video_3s_views",
  "cpa", "roas", "ctr", "cpm",
]

const VALID_DIRECTIONS = ["increase", "decrease", "either"]

/**
 * GET /api/alert-config/[clientId] — list all alert configs for a client
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_alert_config")
    .select("*")
    .eq("client_id", params.clientId)
    .order("created_at", { ascending: true })

  if (error) return safeError(error)
  return NextResponse.json(data || [])
}

/**
 * POST /api/alert-config/[clientId] — create a new alert
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { metric, threshold_pct, direction, slack_channel } = body

  if (!metric || !VALID_METRICS.includes(metric)) {
    return NextResponse.json({ error: "Invalid metric" }, { status: 400 })
  }
  if (!threshold_pct || typeof threshold_pct !== "number" || threshold_pct <= 0) {
    return NextResponse.json({ error: "threshold_pct must be a positive number" }, { status: 400 })
  }
  if (!direction || !VALID_DIRECTIONS.includes(direction)) {
    return NextResponse.json({ error: "Invalid direction" }, { status: 400 })
  }
  if (!slack_channel || typeof slack_channel !== "string") {
    return NextResponse.json({ error: "slack_channel is required" }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_alert_config")
    .insert({
      client_id: params.clientId,
      metric,
      threshold_pct,
      direction,
      slack_channel: slack_channel.trim(),
    })
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * PUT /api/alert-config/[clientId] — update an existing alert
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { id, metric, threshold_pct, direction, slack_channel, enabled } = body

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (metric !== undefined) {
    if (!VALID_METRICS.includes(metric)) {
      return NextResponse.json({ error: "Invalid metric" }, { status: 400 })
    }
    payload.metric = metric
  }
  if (threshold_pct !== undefined) {
    if (typeof threshold_pct !== "number" || threshold_pct <= 0) {
      return NextResponse.json({ error: "threshold_pct must be positive" }, { status: 400 })
    }
    payload.threshold_pct = threshold_pct
  }
  if (direction !== undefined) {
    if (!VALID_DIRECTIONS.includes(direction)) {
      return NextResponse.json({ error: "Invalid direction" }, { status: 400 })
    }
    payload.direction = direction
  }
  if (slack_channel !== undefined) {
    payload.slack_channel = slack_channel.trim()
  }
  if (enabled !== undefined) {
    payload.enabled = Boolean(enabled)
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_alert_config")
    .update(payload)
    .eq("id", id)
    .eq("client_id", params.clientId)
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * DELETE /api/alert-config/[clientId]?id=... — delete an alert
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db
    .from("client_alert_config")
    .delete()
    .eq("id", id)
    .eq("client_id", params.clientId)

  if (error) return safeError(error)
  return NextResponse.json({ ok: true })
}
