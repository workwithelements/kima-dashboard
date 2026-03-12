"use client"

import type { SaturationResult } from "@/lib/utils/reach"

type SaturationGaugeProps = {
  saturation: SaturationResult
}

export default function SaturationGauge({ saturation }: SaturationGaugeProps) {
  const { score, level, label, avgFrequency, components } = saturation

  // Arc calculations — SVG arc from -135° to 135° (270° sweep)
  const radius = 80
  const cx = 100
  const cy = 100
  const strokeWidth = 12

  // Convert score (0-100) to angle
  const startAngle = -135
  const endAngle = 135
  const totalAngle = endAngle - startAngle // 270°
  const scoreAngle = startAngle + (score / 100) * totalAngle

  function polarToCartesian(angle: number) {
    const rad = ((angle - 90) * Math.PI) / 180
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    }
  }

  function describeArc(start: number, end: number) {
    const s = polarToCartesian(start)
    const e = polarToCartesian(end)
    const largeArc = end - start > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`
  }

  // Gauge colour based on level
  const gaugeColor =
    level === "low"
      ? "#22C55E"
      : level === "moderate"
        ? "#F59E0B"
        : "#EF4444"

  const textColor =
    level === "low"
      ? "text-green-400"
      : level === "moderate"
        ? "text-amber-400"
        : "text-red-400"

  // Zone boundaries: 0-25 low, 25-55 moderate, 55-100 high
  const lowEnd = 0.25
  const modEnd = 0.55

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="200" height="140" viewBox="0 0 200 160">
          {/* Background arc */}
          <path
            d={describeArc(startAngle, endAngle)}
            fill="none"
            stroke="#262626"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Zone arcs */}
          <path
            d={describeArc(startAngle, startAngle + totalAngle * lowEnd)}
            fill="none"
            stroke="#22C55E"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            opacity={0.15}
          />
          <path
            d={describeArc(
              startAngle + totalAngle * lowEnd,
              startAngle + totalAngle * modEnd
            )}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={strokeWidth}
            opacity={0.15}
          />
          <path
            d={describeArc(
              startAngle + totalAngle * modEnd,
              endAngle
            )}
            fill="none"
            stroke="#EF4444"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            opacity={0.15}
          />

          {/* Score arc */}
          {score > 0 && (
            <path
              d={describeArc(startAngle, scoreAngle)}
              fill="none"
              stroke={gaugeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}

          {/* Score text */}
          <text
            x={cx}
            y={cy - 5}
            textAnchor="middle"
            fill="white"
            fontSize="32"
            fontWeight="600"
            fontFamily="Inter, sans-serif"
          >
            {score}
          </text>
          <text
            x={cx}
            y={cy + 18}
            textAnchor="middle"
            fill="#737373"
            fontSize="12"
            fontFamily="Inter, sans-serif"
          >
            / 100
          </text>
        </svg>
      </div>

      {/* Label */}
      <p className={`mt-1 text-sm font-medium ${textColor}`}>
        {label}
      </p>

      {/* Frequency */}
      <p className="mt-2 text-xs text-neutral-500">
        Avg Frequency: <span className="text-neutral-300">{avgFrequency.toFixed(2)}x</span>
      </p>

      {/* Component breakdown */}
      <div className="mt-3 w-full max-w-[200px] space-y-1.5">
        <ComponentBar label="Frequency" value={components.frequency} color="#8B5CF6" />
        <ComponentBar label="Efficiency" value={components.efficiency} color="#F59E0B" />
        <ComponentBar label="Trend" value={components.trend} color="#3B82F6" />
      </div>

      {/* Info tooltip */}
      <div className="group/tip relative mt-3 flex cursor-help items-center gap-1 text-[10px] text-neutral-500">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>How is this calculated?</span>
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-left text-[11px] leading-relaxed text-neutral-300 opacity-0 shadow-xl transition-opacity group-hover/tip:pointer-events-auto group-hover/tip:opacity-100">
          <p className="mb-1.5 font-medium text-white">Saturation Score (0–100)</p>
          <p className="mb-1">Measures audience fatigue risk from three factors:</p>
          <p className="mb-0.5"><span className="text-purple-400">Frequency (40%):</span> Avg ad frequency vs cap of 8x</p>
          <p className="mb-0.5"><span className="text-amber-400">Efficiency (35%):</span> CPMr vs CPM gap — cost of repeat impressions</p>
          <p className="mb-2"><span className="text-blue-400">Trend (25%):</span> New reach % decline over time</p>
          <p className="text-neutral-500">0–25 Low · 26–55 Moderate · 56–100 High</p>
        </div>
      </div>

      {/* Zone legend */}
      <div className="mt-3 flex gap-4 text-[10px] text-neutral-500">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>0–25</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          <span>26–55</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span>56–100</span>
        </div>
      </div>
    </div>
  )
}

/** Mini horizontal bar showing a component's contribution */
function ComponentBar({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-right text-[10px] text-neutral-500">{label}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-neutral-800">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-6 text-[10px] text-neutral-400">{value}</span>
    </div>
  )
}
