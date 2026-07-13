"use client"

import { useEffect, useMemo, useState } from "react"
import {
  DEFAULT_LTV_ASSUMPTIONS,
  scoreAd,
  type LtvAssumptions,
} from "@/lib/utils/unit-economics"
import { fmtCurrencyWhole, fmtDateFull } from "@/lib/utils/format"

type FieldDef = {
  key: keyof LtvAssumptions
  label: string
  hint?: string
  /** "amount" renders as currency; "pct" renders 0-1 fractions as %; "int" plain integer; "ratio" plain decimal. */
  kind: "amount" | "pct" | "int" | "ratio"
}

type Group = { title: string; fields: FieldDef[] }

const GROUPS: Group[] = [
  {
    title: "Annual plan",
    fields: [
      { key: "annualY1Upfront", label: "Year-1 upfront price", hint: "Cash collected on day 0", kind: "amount" },
      { key: "annualRenewalPrice", label: "Renewal price (yr 2+)", kind: "amount" },
      { key: "year2RenewalRate", label: "Year-2 renewal rate", hint: "Share of annual starters billing a 2nd year", kind: "pct" },
      { key: "year3RenewalRate", label: "Year-3 renewal rate", hint: "Share billing a 3rd year", kind: "pct" },
    ],
  },
  {
    title: "Monthly plan",
    fields: [
      { key: "monthlyPrice", label: "Monthly price", kind: "amount" },
      { key: "firstMonthDiscount", label: "First-month discount", hint: "Acquisition offer", kind: "pct" },
      { key: "monthlyMedianLTV", label: "Median lifetime value", hint: "Full median LTV of a monthly customer", kind: "amount" },
    ],
  },
  {
    title: "Targets",
    fields: [
      { key: "targetMargin", label: "Target margin after CAC", kind: "pct" },
      { key: "ltvCacTarget", label: "LTV:CAC target", kind: "ratio" },
      { key: "horizonMonths", label: "Payback horizon (months)", kind: "int" },
    ],
  },
  {
    title: "Fallback",
    fields: [
      {
        key: "fallbackAnnualMix",
        label: "Account annual mix",
        hint: "Used for ads with no applications-submitted data",
        kind: "pct",
      },
    ],
  },
]

function toInputValue(key: keyof LtvAssumptions, kind: FieldDef["kind"], cfg: LtvAssumptions): string {
  const v = cfg[key]
  if (kind === "pct") return String(Math.round(v * 10000) / 100)
  return String(v)
}

type Props = {
  clientId: string
  currency: string
  assumptions: LtvAssumptions
  updatedAt: string | null
  updatedBy: string | null
  /** Non-admins get a read-only view. */
  canEdit: boolean
  onClose: () => void
  onSaved: (assumptions: LtvAssumptions, updatedAt: string | null, updatedBy: string | null) => void
}

export default function LtvAssumptionsModal({
  clientId,
  currency,
  assumptions,
  updatedAt,
  updatedBy,
  canEdit,
  onClose,
  onSaved,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const g of GROUPS) for (const f of g.fields) out[f.key] = toInputValue(f.key, f.kind, assumptions)
    return out
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onClose])

  /** Parse current inputs back into an LtvAssumptions; null when any field is invalid. */
  const draft: LtvAssumptions | null = useMemo(() => {
    const out = { ...DEFAULT_LTV_ASSUMPTIONS }
    for (const g of GROUPS) {
      for (const f of g.fields) {
        const raw = values[f.key]
        const n = Number(raw)
        if (raw === "" || !isFinite(n)) return null
        out[f.key] = f.kind === "pct" ? n / 100 : n
      }
    }
    return out
  }, [values])

  // Live preview so edits are tangible before saving
  const preview = useMemo(() => {
    if (!draft) return null
    return scoreAd({ cpa: 1, annualMix: 0.3 }, draft)
  }, [draft])

  function setField(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  function resetDefaults() {
    const out: Record<string, string> = {}
    for (const g of GROUPS)
      for (const f of g.fields) out[f.key] = toInputValue(f.key, f.kind, DEFAULT_LTV_ASSUMPTIONS)
    setValues(out)
  }

  async function handleSave() {
    if (!draft) {
      setError("All fields must be valid numbers")
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/ltv-assumptions/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Save failed (${res.status})`)
      }
      const saved = await res.json()
      onSaved(saved.assumptions as LtvAssumptions, saved.updated_at ?? null, saved.updated_by ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-medium">LTV Model Assumptions</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {canEdit
                ? "Estimates refreshed periodically from Baremetrics — edits recompute every ad instantly."
                : "Read-only — only the admin account can edit these."}
              {updatedAt
                ? ` Last updated ${fmtDateFull(updatedAt.split("T")[0])}${updatedBy ? ` by ${updatedBy}` : ""}.`
                : " Using defaults (never saved)."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="flex items-baseline justify-between text-xs text-neutral-400">
                        {f.label}
                        {f.hint && <span className="ml-2 text-[10px] text-neutral-600">{f.hint}</span>}
                      </span>
                      <div className="mt-1 flex items-center gap-1.5">
                        {f.kind === "amount" && (
                          <span className="text-xs text-neutral-500">
                            {currency === "GBP" ? "£" : currency === "USD" ? "$" : "€"}
                          </span>
                        )}
                        <input
                          type="number"
                          step="any"
                          value={values[f.key]}
                          onChange={(e) => setField(f.key, e.target.value)}
                          disabled={!canEdit}
                          placeholder={toInputValue(f.key, f.kind, DEFAULT_LTV_ASSUMPTIONS)}
                          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-white placeholder-neutral-600 focus:border-brand-lime focus:outline-none disabled:opacity-60"
                        />
                        {f.kind === "pct" && <span className="text-xs text-neutral-500">%</span>}
                        {f.kind === "ratio" && <span className="text-xs text-neutral-500">x</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {preview && (
            <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-800/30 px-3 py-2 text-xs text-neutral-400">
              Preview at 30% annual mix: blended LTV{" "}
              <span className="font-medium text-white">{fmtCurrencyWhole(preview.blendedLTV, currency)}</span>
              {" · "}max CAC <span className="font-medium text-white">{fmtCurrencyWhole(preview.maxCAC, currency)}</span>
              {" · "}day-0 cash <span className="font-medium text-white">{fmtCurrencyWhole(preview.immCAC, currency)}</span>
            </div>
          )}
        </div>

        <div className="border-t border-neutral-800 px-6 py-4">
          {error && (
            <p className="mb-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between">
            {canEdit ? (
              <button
                onClick={resetDefaults}
                className="text-xs text-neutral-500 transition hover:text-white"
              >
                Reset to defaults
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
              >
                {canEdit ? "Cancel" : "Close"}
              </button>
              {canEdit && (
                <button
                  onClick={handleSave}
                  disabled={saving || !draft}
                  className="rounded-lg bg-brand-lime px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-brand-lime/90 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
