"use client"

import { useState, useEffect, useCallback } from "react"

export type Tag = {
  id: string
  name: string
  color: string
}

const PRESET_COLORS = [
  "#CDFF00", "#22c55e", "#3b82f6", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#94a3b8",
]

type Props = {
  tags: Tag[]
  onClose: () => void
  onTagsChanged: () => void
}

export default function TagManagerModal({ tags, onClose, onTagsChanged }: Props) {
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState("#CDFF00")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editColor, setEditColor] = useState("")
  const [saving, setSaving] = useState(false)

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [handleClose])

  async function handleCreate() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/creative-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      })
      if (res.ok) {
        setNewName("")
        onTagsChanged()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/creative-tags/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      })
      if (res.ok) {
        setEditingId(null)
        onTagsChanged()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setSaving(true)
    try {
      await fetch(`/api/creative-tags/${id}`, { method: "DELETE" })
      onTagsChanged()
    } finally {
      setSaving(false)
    }
  }

  function startEdit(tag: Tag) {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Manage Tags</h2>
          <button
            onClick={handleClose}
            className="text-neutral-500 transition hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Create new tag */}
        <div className="mb-4 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New tag name..."
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={saving || !newName.trim()}
              className="rounded-lg bg-brand-lime px-4 py-2 text-sm font-medium text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {/* Color picker */}
          <div className="flex gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`h-5 w-5 rounded-full border-2 transition ${
                  newColor === c ? "border-white" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Tag list */}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-neutral-800"
            >
              {editingId === tag.id ? (
                <>
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: editColor }}
                  />
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white focus:border-brand-lime focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUpdate(tag.id)
                      if (e.key === "Escape") setEditingId(null)
                    }}
                    autoFocus
                  />
                  <div className="flex gap-0.5">
                    {PRESET_COLORS.slice(0, 5).map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        className={`h-3 w-3 rounded-full border ${
                          editColor === c ? "border-white" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => handleUpdate(tag.id)}
                    className="text-xs text-brand-lime"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-neutral-500"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="flex-1 text-sm text-neutral-200">
                    {tag.name}
                  </span>
                  <button
                    onClick={() => startEdit(tag)}
                    className="text-xs text-neutral-500 transition hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(tag.id)}
                    className="text-xs text-neutral-500 transition hover:text-red-400"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          ))}
          {tags.length === 0 && (
            <p className="py-4 text-center text-sm text-neutral-500">
              No tags yet. Create one above.
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleClose}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
