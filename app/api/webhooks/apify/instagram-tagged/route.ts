import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

/**
 * Apify webhook endpoint. Apify calls this URL when a scheduled
 * `apify/instagram-scraper` run finishes. This handler fetches the run's
 * dataset, then upserts rows into instagram_tagged_posts and appends to
 * instagram_post_snapshots.
 *
 * Apify Task setup (see repo README section "Organic Social"):
 *   - Webhook URL: https://<your-site>/api/webhooks/apify/instagram-tagged
 *                    ?client_id=<supabase-uuid>&secret=<APIFY_WEBHOOK_SECRET>
 *   - Event: ACTOR.RUN.SUCCEEDED
 *   - Payload template: (default is fine — we read `resource.defaultDatasetId`)
 *
 * Required env vars:
 *   APIFY_TOKEN            — used to fetch the dataset items
 *   APIFY_WEBHOOK_SECRET   — shared secret that Apify includes in the URL
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

// Always server-rendered; never cache.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type ApifyPost = {
  url?: string
  shortCode?: string
  type?: string
  productType?: string
  caption?: string | null
  timestamp?: string
  likesCount?: number | null
  commentsCount?: number | null
  videoViewCount?: number | null
  videoPlayCount?: number | null
  ownerUsername?: string
  ownerFullName?: string | null
  displayUrl?: string
  hashtags?: string[]
  mentions?: string[]
}

type ApifyWebhookPayload = {
  eventType?: string
  eventData?: { actorRunId?: string }
  resource?: {
    id?: string
    defaultDatasetId?: string
    status?: string
  }
}

export async function POST(request: NextRequest) {
  // ─── Verify shared secret ──────────────────────────────────────────
  const providedSecret =
    request.nextUrl.searchParams.get("secret") ||
    request.headers.get("x-apify-webhook-secret")
  const expectedSecret = process.env.APIFY_WEBHOOK_SECRET

  if (!expectedSecret) {
    console.error("[apify-webhook] APIFY_WEBHOOK_SECRET not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const clientId = request.nextUrl.searchParams.get("client_id")
  if (!clientId) {
    return NextResponse.json({ error: "Missing client_id query param" }, { status: 400 })
  }

  const apifyToken = process.env.APIFY_TOKEN
  if (!apifyToken) {
    console.error("[apify-webhook] APIFY_TOKEN not configured")
    return NextResponse.json({ error: "Apify token not configured" }, { status: 500 })
  }

  // ─── Parse webhook payload ─────────────────────────────────────────
  let payload: ApifyWebhookPayload
  try {
    payload = (await request.json()) as ApifyWebhookPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Only act on successful runs. Other statuses (FAILED, ABORTED, …) are
  // acknowledged so Apify doesn't retry, but produce no writes.
  if (payload.resource?.status && payload.resource.status !== "SUCCEEDED") {
    return NextResponse.json({ skipped: true, reason: `status=${payload.resource.status}` })
  }

  const datasetId = payload.resource?.defaultDatasetId
  if (!datasetId) {
    return NextResponse.json(
      { error: "Payload missing resource.defaultDatasetId" },
      { status: 400 },
    )
  }

  // ─── Fetch dataset items ───────────────────────────────────────────
  const items = await fetchDataset(datasetId, apifyToken)
  if (items.length === 0) {
    return NextResponse.json({ inserted: 0, note: "dataset empty" })
  }

  const runId = payload.eventData?.actorRunId || payload.resource?.id || null

  const postRows = items
    .map((p) => toTaggedPostRow(clientId, runId, p))
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (postRows.length === 0) {
    return NextResponse.json({ inserted: 0, note: "no valid posts in dataset" })
  }

  const snapshotRows = postRows.map((r) => ({
    client_id: r.client_id,
    post_url: r.post_url,
    scraped_at: r.last_scraped_at,
    like_count: r.like_count,
    comment_count: r.comment_count,
    video_view_count: r.video_view_count,
    play_count: r.play_count,
  }))

  // ─── Upsert ────────────────────────────────────────────────────────
  const db = createServiceClient()
  const batchSize = 500

  for (let i = 0; i < postRows.length; i += batchSize) {
    const { error } = await db
      .from("instagram_tagged_posts")
      .upsert(postRows.slice(i, i + batchSize), { onConflict: "client_id,post_url" })
    if (error) {
      console.error("[apify-webhook] tagged_posts upsert failed:", error.message)
      return NextResponse.json({ error: "Database write failed" }, { status: 500 })
    }
  }
  for (let i = 0; i < snapshotRows.length; i += batchSize) {
    const { error } = await db
      .from("instagram_post_snapshots")
      .upsert(snapshotRows.slice(i, i + batchSize), {
        onConflict: "client_id,post_url,scraped_at",
      })
    if (error) {
      console.error("[apify-webhook] snapshots upsert failed:", error.message)
      return NextResponse.json({ error: "Database write failed" }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    posts: postRows.length,
    snapshots: snapshotRows.length,
    run_id: runId,
  })
}

/** Paginated Apify dataset fetch. Public datasets still work without a token, but we always send one. */
async function fetchDataset(datasetId: string, token: string): Promise<ApifyPost[]> {
  const all: ApifyPost[] = []
  const pageSize = 1000
  let offset = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url =
      `https://api.apify.com/v2/datasets/${datasetId}/items` +
      `?clean=true&format=json&offset=${offset}&limit=${pageSize}` +
      `&token=${encodeURIComponent(token)}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Apify dataset fetch ${res.status}: ${body.slice(0, 300)}`)
    }
    const batch = (await res.json()) as ApifyPost[]
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < pageSize) break
    offset += pageSize
  }
  return all
}

function toTaggedPostRow(clientId: string, runId: string | null, p: ApifyPost) {
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
    apify_run_id: runId,
    raw: p,
    last_scraped_at: new Date().toISOString(),
  }
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

function isoWeekMonday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay() || 7
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1))
  return x.toISOString().slice(0, 10)
}
