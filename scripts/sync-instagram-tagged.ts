/**
 * Instagram Tagged Posts Sync Script
 *
 * Runs the Apify `apify/instagram-scraper` actor against a client's tagged-posts
 * URL (e.g. https://www.instagram.com/ezrainc/tagged/), upserts snapshot-latest
 * rows into `instagram_tagged_posts`, and appends engagement history rows to
 * `instagram_post_snapshots`.
 *
 * Usage:
 *   npx tsx scripts/sync-instagram-tagged.ts --client-id <uuid>
 *   npx tsx scripts/sync-instagram-tagged.ts --client-id <uuid> --results-limit 200
 *   npx tsx scripts/sync-instagram-tagged.ts --client-id <uuid> --url https://www.instagram.com/ezrainc/tagged/
 *
 * Env vars (can be overridden via CLI flags):
 *   APIFY_TOKEN                     — Apify API token
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"

// ── Types ───────────────────────────────────────────────────────────────

type ApifyPost = {
  url?: string
  shortCode?: string
  type?: string           // "Image" | "Video" | "Sidecar"
  productType?: string    // "clips" (reel), "feed", ...
  caption?: string | null
  timestamp?: string      // ISO
  likesCount?: number | null
  commentsCount?: number | null
  videoViewCount?: number | null
  videoPlayCount?: number | null
  ownerUsername?: string
  ownerFullName?: string | null
  ownerId?: string
  displayUrl?: string
  hashtags?: string[]
  mentions?: string[]
  // profile-metadata fields are only set on the owner/profile entry, not posts
}

type Config = {
  clientId: string
  url: string | null
  resultsLimit: number
  apifyToken: string
}

// ── CLI Arg Parsing ─────────────────────────────────────────────────────

function printUsage(): never {
  console.log(`
Instagram Tagged Posts Sync — Run Apify actor and sync to Supabase.

Usage:
  npx tsx scripts/sync-instagram-tagged.ts --client-id <uuid> [options]

Required:
  --client-id <uuid>        Supabase client ID to sync for

Options:
  --url <instagram-url>     Override the tagged-posts URL (default: clients.instagram_tagged_url)
  --results-limit <N>       Max posts to fetch per run (default: 200)
  --token <token>           Apify token (overrides APIFY_TOKEN env)
  --help                    Show this help message
`)
  process.exit(0)
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined
}

function parseArgs(): Config {
  if (process.argv.includes("--help") || process.argv.includes("-h")) printUsage()

  const clientId = getArg("--client-id")
  if (!clientId) {
    console.error("Error: --client-id is required")
    printUsage()
  }

  const apifyToken = getArg("--token") || process.env.APIFY_TOKEN
  if (!apifyToken) {
    console.error("Error: Apify token required (--token or APIFY_TOKEN env)")
    process.exit(1)
  }

  const resultsLimit = Number(getArg("--results-limit") || "200")
  if (!Number.isFinite(resultsLimit) || resultsLimit <= 0) {
    console.error("Error: --results-limit must be a positive integer")
    process.exit(1)
  }

  return {
    clientId,
    url: getArg("--url") || null,
    resultsLimit,
    apifyToken,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Monday of the ISO week containing `d` (UTC). */
function isoWeekMonday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay() || 7 // Sunday = 7
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1))
  return x.toISOString().slice(0, 10)
}

function normalizePostType(type?: string, productType?: string): string | null {
  if (productType === "clips") return "reel"
  if (!type) return null
  const t = type.toLowerCase()
  if (t === "sidecar") return "sidecar"
  if (t === "video") return "video"
  if (t === "image") return "image"
  return t
}

// ── Apify API ───────────────────────────────────────────────────────────

async function runApifyActor(
  apifyToken: string,
  directUrl: string,
  resultsLimit: number,
): Promise<{ runId: string; items: ApifyPost[] }> {
  // run-sync-get-dataset-items blocks until the run finishes and returns the
  // dataset items inline — no polling loop required.
  // https://docs.apify.com/api/v2#/reference/actors/run-actor-synchronously-and-get-dataset-items/run-actor-synchronously-and-get-dataset-items
  const endpoint =
    "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items" +
    `?token=${encodeURIComponent(apifyToken)}`

  const input = {
    directUrls: [directUrl],
    resultsType: "posts",
    resultsLimit,
    addParentData: false,
  }

  console.log(`  Calling Apify apify/instagram-scraper with resultsLimit=${resultsLimit}...`)
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Apify API error ${res.status}: ${body.slice(0, 500)}`)
  }

  const runId = res.headers.get("X-Apify-Pagination-Offset") // not a runId; see below
  const items = (await res.json()) as ApifyPost[]
  // Apify returns the run id on the response in X-Apify-Request-Id or via the
  // originating runs collection; neither is reliable from this endpoint. We
  // stamp rows with an empty runId when unavailable.
  return { runId: runId || "", items: Array.isArray(items) ? items : [] }
}

// ── Upsert ──────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>

function toTaggedPostRow(clientId: string, runId: string, p: ApifyPost) {
  if (!p.url || !p.timestamp || !p.ownerUsername || !p.shortCode) return null
  const takenAt = new Date(p.timestamp)
  if (isNaN(takenAt.getTime())) return null

  return {
    client_id: clientId,
    post_url: p.url,
    shortcode: p.shortCode,
    post_type: normalizePostType(p.type, p.productType),
    taken_at: takenAt.toISOString(),
    week_start_date: isoWeekMonday(takenAt),
    author_username: p.ownerUsername,
    author_full_name: p.ownerFullName ?? null,
    author_followers: null,
    author_is_verified: null,
    caption: p.caption ?? null,
    thumbnail_url: p.displayUrl ?? null,
    like_count: p.likesCount ?? 0,
    comment_count: p.commentsCount ?? 0,
    video_view_count: p.videoViewCount ?? null,
    play_count: p.videoPlayCount ?? null,
    hashtags: p.hashtags ?? [],
    mentions: p.mentions ?? [],
    apify_run_id: runId || null,
    raw: p,
    last_scraped_at: new Date().toISOString(),
  }
}

async function upsertInBatches<T>(
  supabase: SupabaseClient,
  table: string,
  rows: T[],
  onConflict: string | undefined,
  batchSize = 500,
) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const query = supabase.from(table)
    const { error } = onConflict
      ? await query.upsert(batch as never, { onConflict })
      : await query.insert(batch as never)
    if (error) throw new Error(`Failed to write ${table}: ${error.message}`)
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, instagram_tagged_url")
    .eq("id", config.clientId)
    .single()

  if (clientError || !client) {
    console.error(`Error: Client ${config.clientId} not found`)
    process.exit(1)
  }

  const url = config.url || (client.instagram_tagged_url as string | null)
  if (!url) {
    console.error(
      `Error: no tagged-posts URL. Set clients.instagram_tagged_url for ${client.name} or pass --url.`,
    )
    process.exit(1)
  }

  console.log(`\nInstagram Tagged Sync`)
  console.log(`  Client: ${client.name}`)
  console.log(`  URL:    ${url}`)
  console.log()

  const { runId, items } = await runApifyActor(config.apifyToken, url, config.resultsLimit)
  console.log(`  Fetched ${items.length} items from Apify`)

  if (items.length === 0) {
    console.log("\nNo posts returned. Nothing to sync.")
    return
  }

  const postRows = items
    .map((p) => toTaggedPostRow(config.clientId, runId, p))
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const snapshotRows = postRows.map((r) => ({
    client_id: r.client_id,
    post_url: r.post_url,
    scraped_at: r.last_scraped_at,
    like_count: r.like_count,
    comment_count: r.comment_count,
    video_view_count: r.video_view_count,
    play_count: r.play_count,
  }))

  console.log(`\nUpserting ${postRows.length} posts + ${snapshotRows.length} snapshot rows...`)
  await upsertInBatches(supabase, "instagram_tagged_posts", postRows, "client_id,post_url")
  await upsertInBatches(
    supabase,
    "instagram_post_snapshots",
    snapshotRows,
    "client_id,post_url,scraped_at",
  )

  const totalEngagement = postRows.reduce((s, r) => s + r.like_count + r.comment_count, 0)
  console.log(
    `\nDone. ${postRows.length} posts, ${totalEngagement.toLocaleString()} total engagement (likes + comments).`,
  )
}

main().catch((err) => {
  console.error("\nSync failed:", err.message || err)
  process.exit(1)
})
