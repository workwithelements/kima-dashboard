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
}: {
  label: string
  value: string
  subValue?: string
}) {
  return (
    <Card>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {subValue && <p className="mt-0.5 text-xs text-neutral-500">{subValue}</p>}
    </Card>
  )
}
