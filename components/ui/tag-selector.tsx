"use client"

import { useState, useRef, useEffect } from "react"

type TagItem = { id: string; name: string; color: string }

/** Special ID for the "Untagged" virtual filter option */
export const UNTAGGED_FILTER_ID = "__untagged__"

export default function TagSelector({
  tags,
  selected,
  onChange,
}: {
  tags: TagItem[]
  /** Selected tag IDs — empty means "all" */
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // All items = real tags + "Untagged" virtual option
  const allItems: TagItem[] = [
    ...tags,
    { id: UNTAGGED_FILTER_ID, name: "Untagged", color: "#525252" },
  ]

  const allSelected = selected.length === 0
  const buttonLabel = allSelected
    ? "All tags"
    : selected.length === 1
      ? allItems.find((t) => t.id === selected[0])?.name || "1 tag"
      : `${selected.length} tags`

  function toggle(id: string) {
    if (selected.includes(id)) {
      const next = selected.filter((s) => s !== id)
      onChange(next)
    } else {
      onChange([...selected, id])
    }
  }

  function selectAll() {
    onChange([])
  }

  function clearAll() {
    if (allItems.length) onChange([allItems[0].id])
  }

  if (tags.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600 hover:text-white"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <span>{buttonLabel}</span>
        <svg className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">TAGS</span>
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

          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {allItems.map((tag) => {
              const checked = allSelected || selected.includes(tag.id)
              return (
                <label
                  key={tag.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-neutral-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(tag.id)}
                    className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-800 text-brand-lime focus:ring-brand-lime/30"
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className={`break-all ${checked ? "text-white" : "text-neutral-400"}`}>
                    {tag.name}
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
