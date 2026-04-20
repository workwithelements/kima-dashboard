import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"
import { synthesiseDefaultView, type FunnelView } from "@/lib/utils/funnel-views"

/**
 * GET /api/scorecard-config/[clientId]
 * Returns `{ config, views }`. `views` is the persisted list of
 * client_funnel_views rows, or a synthesised transient default derived from
 * the legacy config fields when no rows exist yet.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const [configRes, viewsRes] = await Promise.all([
    db
      .from("client_scorecard_config")
      .select("*")
      .eq("client_id", params.clientId)
      .single(),
    db
      .from("client_funnel_views")
      .select("id, name, sort_order, funnel_steps, key_action, linked_campaign_ids, is_default")
      .eq("client_id", params.clientId)
      .order("sort_order", { ascending: true }),
  ])

  if (configRes.error && configRes.error.code !== "PGRST116") {
    return safeError(configRes.error)
  }
  if (viewsRes.error) return safeError(viewsRes.error)

  const config = configRes.data || null
  const rawViews = (viewsRes.data || []) as FunnelView[]
  const views: FunnelView[] =
    rawViews.length > 0
      ? rawViews
      : [synthesiseDefaultView(config?.funnel_steps, config?.key_action)]

  return NextResponse.json({ config, views })
}

/**
 * PUT /api/scorecard-config/[clientId] — upsert scorecard config
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { metric_ids, funnel_steps, creative_previews_enabled, key_action, contribution_margin_pct } = body

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

  if (contribution_margin_pct !== undefined) {
    const cm = contribution_margin_pct === null ? null : Number(contribution_margin_pct)
    if (cm !== null && (isNaN(cm) || cm < 0 || cm > 100)) {
      return NextResponse.json({ error: "contribution_margin_pct must be 0-100 or null" }, { status: 400 })
    }
    payload.contribution_margin_pct = cm
  }

  // Use service client for the write to bypass RLS issues with upsert
  const db = createServiceClient()
  const { data, error } = await db
    .from("client_scorecard_config")
    .upsert(payload, { onConflict: "client_id" })
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}
