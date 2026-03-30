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
  { label: "Retention Lift Test", href: "/retention-lift-test", clientOnly: "TouchNote" },
  { label: "Settings", href: "/settings" },
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
        {TABS.filter((tab) => !tab.clientOnly || tab.clientOnly === clientName).map((tab) => {
          const href = basePath + tab.href + (tab.href === "/settings" ? "" : suffix)
          const tabPath = basePath + tab.href
          const isActive =
            tab.href === ""
              ? pathname === basePath
              : pathname === tabPath || pathname.startsWith(tabPath + "/")
          const isSettings = tab.href === "/settings"

          return (
            <Link
              key={tab.label}
              href={href}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
                isSettings ? "ml-auto" : ""
              } ${
                isActive
                  ? "border-brand-lime text-brand-lime"
                  : "border-transparent text-neutral-400 hover:border-neutral-600 hover:text-white"
              }`}
            >
              {isSettings ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.212-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                  {tab.label}
                </span>
              ) : (
                tab.label
              )}
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
