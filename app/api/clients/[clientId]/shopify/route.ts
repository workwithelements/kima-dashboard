import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/clients/[clientId]/shopify — get Shopify settings for a client
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .select("id, shopify_store_domain")
    .eq("id", params.clientId)
    .single()

  if (error) return safeError(error)

  return NextResponse.json({
    enabled: !!data.shopify_store_domain,
    store_domain: data.shopify_store_domain || "",
  })
}

/**
 * PUT /api/clients/[clientId]/shopify — update Shopify settings for a client
 *
 * Body: { enabled: boolean, store_domain?: string }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { enabled, store_domain } = body

  // When enabled, store_domain is required
  if (enabled && (!store_domain || typeof store_domain !== "string" || !store_domain.trim())) {
    return NextResponse.json(
      { error: "store_domain is required when Shopify is enabled" },
      { status: 400 }
    )
  }

  // Validate domain format (basic check)
  if (enabled && store_domain) {
    const domain = store_domain.trim()
    if (!domain.includes(".")) {
      return NextResponse.json(
        { error: "Invalid store domain — expected format: your-store.myshopify.com" },
        { status: 400 }
      )
    }
  }

  const shopify_store_domain = enabled ? store_domain.trim() : null

  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .update({ shopify_store_domain })
    .eq("id", params.clientId)
    .select("id, shopify_store_domain")
    .single()

  if (error) return safeError(error)

  return NextResponse.json({
    enabled: !!data.shopify_store_domain,
    store_domain: data.shopify_store_domain || "",
  })
}
