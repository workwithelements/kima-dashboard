"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { fmtCurrency } from "@/lib/utils/format"

type Props = {
  clientId: string
  currentBudget: number | null
  currency: string
}

export default function BudgetEditor({ clientId, currentBudget, currency }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentBudget?.toString() ?? "")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const budgetVal = value.trim() === "" ? null : Number(value)

    if (budgetVal !== null && (isNaN(budgetVal) || budgetVal < 0)) {
      alert("Please enter a valid positive number")
      setSaving(false)
      return
    }

    const res = await fetch(`/api/clients/${clientId}/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_budget: budgetVal }),
    })

    if (res.ok) {
      setEditing(false)
      router.refresh()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Failed to save: ${err?.error || res.status}`)
    }
    setSaving(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-neutral-400">Monthly Budget</label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-500">{currency}</span>
          <input
            type="number"
            min="0"
            step="100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave()
              if (e.key === "Escape") setEditing(false)
            }}
            autoFocus
            className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm tabular-nums text-white focus:border-brand-lime focus:outline-none"
            placeholder="e.g. 5000"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-lime px-3 py-1 text-xs font-medium text-neutral-900 transition hover:bg-brand-lime/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setValue(currentBudget?.toString() ?? "")
            }}
            className="rounded-md px-3 py-1 text-xs text-neutral-400 transition hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-neutral-400">Monthly Budget:</span>
      <span className="text-sm font-medium tabular-nums text-white">
        {currentBudget ? fmtCurrency(currentBudget, currency) : "Not set"}
      </span>
      <button
        onClick={() => {
          setValue(currentBudget?.toString() ?? "")
          setEditing(true)
        }}
        className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
        title="Edit budget"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
    </div>
  )
}
