import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/creative-test-config/[clientId]
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("creative_test_config")
    .select("*")
    .eq("client_id", params.clientId)
    .single()

  if (error && error.code !== "PGRST116") {
    return safeError(error)
  }

  return NextResponse.json(data || null)
}

/**
 * PUT /api/creative-test-config/[clientId] — upsert config
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()

  const payload: Record<string, unknown> = {
    client_id: params.clientId,
    updated_at: new Date().toISOString(),
  }

  if (body.enabled !== undefined) payload.enabled = body.enabled
  if (body.min_days_live !== undefined) payload.min_days_live = body.min_days_live
  if (body.min_spend !== undefined) payload.min_spend = body.min_spend
  if (body.min_conversions !== undefined) payload.min_conversions = body.min_conversions
  if (body.high_spend_alert !== undefined) payload.high_spend_alert = body.high_spend_alert
  if (body.notion_board_id !== undefined) payload.notion_board_id = body.notion_board_id
  if (body.slack_channel_id !== undefined) payload.slack_channel_id = body.slack_channel_id

  const db = createServiceClient()
  const { data, error } = await db
    .from("creative_test_config")
    .upsert(payload, { onConflict: "client_id" })
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}
