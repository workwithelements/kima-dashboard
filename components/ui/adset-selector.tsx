"use client"

import { useState, useRef, useEffect, useMemo } from "react"

type AdSet = { id: string; name: string }

export default function AdSetSelector({
  adsets,
  selected,
  onChange,
}: {
  adsets: AdSet[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const allSelected = selected.length === adsets.length || selected.length === 0
  const label = allSelected
    ? "All ad sets"
    : selected.length === 1
      ? adsets.find((a) => a.id === selected[0])?.name || "1 ad set"
      : `${selected.length} ad sets`

  function toggle(id: string) {
    if (selected.includes(id)) {
      const next = selected.filter((s) => s !== id)
      // If removing the last one, reset to all
      onChange(next.length === 0 ? adsets.map((a) => a.id) : next)
    } else {
      onChange([...selected, id])
    }
  }

  function selectAll() {
    onChange(adsets.map((a) => a.id))
  }

  function clearAll() {
    // Keep at least 1 — select only the first
    if (adsets.length) onChange([adsets[0].id])
  }

  if (adsets.length <= 1) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600 hover:text-white"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span>{label}</span>
        <svg className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Ad Sets</span>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-[10px] text-neutral-400 hover:text-white"
              >
                All
              </button>
              <button
                onClick={clearAll}
                className="text-[10px] text-neutral-400 hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>

          {adsets.length > 5 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ad sets..."
              className="mb-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none"
              autoFocus
            />
          )}

          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {adsets.filter((a) => !search || a.name.toLowerCase().includes(search.toLowerCase())).map((a) => {
              const checked = allSelected || selected.includes(a.id)
              return (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-neutral-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(a.id)}
                    className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-800 text-brand-lime focus:ring-brand-lime/30"
                  />
                  <span className={checked ? "text-white" : "text-neutral-400"}>
                    {a.name}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
