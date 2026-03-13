import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * PUT /api/creative-tags/[id] — update a tag
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    .update({ name: name.trim(), color: color || "#CDFF00" })
    .eq("id", params.id)
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * DELETE /api/creative-tags/[id] — delete a tag (cascades to ad assignments)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = createClient()

  const { error } = await supabase
    .from("creative_tags")
    .delete()
    .eq("id", params.id)

  if (error) return safeError(error)
  return NextResponse.json({ ok: true })
}
