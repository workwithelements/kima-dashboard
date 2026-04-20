import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

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
 *   - If 403/expired AND creative_id exists, fetch fresh URL from Meta Graph API
 *   - Update cached URL in DB for next time
 *   - Pipe image bytes back to browser with proper cache headers
 */
export async function GET(request: NextRequest) {
  const adId = request.nextUrl.searchParams.get("ad_id")
  if (!adId) {
    return NextResponse.json({ error: "ad_id required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Look up stored URL + creative_id
  const { data: meta } = await supabase
    .from("meta_ad_metadata")
    .select("creative_thumbnail_url, creative_id")
    .eq("ad_id", adId)
    .single()

  if (!meta) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  // Try cached URL first
  let imageUrl = meta.creative_thumbnail_url
  let imageRes: Response | null = null

  if (imageUrl) {
    try {
      imageRes = await fetch(imageUrl, {
        headers: { "User-Agent": "KIMA-Dashboard/2.0" },
        redirect: "follow",
      })
      if (!imageRes.ok) imageRes = null
    } catch {
      imageRes = null
    }
  }

  // If cached URL failed and we have a creative_id, fetch fresh from Meta
  if (!imageRes) {
    const accessToken = process.env.META_ACCESS_TOKEN
    if (accessToken) {
      try {
        // Try creative_id first, fall back to ad_id
        const fetchId = meta.creative_id || adId
        const fields = meta.creative_id
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
            // Update the cached URL in DB (fire-and-forget)
            supabase
              .from("meta_ad_metadata")
              .update({ creative_thumbnail_url: freshUrl, updated_at: new Date().toISOString() })
              .eq("ad_id", adId)
              .then(() => {})

            // Fetch the fresh image
            imageRes = await fetch(freshUrl, {
              headers: { "User-Agent": "KIMA-Dashboard/2.0" },
              redirect: "follow",
            })
            if (!imageRes.ok) imageRes = null
          }
        }
      } catch {
        // Meta API call failed — fall through to placeholder
      }
    }
  }

  // If we still don't have an image, return a transparent placeholder
  if (!imageRes) {
    // 1x1 transparent PNG
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    )
    return new NextResponse(pixel, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60",
      },
    })
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
