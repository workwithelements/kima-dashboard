"use client"

import { useState } from "react"
import type { CustomMetric } from "@/lib/utils/types"
import { BASE_METRIC_FIELDS } from "@/lib/utils/types"
import MetricFormModal from "./metric-form-modal"

type Props = {
  initialMetrics: CustomMetric[]
}

export default function CustomMetricsManager({ initialMetrics }: Props) {
  const [metrics, setMetrics] = useState<CustomMetric[]>(initialMetrics)
  const [showModal, setShowModal] = useState(false)
  const [editingMetric, setEditingMetric] = useState<CustomMetric | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const presets = metrics.filter((m) => m.is_preset)
  const custom = metrics.filter((m) => !m.is_preset)

  function handleCreate() {
    setEditingMetric(null)
    setShowModal(true)
  }

  function handleEdit(metric: CustomMetric) {
    setEditingMetric(metric)
    setShowModal(true)
  }

  async function handleDelete(metric: CustomMetric) {
    if (metric.is_preset) return
    if (!confirm(`Delete "${metric.name}"? This cannot be undone.`)) return

    setDeleting(metric.id)
    try {
      const res = await fetch(`/api/custom-metrics/${metric.id}`, { method: "DELETE" })
      if (res.ok) {
        setMetrics((prev) => prev.filter((m) => m.id !== metric.id))
      } else {
        const { error } = await res.json()
        alert(error || "Failed to delete metric")
      }
    } finally {
      setDeleting(null)
    }
  }

  function handleSaved(saved: CustomMetric) {
    setMetrics((prev) => {
      const exists = prev.find((m) => m.id === saved.id)
      if (exists) {
        return prev.map((m) => (m.id === saved.id ? saved : m))
      }
      return [...prev, saved]
    })
    setShowModal(false)
    setEditingMetric(null)
  }

  function getFieldLabel(field: string): string {
    return BASE_METRIC_FIELDS.find((f) => f.value === field)?.label || field
  }

  function getFormulaDisplay(m: CustomMetric): string {
    const num = getFieldLabel(m.numerator)
    const den = getFieldLabel(m.denominator)
    const mult = m.multiplier !== 1 ? ` × ${m.multiplier}` : ""
    return `${num} / ${den}${mult}`
  }

  function getFormatBadge(format: string): { label: string; className: string } {
    switch (format) {
      case "currency":
        return { label: "£", className: "bg-green-500/10 text-green-400" }
      case "percentage":
        return { label: "%", className: "bg-blue-500/10 text-blue-400" }
      default:
        return { label: "#", className: "bg-neutral-500/10 text-neutral-400" }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Custom Metrics</h2>
          <p className="text-sm text-neutral-400">
            Define calculated metrics from your performance data. These appear in client scorecards.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="rounded-lg bg-brand-lime px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-brand-lime/90"
        >
          + New Metric
        </button>
      </div>

      {/* Preset metrics */}
      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
          Preset Metrics ({presets.length})
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((m) => {
            const badge = getFormatBadge(m.format)
            return (
              <div
                key={m.id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {getFormulaDisplay(m)}
                    </p>
                  </div>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                    preset
                  </span>
                </div>
                {m.description && (
                  <p className="mt-2 text-xs text-neutral-500">{m.description}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Custom metrics */}
      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
          Your Metrics ({custom.length})
        </h3>
        {custom.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-700 p-8 text-center">
            <p className="text-sm text-neutral-500">
              No custom metrics yet. Click &quot;+ New Metric&quot; to create one.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {custom.map((m) => {
              const badge = getFormatBadge(m.format)
              return (
                <div
                  key={m.id}
                  className="group rounded-lg border border-neutral-800 bg-neutral-900/50 p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{m.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        {getFormulaDisplay(m)}
                      </p>
                    </div>
                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => handleEdit(m)}
                        className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
                        title="Edit"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(m)}
                        disabled={deleting === m.id}
                        className="rounded p-1 text-neutral-500 transition hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50"
                        title="Delete"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {m.description && (
                    <p className="mt-2 text-xs text-neutral-500">{m.description}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <MetricFormModal
          metric={editingMetric}
          onClose={() => {
            setShowModal(false)
            setEditingMetric(null)
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
