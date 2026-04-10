import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * POST /api/shopify/attribution — Upsert daily Shopify attribution data by UTM source/medium.
 *
 * Body: { clientId: string, rows: Array<{ date, source, medium, orders, revenue }> }
 */
export async function POST(request: NextRequest) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { clientId, rows } = body

  if (!clientId || typeof clientId !== "string") {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 })
  }

  // Validate each row
  for (const row of rows) {
    if (!row.date || typeof row.date !== "string") {
      return NextResponse.json({ error: "Each row must have a valid date (YYYY-MM-DD)" }, { status: 400 })
    }
    if (!row.source || typeof row.source !== "string") {
      return NextResponse.json({ error: "Each row must have a source" }, { status: 400 })
    }
  }

  const db = createServiceClient()

  // Build upsert payload
  const payload = rows.map((row: any) => ({
    client_id: clientId,
    date: row.date,
    source: row.source,
    medium: row.medium || "",
    orders: Number(row.orders) || 0,
    revenue: Number(row.revenue) || 0,
  }))

  const { data, error } = await db
    .from("shopify_daily_attribution")
    .upsert(payload, { onConflict: "client_id,date,source,medium" })
    .select()

  if (error) return safeError(error)
  return NextResponse.json({ inserted: data?.length || 0 })
}
