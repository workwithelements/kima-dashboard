/** Skeleton shown while Breakdowns data loads */
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <div className="h-8 w-28 rounded-lg bg-neutral-800" />
          <div className="h-8 w-24 rounded-lg bg-neutral-800" />
        </div>
        <div className="h-8 w-48 rounded-lg bg-neutral-800" />
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="h-4 w-32 rounded bg-neutral-800 mb-4" />
        <div className="h-80 rounded bg-neutral-800/50" />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 w-28 rounded bg-neutral-800" />
              <div className="h-4 w-16 rounded bg-neutral-800" />
              <div className="h-4 w-16 rounded bg-neutral-800" />
              <div className="h-4 w-16 rounded bg-neutral-800" />
              <div className="h-4 w-16 rounded bg-neutral-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
