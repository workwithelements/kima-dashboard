"use client"

import { useEffect, useRef, useState } from "react"
import type { AdCreativeData } from "@/app/api/ad-preview/route"

export type AdPreviewFormat =
  | "MOBILE_FEED_STANDARD"
  | "INSTAGRAM_STANDARD"
  | "INSTAGRAM_STORY"
  | "INSTAGRAM_REELS"
  | "FACEBOOK_STORY_MOBILE"
  | "FACEBOOK_REELS_MOBILE"

type Props = {
  adId: string
  format: AdPreviewFormat
  fallbackThumbnailUrl?: string
  isVideo?: boolean
  /** Used to construct a "View on Meta" fallback link for video ads where
   *  the source URL can't be played inline. */
  metaAccountId?: string | null
  adName?: string | null
}

/**
 * Renders a Facebook/Instagram-style ad card from structured Meta creative
 * data fetched via /api/ad-preview. Drops Meta's React iframe entirely —
 * see the route doc for why.
 *
 * The same data renders in two chrome styles: feed (FB Feed / IG Feed) is
 * a square-ish card with header + body + media + footer; story/reels is a
 * full-height 9:16 frame with overlays on top of the media.
 */
export default function AdPreview({ adId, format, fallbackThumbnailUrl, isVideo, metaAccountId, adName }: Props) {
  const [data, setData] = useState<AdCreativeData | null>(null)
  const [errored, setErrored] = useState(false)
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const reqId = ++reqRef.current
    setData(null)
    setErrored(false)
    setErrorReason(null)

    // Format is purely a render-time concern — no need to refetch.
    fetch(`/api/ad-preview?ad_id=${encodeURIComponent(adId)}`)
      .then(async (res) => {
        if (reqId !== reqRef.current) return
        const payload = await res.json().catch(() => null)
        if (!res.ok) {
          setErrored(true)
          setErrorReason(summarizeAttempts(payload) || `HTTP ${res.status}`)
          console.warn("[AdPreview] failed", { adId, status: res.status, payload })
          return
        }
        if (payload?.data) {
          setData(payload.data as AdCreativeData)
          // Log the server-provided diagnostic so the team can inspect
          // which Meta fields were populated without a separate debug URL.
          if (payload?._diag) console.log("[AdPreview] _diag", { adId, ...payload._diag })
        } else {
          setErrored(true)
          setErrorReason("empty response")
        }
      })
      .catch((e) => {
        if (reqId !== reqRef.current) return
        setErrored(true)
        setErrorReason(e?.message || "network error")
      })
  }, [adId])

  const isStory = isStoryFormat(format)

  if (data) {
    // Where to send a user when they click the play button on a video ad
    // whose source URL we can't play inline. Priority: the post's own
    // permalink (best — opens the ad in context), else the same Ads
    // Manager search the modal header uses.
    const watchUrl =
      data.permalinkUrl ??
      (metaAccountId && adName
        ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAccountId}&search_value=${encodeURIComponent(adName)}`
        : `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`)
    return isStory
      ? <StoryCard data={data} format={format} watchUrl={watchUrl} />
      : <FeedCard data={data} format={format} watchUrl={watchUrl} />
  }

  // Loading or error — surface the thumbnail so the modal never looks broken.
  const aspect = isStory ? "aspect-[9/16]" : "aspect-[4/5]"
  return (
    <div className={`relative w-full ${aspect} bg-neutral-800 flex items-center justify-center overflow-hidden`}>
      {fallbackThumbnailUrl ? (
        <img
          src={fallbackThumbnailUrl}
          alt=""
          className="h-full w-full object-contain"
          loading="eager"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="px-6 text-center text-sm text-neutral-500">
          <div className="mb-1 text-neutral-600">
            {isVideo ? "🎬" : "🖼"} {errored ? "Preview unavailable" : "Loading preview…"}
          </div>
          {errored && errorReason && (
            <div className="text-[10px] leading-snug text-neutral-600">{errorReason}</div>
          )}
        </div>
      )}
      {errored && errorReason && fallbackThumbnailUrl && (
        <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/70 px-2 py-1 text-[10px] text-neutral-300 backdrop-blur-sm">
          {errorReason}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── Feed card (FB Feed / IG Feed) ────────────────── */

function FeedCard({ data, format, watchUrl }: { data: AdCreativeData; format: AdPreviewFormat; watchUrl: string }) {
  const isInstagram = format === "INSTAGRAM_STANDARD"
  return (
    <div className="bg-white text-neutral-900 text-[13px] leading-snug">
      <Header data={data} variant={isInstagram ? "instagram" : "facebook"} />
      {/* Instagram puts the body below the media (as a caption), Facebook
          puts it above the media. Render it in the right place per format. */}
      {!isInstagram && data.body && (
        <div className="px-3 pb-2.5 whitespace-pre-wrap text-[13px]">
          <ClampedText text={data.body} maxLines={4} />
        </div>
      )}
      <MediaArea data={data} format={format} watchUrl={watchUrl} />
      {!isInstagram && data.format !== "carousel" && (
        <Footer data={data} />
      )}
      {isInstagram && (
        <InstagramActions data={data} />
      )}
    </div>
  )
}

/* ───────────────────────── Story card (Story / Reels) ───────────────────── */

function StoryCard({ data, format, watchUrl }: { data: AdCreativeData; format: AdPreviewFormat; watchUrl: string }) {
  void format
  // 9:16 sized by height (not width) so the card fits cleanly inside the
  // modal — `w-full aspect-[9/16]` made height = width × 16/9 which
  // overshot the modal and forced the whole thing to scroll.
  //
  // For Story / Reels formats, Meta bakes the headline + body text into
  // the creative image itself. Overlaying our own text on top of that
  // duplicates the same copy — render the image fullbleed and only keep
  // the Sponsored chrome at the top and the CTA button at the bottom,
  // matching how real IG/FB Story ads look.
  const videoUrl = data.media?.videoUrl ?? null
  const imageUrl = data.media?.imageUrl ?? data.media?.thumbnailUrl ?? null
  const isVideoCard = data.format === "single_video" || data.media?.type === "video"
  return (
    <div className="relative mx-auto h-[60vh] max-h-[600px] aspect-[9/16] bg-black overflow-hidden text-white">
      <MediaFill data={data} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute inset-x-0 top-3 px-3 flex items-center gap-2">
        <Avatar url={data.page.pictureUrl} />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold truncate">{data.page.name ?? "Sponsored"}</div>
          <div className="text-[10px] text-white/80">Sponsored</div>
        </div>
      </div>
      {isVideoCard && !videoUrl && imageUrl && (
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 flex items-center justify-center group"
          title="Open on Meta to watch"
        >
          <div className="h-14 w-14 rounded-full bg-black/55 group-hover:bg-black/75 flex items-center justify-center backdrop-blur-sm transition">
            <svg className="h-7 w-7 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </a>
      )}
      {data.cta.label && (
        <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          <button
            className="w-full rounded-full bg-white text-black text-[13px] font-semibold py-2.5"
            type="button"
          >
            {data.cta.label}
          </button>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── Pieces ────────────────────────────────────────── */

function Header({ data, variant }: { data: AdCreativeData; variant: "facebook" | "instagram" }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-2">
      <Avatar url={data.page.pictureUrl} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-neutral-900 truncate">
          {data.page.name ?? "Sponsored"}
        </div>
        <div className="text-[11px] text-neutral-500">
          {variant === "facebook" ? "Sponsored · " : ""}
          <svg className="inline-block h-3 w-3 -mt-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>
      </div>
      <button type="button" aria-label="More" className="p-1 text-neutral-500">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
    </div>
  )
}

function MediaArea({ data, format, watchUrl }: { data: AdCreativeData; format: AdPreviewFormat; watchUrl: string }) {
  void format
  if (data.format === "carousel" && data.children.length > 0) {
    return <Carousel children={data.children} />
  }

  // Extract URLs defensively so we render something whenever there's ANY
  // image or video to show. Previously the renderer bailed to "No media"
  // even when `data.media.thumbnailUrl` was populated, because the type
  // check sat in front of the URL check.
  const videoUrl = data.media?.videoUrl ?? null
  const imageUrl = data.media?.imageUrl ?? data.media?.thumbnailUrl ?? null
  const isVideoCard = data.format === "single_video" || data.media?.type === "video"

  if (!videoUrl && !imageUrl) {
    return (
      <div className="aspect-[1.91/1] bg-neutral-200 flex items-center justify-center text-xs text-neutral-500">
        No media
      </div>
    )
  }

  return (
    <div className="relative w-full bg-neutral-100">
      {videoUrl ? (
        <video
          src={videoUrl}
          poster={data.media?.thumbnailUrl ?? undefined}
          muted
          autoPlay
          loop
          playsInline
          controls
          className="w-full h-auto block max-h-[60vh] object-contain bg-black"
        />
      ) : (
        <img
          src={imageUrl ?? ""}
          alt=""
          className="w-full h-auto block max-h-[60vh] object-contain bg-black"
          loading="eager"
          referrerPolicy="no-referrer"
        />
      )}
      {/* Video ad with no inline source — last-resort clickable play
          overlay that opens Meta in a new tab. With the preview-iframe
          scraper landed, hitting this branch means even that fallback
          path returned no URL (rare). */}
      {isVideoCard && !videoUrl && imageUrl && (
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 flex items-center justify-center group"
          title="Open on Meta to watch"
        >
          <div className="h-14 w-14 rounded-full bg-black/55 group-hover:bg-black/75 flex items-center justify-center backdrop-blur-sm transition">
            <svg className="h-7 w-7 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span className="absolute bottom-2 right-2 rounded bg-black/65 px-2 py-0.5 text-[10px] text-white">
            Watch on Meta ↗
          </span>
        </a>
      )}
    </div>
  )
}

function MediaFill({ data }: { data: AdCreativeData }) {
  if (data.format === "carousel" && data.children[0]) {
    const c = data.children[0]
    return c.videoUrl
      ? <video src={c.videoUrl} poster={c.thumbnailUrl ?? undefined} muted autoPlay loop playsInline className="absolute inset-0 w-full h-full object-cover" />
      : <img src={c.imageUrl ?? ""} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
  }
  if (data.media?.type === "video" && data.media.videoUrl) {
    return <video src={data.media.videoUrl} poster={data.media.thumbnailUrl ?? undefined} muted autoPlay loop playsInline className="absolute inset-0 w-full h-full object-cover" />
  }
  const img = data.media?.imageUrl ?? data.media?.thumbnailUrl
  if (img) return <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
  return <div className="absolute inset-0 bg-neutral-900" />
}

function Footer({ data }: { data: AdCreativeData }) {
  const hasFooter = data.linkDomain || data.title || data.description || data.cta.label
  if (!hasFooter) return null
  return (
    <div className="flex items-start gap-3 bg-neutral-100 px-3 py-2.5 border-t border-neutral-200">
      <div className="min-w-0 flex-1">
        {data.linkDomain && (
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 truncate">{data.linkDomain}</div>
        )}
        {data.title && (
          <div className="text-[14px] font-semibold text-neutral-900 leading-tight line-clamp-2 mt-0.5">
            {data.title}
          </div>
        )}
        {data.description && (
          <div className="text-[12px] text-neutral-600 line-clamp-2 mt-0.5">{data.description}</div>
        )}
      </div>
      {data.cta.label && (
        <button
          type="button"
          className="shrink-0 self-center rounded-md bg-neutral-200 hover:bg-neutral-300 px-3 py-1.5 text-[12px] font-semibold text-neutral-900"
        >
          {data.cta.label}
        </button>
      )}
    </div>
  )
}

function InstagramActions({ data }: { data: AdCreativeData }) {
  return (
    <div className="px-3 py-2 border-t border-neutral-100">
      <div className="flex items-center gap-4 mb-1.5 text-neutral-900">
        <HeartIcon />
        <CommentIcon />
        <ShareIcon />
        <BookmarkIcon className="ml-auto" />
      </div>
      {(data.page.name || data.body) && (
        <div className="text-[13px] leading-snug">
          {data.page.name && <span className="font-semibold mr-1.5">{data.page.name}</span>}
          {data.body && <ClampedText text={data.body} maxLines={2} />}
        </div>
      )}
      {data.cta.label && (
        <button
          type="button"
          className="mt-2 w-full rounded-md bg-[#0095F6] hover:bg-[#1877F2] text-white text-[13px] font-semibold py-2"
        >
          {data.cta.label}
        </button>
      )}
    </div>
  )
}

function Carousel({ children }: { children: AdCreativeData["children"] }) {
  const [idx, setIdx] = useState(0)
  const total = children.length
  if (total === 0) return null
  const card = children[Math.max(0, Math.min(idx, total - 1))]

  return (
    <div className="relative w-full bg-black">
      <div className="aspect-[1/1] relative overflow-hidden bg-neutral-900">
        {card.videoUrl ? (
          <video
            src={card.videoUrl}
            poster={card.thumbnailUrl ?? undefined}
            muted autoPlay loop playsInline controls
            className="absolute inset-0 w-full h-full object-cover"
            key={card.videoUrl}
          />
        ) : (
          <img
            src={card.imageUrl ?? card.thumbnailUrl ?? ""}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
      {card.title || card.ctaLabel || card.description ? (
        <div className="flex items-start gap-3 bg-neutral-100 px-3 py-2 border-t border-neutral-200">
          <div className="min-w-0 flex-1">
            {card.title && <div className="text-[13px] font-semibold text-neutral-900 line-clamp-2">{card.title}</div>}
            {card.description && <div className="text-[11px] text-neutral-600 line-clamp-1">{card.description}</div>}
          </div>
          {card.ctaLabel && (
            <button type="button" className="shrink-0 self-center rounded-md bg-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-900">
              {card.ctaLabel}
            </button>
          )}
        </div>
      ) : null}
      {total > 1 && (
        <>
          {idx > 0 && (
            <button
              type="button"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              aria-label="Previous"
              className="absolute left-2 top-1/3 -translate-y-1/2 h-8 w-8 rounded-full bg-white/95 shadow flex items-center justify-center"
            >
              <svg className="h-4 w-4 text-neutral-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {idx < total - 1 && (
            <button
              type="button"
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              aria-label="Next"
              className="absolute right-2 top-1/3 -translate-y-1/2 h-8 w-8 rounded-full bg-white/95 shadow flex items-center justify-center"
            >
              <svg className="h-4 w-4 text-neutral-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
          <div className="flex items-center justify-center gap-1.5 py-2 bg-white">
            {children.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === idx ? "bg-neutral-900" : "bg-neutral-300"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Avatar({ url }: { url: string | null }) {
  return (
    <div className="h-8 w-8 rounded-full bg-neutral-300 overflow-hidden shrink-0">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : null}
    </div>
  )
}

function ClampedText({ text, maxLines }: { text: string; maxLines: number }) {
  // Tailwind's `line-clamp-N` is set via class so it picks up at build time.
  const cls =
    maxLines === 2 ? "line-clamp-2" :
    maxLines === 3 ? "line-clamp-3" :
    maxLines === 4 ? "line-clamp-4" :
    maxLines === 5 ? "line-clamp-5" : ""
  return <span className={cls}>{text}</span>
}

function isStoryFormat(f: AdPreviewFormat): boolean {
  return f === "INSTAGRAM_STORY" || f === "INSTAGRAM_REELS" || f === "FACEBOOK_STORY_MOBILE" || f === "FACEBOOK_REELS_MOBILE"
}

function summarizeAttempts(data: any): string | null {
  if (!data) return null
  if (Array.isArray(data?.attempts) && data.attempts.length > 0) {
    const last = data.attempts[data.attempts.length - 1]
    if (last?.message) return `${last.via} ${last.status || ""}: ${last.message}`.trim()
  }
  if (typeof data?.error === "string") return data.error
  return null
}

/** Pick the most appropriate ad_format based on which placement received the
 *  most impressions. Falls back to mobile feed. */
export function pickDefaultFormat(
  placements: { ad_id: string; publisher_platform?: string; platform_position?: string; impressions?: number }[],
  adId: string
): AdPreviewFormat {
  let best: { format: AdPreviewFormat; impressions: number } | null = null
  for (const p of placements) {
    if (p.ad_id !== adId) continue
    const platform = (p.publisher_platform || "").toLowerCase()
    const position = (p.platform_position || "").toLowerCase()
    const impressions = p.impressions || 0

    let format: AdPreviewFormat = "MOBILE_FEED_STANDARD"
    if (platform === "instagram") {
      if (position === "story") format = "INSTAGRAM_STORY"
      else if (position === "reels" || position === "instagram_reels") format = "INSTAGRAM_REELS"
      else format = "INSTAGRAM_STANDARD"
    } else if (platform === "facebook") {
      if (position === "story" || position === "facebook_story") format = "FACEBOOK_STORY_MOBILE"
      else if (position === "facebook_reels" || position === "reels") format = "FACEBOOK_REELS_MOBILE"
      else format = "MOBILE_FEED_STANDARD"
    }
    if (!best || impressions > best.impressions) best = { format, impressions }
  }
  return best?.format ?? "MOBILE_FEED_STANDARD"
}

export const FORMAT_LABELS: { key: AdPreviewFormat; label: string }[] = [
  { key: "MOBILE_FEED_STANDARD", label: "FB Feed" },
  { key: "INSTAGRAM_STANDARD", label: "IG Feed" },
  { key: "INSTAGRAM_STORY", label: "IG Story" },
  { key: "INSTAGRAM_REELS", label: "IG Reels" },
  { key: "FACEBOOK_REELS_MOBILE", label: "FB Reels" },
]

/* Inline icons (no extra deps). */
function HeartIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  )
}
function CommentIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  )
}
function ShareIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}
function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg className={`h-6 w-6 ${className ?? ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
  )
}
