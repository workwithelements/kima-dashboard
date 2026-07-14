import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { isPreviewAuthorized } from "@/lib/auth/preview-auth"

const META_GRAPH_URL = "https://graph.facebook.com/v21.0"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** What we ask Meta for in a single batched call. Nested expansion pulls page
 *  name + profile picture and carousel children without follow-up requests. */
const CREATIVE_FIELDS = [
  "id",
  "account_id",
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
  /** facebook.com URL of the underlying organic post when available — used
   *  as a "View on Meta" fallback when we can't render the video inline. */
  permalinkUrl: string | null
  /** Facebook video plugin URL (facebook.com/plugins/video.php?…) for video
   *  ads, built from the creative's video_id. Embeds as an iframe and
   *  plays the video inline — works without ads_management scope and is
   *  designed for third-party embedding (no X-Frame-Options block). Null
   *  for image ads or when no video_id is present. */
  videoEmbedUrl: string | null
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

  // Exempted from the middleware's blanket API auth (like /api/thumbnail) so
  // previews load on public share pages — must authorise per request.
  if (!(await isPreviewAuthorized(request, supabase))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Cache key is fixed per-ad (data is format-independent now).
  // v12: creative resolution order flipped to ad_id-first — earlier rows may
  // hold a different ad's creative when meta_ad_metadata.creative_id was
  // miswritten by the sync, so all v11 entries are treated as misses.
  const cacheKey = "v12"
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

  // Resolve via the ad itself FIRST — /{ad_id}?fields=creative{…} returns
  // the creative actually attached to this ad, so it can never cross ads.
  // The stored creative_id is only a fallback (helps for deleted ads whose
  // ad node is gone): synced creative_ids have been observed pointing at
  // the wrong creative, which made every preview render the same ad.
  const { data: metaRow } = await supabase
    .from("meta_ad_metadata")
    .select("creative_id")
    .eq("ad_id", adId)
    .maybeSingle()

  const attempts: GraphAttempt[] = []
  const candidates: Array<{ via: string; url: string }> = [
    {
      via: "ad_id",
      url: `${META_GRAPH_URL}/${adId}?fields=${encodeURIComponent(`creative{${CREATIVE_FIELDS}}`)}&access_token=${accessToken}`,
    },
  ]
  if (metaRow?.creative_id) {
    candidates.push({
      via: "creative_id",
      url: `${META_GRAPH_URL}/${metaRow.creative_id}?fields=${encodeURIComponent(CREATIVE_FIELDS)}&access_token=${accessToken}`,
    })
  }

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

      // Four follow-up calls in parallel:
      //  - pageInfo: page name + avatar for header chrome
      //  - videoUrlMap: AdVideo source URLs (often blocked by ads_read scope)
      //  - postInfo: the underlying organic post via effective_object_story_id
      //    — gives us full_picture (high-res, vs. the ~64x64 thumbnail_url),
      //      source (post-level video URL, can succeed when AdVideo source
      //      fails), and permalink_url ("View on Meta" fallback)
      //  - imageHashMap: resolves image_hash values to full-res URLs via
      //    /act_{accountId}/adimages. Reliable backup when post fetch fails
      //    (often: token doesn't have pages_read_engagement).
      //  - inlineVideoUrl: scrapes the direct fbcdn .mp4 URL out of the
      //    /previews iframe response for video ads. Last-resort path when
      //    every cheaper API source for the video URL came back empty.
      const pageId: string | undefined = raw?.object_story_spec?.page_id
      const storyId: string | undefined = raw?.effective_object_story_id
      // For the ad_id path account_id sits on the ad envelope, not the
      // creative; for the creative_id path it's on the creative directly.
      const accountId: string | undefined =
        (via === "ad_id" ? json?.account_id : undefined) ?? raw?.account_id
      const videoIds = collectVideoIds(raw)
      const imageHashes = collectImageHashes(raw)
      const isVideoAd = videoIds.length > 0
      // Use whatever identifier we have here for the /previews call. The
      // endpoint works on both ad_ids and creative_ids; we already know
      // which one was successful for the main fetch.
      const previewResourceId = via === "ad_id" ? adId : (metaRow?.creative_id ?? adId)
      const [pageInfo, videoUrlMap, postInfo, imageHashMap, inlineVideoUrl] = await Promise.all([
        pageId ? fetchPageInfo(pageId, accessToken) : Promise.resolve({ name: null, pictureUrl: null }),
        fetchVideoSources(videoIds, accessToken),
        storyId ? fetchPostInfo(storyId, accessToken) : Promise.resolve({ fullPicture: null, videoSource: null, permalinkUrl: null }),
        accountId && imageHashes.length > 0 ? fetchImagesByHash(accountId, imageHashes, accessToken) : Promise.resolve({}),
        isVideoAd ? extractInlineVideoUrl(previewResourceId, accessToken) : Promise.resolve(null),
      ])

      // Roll the scraped URL into postInfo so normalizeCreative picks it
      // up via its existing postInfo.videoSource fallback. Cheaper than
      // adding another parameter.
      const enrichedPostInfo = {
        ...postInfo,
        videoSource: postInfo.videoSource ?? inlineVideoUrl,
      }

      const data = normalizeCreative(raw, pageInfo, videoUrlMap, enrichedPostInfo, imageHashMap)

      // Fire-and-forget cache write.
      supabase
        .from("meta_ad_creative_previews")
        .upsert({ ad_id: adId, format: cacheKey, html: JSON.stringify(data), fetched_at: new Date().toISOString() })
        .then(() => {})

      // Self-heal miswritten sync metadata: the ad_id path just told us the
      // creative that is REALLY attached to this ad, so repair a stale or
      // wrong stored creative_id/thumbnail (these also feed /api/thumbnail).
      const trueCreativeId: string | undefined = via === "ad_id" ? raw?.id : undefined
      if (trueCreativeId && metaRow && metaRow.creative_id !== trueCreativeId) {
        const healUrl = data.media?.imageUrl ?? data.media?.thumbnailUrl ?? data.children[0]?.imageUrl ?? null
        supabase
          .from("meta_ad_metadata")
          .update({
            creative_id: trueCreativeId,
            ...(healUrl ? { creative_thumbnail_url: healUrl } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("ad_id", adId)
          .then(() => {})
      }

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
        postFullPicture: !!postInfo.fullPicture,
        postVideoSource: !!postInfo.videoSource,
        postPermalink: !!postInfo.permalinkUrl,
        accountId: accountId ?? null,
        imageHashesCollected: imageHashes.length,
        imageHashesResolved: Object.keys(imageHashMap).length,
        inlineVideoUrlFound: !!inlineVideoUrl,
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

/** Resolve a batch of image_hash values to full-resolution URLs via
 *  /act_{accountId}/adimages?hashes=[...]. This is the v1 codebase's
 *  primary mechanism — works regardless of token scope on the underlying
 *  post (which often fails) because it queries the ad account directly. */
async function fetchImagesByHash(accountId: string, hashes: string[], token: string): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(hashes.filter(Boolean)))
  if (uniq.length === 0 || !accountId) return {}
  try {
    const url = `${META_GRAPH_URL}/act_${accountId}/adimages?hashes=${encodeURIComponent(JSON.stringify(uniq))}&fields=hash,url&access_token=${token}`
    const res = await fetch(url, { next: { revalidate: 0 } })
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* keep null */ }
    if (!res.ok) {
      console.warn(`[ad-preview] adimages lookup failed status=${res.status} msg=${json?.error?.message ?? text.slice(0, 200)}`)
      return {}
    }
    const map: Record<string, string> = {}
    if (Array.isArray(json?.data)) {
      for (const item of json.data) {
        if (item?.hash && typeof item?.url === "string") map[item.hash] = item.url
      }
    }
    return map
  } catch (e: any) {
    console.warn(`[ad-preview] adimages threw: ${e?.message ?? "unknown"}`)
    return {}
  }
}

/** Collect every image_hash value across the creative so a single
 *  /adimages batch call can resolve them all. */
function collectImageHashes(raw: any): string[] {
  const hashes: string[] = []
  const push = (v: any) => { if (typeof v === "string" && v.length > 0) hashes.push(v) }
  const links = raw?.object_story_spec?.link_data
  push(links?.image_hash)
  if (Array.isArray(links?.child_attachments)) {
    for (const c of links.child_attachments) push(c?.image_hash)
  }
  const feedImages = raw?.asset_feed_spec?.images
  if (Array.isArray(feedImages)) {
    for (const i of feedImages) push(i?.hash)
  }
  return hashes
}

/** Last-resort video URL extraction: hit Meta's `/previews` endpoint,
 *  follow the inner `preview_iframe.php` URL server-side, and regex out
 *  the direct fbcdn .mp4 URL embedded in the page's React payload.
 *
 *  The mp4 URLs are publicly accessible (signed query string but no
 *  auth header required) and play natively in <video src>. They have
 *  a short-ish expiry (~1-2 hours via `oe=`) but that's fine for a
 *  preview surface — we'll just refetch on the next cache miss.
 *
 *  Used only when the cheaper API paths (AdVideo.source, post.source,
 *  post.attachments.media.source) all came back null — which is the
 *  common case on tokens without ads_management scope. */
async function extractInlineVideoUrl(resourceId: string, token: string): Promise<string | null> {
  try {
    const previewsRes = await fetch(
      `${META_GRAPH_URL}/${resourceId}/previews?ad_format=MOBILE_FEED_STANDARD&access_token=${token}`,
      { next: { revalidate: 0 } }
    )
    if (!previewsRes.ok) {
      const t = await previewsRes.text()
      console.warn(`[ad-preview] previews fetch failed for ${resourceId} status=${previewsRes.status} body=${t.slice(0, 200)}`)
      return null
    }
    const previewsJson = await previewsRes.json().catch(() => null)
    const wrapper: string | undefined = previewsJson?.data?.[0]?.body
    if (!wrapper) {
      console.warn(`[ad-preview] previews response had no body for ${resourceId}`)
      return null
    }

    // Extract the inner preview_iframe.php URL from the iframe wrapper.
    const srcMatch = wrapper.match(/<iframe[^>]*\ssrc=(["'])(.+?)\1/i)
    if (!srcMatch) {
      console.warn(`[ad-preview] previews wrapper had no iframe src`)
      return null
    }
    const innerUrl = srcMatch[2].replace(/&amp;/g, "&")

    // Pull down the rendered page HTML.
    const innerRes = await fetch(innerUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KIMA-Dashboard)" },
    })
    if (!innerRes.ok) {
      console.warn(`[ad-preview] preview inner fetch failed status=${innerRes.status}`)
      return null
    }
    const innerHtml = await innerRes.text()

    // The mp4 URLs live inside a big JSON payload in a requireLazy(...)
    // script. Prefer HD; fall back to SD.
    const hd = innerHtml.match(/"videoURIHD"\s*:\s*"([^"]+)"/)
    const sd = innerHtml.match(/"videoURISD"\s*:\s*"([^"]+)"/)
    const escaped = hd?.[1] || sd?.[1]
    if (!escaped) {
      console.warn(`[ad-preview] preview HTML had no videoURI fields`)
      return null
    }
    // JSON-decode the URL (`\/` → `/`).
    return escaped.replace(/\\\//g, "/")
  } catch (e: any) {
    console.warn(`[ad-preview] preview video extraction threw: ${e?.message ?? "unknown"}`)
    return null
  }
}

/** Fetch the underlying organic post for an ad via its
 *  `effective_object_story_id` (format: `{page_id}_{post_id}`). Returns:
 *   - fullPicture: full-resolution image URL (vs. the ~64x64 thumbnail_url
 *     Meta returns on the creative directly)
 *   - videoSource: directly-playable .mp4 URL — for video ads this is
 *     usually only available via the post's `attachments.media.source`
 *     field, not the top-level `source` (which is often null on ad posts)
 *   - permalinkUrl: facebook.com URL to view the post; used as a "View on
 *     Meta" fallback when no inline video URL is available */
async function fetchPostInfo(storyId: string, token: string): Promise<{
  fullPicture: string | null
  videoSource: string | null
  permalinkUrl: string | null
}> {
  try {
    const res = await fetch(
      `${META_GRAPH_URL}/${storyId}?fields=full_picture,source,permalink_url,attachments{type,media{source,image{src}}}&access_token=${token}`,
      { next: { revalidate: 0 } }
    )
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* keep null */ }
    if (!res.ok) {
      console.warn(`[ad-preview] post ${storyId} lookup failed status=${res.status} msg=${json?.error?.message ?? text.slice(0, 200)}`)
      return { fullPicture: null, videoSource: null, permalinkUrl: null }
    }
    // Walk attachments for a playable source. For video ad posts Meta
    // typically returns the mp4 URL at attachments.data[0].media.source.
    const firstAttachment = json?.attachments?.data?.[0]
    const attachmentSource: unknown = firstAttachment?.media?.source
    const attachmentImage: unknown = firstAttachment?.media?.image?.src
    return {
      fullPicture:
        (typeof json?.full_picture === "string" ? json.full_picture : null) ??
        (typeof attachmentImage === "string" ? attachmentImage : null),
      videoSource:
        (typeof json?.source === "string" ? json.source : null) ??
        (typeof attachmentSource === "string" ? attachmentSource : null),
      permalinkUrl: typeof json?.permalink_url === "string" ? json.permalink_url : null,
    }
  } catch (e: any) {
    console.warn(`[ad-preview] post ${storyId} lookup threw: ${e?.message ?? "unknown"}`)
    return { fullPicture: null, videoSource: null, permalinkUrl: null }
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
  videoUrlMap: Record<string, string>,
  postInfo: { fullPicture: string | null; videoSource: string | null; permalinkUrl: string | null },
  imageHashMap: Record<string, string>
): AdCreativeData {
  /** Resolve an image_hash to a full-res URL via the batched /adimages call. */
  const fromHash = (h: string | null | undefined): string | null =>
    (typeof h === "string" && h.length > 0 && imageHashMap[h]) || null
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
      // Prefer the post-level video source (`postInfo.videoSource`) when
      // the AdVideo `source` field is blocked by token scope.
      videoUrl: (vid ? videoUrlMap[vid] : null) ?? postInfo.videoSource ?? null,
      thumbnailUrl: postInfo.fullPicture ?? videoData?.image_url ?? raw?.thumbnail_url ?? raw?.image_url ?? null,
      imageUrl: null,
    }
  } else if (linkData?.picture || raw?.image_url || photoData?.url || fromHash(linkData?.image_hash)) {
    format = "single_image"
    media = {
      type: "image",
      imageUrl: postInfo.fullPicture ?? fromHash(linkData?.image_hash) ?? linkData?.picture ?? raw?.image_url ?? photoData?.url ?? null,
      thumbnailUrl: raw?.thumbnail_url ?? null,
      videoUrl: null,
    }
  } else if (feedFirstVideo?.video_id) {
    format = "single_video"
    media = {
      type: "video",
      videoUrl: videoUrlMap[feedFirstVideo.video_id] ?? postInfo.videoSource ?? null,
      thumbnailUrl: postInfo.fullPicture ?? feedFirstVideo?.thumbnail_url ?? null,
      imageUrl: null,
    }
  } else if (feedFirstImage?.url || postInfo.fullPicture || fromHash(feedFirstImage?.hash)) {
    format = "single_image"
    media = {
      type: "image",
      imageUrl: postInfo.fullPicture ?? fromHash(feedFirstImage?.hash) ?? feedFirstImage?.url ?? null,
      thumbnailUrl: null,
      videoUrl: null,
    }
  }

  // Final fallback: walk the proven v1 priority chain to recover an image
  // URL the branches above didn't find. ASC image creatives in particular
  // tend to put `image_hash` (not `url`) in asset_feed_spec.images, so the
  // `feedFirstImage?.url` branch falls through, but raw.thumbnail_url is
  // still populated. Without this fallback those ads show "No media".
  // Hash resolution via /act_{id}/adimages is a future improvement;
  // thumbnail_url is enough for most preview surfaces.
  if (format === "unknown") {
    const fallback = postInfo.fullPicture ?? pickBestImageUrl(raw, imageHashMap)
    if (fallback) {
      format = "single_image"
      media = {
        type: "image",
        imageUrl: fallback,
        thumbnailUrl: fallback,
        videoUrl: null,
      }
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

  // Pick the first video_id we can find anywhere on the creative. Used
  // to build a Facebook video plugin embed URL when we don't have a
  // direct .mp4 to drop into <video>.
  const embedVideoId: string | null =
    raw?.video_id ??
    raw?.object_story_spec?.video_data?.video_id ??
    raw?.object_story_spec?.link_data?.video_id ??
    raw?.asset_feed_spec?.videos?.[0]?.video_id ??
    null
  const videoEmbedUrl = embedVideoId
    ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(`https://www.facebook.com/watch/?v=${embedVideoId}`)}&show_text=false&autoplay=true&mute=true`
    : null

  return {
    format,
    page,
    body,
    title,
    description,
    linkDomain,
    linkUrl,
    cta,
    permalinkUrl: postInfo.permalinkUrl,
    videoEmbedUrl,
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

/** Walk the priority chain proven in the v1 codebase to recover a usable
 *  image URL from anywhere on the creative. Covers all the spots Meta
 *  hides imagery: video posters, link/photo/carousel objects, dynamic
 *  creative arrays, and the top-level thumbnail_url. Returns null only
 *  when every path comes back empty — typically when imagery is only
 *  available as `image_hash` values that need a /adimages lookup. */
function pickBestImageUrl(raw: any, imageHashMap: Record<string, string>): string | null {
  const spec = raw?.object_story_spec
  const links = spec?.link_data
  const photo = spec?.photo_data
  const video = spec?.video_data
  const feed = raw?.asset_feed_spec
  const fromHash = (h: any): string | null =>
    (typeof h === "string" && h.length > 0 && imageHashMap[h]) || null
  return (
    video?.image_url ||
    links?.picture ||
    links?.image_url ||
    fromHash(links?.image_hash) ||
    links?.child_attachments?.[0]?.picture ||
    links?.child_attachments?.[0]?.image_url ||
    fromHash(links?.child_attachments?.[0]?.image_hash) ||
    photo?.url ||
    photo?.images?.[0]?.url ||
    feed?.images?.[0]?.url ||
    fromHash(feed?.images?.[0]?.hash) ||
    feed?.videos?.[0]?.thumbnail_url ||
    raw?.image_url ||
    raw?.thumbnail_url ||
    null
  )
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
