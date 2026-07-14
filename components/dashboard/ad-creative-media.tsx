"use client"

import { useEffect, useRef, useState } from "react"
import { useAdCreative } from "@/components/dashboard/ad-preview"
import type { AdCreativeData } from "@/app/api/ad-preview/route"

type Props = {
  adId: string
  /** Hint from performance data (video_plays > 0) shown while loading/erroring. */
  isVideoHint?: boolean
  /** Aspect-ratio class for the media box, e.g. "aspect-video" | "aspect-[4/5]". */
  aspectClass?: string
  className?: string
  /** Defer fetching until the element scrolls into view — use for grids that
   *  mount many cells at once. Hover cards should fetch immediately. */
  lazy?: boolean
  /** "autoplay" (hover cards): videos play muted+looped.
   *  "poster" (grids): videos show their real first frame + play glyph —
   *  dozens of simultaneously autoplaying videos would be heavy. */
  videoMode?: "autoplay" | "poster"
}

/**
 * Guaranteed-correct creative media: full-res image / video for exactly the
 * given adId, resolved through /api/ad-preview (ad_id → creative — cannot
 * cross ads).
 *
 * Deliberately shows a neutral skeleton while loading instead of the synced
 * `creative_thumbnail_url`: those stored thumbnails are ~64px (blurry when
 * enlarged) and have been observed pointing at the wrong creative entirely.
 */
export default function AdCreativeMedia({
  adId,
  isVideoHint,
  aspectClass = "aspect-video",
  className = "",
  lazy = false,
  videoMode = "autoplay",
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(!lazy)
  const [fallbackErrored, setFallbackErrored] = useState(false)

  // All call sites key this component by adId, but reset defensively anyway
  useEffect(() => setFallbackErrored(false), [adId])

  useEffect(() => {
    if (!lazy || inView) return
    const el = boxRef.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: "200px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lazy, inView])

  const { data, errored, errorReason } = useAdCreative(adId, inView)

  return (
    <div ref={boxRef} className={`relative overflow-hidden bg-neutral-800 ${aspectClass} ${className}`}>
      {data ? (
        <Media data={data} videoMode={videoMode} />
      ) : errored ? (
        // Degraded mode: /api/ad-preview failed (e.g. META_ACCESS_TOKEN not
        // configured, Meta rate limit, archived creative). Fall back to the
        // stored-thumbnail proxy, which can serve without a Meta token —
        // lower quality but far better than an empty box.
        fallbackErrored ? (
          <div
            className="absolute inset-0 flex items-center justify-center text-xs text-neutral-600"
            title={errorReason ?? undefined}
          >
            {isVideoHint ? "🎬" : "🖼"} No preview
          </div>
        ) : (
          <>
            <img
              src={`/api/thumbnail?ad_id=${encodeURIComponent(adId)}`}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setFallbackErrored(true)}
              title={errorReason ? `Preview degraded: ${errorReason}` : undefined}
            />
            {isVideoHint && <PlayGlyph />}
          </>
        )
      ) : (
        <div className="absolute inset-0 animate-pulse bg-neutral-800">
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-600">
            Loading preview…
          </div>
        </div>
      )}
    </div>
  )
}

function Media({ data, videoMode }: { data: AdCreativeData; videoMode: "autoplay" | "poster" }) {
  // Carousel — first card, with a count badge so it reads as a carousel.
  if (data.format === "carousel" && data.children.length > 0) {
    const c = data.children[0]
    return (
      <>
        <MediaEl
          videoUrl={c.videoUrl}
          imageUrl={c.imageUrl ?? c.thumbnailUrl}
          posterUrl={c.thumbnailUrl}
          videoEmbedUrl={null}
          videoMode={videoMode}
        />
        <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          1/{data.children.length}
        </span>
      </>
    )
  }

  const isVideo = data.format === "single_video" || data.media?.type === "video"
  return (
    <MediaEl
      videoUrl={data.media?.videoUrl ?? null}
      // Prefer imageUrl (full-res) over thumbnailUrl (~64px) so the card is
      // never blurry when a full-res source exists.
      imageUrl={data.media?.imageUrl ?? data.media?.thumbnailUrl ?? null}
      posterUrl={data.media?.thumbnailUrl ?? null}
      videoEmbedUrl={isVideo ? data.videoEmbedUrl : null}
      showPlayGlyph={isVideo}
      videoMode={videoMode}
    />
  )
}

function MediaEl({
  videoUrl,
  imageUrl,
  posterUrl,
  videoEmbedUrl,
  showPlayGlyph,
  videoMode,
}: {
  videoUrl: string | null
  imageUrl: string | null
  posterUrl: string | null
  videoEmbedUrl: string | null
  showPlayGlyph?: boolean
  videoMode: "autoplay" | "poster"
}) {
  if (videoUrl) {
    if (videoMode === "poster") {
      // Real first frame at full resolution, no playback — the surrounding
      // card's click-through (detail modal) is where the video plays.
      return (
        <>
          <video
            src={videoUrl}
            poster={posterUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <PlayGlyph />
        </>
      )
    }
    return (
      <video
        src={videoUrl}
        poster={posterUrl ?? undefined}
        muted
        autoPlay
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      />
    )
  }
  // Video ad without a directly playable source — Meta's video plugin embeds
  // fine in an iframe and autoplays muted, so the hover still shows motion.
  // In poster mode fall through to the image branch instead (an embedded
  // player inside a click-through grid card would swallow clicks).
  if (videoEmbedUrl && videoMode === "autoplay") {
    const sep = videoEmbedUrl.includes("?") ? "&" : "?"
    return (
      <iframe
        src={`${videoEmbedUrl}${sep}autoplay=1&mute=1`}
        className="absolute inset-0 h-full w-full border-0"
        allow="autoplay; encrypted-media"
        scrolling="no"
        title="Ad video preview"
      />
    )
  }
  if (imageUrl) {
    return (
      <>
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          referrerPolicy="no-referrer"
        />
        {showPlayGlyph && <PlayGlyph />}
      </>
    )
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-600">
      No media
    </div>
  )
}

function PlayGlyph() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
        <svg className="ml-0.5 h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
    </div>
  )
}
