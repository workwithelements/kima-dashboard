"use client"

import { useState } from "react"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"
import {
  CLASSIFICATIONS,
  type ClassifiedAd,
} from "@/lib/utils/creative-classification"

type ThumbnailMap = Record<string, string> // ad_id -> thumbnail_url

type Props = {
  ads: ClassifiedAd[]
  thumbnails: ThumbnailMap
}

export default function CreativeCardGrid({ ads, thumbnails }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {ads.map((ad) => (
        <CreativeCard
          key={ad.adId}
          ad={ad}
          thumbnailUrl={thumbnails[ad.adId]}
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
}: {
  ad: ClassifiedAd
  thumbnailUrl?: string
}) {
  const [imgError, setImgError] = useState(false)
  const cls = CLASSIFICATIONS[ad.classification.type]

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden hover:border-neutral-700 transition-colors">
      {/* Thumbnail */}
      <div className="aspect-video bg-neutral-800 relative flex items-center justify-center">
        {thumbnailUrl && !imgError ? (
          <img
            src={thumbnailUrl}
            alt={ad.adName}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="text-neutral-600 text-xs text-center px-4">
            No preview
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Ad name */}
        <p className="text-sm text-neutral-200 font-medium truncate" title={ad.adName}>
          {ad.adName}
        </p>

        {/* Classification badge */}
        <span
          className={`inline-block text-xs px-2 py-0.5 rounded border ${cls.bgColor}`}
        >
          {cls.label}
        </span>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div>
            <span className="text-neutral-500">Spend</span>
            <span className="ml-1 text-neutral-200">{fmtCurrency(ad.spend)}</span>
          </div>
          <div>
            <span className="text-neutral-500">Conv</span>
            <span className="ml-1 text-neutral-200">{fmtNumber(ad.conversions)}</span>
          </div>
          <div>
            <span className="text-neutral-500">CPA</span>
            <span className="ml-1 text-neutral-200">
              {ad.cpa !== null ? fmtCurrency(ad.cpa) : "—"}
            </span>
          </div>
          <div>
            <span className="text-neutral-500">CVR</span>
            <span className="ml-1 text-neutral-200">{fmtPercent(ad.cvr)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
