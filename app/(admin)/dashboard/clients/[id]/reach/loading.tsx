/** Skeleton shown while Reach Analysis data loads */
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-32 rounded bg-neutral-800" />
        <div className="h-8 w-48 rounded-lg bg-neutral-800" />
      </div>

      {/* Scorecards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="h-3 w-16 rounded bg-neutral-800 mb-2" />
            <div className="h-6 w-24 rounded bg-neutral-800" />
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="h-4 w-28 rounded bg-neutral-800 mb-4" />
          <div className="h-72 rounded bg-neutral-800/50" />
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="h-4 w-28 rounded bg-neutral-800 mb-4" />
          <div className="h-72 rounded bg-neutral-800/50" />
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="h-4 w-24 rounded bg-neutral-800 mb-4" />
          <div className="h-64 rounded bg-neutral-800/50" />
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="h-4 w-32 rounded bg-neutral-800 mb-4" />
          <div className="h-64 rounded bg-neutral-800/50" />
        </div>
      </div>
    </div>
  )
}
