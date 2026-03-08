import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/creative-ad-tags?client_id=xxx — list ad-tag assignments for a client
 */
export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get("client_id")
  if (!clientId) {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("creative_ad_tags")
    .select("ad_id, tag_id")
    .eq("client_id", clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/**
 * POST /api/creative-ad-tags — assign a tag to an ad
 * Body: { ad_id, tag_id, client_id }
 */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { ad_id, tag_id, client_id } = body

  if (!ad_id || !tag_id || !client_id) {
    return NextResponse.json({ error: "ad_id, tag_id, and client_id are required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("creative_ad_tags")
    .insert({
      ad_id,
      tag_id,
      client_id,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Tag already assigned to this ad" }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

/**
 * DELETE /api/creative-ad-tags — remove a tag from an ad
 * Body: { ad_id, tag_id }
 */
export async function DELETE(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { ad_id, tag_id } = body

  if (!ad_id || !tag_id) {
    return NextResponse.json({ error: "ad_id and tag_id are required" }, { status: 400 })
  }

  const { error } = await supabase
    .from("creative_ad_tags")
    .delete()
    .eq("ad_id", ad_id)
    .eq("tag_id", tag_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
