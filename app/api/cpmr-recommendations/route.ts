import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

const ACTION_TYPES = ["scale", "pause", "protect"]
const STATUSES = ["actioned", "dismissed"]

/**
 * GET /api/cpmr-recommendations?client_id=...
 * Returns the client's resolved recommendation feedback plus global
 * (all-client) acceptance counts per action type — the learning signal that
 * weights future recommendation ranking.
 */
export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const clientId = request.nextUrl.searchParams.get("client_id")
  if (!clientId) {
    return NextResponse.json({ error: "client_id required" }, { status: 400 })
  }

  const supabase = createServiceClient()
  const [feedbackRes, globalRes] = await Promise.all([
    supabase
      .from("cpmr_recommendation_feedback")
      .select("ad_id, ad_name, action_type, status, feedback, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("cpmr_recommendation_feedback")
      .select("action_type, status"),
  ])

  if (feedbackRes.error) return safeError(feedbackRes.error)

  const typeRates: Record<string, { actioned: number; dismissed: number }> = {}
  for (const row of globalRes.data || []) {
    const entry = (typeRates[row.action_type] ||= { actioned: 0, dismissed: 0 })
    if (row.status === "actioned") entry.actioned++
    else entry.dismissed++
  }

  return NextResponse.json({ feedback: feedbackRes.data || [], typeRates })
}

/**
 * POST /api/cpmr-recommendations — record (or update) the team's response to
 * a recommendation. Upserts on (client_id, ad_id, action_type).
 */
export async function POST(request: NextRequest) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { client_id, ad_id, ad_name, action_type, window_key, status, feedback, metrics } = body

  if (!client_id || !ad_id || !action_type || !status || !window_key) {
    return NextResponse.json(
      { error: "client_id, ad_id, action_type, window_key and status required" },
      { status: 400 }
    )
  }
  if (!ACTION_TYPES.includes(action_type) || !STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid action_type or status" }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("cpmr_recommendation_feedback")
    .upsert(
      {
        client_id,
        ad_id,
        ad_name: ad_name ?? null,
        action_type,
        window_key,
        status,
        feedback: feedback ?? null,
        metrics: metrics ?? null,
      },
      { onConflict: "client_id,ad_id,action_type" }
    )
    .select("ad_id, ad_name, action_type, status, feedback, created_at")
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * DELETE /api/cpmr-recommendations?client_id=...&ad_id=...&action_type=...
 * Undo a recorded response — the recommendation becomes eligible again.
 */
export async function DELETE(request: NextRequest) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const params = request.nextUrl.searchParams
  const clientId = params.get("client_id")
  const adId = params.get("ad_id")
  const actionType = params.get("action_type")
  if (!clientId || !adId || !actionType) {
    return NextResponse.json(
      { error: "client_id, ad_id and action_type required" },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from("cpmr_recommendation_feedback")
    .delete()
    .eq("client_id", clientId)
    .eq("ad_id", adId)
    .eq("action_type", actionType)

  if (error) return safeError(error)
  return NextResponse.json({ ok: true })
}
