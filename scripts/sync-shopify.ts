/**
 * Shopify Sync Script — thin CLI wrapper around lib/integrations/shopify-sync.
 *
 * Usage:
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid>
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid> --from 2024-03-01 --to 2024-03-31
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid> --store my-store.myshopify.com --token shpat_xxx
 *   npx tsx scripts/sync-shopify.ts --client-id <uuid> --cogs-rate 0.35
 *
 * If --store / --cogs-rate are omitted, the script reads
 * shopify_store_domain / shopify_cogs_rate from the client row.
 *
 * Env vars (can be overridden via CLI flags):
 *   SHOPIFY_STORE_DOMAIN
 *   SHOPIFY_ACCESS_TOKEN
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"
import { syncShopifyForClient } from "../lib/integrations/shopify-sync"

function printUsage(): never {
  console.log(`
Shopify Sync Script — fetch orders and sync to Supabase.

Usage:
  npx tsx scripts/sync-shopify.ts --client-id <uuid> [options]

Required:
  --client-id <uuid>    Supabase client ID to sync for

Options:
  --from <YYYY-MM-DD>   Start date (default: 7 days ago)
  --to <YYYY-MM-DD>     End date (default: yesterday)
  --store <domain>      Override clients.shopify_store_domain
  --token <token>       Override SHOPIFY_ACCESS_TOKEN env
  --cogs-rate <0-1>     Override clients.shopify_cogs_rate
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

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) printUsage()

  const clientId = getArg("--client-id")
  if (!clientId) {
    console.error("Error: --client-id is required")
    printUsage()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  // Look up the client to default store domain + cogs rate.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, shopify_store_domain, shopify_cogs_rate")
    .eq("id", clientId)
    .single()

  if (clientError || !client) {
    console.error(`Error: Client ${clientId} not found`)
    process.exit(1)
  }

  const storeDomain =
    getArg("--store") || process.env.SHOPIFY_STORE_DOMAIN || (client.shopify_store_domain as string | null) || ""
  if (!storeDomain) {
    console.error(
      "Error: Shopify store domain required (--store, SHOPIFY_STORE_DOMAIN env, or clients.shopify_store_domain)",
    )
    process.exit(1)
  }

  const accessToken = getArg("--token") || process.env.SHOPIFY_ACCESS_TOKEN
  if (!accessToken) {
    console.error("Error: Shopify access token required (--token or SHOPIFY_ACCESS_TOKEN env)")
    process.exit(1)
  }

  const cliCogs = getArg("--cogs-rate")
  const cogsRate = cliCogs !== undefined
    ? Number(cliCogs)
    : Number(client.shopify_cogs_rate ?? 0)
  if (isNaN(cogsRate) || cogsRate < 0 || cogsRate > 1) {
    console.error("Error: cogs rate must be between 0 and 1")
    process.exit(1)
  }

  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const from = getArg("--from") || formatDate(weekAgo)
  const to = getArg("--to") || formatDate(yesterday)

  console.log(`\nShopify Sync`)
  console.log(`  Client:  ${client.name} (${clientId})`)
  console.log(`  Store:   ${storeDomain}`)
  console.log(`  Range:   ${from} → ${to}`)
  console.log(`  COGS:    ${(cogsRate * 100).toFixed(0)}% of gross revenue`)
  if (
    client.shopify_store_domain &&
    client.shopify_store_domain !== storeDomain
  ) {
    console.log(
      `  Warning: store domain mismatch — DB has "${client.shopify_store_domain}", using "${storeDomain}"`,
    )
  }
  console.log()

  console.log("Fetching + aggregating + upserting...")
  const result = await syncShopifyForClient(supabase, {
    clientId,
    storeDomain,
    accessToken,
    from,
    to,
    cogsRate,
    log: (m) => console.log(m),
  })

  if (result.ordersFetched === 0) {
    console.log("\nNo orders found in date range. Nothing to sync.")
    return
  }

  console.log(
    `\nDone! Synced ${result.ordersFetched} orders across ${result.daysSynced} days, ` +
      `net revenue: ${result.totalNetRevenue.toFixed(2)}`,
  )
}

main().catch((err) => {
  console.error("\nSync failed:", err.message || err)
  process.exit(1)
})
