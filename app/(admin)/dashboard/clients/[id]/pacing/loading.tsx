/** Skeleton shown while Budget & Pacing data loads */
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Pacing card */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-32 rounded bg-neutral-800" />
          <div className="h-6 w-20 rounded-full bg-neutral-800" />
        </div>
        <div className="h-3 w-full rounded-full bg-neutral-800 mb-3" />
        <div className="flex justify-between">
          <div className="h-4 w-24 rounded bg-neutral-800" />
          <div className="h-4 w-24 rounded bg-neutral-800" />
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="h-4 w-36 rounded bg-neutral-800 mb-4" />
          <div className="h-60 rounded bg-neutral-800/50" />
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="h-4 w-32 rounded bg-neutral-800 mb-4" />
          <div className="h-60 rounded bg-neutral-800/50" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="h-3 w-20 rounded bg-neutral-800 mb-2" />
            <div className="h-6 w-16 rounded bg-neutral-800" />
          </div>
        ))}
      </div>
    </div>
  )
}
