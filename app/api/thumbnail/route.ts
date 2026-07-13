export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const META_GRAPH_URL = "https://graph.facebook.com/v21.0"

/**
 * Middleware exempts this route from the blanket API auth check so creative
 * previews also load on public share pages — it must authorise requests
 * itself: either a logged-in admin session, or a valid password-gated
 * share-view session (kima_view_<slug> cookie).
 */
async function isAuthorized(
  request: NextRequest,
  supabase: ReturnType<typeof createServiceClient>
): Promise<boolean> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (user) return true

  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.startsWith("kima_view_") || !cookie.value) continue
    const slug = cookie.name.slice("kima_view_".length)
    const { data: session } = await supabase
      .from("view_sessions")
      .select("expires_at")
      .eq("token", cookie.value)
      .eq("slug", slug)
      .single()
    if (session && new Date(session.expires_at) > new Date()) return true
  }
  return false
}

/**
 * GET /api/thumbnail?ad_id=<ad_id>
 *
 * Server-side thumbnail proxy that solves two problems:
 * 1. Meta CDN URLs expire after ~24 hours (403 Forbidden)
 * 2. CSP / referrer policy blocks direct browser loading
 *
 * Flow:
 *   - Look up cached URL + creative_id from meta_ad_metadata
 *   - Try cached URL first (fast path)
 *   - If expired/missing, fetch a fresh URL from the Meta Graph API — via
 *     creative_id when known, otherwise via the ad_id (works even for ads
 *     with no metadata row yet)
 *   - Update cached URL in DB for next time
 *   - Pipe image bytes back to browser with proper cache headers
 *
 * Returns 404 when no image can be resolved so <img onError> fallbacks
 * ("No preview") render instead of an invisible placeholder.
 */
export async function GET(request: NextRequest) {
  const adId = request.nextUrl.searchParams.get("ad_id")
  if (!adId) {
    return NextResponse.json({ error: "ad_id required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (!(await isAuthorized(request, supabase))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Look up stored URL + creative_id (may be absent for unsynced ads)
  const { data: meta } = await supabase
    .from("meta_ad_metadata")
    .select("creative_thumbnail_url, creative_id")
    .eq("ad_id", adId)
    .single()

  // Try cached URL first
  let imageRes: Response | null = null

  if (meta?.creative_thumbnail_url) {
    try {
      imageRes = await fetch(meta.creative_thumbnail_url, {
        headers: { "User-Agent": "KIMA-Dashboard/2.0" },
        redirect: "follow",
      })
      if (!imageRes.ok) imageRes = null
    } catch {
      imageRes = null
    }
  }

  // If cached URL failed or was never synced, fetch fresh from Meta
  if (!imageRes) {
    const accessToken = process.env.META_ACCESS_TOKEN
    if (accessToken) {
      try {
        // Try creative_id first, fall back to ad_id
        const fetchId = meta?.creative_id || adId
        const fields = meta?.creative_id
          ? "image_url,thumbnail_url"
          : "creative{image_url,thumbnail_url}"
        const graphRes = await fetch(
          `${META_GRAPH_URL}/${fetchId}?fields=${fields}&access_token=${accessToken}`,
          { next: { revalidate: 0 } }
        )
        if (graphRes.ok) {
          const data = await graphRes.json()
          // Extract URL — from creative_id query or from ad → creative nested object
          const freshUrl =
            data.image_url ||
            data.thumbnail_url ||
            data.creative?.image_url ||
            data.creative?.thumbnail_url
          if (freshUrl) {
            // Update the cached URL in DB (fire-and-forget; only when a
            // metadata row exists to update)
            if (meta) {
              supabase
                .from("meta_ad_metadata")
                .update({ creative_thumbnail_url: freshUrl, updated_at: new Date().toISOString() })
                .eq("ad_id", adId)
                .then(() => {})
            }

            // Fetch the fresh image
            imageRes = await fetch(freshUrl, {
              headers: { "User-Agent": "KIMA-Dashboard/2.0" },
              redirect: "follow",
            })
            if (!imageRes.ok) imageRes = null
          }
        }
      } catch {
        // Meta API call failed — fall through to 404
      }
    }
  }

  // Caching must be `private` (browser-only, keyed per full URL): Netlify's
  // CDN ignores query strings in its cache key unless told otherwise, so a
  // `public` response for one ad_id gets served for EVERY ad_id (all previews
  // show the same image) — and a shared cache would also hand auth-gated
  // thumbnails to unauthenticated visitors. Netlify-Vary is belt-and-braces
  // for any layer that does shared-cache the response.
  const VARY_HEADERS = { "Netlify-Vary": "query=ad_id", Vary: "Cookie" }

  // Nothing resolvable — 404 so the client's onError placeholder renders
  if (!imageRes) {
    return NextResponse.json(
      { error: "no thumbnail available" },
      {
        status: 404,
        headers: { "Cache-Control": "private, max-age=300", ...VARY_HEADERS },
      }
    )
  }

  // Stream the image back with caching
  const contentType = imageRes.headers.get("content-type") || "image/jpeg"
  const imageBuffer = await imageRes.arrayBuffer()

  return new NextResponse(imageBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
      ...VARY_HEADERS,
      "X-Thumbnail-Source": imageRes.url.includes("fbcdn") ? "cached" : "refreshed",
    },
  })
}
