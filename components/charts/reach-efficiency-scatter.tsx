"use client"

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Label,
} from "recharts"
import { fmtCurrency, fmtCurrencyCompact, fmtNumber, fmtRoas } from "@/lib/utils/format"
import AdCreativeMedia from "@/components/dashboard/ad-creative-media"
import {
  CLASSIFICATION_CONFIG,
  type AdEfficiencyPoint,
  type EfficiencyThresholds,
} from "@/lib/utils/reach-efficiency"

type Props = {
  points: AdEfficiencyPoint[]
  thresholds: EfficiencyThresholds
  /** @deprecated no longer used — the hover card resolves media per adId
   *  via /api/ad-preview, which can't show another ad's creative. */
  thumbnails?: Record<string, string>
  currency?: string
  height?: number
}

/**
 * Reach efficiency map — each dot is an ad.
 *   x: spend (log) · y: CPMr (log, reversed so cheaper reach is up) · size: people reached
 * The TOF growth zone (high spend + cheap reach) is the shaded top-right rectangle.
 */
export default function ReachEfficiencyScatter({
  points,
  thresholds,
  currency = "GBP",
  height = 420,
}: Props) {
  const other = points.filter((p) => p.classification === "other")
  const reachPlay = points.filter((p) => p.classification === "reachPlay")
  const efficient = points.filter((p) => p.classification === "efficient")

  // Log-scale domains with headroom; guard against degenerate single-value sets
  const spends = points.map((p) => p.spend)
  const cpmrs = points.map((p) => p.cpmr)
  const xMin = Math.min(...spends) * 0.8
  const xMax = Math.max(...spends) * 1.25
  const yMin = Math.min(...cpmrs) * 0.8
  const yMax = Math.max(...cpmrs) * 1.25

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-1 top-0 z-10 text-[10px] text-neutral-500">
        cheaper reach ↑
      </span>
      <span className="pointer-events-none absolute bottom-0 right-1 z-10 text-[10px] text-neutral-500">
        higher spend →
      </span>
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 18, right: 18, bottom: 14, left: 8 }}>
          <XAxis
            type="number"
            dataKey="spend"
            name="spend"
            scale="log"
            domain={[xMin, xMax]}
            tick={false}
            tickLine={false}
            axisLine={{ stroke: "#262626" }}
            allowDataOverflow
          />
          <YAxis
            type="number"
            dataKey="cpmr"
            name="cpmr"
            scale="log"
            reversed
            domain={[yMin, yMax]}
            tick={false}
            tickLine={false}
            axisLine={{ stroke: "#262626" }}
            width={12}
            allowDataOverflow
          />
          <ZAxis type="number" dataKey="reach" range={[40, 900]} name="reach" />

          {/* TOF growth zone: spend ≥ threshold, CPMr ≤ threshold (top-right) */}
          <ReferenceArea
            x1={Math.max(thresholds.spendMin, xMin)}
            x2={xMax}
            y1={yMin}
            y2={Math.min(thresholds.cpmrMax, yMax)}
            fill="#059669"
            fillOpacity={0.08}
            stroke="#059669"
            strokeOpacity={0.25}
            ifOverflow="hidden"
          >
            <Label
              value="TOF growth zone"
              position="insideTopLeft"
              offset={8}
              fill="#34D399"
              fontSize={11}
              fontWeight={600}
            />
          </ReferenceArea>
          <ReferenceLine
            x={thresholds.spendMin}
            stroke="#404040"
            strokeDasharray="4 4"
            ifOverflow="hidden"
          />
          <ReferenceLine
            y={thresholds.cpmrMax}
            stroke="#404040"
            strokeDasharray="4 4"
            ifOverflow="hidden"
          />

          <Tooltip
            cursor={false}
            isAnimationActive={false}
            wrapperStyle={{ zIndex: 30, outline: "none" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as AdEfficiencyPoint | undefined
              if (!active || !point) return null
              return (
                <AdHoverCard
                  key={point.adId}
                  point={point}
                  currency={currency}
                  cpaSplit={thresholds.cpaSplit}
                />
              )
            }}
          />

          {/* Context dots first so classified ads render on top */}
          <Scatter
            data={other}
            fill={CLASSIFICATION_CONFIG.other.dot}
            fillOpacity={0.55}
            stroke="#171717"
            strokeWidth={1}
            isAnimationActive={false}
          />
          <Scatter
            data={reachPlay}
            fill={CLASSIFICATION_CONFIG.reachPlay.dot}
            fillOpacity={0.9}
            stroke="#171717"
            strokeWidth={1}
            isAnimationActive={false}
          />
          <Scatter
            data={efficient}
            fill={CLASSIFICATION_CONFIG.efficient.dot}
            fillOpacity={0.9}
            stroke="#171717"
            strokeWidth={1}
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>

      {/* Static legend — identity is also carried by badges + card rails */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-neutral-400">
        {(["efficient", "reachPlay", "other"] as const).map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: CLASSIFICATION_CONFIG[key].dot }}
            />
            {CLASSIFICATION_CONFIG[key].label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Hover card: creative preview + badge + the numbers that drive the keep-on/off call.
 *  Media comes from /api/ad-preview keyed strictly by adId (full-res image or
 *  autoplaying video) — never from synced thumbnail URLs, which were low-res
 *  and could point at the wrong creative. */
function AdHoverCard({
  point,
  currency,
  cpaSplit,
}: {
  point: AdEfficiencyPoint
  currency: string
  cpaSplit: number
}) {
  const cls = CLASSIFICATION_CONFIG[point.classification]
  const cpaGood = point.cpa !== null && point.cpa <= cpaSplit
  return (
    <div className="w-60 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
      <div className="relative">
        <AdCreativeMedia adId={point.adId} isVideoHint={point.isVideo} aspectClass="aspect-video" />
        <span
          className={`absolute left-2 top-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm ${cls.badgeClass}`}
        >
          {cls.badge}
        </span>
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-xs font-medium text-neutral-200" title={point.adName}>
          {point.adName}
        </p>
        <p className="text-xs text-neutral-400">
          <span className="font-semibold text-white tabular-nums">
            {fmtCurrency(point.cpmr, currency)}
          </span>{" "}
          CPMr
          <span className="mx-1.5 text-neutral-600">·</span>
          <span className="tabular-nums">{fmtCurrencyCompact(point.spend, currency)}</span> spend
        </p>
        <p className="text-xs text-neutral-400">
          <span className="tabular-nums">{fmtNumber(point.reach)}</span> reach
          <span className="mx-1.5 text-neutral-600">·</span>
          {point.cpa !== null ? (
            <span className={`font-medium tabular-nums ${cpaGood ? "text-emerald-400" : "text-red-400"}`}>
              CPA {fmtCurrency(point.cpa, currency)}
            </span>
          ) : (
            <span className="text-neutral-500">no conversions</span>
          )}
          {point.revenue > 0 && (
            <>
              <span className="mx-1.5 text-neutral-600">·</span>
              <span className="tabular-nums">{fmtRoas(point.roas)} ROAS</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
