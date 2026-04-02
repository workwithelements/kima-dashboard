import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * POST /api/clients — create a new client
 */
export async function POST(request: NextRequest) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { name, meta_account_id, google_ads_customer_id, currency_code } = body

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Client name is required" },
      { status: 400 }
    )
  }

  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[&]/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .insert({
      name: name.trim(),
      slug,
      active: true,
      meta_account_id: meta_account_id || null,
      google_ads_customer_id: google_ads_customer_id || null,
      currency_code: currency_code || null,
    })
    .select("id, name, slug, active, meta_account_id, google_ads_customer_id, currency_code")
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data, { status: 201 })
}
