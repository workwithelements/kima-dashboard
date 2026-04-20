import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * PUT /api/funnel-views/[clientId]/reorder — rewrite sort_order in one pass.
 * Body: { orderedIds: string[] }. IDs not owned by the client are ignored.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json().catch(() => ({}))
  const { orderedIds } = body as { orderedIds?: unknown }
  if (!Array.isArray(orderedIds)) {
    return NextResponse.json({ error: "orderedIds must be an array" }, { status: 400 })
  }

  const db = createServiceClient()

  const { data: ownRows, error: ownErr } = await db
    .from("client_funnel_views")
    .select("id")
    .eq("client_id", params.clientId)
  if (ownErr) return safeError(ownErr)
  const ownIds = new Set((ownRows || []).map((r) => r.id))

  const updates = (orderedIds as string[])
    .filter((id) => ownIds.has(id))
    .map((id, idx) =>
      db
        .from("client_funnel_views")
        .update({ sort_order: idx, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("client_id", params.clientId)
    )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed?.error) return safeError(failed.error)

  return NextResponse.json({ ok: true })
}
