import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/naming-config/[clientId] — get naming convention config for a client
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_naming_config")
    .select("*")
    .eq("client_id", params.clientId)
    .single()

  if (error && error.code !== "PGRST116") {
    return safeError(error)
  }

  // Return config or null (no config yet = use default hardcoded parser)
  return NextResponse.json(data || null)
}

/**
 * PUT /api/naming-config/[clientId] — upsert naming convention config
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { positions, value_maps, separator } = body

  // Build upsert payload — only include fields that were sent
  const payload: Record<string, unknown> = {
    client_id: params.clientId,
    updated_at: new Date().toISOString(),
  }

  if (positions !== undefined) {
    if (!Array.isArray(positions)) {
      return NextResponse.json({ error: "positions must be an array" }, { status: 400 })
    }
    // Validate each position has required fields
    for (const pos of positions) {
      if (typeof pos.index !== "number" || !pos.key || !pos.label) {
        return NextResponse.json(
          { error: "Each position must have index (number), key (string), label (string)" },
          { status: 400 }
        )
      }
    }
    payload.positions = positions
  }

  if (value_maps !== undefined) {
    if (typeof value_maps !== "object" || value_maps === null) {
      return NextResponse.json({ error: "value_maps must be an object" }, { status: 400 })
    }
    payload.value_maps = value_maps
  }

  if (separator !== undefined) {
    if (typeof separator !== "string" || separator.length === 0) {
      return NextResponse.json({ error: "separator must be a non-empty string" }, { status: 400 })
    }
    payload.separator = separator
  }

  // Use service client for the write to bypass RLS issues with upsert
  const db = createServiceClient()
  const { data, error } = await db
    .from("client_naming_config")
    .upsert(payload, { onConflict: "client_id" })
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}
