import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * POST /api/funnel-views/[clientId]
 * Create a new funnel view for a client. Body fields are optional except
 * `name`; sort_order defaults to the end of the current list.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json().catch(() => ({}))
  const {
    name,
    funnel_steps,
    key_action,
    linked_campaign_ids,
    is_default,
  } = body as {
    name?: unknown
    funnel_steps?: unknown
    key_action?: unknown
    linked_campaign_ids?: unknown
    is_default?: unknown
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }
  if (funnel_steps !== undefined && !Array.isArray(funnel_steps)) {
    return NextResponse.json({ error: "funnel_steps must be an array" }, { status: 400 })
  }
  if (linked_campaign_ids !== undefined && !Array.isArray(linked_campaign_ids)) {
    return NextResponse.json({ error: "linked_campaign_ids must be an array" }, { status: 400 })
  }

  const db = createServiceClient()

  const { count } = await db
    .from("client_funnel_views")
    .select("id", { count: "exact", head: true })
    .eq("client_id", params.clientId)

  const wantDefault = Boolean(is_default) || (count || 0) === 0

  if (wantDefault) {
    const { error: unsetErr } = await db
      .from("client_funnel_views")
      .update({ is_default: false })
      .eq("client_id", params.clientId)
      .eq("is_default", true)
    if (unsetErr) return safeError(unsetErr)
  }

  const { data, error } = await db
    .from("client_funnel_views")
    .insert({
      client_id: params.clientId,
      name: name.trim(),
      funnel_steps: Array.isArray(funnel_steps) ? funnel_steps : [],
      key_action: typeof key_action === "string" && key_action ? key_action : null,
      linked_campaign_ids: Array.isArray(linked_campaign_ids) ? linked_campaign_ids : [],
      is_default: wantDefault,
      sort_order: count || 0,
    })
    .select("id, name, sort_order, funnel_steps, key_action, linked_campaign_ids, is_default")
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}
