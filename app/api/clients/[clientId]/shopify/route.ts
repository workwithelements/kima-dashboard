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
    .select("id, shopify_store_domain, shopify_cogs_rate")
    .eq("id", params.clientId)
    .single()

  if (error) return safeError(error)

  return NextResponse.json({
    enabled: !!data.shopify_store_domain,
    store_domain: data.shopify_store_domain || "",
    cogs_rate: data.shopify_cogs_rate != null ? Number(data.shopify_cogs_rate) : null,
  })
}

/**
 * PUT /api/clients/[clientId]/shopify — update Shopify settings for a client
 *
 * Body: { enabled: boolean, store_domain?: string, cogs_rate?: number | null }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { enabled, store_domain, cogs_rate } = body as {
    enabled: boolean
    store_domain?: string
    cogs_rate?: number | string | null
  }

  if (enabled && (!store_domain || typeof store_domain !== "string" || !store_domain.trim())) {
    return NextResponse.json(
      { error: "store_domain is required when Shopify is enabled" },
      { status: 400 }
    )
  }

  if (enabled && store_domain) {
    const domain = store_domain.trim()
    if (!domain.includes(".")) {
      return NextResponse.json(
        { error: "Invalid store domain — expected format: your-store.myshopify.com" },
        { status: 400 }
      )
    }
  }

  let cogsRateValue: number | null = null
  if (cogs_rate !== undefined && cogs_rate !== null && cogs_rate !== "") {
    const parsed = Number(cogs_rate)
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
      return NextResponse.json(
        { error: "cogs_rate must be a number between 0 and 1" },
        { status: 400 }
      )
    }
    cogsRateValue = parsed
  }

  const update: Record<string, string | number | null> = {
    shopify_store_domain: enabled ? store_domain!.trim() : null,
    shopify_cogs_rate: enabled ? cogsRateValue : null,
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .update(update)
    .eq("id", params.clientId)
    .select("id, shopify_store_domain, shopify_cogs_rate")
    .single()

  if (error) return safeError(error)

  return NextResponse.json({
    enabled: !!data.shopify_store_domain,
    store_domain: data.shopify_store_domain || "",
    cogs_rate: data.shopify_cogs_rate != null ? Number(data.shopify_cogs_rate) : null,
  })
}
