import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

const META_GRAPH_URL = "https://graph.facebook.com/v21.0"

/** How long a cached preview is considered fresh. Meta creatives rarely
 *  change in-place — once an ad is approved, the rendering is stable. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Allowed ad_format values. Anything else gets rejected so we don't pass
 *  arbitrary strings through to the Graph API. */
const VALID_FORMATS = new Set([
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
  "INSTAGRAM_REELS",
  "FACEBOOK_STORY_MOBILE",
  "FACEBOOK_REELS_MOBILE",
])

type GraphAttempt = {
  via: "creative_id" | "ad_id"
  id: string
  status: number
  ok: boolean
  /** Meta's error message when not ok, or "empty data array" when ok-but-no-preview. */
  message?: string
}

/**
 * GET /api/ad-preview?ad_id=<ad_id>&format=<MOBILE_FEED_STANDARD|...>
 *
 * Returns `{ html: string }` containing Meta's iframe blob for the requested
 * format, or `{ error, attempts }` on failure. The HTML is meant to be rendered
 * with <iframe srcDoc={html}> — that sidesteps Meta's X-Frame-Options header,
 * which blocks the preview URL from loading via <iframe src=...>.
 *
 * Strategy: try /{creative_id}/previews first (works for paused/archived ads
 * too); if that errors or returns nothing, fall back to /{ad_id}/previews.
 *
 * Cached in meta_ad_creative_previews for CACHE_TTL_MS per (ad_id, format).
 * The access token is never sent to the browser.
 */
export async function GET(request: NextRequest) {
  const adId = request.nextUrl.searchParams.get("ad_id")
  const format = request.nextUrl.searchParams.get("format") || "MOBILE_FEED_STANDARD"

  if (!adId) {
    return NextResponse.json({ error: "ad_id required" }, { status: 400 })
  }
  if (!VALID_FORMATS.has(format)) {
    return NextResponse.json({ error: "invalid format" }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: cached } = await supabase
    .from("meta_ad_creative_previews")
    .select("html, fetched_at")
    .eq("ad_id", adId)
    .eq("format", format)
    .maybeSingle()

  if (cached?.html && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    if (age < CACHE_TTL_MS) {
      return NextResponse.json({ html: cached.html, source: "cache" })
    }
  }

  const accessToken = process.env.META_ACCESS_TOKEN
  if (!accessToken) {
    if (cached?.html) {
      return NextResponse.json({ html: cached.html, source: "stale-cache" })
    }
    return NextResponse.json({ error: "META_ACCESS_TOKEN not set" }, { status: 503 })
  }

  const { data: meta } = await supabase
    .from("meta_ad_metadata")
    .select("creative_id")
    .eq("ad_id", adId)
    .maybeSingle()

  const attempts: GraphAttempt[] = []

  // Try creative_id first (if known), then ad_id.
  const candidates: { via: "creative_id" | "ad_id"; id: string }[] = []
  if (meta?.creative_id) candidates.push({ via: "creative_id", id: meta.creative_id })
  candidates.push({ via: "ad_id", id: adId })

  for (const { via, id } of candidates) {
    try {
      const graphRes = await fetch(
        `${META_GRAPH_URL}/${id}/previews?ad_format=${format}&access_token=${accessToken}`,
        { next: { revalidate: 0 } }
      )
      const bodyText = await graphRes.text()
      let parsed: any = null
      try { parsed = JSON.parse(bodyText) } catch { /* keep null */ }

      if (!graphRes.ok) {
        const message = parsed?.error?.message || bodyText.slice(0, 240)
        attempts.push({ via, id, status: graphRes.status, ok: false, message })
        console.warn(`[ad-preview] ${via}=${id} format=${format} status=${graphRes.status} msg=${message}`)
        continue
      }

      const html = parsed?.data?.[0]?.body as string | undefined
      if (!html) {
        attempts.push({ via, id, status: graphRes.status, ok: true, message: "empty data array" })
        console.warn(`[ad-preview] ${via}=${id} format=${format} returned no preview body`)
        continue
      }

      // Success — cache and return.
      supabase
        .from("meta_ad_creative_previews")
        .upsert({ ad_id: adId, format, html, fetched_at: new Date().toISOString() })
        .then(() => {})

      return NextResponse.json({ html, source: "fresh", via })
    } catch (e: any) {
      const message = e?.message || "fetch threw"
      attempts.push({ via, id, status: 0, ok: false, message })
      console.warn(`[ad-preview] ${via}=${id} format=${format} threw: ${message}`)
    }
  }

  // Every attempt failed. Fall back to stale cache if we have one — even if
  // it's older than CACHE_TTL_MS, showing the previous render beats showing
  // nothing.
  if (cached?.html) {
    return NextResponse.json({ html: cached.html, source: "stale-cache", attempts })
  }

  return NextResponse.json(
    { error: "preview unavailable", attempts, hint: "Check Meta API error messages above. Common causes: token lacks ads_read on this ad account; ad format not supported by this creative; creative archived." },
    { status: 502 }
  )
}
