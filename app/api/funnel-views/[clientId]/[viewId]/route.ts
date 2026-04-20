import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

type RouteParams = { params: { clientId: string; viewId: string } }

/**
 * PUT /api/funnel-views/[clientId]/[viewId] — partial update. Setting
 * is_default=true atomically unsets it on any other row for this client.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json().catch(() => ({}))
  const {
    name,
    funnel_steps,
    key_action,
    linked_campaign_ids,
    is_default,
  } = body as Record<string, unknown>

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 })
    }
    payload.name = name.trim()
  }
  if (funnel_steps !== undefined) {
    if (!Array.isArray(funnel_steps)) {
      return NextResponse.json({ error: "funnel_steps must be an array" }, { status: 400 })
    }
    payload.funnel_steps = funnel_steps
  }
  if (key_action !== undefined) {
    payload.key_action = typeof key_action === "string" && key_action ? key_action : null
  }
  if (linked_campaign_ids !== undefined) {
    if (!Array.isArray(linked_campaign_ids)) {
      return NextResponse.json({ error: "linked_campaign_ids must be an array" }, { status: 400 })
    }
    payload.linked_campaign_ids = linked_campaign_ids
  }

  const db = createServiceClient()

  if (is_default === true) {
    const { error: unsetErr } = await db
      .from("client_funnel_views")
      .update({ is_default: false })
      .eq("client_id", params.clientId)
      .neq("id", params.viewId)
      .eq("is_default", true)
    if (unsetErr) return safeError(unsetErr)
    payload.is_default = true
  }

  const { data, error } = await db
    .from("client_funnel_views")
    .update(payload)
    .eq("id", params.viewId)
    .eq("client_id", params.clientId)
    .select("id, name, sort_order, funnel_steps, key_action, linked_campaign_ids, is_default")
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * DELETE /api/funnel-views/[clientId]/[viewId]
 * Refuses to delete the last remaining view (409). If the deleted row was
 * the default, promotes the first remaining view to default.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()

  const { data: siblings, error: sibErr } = await db
    .from("client_funnel_views")
    .select("id, is_default, sort_order")
    .eq("client_id", params.clientId)
    .order("sort_order", { ascending: true })
  if (sibErr) return safeError(sibErr)

  if ((siblings?.length || 0) <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last funnel view" },
      { status: 409 }
    )
  }

  const target = siblings?.find((r) => r.id === params.viewId)
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { error: delErr } = await db
    .from("client_funnel_views")
    .delete()
    .eq("id", params.viewId)
    .eq("client_id", params.clientId)
  if (delErr) return safeError(delErr)

  if (target.is_default) {
    const nextDefault = siblings!.find((r) => r.id !== params.viewId)
    if (nextDefault) {
      const { error: promoteErr } = await db
        .from("client_funnel_views")
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq("id", nextDefault.id)
        .eq("client_id", params.clientId)
      if (promoteErr) return safeError(promoteErr)
    }
  }

  return NextResponse.json({ ok: true })
}
