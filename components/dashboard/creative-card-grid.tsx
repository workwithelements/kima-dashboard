"use client"

import { useState } from "react"
import Image from "next/image"
import {
  CLASSIFICATIONS,
  getUnifiedStatusLabel,
  type ClassifiedAd,
} from "@/lib/utils/creative-classification"
import { FATIGUE_CONFIG } from "@/lib/utils/fatigue-detection"
import MiniRetentionCurve from "@/components/charts/mini-retention-curve"
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
  onAdClick?: (ad: ClassifiedAd) => void
  /** Which metrics to display on cards (default: 6 standard metrics) */
  selectedMetrics?: CreativeMetricKey[]
}

export default function CreativeCardGrid({
  ads,
  thumbnails,
  videoAdIds,
  rows,
  currency = "GBP",
  adTags = {},
  onAdClick,
  selectedMetrics = DEFAULT_CARD_METRICS,
}: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {ads.map((ad) => (
        <CreativeCard
          key={ad.adId}
          ad={ad}
          thumbnailUrl={thumbnails[ad.adId]}
          isVideo={videoAdIds.has(ad.adId)}
          rows={rows}
          currency={currency}
          tags={adTags[ad.adId]}
          onClick={() => onAdClick?.(ad)}
          selectedMetrics={selectedMetrics}
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
  rows,
  currency = "GBP",
  tags,
  onClick,
  selectedMetrics,
}: {
  ad: ClassifiedAd
  thumbnailUrl?: string
  isVideo: boolean
  rows: Partial<MetaDailyRow>[]
  currency?: string
  tags?: TagInfo[]
  onClick?: () => void
  selectedMetrics: CreativeMetricKey[]
}) {
  const [imgError, setImgError] = useState(false)
  const cls = CLASSIFICATIONS[ad.classification.type]

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
            {isVideo ? "🎬" : "🖼"} No preview
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
          {tags && tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-block rounded-full px-1.5 py-px text-[9px] font-medium text-black"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
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

        {/* Inline video retention curve */}
        {isVideo && (
          <div className="border-t border-neutral-800 pt-2">
            <p className="text-[10px] text-neutral-500 mb-1">Video Retention</p>
            <MiniRetentionCurve rows={rows} adId={ad.adId} />
          </div>
        )}
      </div>
    </div>
  )
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-neutral-500">{label}</span>
      <span className="ml-1 text-neutral-200 tabular-nums">{value}</span>
    </div>
  )
}
