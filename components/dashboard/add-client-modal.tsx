"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"

type Props = {
  onClose: () => void
}

const CURRENCIES = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "EUR", label: "EUR — Euro" },
]

export default function AddClientModal({ onClose }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [metaAccountId, setMetaAccountId] = useState("")
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("USD")
  const [error, setError] = useState<string | null>(null)

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [handleClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError("Client name is required")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          meta_account_id: metaAccountId.trim() || null,
          google_ads_customer_id: googleAdsCustomerId.trim() || null,
          currency_code: currencyCode,
        }),
      })

      if (res.ok) {
        router.refresh()
        handleClose()
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body?.error || `Failed to create client (${res.status})`)
      }
    } catch {
      setError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    "w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 placeholder:text-neutral-600"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Add Client</h2>
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
          Add a new client to the dashboard.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Client Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Client Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. R.A.D"
              className={inputClass}
              autoFocus
            />
          </div>

          {/* Meta Account ID */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Meta Account ID
            </label>
            <input
              type="text"
              value={metaAccountId}
              onChange={(e) => setMetaAccountId(e.target.value)}
              placeholder="e.g. 563562107983174"
              className={inputClass}
            />
          </div>

          {/* Google Ads Customer ID */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Google Ads Customer ID
            </label>
            <input
              type="text"
              value={googleAdsCustomerId}
              onChange={(e) => setGoogleAdsCustomerId(e.target.value)}
              placeholder="e.g. 1234567890"
              className={inputClass}
            />
          </div>

          {/* Currency */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Currency
            </label>
            <select
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
              className={inputClass}
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-lime px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-brand-lime/90 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Add Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
