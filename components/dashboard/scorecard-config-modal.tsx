"use client"

import { useState, useEffect, useCallback } from "react"
import {
  FUNNEL_STEP_DEFS,
  FUNNEL_STEP_ORDER,
  type FunnelStepKey,
} from "@/lib/utils/funnel-steps"

type Props = {
  clientId: string
  selectedSteps: string[]
  keyAction?: string | null
  onClose: () => void
  onSaved: (steps: string[], keyAction: string | null) => void
}

export default function ScorecardConfigModal({
  clientId,
  selectedSteps: initialSteps,
  keyAction: initialKeyAction,
  onClose,
  onSaved,
}: Props) {
  const [selected, setSelected] = useState<string[]>(initialSteps)
  const [keyAction, setKeyAction] = useState<string | null>(
    initialKeyAction ?? (initialSteps.length > 0 ? initialSteps[initialSteps.length - 1] : null)
  )
  const [saving, setSaving] = useState(false)

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [handleClose])

  function addStep(key: string) {
    setSelected((prev) => [...prev, key])
  }

  function removeStep(key: string) {
    setSelected((prev) => prev.filter((k) => k !== key))
    if (keyAction === key) setKeyAction(null)
  }

  function moveUp(key: string) {
    setSelected((prev) => {
      const idx = prev.indexOf(key)
      if (idx <= 0) return prev
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }

  function moveDown(key: string) {
    setSelected((prev) => {
      const idx = prev.indexOf(key)
      if (idx < 0 || idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/scorecard-config/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnel_steps: selected, key_action: keyAction }),
      })
      if (res.ok) {
        onSaved(selected, keyAction)
      } else {
        const errBody = await res.json().catch(() => ({}))
        alert(`Failed to save configuration: ${errBody?.error || res.status}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const available = FUNNEL_STEP_ORDER.filter((k) => !selected.includes(k))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Configure Funnel Steps</h2>
          <button
            onClick={handleClose}
            className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="mt-1 text-xs text-neutral-500">
          Each step generates 3 cards: count, rate, and cost per.
          Use the star to set the key action for the CPA chart.
        </p>

        {/* Active steps — ordered list */}
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Active ({selected.length})
          </h3>
          {selected.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-3 text-center text-xs text-neutral-500">
              No funnel steps — only core metrics will show
            </p>
          ) : (
            <div className="space-y-1">
              {selected.map((key, i) => {
                const def = FUNNEL_STEP_DEFS[key]
                if (!def) return null
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800/50 px-3 py-2"
                  >
                    {/* Reorder arrows */}
                    <div className="flex flex-col">
                      <button
                        onClick={() => moveUp(key)}
                        disabled={i === 0}
                        className="text-neutral-600 transition hover:text-white disabled:opacity-30"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveDown(key)}
                        disabled={i === selected.length - 1}
                        className="text-neutral-600 transition hover:text-white disabled:opacity-30"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                    <div className="flex-1">
                      <span className="text-sm">{def.label}</span>
                      <span className="ml-2 text-[10px] text-neutral-500">
                        {def.rateLabel} · {def.costLabel}
                      </span>
                    </div>

                    {/* Key action star toggle */}
                    <button
                      onClick={() => setKeyAction(keyAction === key ? null : key)}
                      className={`rounded p-0.5 transition ${
                        keyAction === key
                          ? "text-brand-lime"
                          : "text-neutral-600 hover:text-neutral-400"
                      }`}
                      title={keyAction === key ? "Key action (click to unset)" : "Set as key action (CPA denominator)"}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill={keyAction === key ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>

                    <button
                      onClick={() => removeStep(key)}
                      className="rounded p-0.5 text-neutral-500 transition hover:text-red-400"
                      title="Remove"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Available steps */}
        {available.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
              Available ({available.length})
            </h3>
            <div className="space-y-1">
              {available.map((key) => {
                const def = FUNNEL_STEP_DEFS[key as FunnelStepKey]
                if (!def) return null
                return (
                  <button
                    key={key}
                    onClick={() => addStep(key)}
                    className="flex w-full items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-left transition hover:border-neutral-700 hover:bg-neutral-800/50"
                  >
                    <svg className="h-3.5 w-3.5 text-brand-lime" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    <div className="flex-1">
                      <span className="text-sm">{def.label}</span>
                      <span className="ml-2 text-[10px] text-neutral-500">
                        {def.rateLabel} · {def.costLabel}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-brand-lime px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-brand-lime/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
