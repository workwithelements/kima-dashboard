"use client"

import type { AdPlatform } from "@/lib/utils/types"

export type PlatformView = AdPlatform | "all"

const PLATFORM_LABELS: Record<PlatformView, string> = {
  all: "All Platforms",
  meta: "Meta",
  google_ads: "Google Ads",
  shopify: "Shopify",
}

export default function PlatformSelector({
  platforms,
  selected,
  onChange,
}: {
  /** Available platforms for this client */
  platforms: AdPlatform[]
  selected: PlatformView
  onChange: (view: PlatformView) => void
}) {
  // Don't render if client only has one platform
  if (platforms.length <= 1) return null

  const options: PlatformView[] = ["all", ...platforms]

  return (
    <div className="inline-flex rounded-lg border border-neutral-700 bg-neutral-800/50 p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
            selected === opt
              ? "bg-neutral-700 text-white"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          {PLATFORM_LABELS[opt]}
        </button>
      ))}
    </div>
  )
}
