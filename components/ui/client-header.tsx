"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import ShareSettingsModal from "@/components/dashboard/share-settings-modal"

type Props = {
  clientId: string
  clientName: string
  slug?: string
}

const TABS = [
  { label: "Performance", href: "" },
  { label: "Creative Analysis", href: "/creative" },
  { label: "Budget & Pacing", href: "/pacing" },
  { label: "Reach Analysis", href: "/reach" },
]

export default function ClientHeader({ clientId, clientName, slug }: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const basePath = `/dashboard/clients/${clientId}`
  const qs = searchParams.toString()
  const suffix = qs ? `?${qs}` : ""

  const [showShare, setShowShare] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/clients"
          className="text-neutral-500 transition hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-semibold">{clientName}</h1>

        {/* Share button */}
        {slug && (
          <button
            onClick={() => setShowShare(true)}
            className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
            title="Share settings"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-neutral-800">
        {TABS.map((tab) => {
          const href = basePath + tab.href + suffix
          const tabPath = basePath + tab.href
          const isActive =
            tab.href === ""
              ? pathname === basePath
              : pathname === tabPath || pathname.startsWith(tabPath + "/")

          return (
            <Link
              key={tab.label}
              href={href}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? "border-brand-lime text-brand-lime"
                  : "border-transparent text-neutral-400 hover:border-neutral-600 hover:text-white"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Share settings modal */}
      {showShare && slug && (
        <ShareSettingsModal
          clientId={clientId}
          slug={slug}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}
