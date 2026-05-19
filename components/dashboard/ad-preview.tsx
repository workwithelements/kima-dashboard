"use client"

import { useEffect, useRef, useState } from "react"

export type AdPreviewFormat =
  | "MOBILE_FEED_STANDARD"
  | "INSTAGRAM_STANDARD"
  | "INSTAGRAM_STORY"
  | "INSTAGRAM_REELS"
  | "FACEBOOK_STORY_MOBILE"
  | "FACEBOOK_REELS_MOBILE"

/** Aspect ratio per format — feed is roughly 4:5, story/reels are 9:16. */
const FORMAT_ASPECT: Record<AdPreviewFormat, string> = {
  MOBILE_FEED_STANDARD: "aspect-[4/5]",
  INSTAGRAM_STANDARD: "aspect-[4/5]",
  INSTAGRAM_STORY: "aspect-[9/16]",
  INSTAGRAM_REELS: "aspect-[9/16]",
  FACEBOOK_STORY_MOBILE: "aspect-[9/16]",
  FACEBOOK_REELS_MOBILE: "aspect-[9/16]",
}

type Props = {
  adId: string
  format: AdPreviewFormat
  /** Shown while loading and if the preview fails to fetch. */
  fallbackThumbnailUrl?: string
  isVideo?: boolean
}

export default function AdPreview({ adId, format, fallbackThumbnailUrl, isVideo }: Props) {
  const [html, setHtml] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)
  const [thumbErrored, setThumbErrored] = useState(false)
  const reqRef = useRef(0)

  useEffect(() => {
    const reqId = ++reqRef.current
    setHtml(null)
    setErrored(false)

    fetch(`/api/ad-preview?ad_id=${encodeURIComponent(adId)}&format=${format}`)
      .then(async (res) => {
        if (reqId !== reqRef.current) return
        if (!res.ok) {
          setErrored(true)
          return
        }
        const data = await res.json()
        if (reqId !== reqRef.current) return
        if (data?.html) setHtml(data.html as string)
        else setErrored(true)
      })
      .catch(() => {
        if (reqId !== reqRef.current) return
        setErrored(true)
      })
  }, [adId, format])

  const aspect = FORMAT_ASPECT[format]

  if (html && !errored) {
    return (
      <div className={`relative w-full ${aspect} overflow-hidden bg-neutral-950`}>
        <iframe
          title="Ad preview"
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    )
  }

  // Loading or error → show the thumbnail as a fallback so the modal never
  // looks broken. We don't surface a separate error state intentionally;
  // the thumbnail is good enough until Meta returns something.
  return (
    <div className={`relative w-full ${aspect} bg-neutral-800 flex items-center justify-center overflow-hidden`}>
      {fallbackThumbnailUrl && !thumbErrored ? (
        <img
          src={fallbackThumbnailUrl}
          alt="Ad thumbnail"
          className="h-full w-full object-contain"
          loading="eager"
          referrerPolicy="no-referrer"
          onError={() => setThumbErrored(true)}
        />
      ) : (
        <div className="text-neutral-600 text-sm">
          {isVideo ? "🎬" : "🖼"} {errored ? "Preview unavailable" : "Loading preview…"}
        </div>
      )}
      {isVideo && fallbackThumbnailUrl && !thumbErrored && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-12 w-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
            <svg className="h-6 w-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}

/** Pick the most appropriate ad_format for an ad based on which placement
 *  received the most impressions. Falls back to mobile feed. */
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

    if (!best || impressions > best.impressions) {
      best = { format, impressions }
    }
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
