/** Skeleton shown while Creative Analysis data loads */
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-40 rounded bg-neutral-800" />
        <div className="h-8 w-48 rounded-lg bg-neutral-800" />
      </div>

      {/* Classification bar */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="h-6 w-full rounded bg-neutral-800" />
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
            <div className="aspect-video bg-neutral-800" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-3/4 rounded bg-neutral-800" />
              <div className="h-3 w-1/2 rounded bg-neutral-800" />
              <div className="grid grid-cols-3 gap-2 mt-2">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="h-3 rounded bg-neutral-800" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
