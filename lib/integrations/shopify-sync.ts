/**
 * Shopify sync core — shared between the CLI script (scripts/sync-shopify.ts)
 * and the daily cron route (/api/cron/shopify-sync).
 *
 * Fetches orders from the Shopify Admin REST API, aggregates them into daily
 * order + UTM-attribution rows, then upserts to Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

// ── Public types ────────────────────────────────────────────────────────

export type ShopifySyncInput = {
  clientId: string
  storeDomain: string
  accessToken: string
  from: string          // YYYY-MM-DD
  to: string            // YYYY-MM-DD
  cogsRate: number      // 0-1
  log?: (msg: string) => void
}

export type ShopifySyncResult = {
  clientId: string
  from: string
  to: string
  ordersFetched: number
  daysSynced: number
  attributionRowsSynced: number
  totalNetRevenue: number
}

// ── Internal types ──────────────────────────────────────────────────────

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

// ── Shopify REST API ────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return matches ? matches[1] : null
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  log: (m: string) => void,
  retries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers })

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") || "2")
      log(`  Rate limited, waiting ${retryAfter}s...`)
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
  log: (m: string) => void,
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
    log(`  Fetching page ${page}...`)
    const res = await fetchWithRetry(url, headers, log)
    const data = await res.json()
    const orders: ShopifyOrder[] = data.orders || []
    allOrders.push(...orders)

    url = parseNextLink(res.headers.get("Link"))
    if (url) await sleep(500)
  }

  log(`  Fetched ${allOrders.length} orders across ${page} page(s)`)
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

  for (const day of Object.values(byDate)) {
    day.net_revenue = day.gross_revenue - day.discounts - day.refunds
    day.cogs = day.gross_revenue * cogsRate

    day.gross_revenue = Math.round(day.gross_revenue * 100) / 100
    day.discounts = Math.round(day.discounts * 100) / 100
    day.refunds = Math.round(day.refunds * 100) / 100
    day.net_revenue = Math.round(day.net_revenue * 100) / 100
    day.cogs = Math.round(day.cogs * 100) / 100
    day.shipping_costs = Math.round(day.shipping_costs * 100) / 100
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

function extractUtm(order: ShopifyOrder): { source: string; medium: string } {
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

  for (const row of Object.values(byKey)) {
    row.revenue = Math.round(row.revenue * 100) / 100
  }

  return Object.values(byKey).sort(
    (a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source),
  )
}

// ── Supabase upsert ─────────────────────────────────────────────────────

async function upsertOrders(
  supabase: SupabaseClient,
  clientId: string,
  rows: DailyOrderAgg[],
) {
  const payload = rows.map((r) => ({ client_id: clientId, ...r }))
  const { error } = await supabase
    .from("shopify_daily_orders")
    .upsert(payload, { onConflict: "client_id,date" })
  if (error) throw new Error(`Failed to upsert orders: ${error.message}`)
}

async function upsertAttribution(
  supabase: SupabaseClient,
  clientId: string,
  rows: DailyAttribution[],
) {
  const payload = rows.map((r) => ({ client_id: clientId, ...r }))
  const { error } = await supabase
    .from("shopify_daily_attribution")
    .upsert(payload, { onConflict: "client_id,date,source,medium" })
  if (error) throw new Error(`Failed to upsert attribution: ${error.message}`)
}

// ── Public entry point ──────────────────────────────────────────────────

/**
 * Run a full Shopify sync for one client. Fetches all orders in the date
 * range, aggregates daily + per-UTM, and upserts to Supabase. Idempotent
 * within the date range — re-running overwrites existing rows.
 */
export async function syncShopifyForClient(
  supabase: SupabaseClient,
  input: ShopifySyncInput,
): Promise<ShopifySyncResult> {
  const log = input.log ?? (() => {})

  const orders = await fetchAllOrders(
    input.storeDomain,
    input.accessToken,
    input.from,
    input.to,
    log,
  )

  if (orders.length === 0) {
    return {
      clientId: input.clientId,
      from: input.from,
      to: input.to,
      ordersFetched: 0,
      daysSynced: 0,
      attributionRowsSynced: 0,
      totalNetRevenue: 0,
    }
  }

  const dailyOrders = aggregateOrders(orders, input.cogsRate)
  const attribution = aggregateAttribution(orders)

  await Promise.all([
    upsertOrders(supabase, input.clientId, dailyOrders),
    upsertAttribution(supabase, input.clientId, attribution),
  ])

  return {
    clientId: input.clientId,
    from: input.from,
    to: input.to,
    ordersFetched: orders.length,
    daysSynced: dailyOrders.length,
    attributionRowsSynced: attribution.length,
    totalNetRevenue: dailyOrders.reduce((s, d) => s + d.net_revenue, 0),
  }
}
