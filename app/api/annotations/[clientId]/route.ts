import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/annotations/[clientId]?from=...&to=...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  let query = supabase
    .from("annotations")
    .select("id, date, text, created_at")
    .eq("client_id", params.clientId)
    .order("date", { ascending: true })

  if (from) query = query.gte("date", from)
  if (to) query = query.lte("date", to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data || [])
}

/**
 * POST /api/annotations/[clientId] — create annotation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { date, text } = body

  if (!date || !text) {
    return NextResponse.json({ error: "date and text required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("annotations")
    .insert({
      client_id: params.clientId,
      date,
      text,
      created_by: user.id,
    })
    .select("id, date, text, created_at")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

/**
 * DELETE /api/annotations/[clientId]?id=...
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  const { error } = await supabase
    .from("annotations")
    .delete()
    .eq("id", id)
    .eq("client_id", params.clientId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
