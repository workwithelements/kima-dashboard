import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/scorecard-config/[clientId] — get scorecard config for a client
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("client_scorecard_config")
    .select("*")
    .eq("client_id", params.clientId)
    .single()

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Return config or null (no config yet = use defaults)
  return NextResponse.json(data || null)
}

/**
 * PUT /api/scorecard-config/[clientId] — upsert scorecard config
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { metric_ids, funnel_steps, creative_previews_enabled, key_action } = body

  // Build upsert payload — only include fields that were sent
  const payload: Record<string, unknown> = {
    client_id: params.clientId,
    updated_at: new Date().toISOString(),
  }

  if (metric_ids !== undefined) {
    if (!Array.isArray(metric_ids)) {
      return NextResponse.json({ error: "metric_ids must be an array" }, { status: 400 })
    }
    payload.metric_ids = metric_ids
  }

  if (funnel_steps !== undefined) {
    if (!Array.isArray(funnel_steps)) {
      return NextResponse.json({ error: "funnel_steps must be an array" }, { status: 400 })
    }
    payload.funnel_steps = funnel_steps
  }

  if (creative_previews_enabled !== undefined) {
    payload.creative_previews_enabled = Boolean(creative_previews_enabled)
  }

  if (key_action !== undefined) {
    payload.key_action = key_action || null
  }

  const { data, error } = await supabase
    .from("client_scorecard_config")
    .upsert(payload, { onConflict: "client_id" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
