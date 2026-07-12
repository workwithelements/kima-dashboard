"use client"

import { useMemo, useRef, useState, useEffect } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { Card } from "@/components/ui/card"
import AdSetSelector from "@/components/ui/adset-selector"
import { fmtCurrency, fmtCurrencyCompact, fmtNumber, fmtRoas, fmtDateShort } from "@/lib/utils/format"
import {
  classifyAds,
  computeThresholds,
  CLASSIFICATION_CONFIG,
  WINDOW_PRESETS,
  type AdEfficiencyPoint,
  type AdEfficiencyRow,
  type WindowKey,
} from "@/lib/utils/reach-efficiency"

const ChartPlaceholder = () => (
  <div className="h-[420px] animate-pulse rounded bg-neutral-800/50" />
)
const ReachEfficiencyScatter = dynamic(
  () => import("@/components/charts/reach-efficiency-scatter"),
  { ssr: false, loading: ChartPlaceholder }
)

type Props = {
  windows: Partial<Record<WindowKey, AdEfficiencyRow[]>>
  thumbnails: Record<string, string>
  keyAction: string
  currency?: string
  /** Initial window (from URL), so custom ranges survive navigation */
  initialWindow?: WindowKey
  customFrom?: string
  customTo?: string
}

export default function ReachEfficiencySection({
  windows,
  thumbnails,
  keyAction,
  currency = "GBP",
  initialWindow = "30d",
  customFrom,
  customTo,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [windowKey, setWindowKey] = useState<WindowKey>(
    windows[initialWindow] ? initialWindow : "30d"
  )
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([])
  const [selectedAdsets, setSelectedAdsets] = useState<string[]>([])

  // Reset filters when the window changes — entity IDs can differ per window,
  // and a stale selection would silently empty the map
  useEffect(() => {
    setSelectedCampaigns([])
    setSelectedAdsets([])
  }, [windowKey])

  const ads = useMemo(() => windows[windowKey] || [], [windows, windowKey])

  // Filter option lists come from the active window's ads
  const campaigns = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of ads) if (a.campaignId) map.set(a.campaignId, a.campaignName || a.campaignId)
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [ads])

  const allCampaignsSelected =
    selectedCampaigns.length === 0 || selectedCampaigns.length === campaigns.length

  const campaignFiltered = useMemo(
    () =>
      allCampaignsSelected
        ? ads
        : ads.filter((a) => selectedCampaigns.includes(a.campaignId)),
    [ads, selectedCampaigns, allCampaignsSelected]
  )

  const adsets = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of campaignFiltered) if (a.adsetId) map.set(a.adsetId, a.adsetName || a.adsetId)
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [campaignFiltered])

  const allAdsetsSelected =
    selectedAdsets.length === 0 ||
    adsets.every((a) => selectedAdsets.includes(a.id))

  const filtered = useMemo(
    () =>
      allAdsetsSelected
        ? campaignFiltered
        : campaignFiltered.filter((a) => selectedAdsets.includes(a.adsetId)),
    [campaignFiltered, selectedAdsets, allAdsetsSelected]
  )

  // Thresholds adapt to the filtered set, so the zone stays meaningful when
  // narrowing to one campaign or ad set
  const thresholds = useMemo(() => computeThresholds(filtered), [filtered])
  const points = useMemo(() => classifyAds(filtered, thresholds), [filtered, thresholds])

  // Meta CDN thumbnail URLs expire after ~24h, so route every ad through
  // /api/thumbnail, which refreshes expired URLs from the Graph API — even for
  // ads with no synced thumbnail yet. Non-http URLs (test fixtures) pass through.
  const proxiedThumbnails = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ad of ads) {
      const raw = thumbnails[ad.adId]
      map[ad.adId] =
        raw && !raw.startsWith("http")
          ? raw
          : `/api/thumbnail?ad_id=${encodeURIComponent(ad.adId)}`
    }
    return map
  }, [ads, thumbnails])

  const efficient = useMemo(
    () =>
      points
        .filter((p) => p.classification === "efficient")
        .sort((a, b) => b.spend - a.spend),
    [points]
  )
  const reachPlays = useMemo(
    () =>
      points
        .filter((p) => p.classification === "reachPlay")
        .sort((a, b) => b.spend - a.spend),
    [points]
  )

  function applyCustomRange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("rw", "custom")
    params.set("rfrom", from)
    params.set("rto", to)
    setWindowKey("custom")
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function selectPreset(key: WindowKey) {
    setWindowKey(key)
    // Keep the URL in sync so shared links open on the same window
    const params = new URLSearchParams(searchParams.toString())
    params.set("rw", key)
    params.delete("rfrom")
    params.delete("rto")
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const keyActionLabel = keyAction.replace(/_/g, " ")

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-sm font-medium text-neutral-400">CPMr Report</h2>
        <p className="mt-1 max-w-3xl text-xs text-neutral-500">
          Which ads are driving top-of-funnel growth — high spend, low CPMr (cheap
          reach at scale). Split by CPA on{" "}
          <span className="text-neutral-400">{keyActionLabel}</span>: efficient
          growth vs reach plays you shouldn&apos;t pause.
        </p>
      </div>

      {/* Controls: window toggle + custom range + thresholds readout + filters */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          Window
        </span>
        <div className="inline-flex rounded-lg border border-neutral-700 bg-neutral-800/50 p-0.5">
          {WINDOW_PRESETS.map((w) => (
            <button
              key={w.key}
              onClick={() => selectPreset(w.key)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                windowKey === w.key
                  ? "bg-brand-lime/15 text-brand-lime"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <CustomRangeButton
          active={windowKey === "custom"}
          from={customFrom}
          to={customTo}
          onApply={applyCustomRange}
        />
        {filtered.length > 0 && (
          <span className="text-xs text-neutral-500">
            thresholds · spend ≥ {fmtCurrency(thresholds.spendMin, currency)} · CPMr
            ≤ {fmtCurrency(thresholds.cpmrMax, currency)} · CPA split{" "}
            {fmtCurrency(thresholds.cpaSplit, currency)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <AdSetSelector
            items={campaigns}
            selected={selectedCampaigns.length ? selectedCampaigns : campaigns.map((c) => c.id)}
            onChange={setSelectedCampaigns}
            label="campaigns"
          />
          <AdSetSelector
            items={adsets}
            selected={selectedAdsets.length ? selectedAdsets : adsets.map((a) => a.id)}
            onChange={setSelectedAdsets}
            label="ad sets"
          />
        </div>
      </div>

      {/* Reach efficiency map */}
      <Card>
        <h3 className="mb-3 text-sm font-medium text-neutral-400">
          Reach efficiency map
          <span className="ml-2 text-[10px] font-normal text-neutral-600">
            each dot is an ad · size = people reached
          </span>
        </h3>
        {points.length > 0 ? (
          <ReachEfficiencyScatter
            points={points}
            thresholds={thresholds}
            thumbnails={proxiedThumbnails}
            currency={currency}
            height={420}
          />
        ) : (
          <p className="py-16 text-center text-xs text-neutral-500">
            No ads with spend and reach in this window
          </p>
        )}
      </Card>

      {/* Card rails */}
      <AdRail
        title="🚀 Efficient growth"
        subtitle="low CPMr + low CPA — scale these"
        emptyText="No ads currently qualify — they need top-quartile spend, below-median CPMr and CPA under the split."
        points={efficient}
        thumbnails={proxiedThumbnails}
        currency={currency}
        cpaSplit={thresholds.cpaSplit}
        accent="text-emerald-400"
      />
      <AdRail
        title="📡 Reach play"
        subtitle="cheap reach at scale, high CPA — don't pause"
        emptyText="No reach plays in this window."
        points={reachPlays}
        thumbnails={proxiedThumbnails}
        currency={currency}
        cpaSplit={thresholds.cpaSplit}
        accent="text-amber-400"
      />
    </div>
  )
}

/** Calendar button + popover with from/to date inputs for the custom window. */
function CustomRangeButton({
  active,
  from,
  to,
  onApply,
}: {
  active: boolean
  from?: string
  to?: string
  onApply: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(from || "")
  const [customTo, setCustomTo] = useState(to || "")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const label =
    active && from && to ? `${fmtDateShort(from)} – ${fmtDateShort(to)}` : "Custom range"

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
          active
            ? "border-brand-lime/40 bg-brand-lime/10 text-brand-lime"
            : "border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:border-neutral-600 hover:text-white"
        }`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{label}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-neutral-500">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-500">To</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white"
              />
            </div>
            <button
              disabled={!customFrom || !customTo || customTo < customFrom}
              onClick={() => {
                onApply(customFrom, customTo)
                setOpen(false)
              }}
              className="w-full rounded-lg bg-brand-lime/15 px-3 py-1.5 text-xs font-medium text-brand-lime transition enabled:hover:bg-brand-lime/25 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Horizontally scrolling rail of ad cards for one classification bucket. */
function AdRail({
  title,
  subtitle,
  emptyText,
  points,
  thumbnails,
  currency,
  cpaSplit,
  accent,
}: {
  title: string
  subtitle: string
  emptyText: string
  points: AdEfficiencyPoint[]
  thumbnails: Record<string, string>
  currency: string
  cpaSplit: number
  accent: string
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-medium text-white">{title}</h3>
        <span className="text-xs text-neutral-500">{subtitle}</span>
        <span className="text-xs font-medium text-neutral-400">· {points.length}</span>
      </div>
      {points.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 py-6 text-center text-xs text-neutral-600">
          {emptyText}
        </p>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {points.map((p) => (
            <RailCard
              key={p.adId}
              point={p}
              thumbnailUrl={thumbnails[p.adId]}
              currency={currency}
              cpaSplit={cpaSplit}
              accent={accent}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RailCard({
  point,
  thumbnailUrl,
  currency,
  cpaSplit,
  accent,
}: {
  point: AdEfficiencyPoint
  thumbnailUrl?: string
  currency: string
  cpaSplit: number
  accent: string
}) {
  const [imgError, setImgError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const cls = CLASSIFICATION_CONFIG[point.classification]
  const cpaGood = point.cpa !== null && point.cpa <= cpaSplit

  // Cards are server-rendered, so an image can fail before hydration attaches
  // the onError listener — re-check after mount, and reset when the URL changes
  useEffect(() => {
    setImgError(false)
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth === 0) setImgError(true)
  }, [thumbnailUrl])

  return (
    <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 transition-colors hover:border-neutral-700">
      <div className="relative aspect-video bg-neutral-800">
        {thumbnailUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={thumbnailUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-600">
            {point.isVideo ? "🎥" : "🖼"} No preview
          </div>
        )}
        <span
          className={`absolute left-2 top-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide backdrop-blur-sm ${cls.badgeClass}`}
        >
          {cls.badge}
        </span>
        {point.isVideo && thumbnailUrl && !imgError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
              <svg className="ml-0.5 h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="truncate text-xs text-neutral-300" title={point.adName}>
          {point.adName}
        </p>
        <p className={`text-xl font-semibold tabular-nums ${accent}`}>
          {fmtCurrency(point.cpmr, currency)}
          <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            CPMr
          </span>
        </p>
        <div className="mt-auto grid grid-cols-4 gap-1 border-t border-neutral-800/60 pt-2">
          <RailStat label="Spend" value={fmtCurrencyCompact(point.spend, currency)} />
          <RailStat label="Reach" value={fmtNumber(point.reach)} />
          <RailStat
            label="CPA"
            value={point.cpa !== null ? fmtCurrency(point.cpa, currency) : "—"}
            valueClass={
              point.cpa === null ? "" : cpaGood ? "text-emerald-400" : "text-red-400"
            }
          />
          <RailStat label="ROAS" value={point.revenue > 0 ? fmtRoas(point.roas) : "—"} />
        </div>
      </div>
    </div>
  )
}

function RailStat({
  label,
  value,
  valueClass = "",
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-medium uppercase tracking-wider text-neutral-600">
        {label}
      </p>
      <p className={`truncate text-[11px] font-medium tabular-nums text-neutral-200 ${valueClass}`}>
        {value}
      </p>
    </div>
  )
}
