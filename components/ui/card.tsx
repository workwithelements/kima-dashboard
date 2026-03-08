export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-neutral-800 bg-neutral-900 p-5 ${className}`}>
      {children}
    </div>
  )
}

export function MetricCard({
  label,
  value,
  subValue,
  delta,
  invertDelta,
}: {
  label: string
  value: string
  subValue?: string
  delta?: { text: string; positive: boolean } | null
  /** If true, red means positive (e.g. CPA going up is bad) */
  invertDelta?: boolean
}) {
  const deltaColor = delta
    ? (delta.positive !== (invertDelta || false))
      ? "text-green-400"
      : "text-red-400"
    : ""

  return (
    <Card>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {delta && delta.text !== "—" && (
          <span className={`text-xs font-medium ${deltaColor}`}>{delta.text}</span>
        )}
        {subValue && <span className="text-xs text-neutral-500">{subValue}</span>}
      </div>
    </Card>
  )
}
