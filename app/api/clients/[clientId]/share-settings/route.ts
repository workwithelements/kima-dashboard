import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

/**
 * GET /api/clients/[clientId]/share-settings
 * Returns the client's slug and whether a password is set (never exposes the hash).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const db = createServiceClient()
  const { data: client, error } = await db
    .from("clients")
    .select("slug, view_password_hash")
    .eq("id", params.clientId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    slug: client.slug,
    hasPassword: !!client.view_password_hash,
  })
}

/**
 * PUT /api/clients/[clientId]/share-settings
 * Accepts { password } and stores the SHA-256 hash on the clients table.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { password } = await request.json()

  if (!password || typeof password !== "string" || password.length < 4) {
    return NextResponse.json(
      { error: "Password must be at least 4 characters" },
      { status: 400 }
    )
  }

  // SHA-256 hash — same approach as /api/view-auth
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const db = createServiceClient()

  // Fetch current slug
  const { data: client } = await db
    .from("clients")
    .select("slug")
    .eq("id", params.clientId)
    .single()

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

  // Update password hash
  const { error } = await db
    .from("clients")
    .update({ view_password_hash: hashHex })
    .eq("id", params.clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    slug: client.slug,
    hasPassword: true,
  })
}
