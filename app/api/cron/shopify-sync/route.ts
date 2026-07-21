import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { syncShopifyForClient } from "@/lib/integrations/shopify-sync"

export const dynamic = "force-dynamic"
export const maxDuration = 300

type SyncOutcome =
  | {
      status: "ok"
      client_id: string
      client_name: string
      orders_fetched: number
      days_synced: number
      total_net_revenue: number
    }
  | {
      status: "skipped"
      client_id: string
      client_name: string
      reason: string
    }
  | {
      status: "error"
      client_id: string
      client_name: string
      error: string
    }

/**
 * POST /api/cron/shopify-sync — daily Shopify sync for every enabled client.
 *
 * Schedule this against any cron service (Netlify Scheduled Functions,
 * Vercel Cron, GitHub Actions, external scheduler). Secured with CRON_SECRET
 * bearer token, matching /api/cron/check-ready-tests.
 *
 * Query params:
 *   ?days=7         — how many days back to sync (default 3)
 *   ?client_id=xxx  — restrict to a single client (default: all enabled)
 *
 * Each enabled client must have shopify_store_domain set. Per-client COGS
 * comes from clients.shopify_cogs_rate. The shared SHOPIFY_ACCESS_TOKEN env
 * is used for all clients (Shopify custom apps are per-store, so set
 * SHOPIFY_ACCESS_TOKEN_<UPPER_SLUG> to override per client if needed in
 * the future — for now a single store + token is assumed).
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const daysParam = Number(url.searchParams.get("days") || "3")
  const days = isNaN(daysParam) || daysParam < 1 || daysParam > 90 ? 3 : daysParam
  const clientIdFilter = url.searchParams.get("client_id")

  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const from = new Date(yesterday)
  from.setUTCDate(from.getUTCDate() - (days - 1))

  const fromStr = from.toISOString().slice(0, 10)
  const toStr = yesterday.toISOString().slice(0, 10)

  const db = createServiceClient()

  let query = db
    .from("clients")
    .select("id, name, shopify_store_domain, shopify_cogs_rate, active")
    .not("shopify_store_domain", "is", null)
    .eq("active", true)

  if (clientIdFilter) query = query.eq("id", clientIdFilter)

  const { data: clients, error } = await query

  if (error) {
    console.error("[shopify-sync] failed to load clients:", error.message)
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 })
  }

  if (!clients || clients.length === 0) {
    return NextResponse.json({
      message: "No clients with Shopify enabled",
      window: { from: fromStr, to: toStr },
      results: [],
    })
  }

  const perClientToken = (slug: string): string | undefined =>
    process.env[`SHOPIFY_ACCESS_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]

  const sharedToken = process.env.SHOPIFY_ACCESS_TOKEN

  const results: SyncOutcome[] = []

  for (const client of clients) {
    const id = client.id as string
    const name = (client.name as string) || id
    const storeDomain = client.shopify_store_domain as string
    const cogsRate = Number(client.shopify_cogs_rate ?? 0)
    const accessToken = perClientToken(storeDomain.split(".")[0]) ?? sharedToken

    if (!accessToken) {
      results.push({
        status: "skipped",
        client_id: id,
        client_name: name,
        reason: "No SHOPIFY_ACCESS_TOKEN (shared or per-store) configured",
      })
      continue
    }

    try {
      const r = await syncShopifyForClient(db as any, {
        clientId: id,
        storeDomain,
        accessToken,
        from: fromStr,
        to: toStr,
        cogsRate,
      })
      results.push({
        status: "ok",
        client_id: id,
        client_name: name,
        orders_fetched: r.ordersFetched,
        days_synced: r.daysSynced,
        total_net_revenue: r.totalNetRevenue,
      })
    } catch (err: any) {
      console.error(`[shopify-sync] ${name} (${id}) failed:`, err?.message || err)
      results.push({
        status: "error",
        client_id: id,
        client_name: name,
        error: err?.message || String(err),
      })
    }
  }

  const ok = results.filter((r) => r.status === "ok").length
  const skipped = results.filter((r) => r.status === "skipped").length
  const errored = results.filter((r) => r.status === "error").length

  return NextResponse.json({
    message: `Synced ${ok} client(s), skipped ${skipped}, errored ${errored}`,
    window: { from: fromStr, to: toStr },
    results,
  })
}
