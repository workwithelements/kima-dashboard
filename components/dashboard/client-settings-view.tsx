"use client"

import { useState, useEffect } from "react"

/* ── Types ── */
type NamingPosition = { index: number; key: string; label: string }

const STANDARD_KEYS = [
  { key: "format", label: "Format" },
  { key: "landingPage", label: "Landing Page" },
  { key: "launchDate", label: "Launch Date" },
  { key: "conceptName", label: "Concept" },
  { key: "conceptCopy", label: "Copy" },
  { key: "creator", label: "Creator" },
  { key: "styleOfContent", label: "Style" },
  { key: "campaign", label: "Campaign" },
  { key: "version", label: "Version" },
]

/* ── Component ── */
export default function ClientSettingsView({ clientId }: { clientId: string }) {
  /* ── Naming config state ── */
  const [positions, setPositions] = useState<NamingPosition[]>([])
  const [valueMaps, setValueMaps] = useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showValueMaps, setShowValueMaps] = useState(false)

  /* ── Load existing config ── */
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/naming-config/${clientId}`)
        if (res.ok) {
          const data = await res.json()
          if (data) {
            setPositions(data.positions || [])
            setValueMaps(data.value_maps || {})
          }
        }
      } catch {
        /* ignore */
      }
      setLoading(false)
    }
    load()
  }, [clientId])

  /* ── Position CRUD ── */
  function addPosition() {
    const nextIndex =
      positions.length > 0 ? Math.max(...positions.map((p) => p.index)) + 1 : 0
    setPositions([...positions, { index: nextIndex, key: "format", label: "Format" }])
    setSaved(false)
  }

  function removePosition(idx: number) {
    setPositions(positions.filter((_, i) => i !== idx))
    setSaved(false)
  }

  function movePosition(idx: number, direction: "up" | "down") {
    if (
      (direction === "up" && idx === 0) ||
      (direction === "down" && idx === positions.length - 1)
    )
      return
    const newPositions = [...positions]
    const target = direction === "up" ? idx - 1 : idx + 1
    const tmpIndex = newPositions[idx].index
    newPositions[idx] = { ...newPositions[idx], index: newPositions[target].index }
    newPositions[target] = { ...newPositions[target], index: tmpIndex }
    ;[newPositions[idx], newPositions[target]] = [newPositions[target], newPositions[idx]]
    setPositions(newPositions)
    setSaved(false)
  }

  function updatePosition(idx: number, field: "key" | "label" | "index", value: string | number) {
    const newPositions = [...positions]
    if (field === "key") {
      const stdKey = STANDARD_KEYS.find((s) => s.key === value)
      newPositions[idx] = {
        ...newPositions[idx],
        key: value as string,
        label: stdKey?.label || newPositions[idx].label,
      }
    } else if (field === "label") {
      newPositions[idx] = { ...newPositions[idx], label: value as string }
    } else {
      newPositions[idx] = { ...newPositions[idx], index: value as number }
    }
    setPositions(newPositions)
    setSaved(false)
  }

  /* ── Value map CRUD ── */
  function addValueMapEntry(dimKey: string) {
    setValueMaps((prev) => ({
      ...prev,
      [dimKey]: { ...(prev[dimKey] || {}), "": "" },
    }))
    setSaved(false)
  }

  function updateValueMapEntry(dimKey: string, oldCode: string, newCode: string, newLabel: string) {
    setValueMaps((prev) => {
      const map = { ...(prev[dimKey] || {}) }
      if (oldCode !== newCode) delete map[oldCode]
      if (newCode) map[newCode] = newLabel
      return { ...prev, [dimKey]: map }
    })
    setSaved(false)
  }

  function removeValueMapEntry(dimKey: string, code: string) {
    setValueMaps((prev) => {
      const map = { ...(prev[dimKey] || {}) }
      delete map[code]
      return { ...prev, [dimKey]: map }
    })
    setSaved(false)
  }

  /* ── Save ── */
  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/naming-config/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions, value_maps: valueMaps }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      /* ignore */
    }
    setSaving(false)
  }

  const usedKeys = positions.map((p) => p.key)

  /* ── Render ── */
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ── Naming Convention Section ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Naming Convention
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Define how underscore-delimited ad names map to dimensions. This powers
            filters and grouping on the Performance and Creative tabs.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-6 p-5">
            {/* ── Position list ── */}
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-400">
                Position Mapping
              </p>

              {positions.length === 0 && (
                <p className="mb-3 rounded-lg border border-dashed border-neutral-700 px-4 py-6 text-center text-xs text-neutral-500">
                  No positions configured. Add positions to map underscore-separated segments in your ad names to dimensions.
                </p>
              )}

              <div className="space-y-2">
                {positions.map((pos, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800/50 px-3 py-2"
                  >
                    {/* Position index */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-neutral-500">Pos</span>
                      <input
                        type="number"
                        value={pos.index}
                        onChange={(e) =>
                          updatePosition(idx, "index", parseInt(e.target.value) || 0)
                        }
                        className="w-10 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center text-xs text-white focus:border-brand-lime focus:outline-none"
                        min={0}
                      />
                    </div>

                    {/* Dimension key dropdown */}
                    <select
                      value={
                        STANDARD_KEYS.find((s) => s.key === pos.key)
                          ? pos.key
                          : "__custom__"
                      }
                      onChange={(e) => {
                        if (e.target.value !== "__custom__") {
                          updatePosition(idx, "key", e.target.value)
                        }
                      }}
                      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 focus:border-brand-lime focus:outline-none"
                    >
                      {STANDARD_KEYS.map((sk) => (
                        <option key={sk.key} value={sk.key}>
                          {sk.label}
                        </option>
                      ))}
                      <option value="__custom__">Custom…</option>
                    </select>

                    {/* Custom key input */}
                    {!STANDARD_KEYS.find((s) => s.key === pos.key) && (
                      <input
                        type="text"
                        value={pos.key}
                        onChange={(e) => {
                          const key = e.target.value
                            .replace(/\s+/g, "_")
                            .toLowerCase()
                          updatePosition(idx, "key", key)
                        }}
                        placeholder="key"
                        className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-brand-lime focus:outline-none"
                      />
                    )}

                    {/* Label */}
                    <input
                      type="text"
                      value={pos.label}
                      onChange={(e) => updatePosition(idx, "label", e.target.value)}
                      placeholder="Display label"
                      className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-brand-lime focus:outline-none"
                    />

                    {/* Move up / down */}
                    <button
                      onClick={() => movePosition(idx, "up")}
                      disabled={idx === 0}
                      className="rounded p-0.5 text-neutral-500 transition hover:text-white disabled:opacity-30"
                      title="Move up"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 15l7-7 7 7"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => movePosition(idx, "down")}
                      disabled={idx === positions.length - 1}
                      className="rounded p-0.5 text-neutral-500 transition hover:text-white disabled:opacity-30"
                      title="Move down"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>

                    {/* Remove */}
                    <button
                      onClick={() => removePosition(idx)}
                      className="rounded p-0.5 text-neutral-500 transition hover:text-red-400"
                      title="Remove"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={addPosition}
                className="mt-2 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:text-brand-lime"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add Position
              </button>
            </div>

            {/* ── Value Mappings (collapsible) ── */}
            <div>
              <button
                onClick={() => setShowValueMaps(!showValueMaps)}
                className="flex items-center gap-2 text-xs font-medium text-neutral-400 transition hover:text-neutral-200"
              >
                <svg
                  className={`h-3 w-3 transition ${showValueMaps ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                Value Mappings
                <span className="text-[10px] font-normal text-neutral-500">
                  (optional code → label translations)
                </span>
              </button>

              {showValueMaps && (
                <div className="mt-3 space-y-4">
                  {usedKeys.length === 0 ? (
                    <p className="text-xs text-neutral-500">
                      Add positions above first, then configure value mappings per
                      dimension.
                    </p>
                  ) : (
                    Array.from(new Set(usedKeys)).map((dimKey) => {
                      const dimLabel =
                        positions.find((p) => p.key === dimKey)?.label || dimKey
                      const entries = Object.entries(valueMaps[dimKey] || {})
                      return (
                        <div
                          key={dimKey}
                          className="rounded-lg border border-neutral-800 p-3"
                        >
                          <p className="mb-2 text-xs font-medium text-neutral-300">
                            {dimLabel}
                          </p>
                          {entries.map(([code, label], eIdx) => (
                            <div
                              key={eIdx}
                              className="mb-1.5 flex items-center gap-2"
                            >
                              <input
                                type="text"
                                value={code}
                                onChange={(e) =>
                                  updateValueMapEntry(
                                    dimKey,
                                    code,
                                    e.target.value,
                                    label,
                                  )
                                }
                                placeholder="Code"
                                className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-brand-lime focus:outline-none"
                              />
                              <span className="text-xs text-neutral-600">→</span>
                              <input
                                type="text"
                                value={label}
                                onChange={(e) =>
                                  updateValueMapEntry(
                                    dimKey,
                                    code,
                                    code,
                                    e.target.value,
                                  )
                                }
                                placeholder="Display label"
                                className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-brand-lime focus:outline-none"
                              />
                              <button
                                onClick={() => removeValueMapEntry(dimKey, code)}
                                className="rounded p-0.5 text-neutral-500 transition hover:text-red-400"
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addValueMapEntry(dimKey)}
                            className="text-[10px] text-neutral-500 transition hover:text-brand-lime"
                          >
                            + Add mapping
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>

            {/* ── Save button ── */}
            <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
              {saved && (
                <span className="text-xs font-medium text-green-400">
                  ✓ Saved
                </span>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Future settings sections go here ── */}
      {/* Example: Scorecard Config, Data Sources, etc. */}
    </div>
  )
}
