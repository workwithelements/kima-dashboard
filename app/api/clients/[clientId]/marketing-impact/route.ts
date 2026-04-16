import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/clients/[clientId]/marketing-impact — get Marketing Impact tab visibility
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .select("id, marketing_impact_enabled")
    .eq("id", params.clientId)
    .single()

  if (error) return safeError(error)

  return NextResponse.json({
    enabled: data.marketing_impact_enabled ?? false,
  })
}

/**
 * PUT /api/clients/[clientId]/marketing-impact — toggle Marketing Impact tab visibility
 *
 * Body: { enabled: boolean }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const enabled = !!body.enabled

  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .update({ marketing_impact_enabled: enabled })
    .eq("id", params.clientId)
    .select("id, marketing_impact_enabled")
    .single()

  if (error) return safeError(error)

  return NextResponse.json({
    enabled: data.marketing_impact_enabled ?? false,
  })
}
