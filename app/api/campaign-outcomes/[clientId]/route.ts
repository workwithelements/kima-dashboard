import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"
import { FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"

/**
 * GET /api/campaign-outcomes/[clientId] — list all campaign outcome overrides
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_campaign_outcomes")
    .select("id, client_id, campaign_id, campaign_name, outcome_key")
    .eq("client_id", params.clientId)
    .order("created_at")

  if (error) return safeError(error)
  return NextResponse.json(data || [])
}

/**
 * PUT /api/campaign-outcomes/[clientId] — upsert a campaign outcome
 * Body: { campaign_id, campaign_name?, outcome_key }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { campaign_id, campaign_name, outcome_key } = body

  if (!campaign_id || typeof campaign_id !== "string") {
    return NextResponse.json({ error: "campaign_id is required" }, { status: 400 })
  }

  if (!outcome_key || !FUNNEL_STEP_DEFS[outcome_key]) {
    return NextResponse.json(
      { error: "outcome_key must be a valid funnel step" },
      { status: 400 }
    )
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_campaign_outcomes")
    .upsert(
      {
        client_id: params.clientId,
        campaign_id,
        campaign_name: campaign_name || null,
        outcome_key,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,campaign_id" }
    )
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * DELETE /api/campaign-outcomes/[clientId]?campaign_id=xxx — remove a campaign outcome
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const campaignId = request.nextUrl.searchParams.get("campaign_id")
  if (!campaignId) {
    return NextResponse.json({ error: "campaign_id query param required" }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db
    .from("client_campaign_outcomes")
    .delete()
    .eq("client_id", params.clientId)
    .eq("campaign_id", campaignId)

  if (error) return safeError(error)
  return NextResponse.json({ ok: true })
}
