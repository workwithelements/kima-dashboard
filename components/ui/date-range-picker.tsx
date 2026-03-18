"use client"

import { useState, useRef, useEffect } from "react"
import type { DatePreset } from "@/lib/utils/dates"

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "last_7d" },
  { label: "Last 30 days", value: "last_30d" },
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
  { label: "This quarter", value: "this_quarter" },
  { label: "Last quarter", value: "last_quarter" },
  { label: "Year to date", value: "ytd" },
  { label: "Custom", value: "custom" },
]

export default function DateRangePicker({
  preset,
  from,
  to,
  onPresetChange,
  onCustomChange,
}: {
  preset: DatePreset
  from: string
  to: string
  onPresetChange: (p: DatePreset) => void
  onCustomChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [showCustom, setShowCustom] = useState(preset === "custom")
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // Keep local custom values in sync with props
  useEffect(() => {
    if (from) setCustomFrom(from)
    if (to) setCustomTo(to)
  }, [from, to])

  const activeLabel = PRESETS.find((p) => p.value === preset)?.label || "Custom"

  // Safe date display — handle empty/invalid strings
  function formatDate(dateStr: string) {
    if (!dateStr) return "—"
    const d = new Date(dateStr + "T00:00:00")
    if (isNaN(d.getTime())) return "—"
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  }

  const displayFrom = formatDate(from)
  const displayTo = formatDate(to)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600 hover:text-white"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{displayFrom} – {displayTo}</span>
        <svg className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          <div className="space-y-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  if (p.value === "custom") {
                    setShowCustom(true)
                  } else {
                    setShowCustom(false)
                    onPresetChange(p.value)
                    setOpen(false)
                  }
                }}
                className={`w-full rounded-lg px-3 py-1.5 text-left text-xs transition ${
                  (p.value === "custom" && showCustom) || (p.value !== "custom" && preset === p.value && !showCustom)
                    ? "bg-brand-lime/10 text-brand-lime"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {showCustom && (
            <div className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
              <div>
                <label className="text-[10px] text-neutral-500">From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => {
                    setCustomFrom(e.target.value)
                    if (e.target.value && customTo) {
                      onCustomChange(e.target.value, customTo)
                    }
                  }}
                  className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500">To</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => {
                    setCustomTo(e.target.value)
                    if (customFrom && e.target.value) {
                      onCustomChange(customFrom, e.target.value)
                    }
                  }}
                  className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
