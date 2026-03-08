"use client"

import type { SaturationResult } from "@/lib/utils/reach"

type SaturationGaugeProps = {
  saturation: SaturationResult
}

export default function SaturationGauge({ saturation }: SaturationGaugeProps) {
  const { score, level, label, avgFrequency } = saturation

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
            d={describeArc(startAngle, startAngle + totalAngle * 0.3)}
            fill="none"
            stroke="#22C55E"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            opacity={0.15}
          />
          <path
            d={describeArc(
              startAngle + totalAngle * 0.3,
              startAngle + totalAngle * 0.6
            )}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={strokeWidth}
            opacity={0.15}
          />
          <path
            d={describeArc(
              startAngle + totalAngle * 0.6,
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

      {/* Zone legend */}
      <div className="mt-4 flex gap-4 text-[10px] text-neutral-500">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>0–30</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          <span>30–60</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span>60–100</span>
        </div>
      </div>
    </div>
  )
}
