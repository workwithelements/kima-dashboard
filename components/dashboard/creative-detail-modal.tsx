"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import MiniRetentionCurve from "@/components/charts/mini-retention-curve"
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/utils/format"
import { type ClassifiedAd } from "@/lib/utils/creative-classification"
import { FUNNEL_STEP_DEFS } from "@/lib/utils/funnel-steps"
import type { TagInfo } from "@/components/dashboard/creative-card-grid"
import type { MetaDailyRow, MetaDemographicsRow, MetaPlacementsRow } from "@/lib/utils/types"
import AdPreview, { FORMAT_LABELS, pickDefaultFormat, type AdPreviewFormat } from "@/components/dashboard/ad-preview"

type Props = {
  ad: ClassifiedAd
  thumbnailUrl?: string
  isVideo: boolean
  rows: Partial<MetaDailyRow>[]
  currency: string
  tags?: TagInfo[]
  metaAccountId?: string
  demographics?: MetaDemographicsRow[]
  placements?: MetaPlacementsRow[]
  funnelSteps?: string[]
  keyAction?: string
  onClose: () => void
}

export default function CreativeDetailModal({
  ad,
  thumbnailUrl,
  isVideo,
  rows,
  currency,
  tags,
  metaAccountId,
  demographics = [],
  placements = [],
  funnelSteps = ["unique_link_clicks", "purchases"],
  keyAction,
  onClose,
}: Props) {
  const roas = ad.spend > 0 ? ad.revenue / ad.spend : 0

  const defaultFormat = useMemo<AdPreviewFormat>(
    () => pickDefaultFormat(placements, ad.adId),
    [placements, ad.adId]
  )
  const [format, setFormat] = useState<AdPreviewFormat>(defaultFormat)
  useEffect(() => { setFormat(defaultFormat) }, [defaultFormat])

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg bg-neutral-800/80 p-1.5 text-neutral-400 transition hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="relative">
          <AdPreview
            adId={ad.adId}
            format={format}
            fallbackThumbnailUrl={thumbnailUrl}
            isVideo={isVideo}
            metaAccountId={metaAccountId ?? null}
            adName={ad.adName ?? null}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-neutral-800 bg-neutral-900/80 px-3 py-2 scrollbar-hide">
          {FORMAT_LABELS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFormat(f.key)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                format === f.key
                  ? "bg-brand-lime/10 text-brand-lime ring-1 ring-brand-lime/40"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-medium text-neutral-100 leading-snug">
                  {ad.adName}
                </h3>
                <p className="text-xs text-neutral-500 mt-1">{ad.adsetName}</p>
              </div>
              <a
                href={metaAccountId
                  ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAccountId}&search_value=${encodeURIComponent(ad.adName)}`
                  : `https://www.facebook.com/ads/library/?id=${ad.adId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:bg-neutral-700 hover:text-white"
                onClick={(e) => e.stopPropagation()}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View on Meta
              </a>
            </div>
            {tags && tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-black"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <DetailMetric label="Spend" value={fmtCurrency(ad.spend, currency)} />
            <DetailMetric label="Impressions" value={fmtNumber(ad.impressions)} />
            <DetailMetric label="Revenue" value={fmtCurrency(ad.revenue, currency)} />
            <DetailMetric label="ROAS" value={roas > 0 ? `${roas.toFixed(2)}x` : "—"} />
            <DetailMetric label="Spend Share" value={fmtPercent(ad.spendShare, 1)} />
          </div>

          {(() => {
            const adMetrics: Record<string, number> = {
              spend: ad.spend,
              impressions: ad.impressions,
              clicks: ad.clicks,
              purchases: ad.conversions,
              landingPageViews: ad.landingPageViews ?? 0,
              addsToCart: ad.addsToCart ?? 0,
              checkoutsInitiated: ad.checkoutsInitiated ?? 0,
              registrationsCompleted: ad.registrationsCompleted ?? 0,
              appInstalls: ad.appInstalls ?? 0,
              mobileAppRegistrations: ad.mobileAppRegistrations ?? 0,
            }

            return (
              <div className="space-y-2">
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Funnel Metrics</p>
                <div className="grid grid-cols-3 gap-3">
                  {funnelSteps.map((stepKey, i) => {
                    const def = FUNNEL_STEP_DEFS[stepKey]
                    if (!def) return null
                    const count = adMetrics[def.field as string] ?? 0
                    const prevStepKey = i > 0 ? funnelSteps[i - 1] : undefined
                    const prevDef = prevStepKey ? FUNNEL_STEP_DEFS[prevStepKey] : undefined
                    const denomField = prevDef ? prevDef.field : def.rateDenominator
                    const denominator = adMetrics[denomField as string] ?? 0
                    const rate = denominator > 0 ? (count / denominator) * def.rateMultiplier : null
                    const costPer = count > 0 ? ad.spend / count : null
                    const isKey = stepKey === keyAction

                    return (
                      <div key={stepKey} className="col-span-3 grid grid-cols-3 gap-3">
                        <DetailMetric
                          label={def.label}
                          value={fmtNumber(count)}
                          highlight={isKey}
                        />
                        <DetailMetric
                          label={def.rateLabel}
                          value={rate !== null ? fmtPercent(rate, def.rateDecimals ?? 1) : "—"}
                          highlight={isKey}
                        />
                        <DetailMetric
                          label={def.costLabel}
                          value={costPer !== null ? fmtCurrency(costPer, currency) : "—"}
                          highlight={isKey}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {isVideo && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs text-neutral-500 mb-2">Video Retention</p>
              <MiniRetentionCurve rows={rows} adId={ad.adId} />
            </div>
          )}

          {ad.fatigueStatus && ad.fatigueStatus !== "healthy" && (
            <div className="border-t border-neutral-800 pt-3">
              <p className="text-xs text-neutral-500 mb-1">Fatigue Analysis</p>
              <p className="text-xs text-neutral-300">{ad.fatigueReason}</p>
            </div>
          )}

          <AdPlacementBreakdown placements={placements} adId={ad.adId} currency={currency} />

          <AdDemographicBreakdown demographics={demographics} adId={ad.adId} currency={currency} />
        </div>
      </div>
    </div>,
    document.body
  )
}

function AdPlacementBreakdown({
  placements,
  adId,
  currency,
}: {
  placements: MetaPlacementsRow[]
  adId: string
  currency: string
}) {
  const adPlacements = placements.filter((p) => p.ad_id === adId)
  if (adPlacements.length === 0) {
    return (
      <div className="border-t border-neutral-800 pt-3">
        <p className="text-xs text-neutral-500 mb-2">Placement Breakdown</p>
        <p className="text-[11px] text-neutral-600 italic">No placement data available for this ad</p>
      </div>
    )
  }

  const agg = new Map<string, { spend: number; impressions: number; clicks: number }>()
  for (const p of adPlacements) {
    const key = `${p.publisher_platform || "unknown"} · ${p.platform_position || "unknown"}`
    const existing = agg.get(key) || { spend: 0, impressions: 0, clicks: 0 }
    existing.spend += p.spend || 0
    existing.impressions += p.impressions || 0
    existing.clicks += p.unique_link_clicks || 0
    agg.set(key, existing)
  }

  const sorted = Array.from(agg.entries()).sort((a, b) => b[1].spend - a[1].spend)
  const maxSpend = sorted[0]?.[1].spend || 1

  return (
    <div className="border-t border-neutral-800 pt-3">
      <p className="text-xs text-neutral-500 mb-2">Placement Breakdown</p>
      <div className="space-y-1.5">
        {sorted.slice(0, 8).map(([key, data]) => (
          <div key={key}>
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span className="text-neutral-300 truncate mr-2">{key}</span>
              <span className="text-neutral-400 tabular-nums shrink-0">
                {fmtCurrency(data.spend, currency)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500/60"
                style={{ width: `${(data.spend / maxSpend) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AdDemographicBreakdown({
  demographics,
  adId,
  currency,
}: {
  demographics: MetaDemographicsRow[]
  adId: string
  currency: string
}) {
  const adDemo = demographics.filter((d) => d.ad_id === adId)
  if (adDemo.length === 0) {
    return (
      <div className="border-t border-neutral-800 pt-3">
        <p className="text-xs text-neutral-500 mb-2">Demographic Breakdown</p>
        <p className="text-[11px] text-neutral-600 italic">No demographic data available for this ad</p>
      </div>
    )
  }

  const ageGroups = new Map<string, { male: number; female: number; unknown: number }>()
  for (const d of adDemo) {
    const age = d.age || "Unknown"
    const existing = ageGroups.get(age) || { male: 0, female: 0, unknown: 0 }
    const spend = d.spend || 0
    if (d.gender === "male") existing.male += spend
    else if (d.gender === "female") existing.female += spend
    else existing.unknown += spend
    ageGroups.set(age, existing)
  }

  const ageOrder = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
  const sorted = Array.from(ageGroups.entries()).sort((a, b) => {
    const ia = ageOrder.indexOf(a[0])
    const ib = ageOrder.indexOf(b[0])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const maxTotal = Math.max(...sorted.map(([, d]) => d.male + d.female + d.unknown), 1)

  return (
    <div className="border-t border-neutral-800 pt-3">
      <p className="text-xs text-neutral-500 mb-2">Demographic Breakdown</p>
      <div className="space-y-1.5">
        {sorted.map(([age, data]) => {
          const total = data.male + data.female + data.unknown
          return (
            <div key={age}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-neutral-300 w-10">{age}</span>
                <span className="text-neutral-400 tabular-nums">{fmtCurrency(total, currency)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden flex">
                {data.male > 0 && (
                  <div
                    className="h-full bg-blue-500/70"
                    style={{ width: `${(data.male / maxTotal) * 100}%` }}
                    title={`Male: ${fmtCurrency(data.male, currency)}`}
                  />
                )}
                {data.female > 0 && (
                  <div
                    className="h-full bg-pink-500/70"
                    style={{ width: `${(data.female / maxTotal) * 100}%` }}
                    title={`Female: ${fmtCurrency(data.female, currency)}`}
                  />
                )}
                {data.unknown > 0 && (
                  <div
                    className="h-full bg-neutral-600/70"
                    style={{ width: `${(data.unknown / maxTotal) * 100}%` }}
                    title={`Unknown: ${fmtCurrency(data.unknown, currency)}`}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex items-center gap-1 text-[10px] text-neutral-400">
          <span className="inline-block h-2 w-2 rounded-sm bg-blue-500/70" /> Male
        </div>
        <div className="flex items-center gap-1 text-[10px] text-neutral-400">
          <span className="inline-block h-2 w-2 rounded-sm bg-pink-500/70" /> Female
        </div>
      </div>
    </div>
  )
}

function DetailMetric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? "bg-[#CDFF00]/10 ring-1 ring-[#CDFF00]/30" : "bg-neutral-800/50"}`}>
      <p className={`text-[10px] ${highlight ? "text-[#CDFF00]/70" : "text-neutral-500"}`}>{label}</p>
      <p className={`text-sm font-medium tabular-nums ${highlight ? "text-[#CDFF00]" : "text-neutral-100"}`}>{value}</p>
    </div>
  )
}
