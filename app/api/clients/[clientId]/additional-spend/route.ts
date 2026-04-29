import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/clients/[clientId]/additional-spend
 * Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD filters to entries overlapping the range.
 * Without a range, returns all entries for the client.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const db = createServiceClient()
  let query = db
    .from("client_additional_spend")
    .select("id, client_id, start_date, end_date, amount, note")
    .eq("client_id", params.clientId)
    .order("start_date", { ascending: false })

  if (from && to) {
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 })
    }
    query = query.lte("start_date", to).gte("end_date", from)
  }

  const { data, error } = await query
  if (error) return safeError(error)
  return NextResponse.json(data || [])
}

/**
 * POST /api/clients/[clientId]/additional-spend
 * Body: { start_date, end_date?, amount, note? }
 * If end_date is omitted, it defaults to start_date.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const start_date = String(body.start_date || "")
  const end_date = String(body.end_date || start_date)
  const amount = Number(body.amount)
  const note = body.note != null ? String(body.note).trim() || null : null

  if (!DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
    return NextResponse.json({ error: "start_date and end_date must be YYYY-MM-DD" }, { status: 400 })
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_additional_spend")
    .insert({
      client_id: params.clientId,
      start_date,
      end_date,
      amount,
      note,
    })
    .select("id, client_id, start_date, end_date, amount, note")
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data, { status: 201 })
}
