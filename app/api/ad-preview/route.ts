import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

const META_GRAPH_URL = "https://graph.facebook.com/v21.0"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** What we ask Meta for in a single batched call. Nested expansion pulls page
 *  name + profile picture and carousel children without follow-up requests. */
const CREATIVE_FIELDS = [
  "id",
  "body",
  "title",
  "name",
  "call_to_action_type",
  "link_url",
  "image_url",
  "thumbnail_url",
  "video_id",
  "effective_object_story_id",
  // Note: `instagram_actor_id` was removed here — Meta deprecated it as part
  // of the v22.0 API changes and rejects requests for it pre-emptively on
  // v21.0 with `(#12) Old Instagram ID is deprecated`. We never used the
  // returned value, so dropping it is the simplest fix.
  "object_story_spec{page_id,link_data{message,name,description,link,caption,call_to_action,image_hash,picture,video_id,child_attachments{name,description,link,picture,image_hash,call_to_action,video_id}},video_data{title,message,call_to_action,image_hash,image_url,video_id,link_description},photo_data{url,caption,branded_content_shared_to_sponsor_status}}",
  // Advantage+ Shopping (ASC) and other dynamic creatives put the actual
  // media here instead of in object_story_spec.
  "asset_feed_spec{bodies{text},titles{text},descriptions{text},link_urls{website_url,display_url},images{hash,url},videos{video_id,thumbnail_hash,thumbnail_url},call_to_action_types,ad_formats}",
].join(",")

/** What the client gets back — structured, render-ready. */
export type AdCreativeData = {
  format: "single_image" | "single_video" | "carousel" | "unknown"
  page: { name: string | null; pictureUrl: string | null }
  body: string | null
  title: string | null
  description: string | null
  linkDomain: string | null
  linkUrl: string | null
  cta: { type: string | null; label: string | null }
  media: {
    type: "image" | "video"
    imageUrl: string | null
    videoUrl: string | null
    thumbnailUrl: string | null
  } | null
  children: Array<{
    imageUrl: string | null
    videoUrl: string | null
    thumbnailUrl: string | null
    title: string | null
    description: string | null
    linkUrl: string | null
    ctaLabel: string | null
  }>
}

type GraphAttempt = { via: string; id: string; status: number; ok: boolean; message?: string }

/**
 * GET /api/ad-preview?ad_id=<ad_id>
 *
 * Returns `{ data: AdCreativeData }` with structured creative fields pulled
 * from Meta's Marketing API. The frontend renders this with a custom card
 * component, sidestepping Meta's React-bootstrapped iframe entirely (which
 * never rendered in our sandboxed srcDoc).
 *
 * Cached as JSON in meta_ad_creative_previews (`html` column) keyed by
 * `(ad_id, "v3")` — the `format` query param doesn't change the data,
 * only how the client renders it. Old cache rows (iframe HTML, or
 * earlier-normalizer JSON missing asset_feed_spec data) are detected
 * and treated as a miss. Bump this key when changing normalizer output
 * to invalidate everything.
 *
 * The Meta access token never leaves the server.
 */
export async function GET(request: NextRequest) {
  const adId = request.nextUrl.searchParams.get("ad_id")
  const debug = request.nextUrl.searchParams.get("debug") === "1"

  if (!adId) {
    return NextResponse.json({ error: "ad_id required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Cache key is fixed per-ad (data is format-independent now).
  const cacheKey = "v5"
  const { data: cached } = await supabase
    .from("meta_ad_creative_previews")
    .select("html, fetched_at")
    .eq("ad_id", adId)
    .eq("format", cacheKey)
    .maybeSingle()

  if (cached?.html && cached.fetched_at) {
    const parsed = tryParseJson(cached.html)
    if (parsed) {
      const age = Date.now() - new Date(cached.fetched_at).getTime()
      if (age < CACHE_TTL_MS) {
        if (debug) return debugResponse(parsed)
        return NextResponse.json({ data: parsed, source: "cache" })
      }
    }
  }

  const accessToken = process.env.META_ACCESS_TOKEN
  if (!accessToken) {
    if (cached?.html) {
      const parsed = tryParseJson(cached.html)
      if (parsed) return NextResponse.json({ data: parsed, source: "stale-cache" })
    }
    return NextResponse.json({ error: "META_ACCESS_TOKEN not set" }, { status: 503 })
  }

  // Resolve creative_id (preferred — works for paused ads), then fall back
  // to ad_id with adcreatives expansion.
  const { data: metaRow } = await supabase
    .from("meta_ad_metadata")
    .select("creative_id")
    .eq("ad_id", adId)
    .maybeSingle()

  const attempts: GraphAttempt[] = []
  const candidates: Array<{ via: string; url: string }> = []
  if (metaRow?.creative_id) {
    candidates.push({
      via: "creative_id",
      url: `${META_GRAPH_URL}/${metaRow.creative_id}?fields=${encodeURIComponent(CREATIVE_FIELDS)}&access_token=${accessToken}`,
    })
  }
  candidates.push({
    via: "ad_id",
    url: `${META_GRAPH_URL}/${adId}?fields=${encodeURIComponent(`creative{${CREATIVE_FIELDS}}`)}&access_token=${accessToken}`,
  })

  for (const { via, url } of candidates) {
    try {
      const res = await fetch(url, { next: { revalidate: 0 } })
      const text = await res.text()
      let json: any = null
      try { json = JSON.parse(text) } catch { /* keep null */ }

      if (!res.ok) {
        const message = json?.error?.message || text.slice(0, 240)
        attempts.push({ via, id: via === "creative_id" ? metaRow!.creative_id! : adId, status: res.status, ok: false, message })
        console.warn(`[ad-preview] ${via} status=${res.status} msg=${message}`)
        continue
      }

      // For ad_id route we get { creative: {...} }; for creative_id route the
      // creative fields are at the root.
      const raw = via === "ad_id" ? json?.creative : json
      if (!raw || typeof raw !== "object") {
        attempts.push({ via, id: via === "creative_id" ? metaRow!.creative_id! : adId, status: res.status, ok: true, message: "no creative on response" })
        continue
      }

      // Page info needs a second small call — Meta doesn't return page name
      // via creative field expansion any more.
      const pageId: string | undefined = raw?.object_story_spec?.page_id
      const pageInfo = pageId ? await fetchPageInfo(pageId, accessToken) : { name: null, pictureUrl: null }

      // Video src URL needs resolving for any video_id we found.
      const videoIds = collectVideoIds(raw)
      const videoUrlMap = await fetchVideoSources(videoIds, accessToken)

      const data = normalizeCreative(raw, pageInfo, videoUrlMap)

      // Fire-and-forget cache write.
      supabase
        .from("meta_ad_creative_previews")
        .upsert({ ad_id: adId, format: cacheKey, html: JSON.stringify(data), fetched_at: new Date().toISOString() })
        .then(() => {})

      // Compact diagnostic so the client can console.log it. Tells us, in
      // one glance, which Meta fields were populated for this ad — useful
      // for figuring out why the normalizer fell through to media=null.
      const diag = {
        rawTopLevelKeys: Object.keys(raw).slice(0, 30),
        hasObjectStorySpec: !!raw?.object_story_spec,
        objectStorySpecKeys: raw?.object_story_spec ? Object.keys(raw.object_story_spec) : null,
        hasAssetFeedSpec: !!raw?.asset_feed_spec,
        assetFeedSpecKeys: raw?.asset_feed_spec ? Object.keys(raw.asset_feed_spec) : null,
        feedVideosCount: Array.isArray(raw?.asset_feed_spec?.videos) ? raw.asset_feed_spec.videos.length : null,
        feedImagesCount: Array.isArray(raw?.asset_feed_spec?.images) ? raw.asset_feed_spec.images.length : null,
        videoUrlMapKeys: Object.keys(videoUrlMap),
      }

      if (debug) return debugResponse(data, { raw, via, page: pageInfo, videoUrlMap, _diag: diag })
      return NextResponse.json({ data, source: "fresh", via, _diag: diag })
    } catch (e: any) {
      const message = e?.message || "fetch threw"
      attempts.push({ via, id: via === "creative_id" ? metaRow!.creative_id! : adId, status: 0, ok: false, message })
      console.warn(`[ad-preview] ${via} threw: ${message}`)
    }
  }

  // All attempts failed. Fall back to a usable stale cache if we have one.
  if (cached?.html) {
    const parsed = tryParseJson(cached.html)
    if (parsed) return NextResponse.json({ data: parsed, source: "stale-cache", attempts })
  }

  return NextResponse.json(
    { error: "preview unavailable", attempts, hint: "Token may lack ads_read on this ad account, the creative is archived, or the ad has no rendered creative." },
    { status: 502 }
  )
}

function tryParseJson(text: string): AdCreativeData | null {
  if (!text || typeof text !== "string") return null
  // Legacy rows from the iframe era stored HTML; refuse them.
  if (text.trimStart().startsWith("<")) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || !("format" in parsed)) return null
    // Reject entries that contain no usable data — better to re-fetch than
    // to keep serving a stuck "No media" placeholder. An entry with no
    // media, no children, AND format == "unknown" can't render anything,
    // so we treat it as a miss.
    const p = parsed as AdCreativeData
    if (p.format === "unknown" && !p.media && (!Array.isArray(p.children) || p.children.length === 0)) {
      return null
    }
    return p
  } catch {
    return null
  }
}

function debugResponse(
  data: AdCreativeData,
  extras?: { raw?: any; via?: string; page?: unknown; videoUrlMap?: Record<string, string>; _diag?: unknown }
) {
  // When `extras` is present, include the raw Meta response so operators
  // can see exactly what fields came back when the normalized output looks
  // wrong. Cache-hit debugs only have `data` to show.
  const payload = extras ? { data, ...extras } : data
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

/** Hit /{page_id}?fields=name,picture for the header chrome. Failures are
 *  non-fatal — we just render without page info — but log them so we know
 *  whether the issue is permissions, a wrong field name, or the page being
 *  unavailable. */
async function fetchPageInfo(pageId: string, token: string): Promise<{ name: string | null; pictureUrl: string | null }> {
  try {
    const res = await fetch(
      `${META_GRAPH_URL}/${pageId}?fields=name,picture.type(large)&access_token=${token}`,
      { next: { revalidate: 0 } }
    )
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* keep null */ }
    if (!res.ok) {
      console.warn(`[ad-preview] page ${pageId} lookup failed status=${res.status} msg=${json?.error?.message ?? text.slice(0, 200)}`)
      return { name: null, pictureUrl: null }
    }
    return {
      name: json?.name ?? null,
      pictureUrl: json?.picture?.data?.url ?? null,
    }
  } catch (e: any) {
    console.warn(`[ad-preview] page ${pageId} lookup threw: ${e?.message ?? "unknown"}`)
    return { name: null, pictureUrl: null }
  }
}

/** Resolve a batch of video_ids to source URLs via one /v.../?ids=... call.
 *
 *  `source` requires ads_management on most tokens; with only ads_read we
 *  get HTTP 400 with `(#100)` or per-id error objects. Logs the failure and
 *  returns whatever URLs did resolve. The renderer falls back to the
 *  thumbnail when no URL is available. */
async function fetchVideoSources(ids: string[], token: string): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  if (uniq.length === 0) return {}
  try {
    const res = await fetch(
      `${META_GRAPH_URL}/?ids=${uniq.join(",")}&fields=source,picture&access_token=${token}`,
      { next: { revalidate: 0 } }
    )
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* keep null */ }

    if (!res.ok) {
      console.warn(`[ad-preview] video sources batch failed status=${res.status} msg=${json?.error?.message ?? text.slice(0, 200)}`)
      return {}
    }
    const map: Record<string, string> = {}
    for (const id of uniq) {
      const entry = json?.[id]
      const src = entry?.source
      if (typeof src === "string") {
        map[id] = src
      } else if (entry?.error) {
        console.warn(`[ad-preview] video ${id} returned error: ${entry.error.message ?? "(no message)"}`)
      }
    }
    return map
  } catch (e: any) {
    console.warn(`[ad-preview] video sources threw: ${e?.message ?? "unknown"}`)
    return {}
  }
}

function collectVideoIds(raw: any): string[] {
  const ids: string[] = []
  const push = (v: any) => { if (typeof v === "string" && v.length > 0) ids.push(v) }
  push(raw?.video_id)
  push(raw?.object_story_spec?.video_data?.video_id)
  push(raw?.object_story_spec?.link_data?.video_id)
  const children = raw?.object_story_spec?.link_data?.child_attachments
  if (Array.isArray(children)) {
    for (const c of children) push(c?.video_id)
  }
  const feedVideos = raw?.asset_feed_spec?.videos
  if (Array.isArray(feedVideos)) {
    for (const v of feedVideos) push(v?.video_id)
  }
  return ids
}

/** Map Meta's raw fields onto our flat AdCreativeData shape. */
function normalizeCreative(
  raw: any,
  page: { name: string | null; pictureUrl: string | null },
  videoUrlMap: Record<string, string>
): AdCreativeData {
  const spec = raw?.object_story_spec ?? {}
  const linkData = spec?.link_data
  const videoData = spec?.video_data
  const photoData = spec?.photo_data
  const children: any[] = Array.isArray(linkData?.child_attachments) ? linkData.child_attachments : []

  // Advantage+ Shopping and other dynamic creatives put text + media inside
  // asset_feed_spec as parallel arrays. Take the first variant for preview.
  const feedSpec = raw?.asset_feed_spec
  const feedBody = pickArrayText(feedSpec?.bodies)
  const feedTitle = pickArrayText(feedSpec?.titles)
  const feedDescription = pickArrayText(feedSpec?.descriptions)
  const feedLinkUrl = feedSpec?.link_urls?.[0]?.website_url ?? null
  const feedDisplayUrl = feedSpec?.link_urls?.[0]?.display_url ?? null
  const feedFirstVideo = feedSpec?.videos?.[0]
  const feedFirstImage = feedSpec?.images?.[0]
  const feedCtaType = Array.isArray(feedSpec?.call_to_action_types) ? feedSpec.call_to_action_types[0] : null

  // Body — the long message above the media.
  const body = linkData?.message ?? videoData?.message ?? raw?.body ?? photoData?.caption ?? feedBody ?? null

  // Title — the headline beneath the media. NB: `raw.name` is the
  // AdCreative's internal Meta label (often a template like
  // `{{product.name}} <hash>`), never a user-facing headline. Excluded.
  const title = linkData?.name ?? videoData?.title ?? feedTitle ?? raw?.title ?? null

  const description = linkData?.description ?? videoData?.link_description ?? feedDescription ?? null
  const linkUrl = linkData?.link ?? raw?.link_url ?? feedLinkUrl ?? null
  const linkDomain = linkUrl
    ? extractDomain(linkUrl)
    : (feedDisplayUrl ? extractDomain(feedDisplayUrl) ?? feedDisplayUrl.toUpperCase() : (linkData?.caption ?? null))

  const ctaType =
    linkData?.call_to_action?.type ??
    videoData?.call_to_action?.type ??
    raw?.call_to_action_type ??
    feedCtaType ??
    null
  const cta = { type: ctaType, label: ctaLabel(ctaType) }

  // Media: prefer video over image. Detect carousel. Fall through to
  // asset_feed_spec when object_story_spec yields nothing.
  let format: AdCreativeData["format"] = "unknown"
  let media: AdCreativeData["media"] = null

  if (children.length > 1) {
    format = "carousel"
    media = null
  } else if (videoData?.video_id || raw?.video_id) {
    format = "single_video"
    const vid = videoData?.video_id ?? raw?.video_id
    media = {
      type: "video",
      videoUrl: vid ? videoUrlMap[vid] ?? null : null,
      thumbnailUrl: videoData?.image_url ?? raw?.thumbnail_url ?? raw?.image_url ?? null,
      imageUrl: null,
    }
  } else if (linkData?.picture || raw?.image_url || photoData?.url) {
    format = "single_image"
    media = {
      type: "image",
      imageUrl: linkData?.picture ?? raw?.image_url ?? photoData?.url ?? null,
      thumbnailUrl: raw?.thumbnail_url ?? null,
      videoUrl: null,
    }
  } else if (feedFirstVideo?.video_id) {
    format = "single_video"
    media = {
      type: "video",
      videoUrl: videoUrlMap[feedFirstVideo.video_id] ?? null,
      thumbnailUrl: feedFirstVideo?.thumbnail_url ?? null,
      imageUrl: null,
    }
  } else if (feedFirstImage?.url) {
    format = "single_image"
    media = {
      type: "image",
      imageUrl: feedFirstImage.url,
      thumbnailUrl: null,
      videoUrl: null,
    }
  }

  const normalizedChildren: AdCreativeData["children"] = children.map((c) => {
    const cVid = c?.video_id
    return {
      imageUrl: c?.picture ?? null,
      videoUrl: cVid ? videoUrlMap[cVid] ?? null : null,
      thumbnailUrl: c?.picture ?? null,
      title: c?.name ?? null,
      description: c?.description ?? null,
      linkUrl: c?.link ?? null,
      ctaLabel: ctaLabel(c?.call_to_action?.type ?? null),
    }
  })

  return {
    format,
    page,
    body,
    title,
    description,
    linkDomain,
    linkUrl,
    cta,
    media,
    children: normalizedChildren,
  }
}

/** asset_feed_spec text fields look like `[{text: "..."}]`; this just grabs
 *  the first non-empty entry. */
function pickArrayText(arr: any): string | null {
  if (!Array.isArray(arr)) return null
  for (const item of arr) {
    const text = item?.text
    if (typeof text === "string" && text.length > 0) return text
  }
  return null
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, "").toUpperCase()
  } catch {
    return null
  }
}

/** Friendly labels for Meta's CTA enum. Anything unrecognised falls through
 *  to "Learn more" — the platform default. */
function ctaLabel(type: string | null | undefined): string | null {
  if (!type) return null
  const map: Record<string, string> = {
    SHOP_NOW: "Shop Now",
    LEARN_MORE: "Learn More",
    SIGN_UP: "Sign Up",
    SUBSCRIBE: "Subscribe",
    DOWNLOAD: "Download",
    INSTALL_MOBILE_APP: "Install Now",
    USE_APP: "Use App",
    BOOK_NOW: "Book Now",
    BOOK_TRAVEL: "Book Now",
    GET_OFFER: "Get Offer",
    GET_QUOTE: "Get Quote",
    GET_SHOWTIMES: "Get Showtimes",
    CONTACT_US: "Contact Us",
    APPLY_NOW: "Apply Now",
    DONATE_NOW: "Donate",
    WATCH_MORE: "Watch More",
    LISTEN_NOW: "Listen Now",
    ORDER_NOW: "Order Now",
    SEE_MENU: "See Menu",
    PLAY_GAME: "Play Game",
    MESSAGE_PAGE: "Send Message",
    WHATSAPP_MESSAGE: "Send WhatsApp Message",
    INQUIRE_NOW: "Inquire Now",
    REQUEST_TIME: "Request Time",
    CALL_NOW: "Call Now",
    FIND_OUT_MORE: "Find Out More",
    GET_STARTED: "Get Started",
  }
  return map[type] ?? "Learn More"
}
