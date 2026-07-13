/**
 * Tiny inline payback sparkline: cumulative blended cash per customer over
 * the horizon, a dashed reference line at the ad's CPA, and a marker where
 * the curve crosses it. Pure SVG — the unit-economics table renders one per
 * row, so recharts instances would be needlessly heavy.
 */

type Props = {
  /** Cumulative cash per customer, months 0..horizon. */
  curve: number[]
  cpa: number
  /** Interpolated payback month, or null if never within the horizon. */
  paybackMonth: number | null
  width?: number
  height?: number
}

export default function PaybackSparkline({
  curve,
  cpa,
  paybackMonth,
  width = 96,
  height = 28,
}: Props) {
  if (curve.length < 2) return null

  const pad = 3
  const w = width - pad * 2
  const h = height - pad * 2
  const maxY = Math.max(...curve, cpa) || 1
  const lastM = curve.length - 1

  const x = (m: number) => pad + (m / lastM) * w
  const y = (v: number) => pad + h - (v / maxY) * h

  const points = curve.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const cpaY = y(cpa)

  const paysBack = paybackMonth !== null
  // Interpolate the curve's value at the (fractional) payback month
  let markerX: number | null = null
  let markerY: number | null = null
  if (paysBack) {
    const m = Math.min(paybackMonth!, lastM)
    const lo = Math.floor(m)
    const hi = Math.min(lo + 1, lastM)
    const v = curve[lo] + (curve[hi] - curve[lo]) * (m - lo)
    markerX = x(m)
    markerY = y(v)
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {/* CPA reference line */}
      <line
        x1={pad}
        x2={width - pad}
        y1={cpaY}
        y2={cpaY}
        stroke="#737373"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      {/* Cumulative cash curve */}
      <polyline
        points={points}
        fill="none"
        stroke={paysBack ? "#CDFF00" : "#f87171"}
        strokeOpacity={paysBack ? 0.9 : 0.7}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Payback crossing marker */}
      {markerX !== null && markerY !== null && (
        <circle cx={markerX} cy={markerY} r={2.5} fill="#CDFF00" />
      )}
    </svg>
  )
}
