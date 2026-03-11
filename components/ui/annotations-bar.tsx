"use client"

import { useState, useCallback } from "react"

export type Annotation = {
  id: string
  date: string
  text: string
  created_at?: string
}

type Props = {
  annotations: Annotation[]
  clientId: string
  from: string
  to: string
  onAdd?: (a: Annotation) => void
  onDelete?: (id: string) => void
  /** Read-only mode hides add/delete controls */
  readOnly?: boolean
}

export default function AnnotationsBar({
  annotations,
  clientId,
  from,
  to,
  onAdd,
  onDelete,
  readOnly = false,
}: Props) {
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newDate, setNewDate] = useState("")
  const [newText, setNewText] = useState("")
  const [saving, setSaving] = useState(false)

  const handleAdd = useCallback(async () => {
    if (!newDate || !newText.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/annotations/${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate, text: newText.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        onAdd?.(data)
        setNewDate("")
        setNewText("")
        setAdding(false)
      }
    } finally {
      setSaving(false)
    }
  }, [clientId, newDate, newText, onAdd])

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/annotations/${clientId}?id=${id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        onDelete?.(id)
      }
    },
    [clientId, onDelete]
  )

  if (annotations.length === 0 && readOnly) return null

  return (
    <div className="mt-2">
      {/* Marker timeline */}
      {annotations.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1 flex-wrap">
            {annotations.map((a) => (
              <div key={a.id} className="group relative">
                <div
                  className="h-4 w-4 flex items-center justify-center cursor-default"
                  title={`${a.date}: ${a.text}`}
                >
                  <svg
                    className="h-3 w-3 text-brand-lime/70 group-hover:text-brand-lime transition"
                    viewBox="0 0 10 10"
                    fill="currentColor"
                  >
                    <polygon points="5,0 10,10 0,10" />
                  </svg>
                </div>
                {/* Hover tooltip */}
                <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-20 w-48 rounded-lg bg-neutral-800 border border-neutral-700 p-2 text-xs shadow-lg">
                  <p className="text-neutral-400 text-[10px] mb-0.5">{a.date}</p>
                  <p className="text-neutral-200">{a.text}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowAll(!showAll)}
            className="ml-auto text-[10px] text-neutral-500 hover:text-neutral-300 transition"
          >
            {showAll ? "Hide Notes" : `${annotations.length} Note${annotations.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {/* Expanded list */}
      {showAll && annotations.length > 0 && (
        <div className="mb-3 space-y-1.5 rounded-lg bg-neutral-800/50 border border-neutral-700/50 p-3">
          {annotations.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2 text-xs group"
            >
              <span className="text-neutral-500 shrink-0 tabular-nums">
                {a.date}
              </span>
              <span className="text-neutral-300 flex-1">{a.text}</span>
              {!readOnly && (
                <button
                  onClick={() => handleDelete(a.id)}
                  className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition shrink-0"
                  title="Delete note"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add note form */}
      {!readOnly && !adding && (
        <button
          onClick={() => {
            setAdding(true)
            setNewDate(from)
          }}
          className="text-[10px] text-neutral-500 hover:text-brand-lime transition inline-flex items-center gap-1"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Note
        </button>
      )}

      {!readOnly && adding && (
        <div className="flex items-center gap-2 mt-1">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            min={from}
            max={to}
            className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-brand-lime/50"
          />
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Note..."
            className="flex-1 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-brand-lime/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd()
              if (e.key === "Escape") setAdding(false)
            }}
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newText.trim()}
            className="rounded-md bg-brand-lime/20 text-brand-lime px-2 py-1 text-xs font-medium hover:bg-brand-lime/30 transition disabled:opacity-50"
          >
            {saving ? "..." : "Save"}
          </button>
          <button
            onClick={() => setAdding(false)}
            className="text-neutral-500 hover:text-neutral-300 text-xs"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
