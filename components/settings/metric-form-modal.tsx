"use client"

import { useState, useEffect } from "react"
import type { CustomMetric } from "@/lib/utils/types"
import { BASE_METRIC_FIELDS } from "@/lib/utils/types"

type Props = {
  metric: CustomMetric | null // null = create mode
  onClose: () => void
  onSaved: (metric: CustomMetric) => void
}

export default function MetricFormModal({ metric, onClose, onSaved }: Props) {
  const isEdit = !!metric

  const [name, setName] = useState(metric?.name || "")
  const [numerator, setNumerator] = useState(metric?.numerator || "spend")
  const [denominator, setDenominator] = useState(metric?.denominator || "impressions")
  const [multiplier, setMultiplier] = useState(metric?.multiplier ?? 1)
  const [format, setFormat] = useState<"number" | "currency" | "percentage">(
    metric?.format || "number"
  )
  const [decimals, setDecimals] = useState(metric?.decimals ?? 2)
  const [description, setDescription] = useState(metric?.description || "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onClose])

  // Preview formula
  function getFieldLabel(field: string): string {
    return BASE_METRIC_FIELDS.find((f) => f.value === field)?.label || field
  }

  const formulaPreview = `${getFieldLabel(numerator)} ÷ ${getFieldLabel(denominator)}${
    multiplier !== 1 ? ` × ${multiplier}` : ""
  }`

  // Format preview value
  function getPreviewValue(): string {
    const val = 1.2345
    switch (format) {
      case "currency":
        return `£${val.toFixed(decimals)}`
      case "percentage":
        return `${val.toFixed(decimals)}%`
      default:
        return val.toFixed(decimals)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (!name.trim()) {
      setError("Name is required")
      return
    }
    if (numerator === denominator) {
      setError("Numerator and denominator must be different")
      return
    }

    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        numerator,
        denominator,
        multiplier,
        format,
        decimals,
        description: description.trim() || null,
      }

      const url = isEdit ? `/api/custom-metrics/${metric.id}` : "/api/custom-metrics"
      const method = isEdit ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const { error: msg } = await res.json()
        setError(msg || "Failed to save")
        return
      }

      const saved = await res.json()
      onSaved(saved)
    } catch {
      setError("Network error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {isEdit ? "Edit Metric" : "New Custom Metric"}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Metric Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Conversion Rate"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-brand-lime"
            />
          </div>

          {/* Formula row */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            {/* Numerator */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Numerator
              </label>
              <select
                value={numerator}
                onChange={(e) => setNumerator(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-lime"
              >
                {BASE_METRIC_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <span className="pb-2 text-lg text-neutral-500">÷</span>

            {/* Denominator */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Denominator
              </label>
              <select
                value={denominator}
                onChange={(e) => setDenominator(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-lime"
              >
                {BASE_METRIC_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Multiplier + Format + Decimals */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Multiplier
              </label>
              <input
                type="number"
                value={multiplier}
                onChange={(e) => setMultiplier(Number(e.target.value))}
                step="any"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-lime"
              />
              <p className="mt-0.5 text-[10px] text-neutral-600">
                100 for percentages
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Format
              </label>
              <select
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as "number" | "currency" | "percentage")
                }
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-lime"
              >
                <option value="number">Number</option>
                <option value="currency">Currency (£)</option>
                <option value="percentage">Percentage (%)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Decimals
              </label>
              <input
                type="number"
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
                min={0}
                max={6}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-lime"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief explanation of this metric"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-brand-lime"
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg bg-neutral-800/50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Preview
            </p>
            <p className="mt-1 text-sm text-neutral-300">
              <span className="text-brand-lime">{name || "Metric Name"}</span>
              {" = "}
              {formulaPreview}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Example output: {getPreviewValue()}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-lime px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-brand-lime/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Update Metric" : "Create Metric"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
