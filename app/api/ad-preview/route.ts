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

/** A cached HTML row is from the old format (raw iframe wrapper, blocked by
 *  X-Frame-Options) if it starts with `<iframe`. Those are unusable — treat
 *  them as a cache miss so we refetch and store the rendered inner HTML. */
function isLegacyCachedHtml(html: string): boolean {
  return /^\s*<iframe/i.test(html)
}

/**
 * GET /api/ad-preview?ad_id=<ad_id>&format=<MOBILE_FEED_STANDARD|...>
 *
 * Returns `{ html }` containing the fully-rendered ad HTML, ready to drop
 * into `<iframe srcDoc={html}>`. We do *two* fetches: first to Meta's
 * `/{id}/previews` (which returns a wrapper iframe pointing at
 * preview_iframe.php), then to that wrapper's src= URL to get the actual
 * rendered ad markup. The rendered HTML doesn't have X-Frame-Options, so
 * dropping it straight into srcDoc works. The wrapper would not.
 *
 * Strategy: try /{creative_id}/previews first (works for paused/archived
 * ads); if that errors or returns nothing, fall back to /{ad_id}/previews.
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

  // Only serve from cache when the cached row is in the new format (rendered
  // HTML, not the unusable wrapper iframe).
  const cacheUsable = cached?.html && !isLegacyCachedHtml(cached.html)

  if (cacheUsable && cached?.html && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    if (age < CACHE_TTL_MS) {
      return NextResponse.json({ html: cached.html, source: "cache" })
    }
  }

  const accessToken = process.env.META_ACCESS_TOKEN
  if (!accessToken) {
    if (cacheUsable && cached?.html) {
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

      const wrapper = parsed?.data?.[0]?.body as string | undefined
      if (!wrapper) {
        attempts.push({ via, id, status: graphRes.status, ok: true, message: "empty data array" })
        console.warn(`[ad-preview] ${via}=${id} format=${format} returned no preview body`)
        continue
      }

      // Extract the inner src= URL from Meta's <iframe ...> wrapper. The URL
      // points at facebook.com/ads/api/preview_iframe.php and contains the
      // access token in its query string.
      const innerUrl = extractIframeSrc(wrapper)
      if (!innerUrl) {
        attempts.push({ via, id, status: graphRes.status, ok: true, message: "wrapper had no src=" })
        console.warn(`[ad-preview] ${via}=${id} format=${format} wrapper without src`)
        continue
      }

      // Fetch the rendered ad HTML server-side. This bypasses Meta's
      // X-Frame-Options on the preview_iframe.php endpoint — the response
      // body is just static markup + fbcdn images/videos, which load fine
      // inside <iframe srcDoc>.
      const renderedRes = await fetch(innerUrl, {
        headers: { "User-Agent": "Mozilla/5.0 KIMA-Dashboard/2.0" },
        redirect: "follow",
      })
      if (!renderedRes.ok) {
        attempts.push({ via, id, status: renderedRes.status, ok: false, message: `inner fetch ${renderedRes.status}` })
        console.warn(`[ad-preview] ${via}=${id} inner fetch failed status=${renderedRes.status}`)
        continue
      }

      const renderedHtml = await renderedRes.text()
      if (!renderedHtml || renderedHtml.length < 50) {
        attempts.push({ via, id, status: renderedRes.status, ok: true, message: "inner empty" })
        continue
      }

      // Cache and return.
      supabase
        .from("meta_ad_creative_previews")
        .upsert({ ad_id: adId, format, html: renderedHtml, fetched_at: new Date().toISOString() })
        .then(() => {})

      return NextResponse.json({ html: renderedHtml, source: "fresh", via })
    } catch (e: any) {
      const message = e?.message || "fetch threw"
      attempts.push({ via, id, status: 0, ok: false, message })
      console.warn(`[ad-preview] ${via}=${id} format=${format} threw: ${message}`)
    }
  }

  // Every attempt failed. Fall back to a usable stale cache if we have one.
  if (cacheUsable && cached?.html) {
    return NextResponse.json({ html: cached.html, source: "stale-cache", attempts })
  }

  return NextResponse.json(
    { error: "preview unavailable", attempts, hint: "Common causes: token lacks ads_read on this ad account; ad format not supported by this creative; creative archived." },
    { status: 502 }
  )
}

/** Pull the src= URL out of `<iframe ... src="https://..." ...>`. Handles
 *  both single and double quotes, and HTML-entity-encoded `&amp;`. */
function extractIframeSrc(wrapper: string): string | null {
  const match = wrapper.match(/<iframe[^>]*\ssrc=(["'])(.+?)\1/i)
  if (!match) return null
  return match[2].replace(/&amp;/g, "&")
}
