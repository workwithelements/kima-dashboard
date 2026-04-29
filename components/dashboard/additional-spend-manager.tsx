"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { fmtCurrency, fmtDateShort } from "@/lib/utils/format"
import type { AdditionalSpendEntry } from "@/lib/utils/types"

type Props = {
  clientId: string
  currency: string
  initialEntries: AdditionalSpendEntry[]
}

type FormState = {
  start_date: string
  end_date: string
  amount: string
  note: string
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm(): FormState {
  const t = todayISO()
  return { start_date: t, end_date: t, amount: "", note: "" }
}

export default function AdditionalSpendManager({ clientId, currency, initialEntries }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setForm(emptyForm())
    setError(null)
  }

  function startEdit(entry: AdditionalSpendEntry) {
    setEditingId(entry.id)
    setAdding(false)
    setForm({
      start_date: entry.start_date,
      end_date: entry.end_date,
      amount: String(entry.amount),
      note: entry.note ?? "",
    })
    setError(null)
  }

  function cancel() {
    setAdding(false)
    setEditingId(null)
    resetForm()
  }

  function validate(): string | null {
    if (!form.start_date || !form.end_date) return "Both dates are required."
    if (form.end_date < form.start_date) return "End date must be on or after start date."
    const amt = Number(form.amount)
    if (!Number.isFinite(amt) || amt < 0) return "Amount must be a non-negative number."
    return null
  }

  async function submitAdd() {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/clients/${clientId}/additional-spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: form.start_date,
        end_date: form.end_date,
        amount: Number(form.amount),
        note: form.note.trim() || null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j?.error || `Failed (${res.status})`)
      return
    }
    setAdding(false)
    resetForm()
    router.refresh()
  }

  async function submitEdit(id: string) {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/clients/${clientId}/additional-spend/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: form.start_date,
        end_date: form.end_date,
        amount: Number(form.amount),
        note: form.note.trim() || null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j?.error || `Failed (${res.status})`)
      return
    }
    setEditingId(null)
    resetForm()
    router.refresh()
  }

  async function remove(id: string) {
    if (!confirm("Delete this additional spend entry?")) return
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/additional-spend/${id}`, {
      method: "DELETE",
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(`Failed to delete: ${j?.error || res.status}`)
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-white">Additional Spend</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Off-platform spend (TV, billboards, retainers, etc.) included in pacing only.
            Amount is split evenly across days in the range.
          </p>
        </div>
        {!adding && editingId === null && (
          <button
            onClick={() => { setAdding(true); resetForm() }}
            className="rounded-md bg-brand-lime px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-brand-lime/90"
          >
            + Add entry
          </button>
        )}
      </div>

      {adding && (
        <EntryForm
          form={form}
          setForm={setForm}
          currency={currency}
          busy={busy}
          error={error}
          submitLabel="Add"
          onSubmit={submitAdd}
          onCancel={cancel}
        />
      )}

      {initialEntries.length === 0 && !adding ? (
        <p className="text-xs text-neutral-500">No additional spend entries yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {initialEntries.map((entry) => {
            const isEditing = editingId === entry.id
            const days =
              Math.round(
                (Date.parse(entry.end_date + "T00:00:00Z") -
                  Date.parse(entry.start_date + "T00:00:00Z")) /
                  86_400_000
              ) + 1
            const perDay = days > 0 ? entry.amount / days : entry.amount
            return (
              <li key={entry.id} className="py-3">
                {isEditing ? (
                  <EntryForm
                    form={form}
                    setForm={setForm}
                    currency={currency}
                    busy={busy}
                    error={error}
                    submitLabel="Save"
                    onSubmit={() => submitEdit(entry.id)}
                    onCancel={cancel}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm font-medium tabular-nums text-white">
                          {fmtCurrency(entry.amount, currency)}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {entry.start_date === entry.end_date
                            ? fmtDateShort(entry.start_date)
                            : `${fmtDateShort(entry.start_date)} – ${fmtDateShort(entry.end_date)}`}
                        </span>
                        {days > 1 && (
                          <span className="text-[11px] text-neutral-500">
                            ({days} days · {fmtCurrency(perDay, currency)}/day)
                          </span>
                        )}
                      </div>
                      {entry.note && (
                        <p className="mt-1 text-xs text-neutral-400">{entry.note}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => startEdit(entry)}
                        disabled={busy}
                        className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white disabled:opacity-50"
                        title="Edit"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => remove(entry.id)}
                        disabled={busy}
                        className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-red-400 disabled:opacity-50"
                        title="Delete"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function EntryForm({
  form,
  setForm,
  currency,
  busy,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  form: FormState
  setForm: (f: FormState) => void
  currency: string
  busy: boolean
  error: string | null
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
}) {
  const inputCls =
    "w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-white focus:border-brand-lime focus:outline-none"
  return (
    <div className="mb-4 rounded-md border border-neutral-800 bg-neutral-950 p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-400">Start date</span>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: form.end_date < e.target.value ? e.target.value : form.end_date })}
            className={inputCls}
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-400">End date</span>
          <input
            type="date"
            value={form.end_date}
            min={form.start_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-400">Amount ({currency})</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className={inputCls + " tabular-nums"}
            placeholder="0.00"
          />
        </label>
        <label className="block text-xs sm:col-span-1">
          <span className="mb-1 block text-neutral-400">Note (optional)</span>
          <input
            type="text"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className={inputCls}
            placeholder="e.g. TV campaign"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={busy}
          className="rounded-md bg-brand-lime px-3 py-1 text-xs font-medium text-neutral-900 transition hover:bg-brand-lime/90 disabled:opacity-50"
        >
          {busy ? "Saving..." : submitLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-3 py-1 text-xs text-neutral-400 transition hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
