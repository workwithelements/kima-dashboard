"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import {
  CLASSIFICATIONS,
  getUnifiedStatusLabel,
  type ClassifiedAd,
} from "@/lib/utils/creative-classification"
import { FATIGUE_CONFIG } from "@/lib/utils/fatigue-detection"
import type { MetaDailyRow } from "@/lib/utils/types"
import {
  CREATIVE_METRICS,
  DEFAULT_CARD_METRICS,
  type CreativeMetricKey,
} from "@/lib/utils/creative-metrics"

type ThumbnailMap = Record<string, string> // ad_id -> thumbnail_url

export type TagInfo = { id: string; name: string; color: string }

type Props = {
  ads: ClassifiedAd[]
  thumbnails: ThumbnailMap
  videoAdIds: Set<string>
  rows: Partial<MetaDailyRow>[]
  currency?: string
  /** Per-ad tag list, keyed by ad ID */
  adTags?: Record<string, TagInfo[]>
  /** All available tags for assignment */
  allTags?: TagInfo[]
  onAdClick?: (ad: ClassifiedAd) => void
  /** Which metrics to display on cards (default: 6 standard metrics) */
  selectedMetrics?: CreativeMetricKey[]
  /** Assign a tag to an ad */
  onAssignTag?: (adId: string, tagId: string) => void
  /** Remove a tag from an ad */
  onRemoveTag?: (adId: string, tagId: string) => void
}

export default function CreativeCardGrid({
  ads,
  thumbnails,
  videoAdIds,
  rows,
  currency = "GBP",
  adTags = {},
  allTags = [],
  onAdClick,
  selectedMetrics = DEFAULT_CARD_METRICS,
  onAssignTag,
  onRemoveTag,
}: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {ads.map((ad) => (
        <CreativeCard
          key={ad.adId}
          ad={ad}
          thumbnailUrl={thumbnails[ad.adId]}
          isVideo={videoAdIds.has(ad.adId)}
          currency={currency}
          tags={adTags[ad.adId]}
          allTags={allTags}
          onClick={() => onAdClick?.(ad)}
          selectedMetrics={selectedMetrics}
          onAssignTag={onAssignTag}
          onRemoveTag={onRemoveTag}
        />
      ))}
      {ads.length === 0 && (
        <div className="col-span-full text-center text-neutral-500 py-12">
          No creatives found for the selected filters.
        </div>
      )}
    </div>
  )
}

function CreativeCard({
  ad,
  thumbnailUrl,
  isVideo,
  currency = "GBP",
  tags,
  allTags = [],
  onClick,
  selectedMetrics,
  onAssignTag,
  onRemoveTag,
}: {
  ad: ClassifiedAd
  thumbnailUrl?: string
  isVideo: boolean
  currency?: string
  tags?: TagInfo[]
  allTags?: TagInfo[]
  onClick?: () => void
  selectedMetrics: CreativeMetricKey[]
  onAssignTag?: (adId: string, tagId: string) => void
  onRemoveTag?: (adId: string, tagId: string) => void
}) {
  const [imgError, setImgError] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [tagAnchor, setTagAnchor] = useState<DOMRect | null>(null)
  const cls = CLASSIFICATIONS[ad.classification.type]

  const assignedTagIds = new Set((tags || []).map((t) => t.id))
  const unassignedTags = allTags.filter((t) => !assignedTagIds.has(t.id))

  return (
    <div
      className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden hover:border-neutral-700 transition-colors flex flex-col cursor-pointer"
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-neutral-800 relative flex items-center justify-center">
        {thumbnailUrl && !imgError ? (
          <Image
            src={thumbnailUrl}
            alt={ad.adName}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-contain"
            unoptimized
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="text-neutral-600 text-xs text-center px-4">
            {isVideo ? "\ud83c\udfa5" : "\ud83d\uddbc"} No preview
          </div>
        )}

        {/* Video play icon overlay */}
        {isVideo && thumbnailUrl && !imgError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-8 w-8 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
              <svg className="h-4 w-4 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

        {/* Classification badge overlaid on thumbnail (includes fatigue status) */}
        <span
          className={`absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border backdrop-blur-sm ${cls.bgColor}`}
        >
          {getUnifiedStatusLabel(ad)}
          {ad.fatigueStatus && ad.fatigueStatus !== "healthy" && (
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${FATIGUE_CONFIG.dot[ad.fatigueStatus]}`}
              title={ad.fatigueReason}
            />
          )}
        </span>
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col gap-2.5 flex-1">
        {/* Ad name */}
        <div>
          <p
            className="text-sm text-neutral-200 font-medium leading-snug line-clamp-2"
            title={ad.adName}
          >
            {ad.adName}
          </p>
          <p
            className="text-[10px] text-neutral-500 truncate mt-0.5"
            title={ad.adsetName}
          >
            {ad.adsetName}
          </p>
          {/* Tags with assignment */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tags && tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-medium text-black"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
                {onRemoveTag && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveTag(ad.adId, tag.id)
                    }}
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    title="Remove tag"
                  >
                    &times;
                  </button>
                )}
              </span>
            ))}
            {onAssignTag && allTags.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setTagAnchor(e.currentTarget.getBoundingClientRect())
                  setShowTagDropdown((v) => !v)
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-neutral-700 text-[10px] text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-300"
                title="Add tag"
              >
                +
              </button>
            )}
            {showTagDropdown && tagAnchor && (
              <CardTagDropdown
                tags={unassignedTags}
                onSelect={(tagId) => {
                  onAssignTag?.(ad.adId, tagId)
                  setShowTagDropdown(false)
                  setTagAnchor(null)
                }}
                onClose={() => {
                  setShowTagDropdown(false)
                  setTagAnchor(null)
                }}
                anchorRect={tagAnchor}
              />
            )}
          </div>
        </div>

        {/* Primary metrics — dynamic based on selectedMetrics */}
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs">
          {selectedMetrics.map((key) => {
            const def = CREATIVE_METRICS[key]
            return (
              <MetricItem
                key={key}
                label={def.shortLabel}
                value={def.format(ad, currency)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Portal-based tag dropdown for card grid (escapes overflow clipping) */
function CardTagDropdown({
  tags,
  onSelect,
  onClose,
  anchorRect,
}: {
  tags: TagInfo[]
  onSelect: (tagId: string) => void
  onClose: () => void
  anchorRect: DOMRect
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [onClose])

  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(anchorRect.bottom + 4, window.innerHeight - 200),
    left: Math.min(anchorRect.left, window.innerWidth - 170),
    zIndex: 50,
  }

  const content =
    tags.length === 0 ? (
      <div ref={ref} className="w-36 rounded-lg border border-neutral-700 bg-neutral-800 p-2 shadow-xl" style={style}>
        <p className="text-xs text-neutral-500">No more tags</p>
      </div>
    ) : (
      <div ref={ref} className="w-40 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl" style={style}>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(tag.id)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 transition hover:bg-neutral-700"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </button>
        ))}
      </div>
    )

  return createPortal(content, document.body)
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-neutral-500">{label}</span>
      <span className="ml-1 text-neutral-200 tabular-nums">{value}</span>
    </div>
  )
}
