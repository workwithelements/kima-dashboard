import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"
import bcrypt from "bcryptjs"

/**
 * GET /api/clients/[clientId]/share-settings
 * Returns the client's slug and whether a password is set (never exposes the hash).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data: client, error } = await db
    .from("clients")
    .select("slug, view_password_hash")
    .eq("id", params.clientId)
    .single()

  if (error) return safeError(error)
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    slug: client.slug,
    hasPassword: !!client.view_password_hash,
  })
}

/**
 * PUT /api/clients/[clientId]/share-settings
 * Accepts { password } and stores a bcrypt hash on the clients table.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const { password } = await request.json()

  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    )
  }

  // Hash with bcrypt (10 rounds)
  const hash = await bcrypt.hash(password, 10)

  const db = createServiceClient()

  // Fetch current slug
  const { data: client } = await db
    .from("clients")
    .select("slug")
    .eq("id", params.clientId)
    .single()

  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Update password hash
  const { error } = await db
    .from("clients")
    .update({ view_password_hash: hash })
    .eq("id", params.clientId)

  if (error) return safeError(error)

  return NextResponse.json({
    slug: client.slug,
    hasPassword: true,
  })
}
