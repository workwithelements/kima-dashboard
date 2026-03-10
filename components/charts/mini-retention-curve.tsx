"use client"

import { useMemo, useState } from "react"
import type { MetaDailyRow } from "@/lib/utils/types"
import {
  aggregateVideoMetrics,
  calculateRetentionCurve,
  videoKPIs,
} from "@/lib/utils/video-retention"
import { fmtPercent } from "@/lib/utils/format"

type Props = {
  rows: Partial<MetaDailyRow>[]
  adId: string
  color?: string
}

/**
 * Interactive retention curve for creative cards.
 * Taller chart with Y/X axes, smooth bezier curve,
 * hover tooltips, and Hook / Completion / Avg Watch KPIs.
 */
export default function MiniRetentionCurve({
  rows,
  adId,
  color = "#CDFF00",
}: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const { points, kpis } = useMemo(() => {
    const metrics = aggregateVideoMetrics(rows, adId)
    const curve = calculateRetentionCurve(metrics)
    const k = videoKPIs(metrics)
    // Include the "Impr." (100%) start point so curve always starts high and descends
    return { points: curve, kpis: k }
  }, [rows, adId])

  if (points.length === 0 || points.every((p) => p.percent === 0)) return null

  // ── SVG layout ──────────────────────────────────────────────
  const W = 240
  const H = 120
  const m = { top: 6, right: 6, bottom: 20, left: 28 }
  const cW = W - m.left - m.right
  const cH = H - m.top - m.bottom

  // ── Map data points to pixel coords ─────────────────────────
  const pts = points.map((p, i) => ({
    x: m.left + (i / (points.length - 1)) * cW,
    y: m.top + cH - (p.percent / 100) * cH,
    label: p.label,
    percent: p.percent,
  }))

  // ── Smooth Catmull-Rom → cubic bezier curve ─────────────────
  function smoothPath(arr: { x: number; y: number }[]): string {
    if (arr.length < 2) return ""
    let d = `M ${arr[0].x.toFixed(1)} ${arr[0].y.toFixed(1)}`
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[Math.max(0, i - 1)]
      const b = arr[i]
      const c = arr[i + 1]
      const e = arr[Math.min(arr.length - 1, i + 2)]
      const t = 0.3
      d += ` C ${(b.x + (c.x - a.x) * t).toFixed(1)} ${(b.y + (c.y - a.y) * t).toFixed(1)}, ${(c.x - (e.x - b.x) * t).toFixed(1)} ${(c.y - (e.y - b.y) * t).toFixed(1)}, ${c.x.toFixed(1)} ${c.y.toFixed(1)}`
    }
    return d
  }

  const line = smoothPath(pts)
  const bottomY = m.top + cH
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${bottomY} L ${pts[0].x.toFixed(1)} ${bottomY} Z`

  // ── Y-axis ticks ────────────────────────────────────────────
  const yTicks = [0, 25, 50, 100]
  const yPos = (v: number) => m.top + cH - (v / 100) * cH

  // ── X-axis / tooltip labels ─────────────────────────────────
  const tooltipLabel = (idx: number) => {
    const lbl = points[idx]?.label ?? ""
    if (lbl === "Impr.") return "Impressions"
    if (lbl === "3s") return "3s Play"
    return lbl
  }

  // ── Tooltip position ────────────────────────────────────────
  const hovered = hoverIdx !== null ? pts[hoverIdx] : null
  const ttW = 78
  const ttH = 28
  let ttX = hovered ? hovered.x - ttW / 2 : 0
  let ttY = hovered ? hovered.y - ttH - 8 : 0
  if (ttX < 2) ttX = 2
  if (ttX + ttW > W - 2) ttX = W - 2 - ttW
  if (hovered && ttY < 2) ttY = hovered.y + 10

  return (
    <div className="space-y-1.5">
      {/* KPI row */}
      <div className="flex items-center justify-between text-[10px]">
        <div>
          <span className="text-neutral-300 font-medium">
            {fmtPercent(kpis.hookRate, 1)}
          </span>
          <span className="text-neutral-500"> 3s Hook</span>
        </div>
        <div>
          <span className="text-neutral-300 font-medium">
            {fmtPercent(kpis.completionRate, 1)}
          </span>
          <span className="text-neutral-500"> Comp</span>
        </div>
        <div>
          <span className="text-neutral-300 font-medium">
            {fmtPercent(kpis.avgWatchPercent, 0)}
          </span>
          <span className="text-neutral-500"> Avg Watch</span>
        </div>
      </div>

      {/* Retention chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ height: 100 }}
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y-axis gridlines + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={m.left}
              y1={yPos(v)}
              x2={W - m.right}
              y2={yPos(v)}
              stroke="#333"
              strokeWidth={0.5}
              strokeDasharray={v === 0 ? undefined : "2,2"}
            />
            <text
              x={m.left - 3}
              y={yPos(v) + 3}
              textAnchor="end"
              fill="#555"
              fontSize={7}
            >
              {v}%
            </text>
          </g>
        ))}

        {/* Area fill */}
        <path d={area} fill={color} fillOpacity={0.08} />

        {/* Curve line */}
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data-point dots */}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoverIdx === i ? 3.5 : 2}
            fill={hoverIdx === i ? color : "transparent"}
            stroke={color}
            strokeWidth={1.5}
            opacity={hoverIdx === i ? 1 : 0.5}
          />
        ))}

        {/* X-axis labels */}
        {pts.map((p, i) => (
          <text
            key={`xl-${i}`}
            x={p.x}
            y={H - 3}
            textAnchor="middle"
            fill={hoverIdx === i ? "#bbb" : "#555"}
            fontSize={7}
          >
            {pts[i]?.label ?? ""}
          </text>
        ))}

        {/* Invisible hover hit-areas (vertical strips) */}
        {pts.map((p, i) => {
          const prevMid =
            i === 0 ? m.left : (pts[i - 1].x + p.x) / 2
          const nextMid =
            i === pts.length - 1
              ? m.left + cW
              : (p.x + pts[i + 1].x) / 2
          return (
            <rect
              key={`h-${i}`}
              x={prevMid}
              y={m.top}
              width={nextMid - prevMid}
              height={cH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              style={{ cursor: "crosshair" }}
            />
          )
        })}

        {/* Hover overlay: vertical guide + tooltip */}
        {hovered && hoverIdx !== null && (
          <g>
            {/* Vertical dashed guide */}
            <line
              x1={hovered.x}
              y1={m.top}
              x2={hovered.x}
              y2={bottomY}
              stroke="#555"
              strokeWidth={0.5}
              strokeDasharray="2,2"
            />
            {/* Tooltip background */}
            <rect
              x={ttX}
              y={ttY}
              width={ttW}
              height={ttH}
              rx={4}
              fill="#1a1a1a"
              stroke="#444"
              strokeWidth={0.5}
            />
            {/* Tooltip — milestone label */}
            <text
              x={ttX + ttW / 2}
              y={ttY + 11}
              textAnchor="middle"
              fill="#fff"
              fontSize={8}
              fontWeight={600}
            >
              {tooltipLabel(hoverIdx)}
            </text>
            {/* Tooltip — retained % */}
            <text
              x={ttX + ttW / 2}
              y={ttY + 22}
              textAnchor="middle"
              fill="#999"
              fontSize={7.5}
            >
              Retained: {fmtPercent(hovered.percent, 1)}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
