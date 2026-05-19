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

/**
 * GET /api/ad-preview?ad_id=<ad_id>&format=<MOBILE_FEED_STANDARD|...>
 *
 * Returns `{ html: string }` containing Meta's iframe blob for the requested
 * format, or `{ error }` on failure. The HTML is meant to be rendered with
 * <iframe srcDoc={html}> — that sidesteps Meta's X-Frame-Options header,
 * which blocks the preview URL from loading via <iframe src=...>.
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
    return NextResponse.json({ error: "preview unavailable" }, { status: 503 })
  }

  const { data: meta } = await supabase
    .from("meta_ad_metadata")
    .select("creative_id")
    .eq("ad_id", adId)
    .maybeSingle()

  // Prefer the creative_id endpoint — it works even for paused ads. Fall back
  // to the ad_id endpoint, which still returns previews for active ads.
  const fetchId = meta?.creative_id || adId

  try {
    const graphRes = await fetch(
      `${META_GRAPH_URL}/${fetchId}/previews?ad_format=${format}&access_token=${accessToken}`,
      { next: { revalidate: 0 } }
    )

    if (!graphRes.ok) {
      if (cached?.html) {
        return NextResponse.json({ html: cached.html, source: "stale-cache" })
      }
      return NextResponse.json({ error: "meta api error", status: graphRes.status }, { status: 502 })
    }

    const data = await graphRes.json()
    const html = data?.data?.[0]?.body as string | undefined
    if (!html) {
      if (cached?.html) {
        return NextResponse.json({ html: cached.html, source: "stale-cache" })
      }
      return NextResponse.json({ error: "empty preview" }, { status: 502 })
    }

    // Fire-and-forget upsert. If the cache write fails, the request still
    // succeeds — the user gets their preview either way.
    supabase
      .from("meta_ad_creative_previews")
      .upsert({ ad_id: adId, format, html, fetched_at: new Date().toISOString() })
      .then(() => {})

    return NextResponse.json({ html, source: "fresh" })
  } catch {
    if (cached?.html) {
      return NextResponse.json({ html: cached.html, source: "stale-cache" })
    }
    return NextResponse.json({ error: "fetch failed" }, { status: 502 })
  }
}
