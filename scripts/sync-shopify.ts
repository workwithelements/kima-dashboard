/**
 * Shopify Sync Script
 *
 * Fetches orders from the Shopify Admin REST API, aggregates them into daily
 * summaries and UTM attribution rows, then upserts to Supabase.
 *
 * Usage:
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid>
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid> --from 2024-03-01 --to 2024-03-31
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid> --store my-store.myshopify.com --token shpat_xxx
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid> --cogs-rate 0.35
 *
 * Env vars (can be overridden via CLI flags):
 *   SHOPIFY_STORE_DOMAIN   — e.g. "my-store.myshopify.com"
 *   SHOPIFY_ACCESS_TOKEN   — Shopify custom app access token
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"

// ── Types ───────────────────────────────────────────────────────────────

type ShopifyOrder = {
  id: number
  created_at: string
  total_price: string
  total_discounts: string
  financial_status: string
  refunds: Array<{
    refund_line_items: Array<{ subtotal: number }>
    transactions: Array<{ amount: string; kind: string }>
  }>
  line_items: Array<{
    quantity: number
    price: string
  }>
  shipping_lines: Array<{
    price: string
  }>
  landing_site: string | null
  referring_site: string | null
}

type DailyOrderAgg = {
  date: string
  orders: number
  gross_revenue: number
  discounts: number
  refunds: number
  net_revenue: number
  cogs: number
  shipping_costs: number
}

type DailyAttribution = {
  date: string
  source: string
  medium: string
  orders: number
  revenue: number
}

type Config = {
  clientId: string
  storeDomain: string
  accessToken: string
  from: string
  to: string
  cogsRate: number
}

// ── CLI Arg Parsing ─────────────────────────────────────────────────────

function printUsage(): never {
  console.log(`
Shopify Sync Script — Fetch orders and sync to Supabase.

Usage:
  npx tsx scripts/sync-shopify.ts --client-id <uuid> [options]

Required:
  --client-id <uuid>    Supabase client ID to sync for

Options:
  --from <YYYY-MM-DD>   Start date (default: 7 days ago)
  --to <YYYY-MM-DD>     End date (default: yesterday)
  --store <domain>      Shopify store domain (overrides SHOPIFY_STORE_DOMAIN env)
  --token <token>       Shopify access token (overrides SHOPIFY_ACCESS_TOKEN env)
  --cogs-rate <0-1>     COGS as fraction of gross revenue (default: 0)
  --help                Show this help message
`)
  process.exit(0)
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseArgs(): Config {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage()
  }

  const clientId = getArg("--client-id")
  if (!clientId) {
    console.error("Error: --client-id is required")
    printUsage()
  }

  const storeDomain = getArg("--store") || process.env.SHOPIFY_STORE_DOMAIN
  if (!storeDomain) {
    console.error("Error: Shopify store domain required (--store or SHOPIFY_STORE_DOMAIN env)")
    process.exit(1)
  }

  const accessToken = getArg("--token") || process.env.SHOPIFY_ACCESS_TOKEN
  if (!accessToken) {
    console.error("Error: Shopify access token required (--token or SHOPIFY_ACCESS_TOKEN env)")
    process.exit(1)
  }

  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const from = getArg("--from") || formatDate(weekAgo)
  const to = getArg("--to") || formatDate(yesterday)

  const cogsRate = Number(getArg("--cogs-rate") || "0")
  if (cogsRate < 0 || cogsRate > 1) {
    console.error("Error: --cogs-rate must be between 0 and 1")
    process.exit(1)
  }

  return { clientId, storeDomain, accessToken, from, to, cogsRate }
}

// ── Shopify API ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return matches ? matches[1] : null
}

async function fetchWithRetry(url: string, headers: Record<string, string>, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers })

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") || "2")
      console.log(`  Rate limited, waiting ${retryAfter}s...`)
      await sleep(retryAfter * 1000)
      continue
    }

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Shopify API error ${res.status}: ${body}`)
    }

    return res
  }

  throw new Error("Shopify API: max retries exceeded (429)")
}

async function fetchAllOrders(
  storeDomain: string,
  accessToken: string,
  from: string,
  to: string,
): Promise<ShopifyOrder[]> {
  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  }

  const baseUrl = `https://${storeDomain}/admin/api/2024-01/orders.json`
  const params = new URLSearchParams({
    status: "any",
    financial_status: "paid,partially_refunded,refunded",
    created_at_min: `${from}T00:00:00Z`,
    created_at_max: `${to}T23:59:59Z`,
    limit: "250",
  })

  let url: string | null = `${baseUrl}?${params}`
  const allOrders: ShopifyOrder[] = []
  let page = 0

  while (url) {
    page++
    console.log(`  Fetching page ${page}...`)

    const res = await fetchWithRetry(url, headers)
    const data = await res.json()
    const orders: ShopifyOrder[] = data.orders || []
    allOrders.push(...orders)

    url = parseNextLink(res.headers.get("Link"))
    if (url) await sleep(500) // respect rate limits
  }

  console.log(`  Fetched ${allOrders.length} orders across ${page} page(s)`)
  return allOrders
}

// ── Aggregation ─────────────────────────────────────────────────────────

function getDateFromISO(isoStr: string): string {
  return isoStr.slice(0, 10)
}

function aggregateOrders(orders: ShopifyOrder[], cogsRate: number): DailyOrderAgg[] {
  const byDate: Record<string, DailyOrderAgg> = {}

  for (const order of orders) {
    const date = getDateFromISO(order.created_at)

    if (!byDate[date]) {
      byDate[date] = {
        date,
        orders: 0,
        gross_revenue: 0,
        discounts: 0,
        refunds: 0,
        net_revenue: 0,
        cogs: 0,
        shipping_costs: 0,
      }
    }

    const day = byDate[date]
    const grossRevenue = parseFloat(order.total_price) || 0
    const discounts = parseFloat(order.total_discounts) || 0

    let refundTotal = 0
    if (order.refunds) {
      for (const refund of order.refunds) {
        if (refund.transactions) {
          for (const txn of refund.transactions) {
            if (txn.kind === "refund") {
              refundTotal += parseFloat(txn.amount) || 0
            }
          }
        }
      }
    }

    let shippingCosts = 0
    if (order.shipping_lines) {
      for (const line of order.shipping_lines) {
        shippingCosts += parseFloat(line.price) || 0
      }
    }

    day.orders += 1
    day.gross_revenue += grossRevenue
    day.discounts += discounts
    day.refunds += refundTotal
    day.shipping_costs += shippingCosts
  }

  // Calculate net revenue and COGS per day
  for (const day of Object.values(byDate)) {
    day.net_revenue = day.gross_revenue - day.discounts - day.refunds
    day.cogs = day.gross_revenue * cogsRate

    // Round to 2 decimals
    day.gross_revenue = Math.round(day.gross_revenue * 100) / 100
    day.discounts = Math.round(day.discounts * 100) / 100
    day.refunds = Math.round(day.refunds * 100) / 100
    day.net_revenue = Math.round(day.net_revenue * 100) / 100
    day.cogs = Math.round(day.cogs * 100) / 100
    day.shipping_costs = Math.round(day.shipping_costs * 100) / 100
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

// ── UTM Extraction ──────────────────────────────────────────────────────

function extractUtm(order: ShopifyOrder): { source: string; medium: string } {
  // Try landing_site first (contains UTM params from the storefront visit)
  if (order.landing_site) {
    try {
      const url = new URL("https://placeholder" + order.landing_site)
      const source = url.searchParams.get("utm_source")
      const medium = url.searchParams.get("utm_medium")
      if (source) {
        return { source: source.toLowerCase(), medium: (medium || "").toLowerCase() }
      }
    } catch {
      // malformed URL, fall through
    }
  }

  // Fall back to referring_site
  if (order.referring_site) {
    try {
      const url = new URL(order.referring_site)
      return { source: url.hostname.replace("www.", ""), medium: "referral" }
    } catch {
      // malformed URL, fall through
    }
  }

  return { source: "direct", medium: "" }
}

function aggregateAttribution(orders: ShopifyOrder[]): DailyAttribution[] {
  const byKey: Record<string, DailyAttribution> = {}

  for (const order of orders) {
    const date = getDateFromISO(order.created_at)
    const { source, medium } = extractUtm(order)
    const key = `${date}|${source}|${medium}`

    if (!byKey[key]) {
      byKey[key] = { date, source, medium, orders: 0, revenue: 0 }
    }

    byKey[key].orders += 1
    byKey[key].revenue += parseFloat(order.total_price) || 0
  }

  // Round revenue
  for (const row of Object.values(byKey)) {
    row.revenue = Math.round(row.revenue * 100) / 100
  }

  return Object.values(byKey).sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source))
}

// ── Supabase Upsert ─────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>

async function upsertOrders(supabase: SupabaseClient, clientId: string, rows: DailyOrderAgg[]) {
  const payload = rows.map((r) => ({
    client_id: clientId,
    date: r.date,
    orders: r.orders,
    gross_revenue: r.gross_revenue,
    discounts: r.discounts,
    refunds: r.refunds,
    net_revenue: r.net_revenue,
    cogs: r.cogs,
    shipping_costs: r.shipping_costs,
  }))

  const { error } = await supabase
    .from("shopify_daily_orders")
    .upsert(payload, { onConflict: "client_id,date" })

  if (error) throw new Error(`Failed to upsert orders: ${error.message}`)
}

async function upsertAttribution(supabase: SupabaseClient, clientId: string, rows: DailyAttribution[]) {
  const payload = rows.map((r) => ({
    client_id: clientId,
    date: r.date,
    source: r.source,
    medium: r.medium,
    orders: r.orders,
    revenue: r.revenue,
  }))

  const { error } = await supabase
    .from("shopify_daily_attribution")
    .upsert(payload, { onConflict: "client_id,date,source,medium" })

  if (error) throw new Error(`Failed to upsert attribution: ${error.message}`)
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs()

  console.log(`\nShopify Sync`)
  console.log(`  Client:  ${config.clientId}`)
  console.log(`  Store:   ${config.storeDomain}`)
  console.log(`  Range:   ${config.from} → ${config.to}`)
  if (config.cogsRate > 0) {
    console.log(`  COGS:    ${(config.cogsRate * 100).toFixed(0)}% of gross revenue`)
  }
  console.log()

  // Validate Supabase env
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  // Verify client exists
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, shopify_store_domain")
    .eq("id", config.clientId)
    .single()

  if (clientError || !client) {
    console.error(`Error: Client ${config.clientId} not found`)
    process.exit(1)
  }

  console.log(`  Found client: ${client.name}`)
  if (client.shopify_store_domain && client.shopify_store_domain !== config.storeDomain) {
    console.log(`  Warning: store domain mismatch — DB has "${client.shopify_store_domain}", using "${config.storeDomain}"`)
  }

  // Fetch orders from Shopify
  console.log("\nFetching orders from Shopify...")
  const orders = await fetchAllOrders(config.storeDomain, config.accessToken, config.from, config.to)

  if (orders.length === 0) {
    console.log("\nNo orders found in date range. Nothing to sync.")
    process.exit(0)
  }

  // Aggregate
  console.log("\nAggregating...")
  const dailyOrders = aggregateOrders(orders, config.cogsRate)
  const attribution = aggregateAttribution(orders)

  console.log(`  ${dailyOrders.length} daily order rows`)
  console.log(`  ${attribution.length} attribution rows`)

  // Upsert to Supabase
  console.log("\nUpserting to Supabase...")
  await Promise.all([
    upsertOrders(supabase, config.clientId, dailyOrders),
    upsertAttribution(supabase, config.clientId, attribution),
  ])

  // Summary
  const totalOrders = dailyOrders.reduce((s, d) => s + d.orders, 0)
  const totalRevenue = dailyOrders.reduce((s, d) => s + d.net_revenue, 0)
  console.log(`\nDone! Synced ${totalOrders} orders, ${dailyOrders.length} days, net revenue: ${totalRevenue.toFixed(2)}`)
}

main().catch((err) => {
  console.error("\nSync failed:", err.message || err)
  process.exit(1)
})
