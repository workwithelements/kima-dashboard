import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * POST /api/shopify/orders — Upsert daily Shopify order data.
 *
 * Body: { clientId: string, rows: Array<{ date, orders, gross_revenue, discounts, refunds, net_revenue, cogs, shipping_costs }> }
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
  }

  const db = createServiceClient()

  // Build upsert payload
  const payload = rows.map((row: any) => ({
    client_id: clientId,
    date: row.date,
    orders: Number(row.orders) || 0,
    gross_revenue: Number(row.gross_revenue) || 0,
    discounts: Number(row.discounts) || 0,
    refunds: Number(row.refunds) || 0,
    net_revenue: Number(row.net_revenue) || 0,
    cogs: Number(row.cogs) || 0,
    shipping_costs: Number(row.shipping_costs) || 0,
  }))

  const { data, error } = await db
    .from("shopify_daily_orders")
    .upsert(payload, { onConflict: "client_id,date" })
    .select()

  if (error) return safeError(error)
  return NextResponse.json({ inserted: data?.length || 0 })
}
