"use client"

import { fmtCurrency, fmtNumber } from "@/lib/utils/format"

export type AdEntry = {
  adId: string
  adName: string
  value: number
  share: number
}

type Props = {
  title: string
  metric: string
  ads: AdEntry[]
  currency: string
  onClose: () => void
}

export default function AdsSidebar({ title, metric, ads, currency, onClose }: Props) {
  const fmt = metric === "Spend" ? (v: number) => fmtCurrency(v, currency) : fmtNumber

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="relative w-full overflow-y-auto border-l border-neutral-800 bg-neutral-900 sm:w-96">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900 px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">{title}</h3>
              <p className="mt-0.5 text-xs text-neutral-500">Top ads by {metric.toLowerCase()}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* Ad list */}
        <div className="divide-y divide-neutral-800/50 px-5">
          {ads.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-500">No ad data for this segment.</p>
          ) : (
            ads.map((ad, i) => (
              <div key={ad.adId} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="mr-1.5 inline-block text-[10px] text-neutral-600">{i + 1}.</span>
                    <span className="text-xs text-neutral-300">{ad.adName || ad.adId}</span>
                  </div>
                  <span className="whitespace-nowrap text-xs font-medium text-white">
                    {fmt(ad.value)}
                  </span>
                </div>
                {/* Share bar */}
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-brand-lime/60"
                    style={{ width: `${Math.max(ad.share * 100, 1)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[10px] text-neutral-600">
                  {(ad.share * 100).toFixed(1)}% of total
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
