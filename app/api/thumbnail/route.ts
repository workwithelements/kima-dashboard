import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { isPreviewAuthorized } from "@/lib/auth/preview-auth"

const META_GRAPH_URL = "https://graph.facebook.com/v21.0"

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

  if (!(await isPreviewAuthorized(request, supabase))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Look up stored URL + creative_id (may be absent for unsynced ads)
  const { data: meta } = await supabase
    .from("meta_ad_metadata")
    .select("creative_thumbnail_url, creative_id")
    .eq("ad_id", adId)
    .maybeSingle()

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

  // If cached URL failed or was never synced, fetch fresh from Meta.
  // Resolve via the ad itself first — /{ad_id}?fields=creative{…} returns
  // the creative actually attached to this ad and can never cross ads,
  // whereas synced creative_ids have been observed pointing at the wrong
  // creative. The stored creative_id is only a fallback (deleted ads).
  if (!imageRes) {
    const accessToken = process.env.META_ACCESS_TOKEN
    if (accessToken) {
      try {
        const lookups: Array<{ id: string; fields: string }> = [
          { id: adId, fields: "creative{image_url,thumbnail_url}" },
          ...(meta?.creative_id
            ? [{ id: meta.creative_id, fields: "image_url,thumbnail_url" }]
            : []),
        ]
        let data: any = null
        for (const lookup of lookups) {
          const graphRes = await fetch(
            `${META_GRAPH_URL}/${lookup.id}?fields=${lookup.fields}&access_token=${accessToken}`,
            { next: { revalidate: 0 } }
          )
          if (graphRes.ok) {
            data = await graphRes.json()
            break
          }
        }
        if (data) {
          // Extract URL — nested creative object (ad_id path) or root
          // fields (creative_id path); prefer image_url (full-res) over
          // the ~64px thumbnail_url.
          const freshUrl =
            data.creative?.image_url ||
            data.image_url ||
            data.creative?.thumbnail_url ||
            data.thumbnail_url
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

  // Nothing resolvable — 404 so the client's onError placeholder renders
  if (!imageRes) {
    return NextResponse.json(
      { error: "no thumbnail available" },
      { status: 404, headers: { "Cache-Control": "public, max-age=300" } }
    )
  }

  // Stream the image back with caching
  const contentType = imageRes.headers.get("content-type") || "image/jpeg"
  const imageBuffer = await imageRes.arrayBuffer()

  return new NextResponse(imageBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Thumbnail-Source": imageRes.url.includes("fbcdn") ? "cached" : "refreshed",
    },
  })
}
