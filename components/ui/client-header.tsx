"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

type Props = {
  clientId: string
  clientName: string
}

const TABS = [
  { label: "Performance", href: "" },
  { label: "Creative Analysis", href: "/creative" },
  { label: "Breakdowns", href: "/breakdowns" },
  { label: "Budget & Pacing", href: "/pacing" },
  { label: "Reach Analysis", href: "/reach" },
]

export default function ClientHeader({ clientId, clientName }: Props) {
  const pathname = usePathname()
  const basePath = `/dashboard/clients/${clientId}`

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
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-neutral-800">
        {TABS.map((tab) => {
          const href = basePath + tab.href
          const isActive =
            tab.href === ""
              ? pathname === basePath
              : pathname === href || pathname.startsWith(href + "/")

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
    </div>
  )
}
