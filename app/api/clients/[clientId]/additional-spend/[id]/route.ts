import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * PATCH /api/clients/[clientId]/additional-spend/[id]
 * Body: { start_date?, end_date?, amount?, note? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { clientId: string; id: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (body.start_date !== undefined) {
    if (!DATE_RE.test(String(body.start_date))) {
      return NextResponse.json({ error: "start_date must be YYYY-MM-DD" }, { status: 400 })
    }
    update.start_date = body.start_date
  }
  if (body.end_date !== undefined) {
    if (!DATE_RE.test(String(body.end_date))) {
      return NextResponse.json({ error: "end_date must be YYYY-MM-DD" }, { status: 400 })
    }
    update.end_date = body.end_date
  }
  if (body.amount !== undefined) {
    const amt = Number(body.amount)
    if (!Number.isFinite(amt) || amt < 0) {
      return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 })
    }
    update.amount = amt
  }
  if (body.note !== undefined) {
    update.note = body.note != null && String(body.note).trim() !== "" ? String(body.note).trim() : null
  }

  if (
    typeof update.start_date === "string" &&
    typeof update.end_date === "string" &&
    update.end_date < update.start_date
  ) {
    return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 })
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  update.updated_at = new Date().toISOString()

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_additional_spend")
    .update(update)
    .eq("id", params.id)
    .eq("client_id", params.clientId)
    .select("id, client_id, start_date, end_date, amount, note")
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * DELETE /api/clients/[clientId]/additional-spend/[id]
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { clientId: string; id: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { error } = await db
    .from("client_additional_spend")
    .delete()
    .eq("id", params.id)
    .eq("client_id", params.clientId)

  if (error) return safeError(error)
  return NextResponse.json({ ok: true })
}
