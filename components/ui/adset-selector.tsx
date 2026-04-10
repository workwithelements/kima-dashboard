"use client"

import { useState, useRef, useEffect, useMemo } from "react"

type AdSetItem = { id: string; name: string; active?: boolean }

export default function AdSetSelector({
  items,
  selected,
  onChange,
  label: itemLabel = "ad sets",
}: {
  items: AdSetItem[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** Label used in the button and header, e.g. "ad sets" or "ad groups" */
  label?: string
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

  const allSelected = selected.length === items.length || selected.length === 0
  const buttonLabel = allSelected
    ? `All ${itemLabel}`
    : selected.length === 1
      ? items.find((a) => a.id === selected[0])?.name || `1 ${itemLabel.replace(/s$/, "")}`
      : `${selected.length} ${itemLabel}`

  function toggle(id: string) {
    if (selected.includes(id)) {
      const next = selected.filter((s) => s !== id)
      onChange(next.length === 0 ? items.map((a) => a.id) : next)
    } else {
      onChange([...selected, id])
    }
  }

  function selectAll() {
    onChange(items.map((a) => a.id))
  }

  function clearAll() {
    if (items.length) onChange([items[0].id])
  }

  if (items.length <= 1) return null

  const headerLabel = itemLabel.toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600 hover:text-white"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span>{buttonLabel}</span>
        <svg className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl md:w-80">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{headerLabel}</span>
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

          {items.length > 5 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${itemLabel}...`}
              className="mb-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none"
              autoFocus
            />
          )}

          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {items.filter((a) => !search || a.name.toLowerCase().includes(search.toLowerCase())).map((a) => {
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
                  {a.active !== undefined && (
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        a.active ? "bg-green-400" : "bg-red-400"
                      }`}
                      title={a.active ? "Active" : "Inactive"}
                    />
                  )}
                  <span className={`break-all ${checked ? "text-white" : "text-neutral-400"}`}>
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
