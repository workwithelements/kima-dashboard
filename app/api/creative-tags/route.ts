import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/creative-tags — list all tags
 */
export async function GET() {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = createClient()

  const { data, error } = await supabase
    .from("creative_tags")
    .select("*")
    .order("name")

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * POST /api/creative-tags — create a new tag
 */
export async function POST(request: NextRequest) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = createClient()

  const body = await request.json()
  const { name, color } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("creative_tags")
    .insert({
      name: name.trim(),
      color: color || "#CDFF00",
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Tag name already exists" }, { status: 409 })
    }
    return safeError(error)
  }
  return NextResponse.json(data, { status: 201 })
}
