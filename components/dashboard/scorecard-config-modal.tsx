"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  FUNNEL_STEP_DEFS,
  FUNNEL_STEP_ORDER,
  AMPLITUDE_STEP_PREFIX,
  isAmplitudeStep,
  amplitudeChartId,
  type FunnelStepKey,
} from "@/lib/utils/funnel-steps"
import {
  SYNTHESISED_DEFAULT_ID,
  type FunnelView,
} from "@/lib/utils/funnel-views"

type Campaign = { id: string; name: string; active?: boolean }

type Props = {
  clientId: string
  views: FunnelView[]
  initialActiveViewId?: string | null
  contributionMarginPct?: number | null
  /** Meta campaigns available for linking. Optional — if empty, picker is hidden. */
  campaigns?: Campaign[]
  onClose: () => void
  onSaved: (views: FunnelView[], contributionMarginPct: number | null) => void
}

type DraftView = FunnelView & {
  /** True when this draft has never been persisted (new, or synthesised). */
  _new: boolean
  /** True when the user has edited fields on this draft. */
  _dirty: boolean
}

function makeDraft(v: FunnelView): DraftView {
  return {
    ...v,
    _new: v.id === SYNTHESISED_DEFAULT_ID || v.id.startsWith("tmp_"),
    _dirty: false,
  }
}

function blankDraft(sortOrder: number): DraftView {
  return {
    id: `tmp_${Math.random().toString(36).slice(2, 10)}`,
    name: "New view",
    sort_order: sortOrder,
    funnel_steps: [],
    key_action: null,
    linked_campaign_ids: [],
    is_default: false,
    _new: true,
    _dirty: true,
  }
}

export default function ScorecardConfigModal({
  clientId,
  views: initialViews,
  initialActiveViewId,
  contributionMarginPct: initialCmPct = null,
  campaigns = [],
  onClose,
  onSaved,
}: Props) {
  const [drafts, setDrafts] = useState<DraftView[]>(() =>
    initialViews.map(makeDraft)
  )
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const [amplitudeCharts, setAmplitudeCharts] = useState<
    Array<{ chart_id: string; title: string | null }>
  >([])

  // Pull saved Amplitude charts so they show up as available funnel steps.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/clients/${clientId}/amplitude`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setAmplitudeCharts(
          Array.isArray(data.charts)
            ? data.charts.map((c: { chart_id: string; title: string | null }) => ({
                chart_id: c.chart_id,
                title: c.title,
              }))
            : []
        )
      })
      .catch(() => {
        /* ignore — amplitude is optional */
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  const amplitudeStepLabel = useCallback(
    (key: string) => {
      const id = amplitudeChartId(key)
      const found = amplitudeCharts.find((c) => c.chart_id === id)
      return found?.title?.trim() || `Amplitude: ${id}`
    },
    [amplitudeCharts]
  )
  const [activeId, setActiveId] = useState<string>(() => {
    const requested = initialActiveViewId
      ? drafts.find((d) => d.id === initialActiveViewId)?.id
      : null
    return (
      requested ||
      initialViews.find((v) => v.is_default)?.id ||
      initialViews[0]?.id ||
      ""
    )
  })
  const [cmPct, setCmPct] = useState<string>(
    initialCmPct != null ? String(initialCmPct) : ""
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = useMemo(
    () => drafts.find((d) => d.id === activeId) || drafts[0] || null,
    [drafts, activeId]
  )

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [handleClose])

  function patchActive(patch: Partial<FunnelView>) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === activeId ? { ...d, ...patch, _dirty: true } : d
      )
    )
  }

  function addStep(key: string) {
    if (!active) return
    patchActive({ funnel_steps: [...active.funnel_steps, key] })
  }
  function removeStep(key: string) {
    if (!active) return
    patchActive({
      funnel_steps: active.funnel_steps.filter((k) => k !== key),
      key_action: active.key_action === key ? null : active.key_action,
    })
  }
  function moveStep(key: string, dir: -1 | 1) {
    if (!active) return
    const idx = active.funnel_steps.indexOf(key)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= active.funnel_steps.length) return
    const next = [...active.funnel_steps]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    patchActive({ funnel_steps: next })
  }
  function toggleKeyAction(key: string) {
    if (!active) return
    patchActive({ key_action: active.key_action === key ? null : key })
  }
  function toggleLinkedCampaign(id: string) {
    if (!active) return
    const has = active.linked_campaign_ids.includes(id)
    patchActive({
      linked_campaign_ids: has
        ? active.linked_campaign_ids.filter((c) => c !== id)
        : [...active.linked_campaign_ids, id],
    })
  }
  function setAsDefault() {
    if (!active) return
    setDrafts((prev) =>
      prev.map((d) => ({
        ...d,
        is_default: d.id === activeId,
        _dirty: d.id === activeId || d.is_default ? true : d._dirty,
      }))
    )
  }
  function renameActive(name: string) {
    patchActive({ name })
  }
  function addView() {
    const nextOrder = drafts.length
    const fresh = blankDraft(nextOrder)
    setDrafts((prev) => [...prev, fresh])
    setActiveId(fresh.id)
  }
  function deleteActive() {
    if (!active) return
    if (drafts.length <= 1) {
      setError("At least one view is required")
      return
    }
    if (!active._new) {
      setDeletedIds((prev) => [...prev, active.id])
    }
    const wasDefault = active.is_default
    const remaining = drafts.filter((d) => d.id !== active.id)
    // Promote first remaining to default if the deleted one was default.
    const next = wasDefault
      ? remaining.map((d, i) => ({ ...d, is_default: i === 0, _dirty: true }))
      : remaining
    setDrafts(next)
    setActiveId(next[0]?.id || "")
  }
  function moveView(id: string, dir: -1 | 1) {
    const idx = drafts.findIndex((d) => d.id === id)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= drafts.length) return
    const next = [...drafts]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setDrafts(next.map((d, i) => ({ ...d, sort_order: i })))
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const cmVal = cmPct.trim() === "" ? null : Number(cmPct)
      if (cmVal !== null && (isNaN(cmVal) || cmVal < 0 || cmVal > 100)) {
        setError("Contribution margin must be between 0 and 100")
        setSaving(false)
        return
      }

      // Persist CM % on the client-wide scorecard config.
      const cmRes = await fetch(`/api/scorecard-config/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contribution_margin_pct: cmVal }),
      })
      if (!cmRes.ok) {
        const body = await cmRes.json().catch(() => ({}))
        throw new Error(body?.error || `Save failed (${cmRes.status})`)
      }

      // 1. Deletes (real rows only)
      for (const id of deletedIds) {
        const res = await fetch(`/api/funnel-views/${clientId}/${id}`, {
          method: "DELETE",
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Delete failed (${res.status})`)
        }
      }

      // 2. Creates + updates. Track tmp_id → real_id.
      const idMap = new Map<string, string>()
      const persisted: FunnelView[] = []

      for (const d of drafts) {
        if (d._new) {
          const res = await fetch(`/api/funnel-views/${clientId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: d.name,
              funnel_steps: d.funnel_steps,
              key_action: d.key_action,
              linked_campaign_ids: d.linked_campaign_ids,
              is_default: d.is_default,
            }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body?.error || `Create failed (${res.status})`)
          }
          const created = (await res.json()) as FunnelView
          idMap.set(d.id, created.id)
          persisted.push(created)
        } else if (d._dirty) {
          const res = await fetch(`/api/funnel-views/${clientId}/${d.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: d.name,
              funnel_steps: d.funnel_steps,
              key_action: d.key_action,
              linked_campaign_ids: d.linked_campaign_ids,
              is_default: d.is_default,
            }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body?.error || `Update failed (${res.status})`)
          }
          const updated = (await res.json()) as FunnelView
          persisted.push(updated)
        } else {
          persisted.push({
            id: d.id,
            name: d.name,
            sort_order: d.sort_order,
            funnel_steps: d.funnel_steps,
            key_action: d.key_action,
            linked_campaign_ids: d.linked_campaign_ids,
            is_default: d.is_default,
          })
        }
      }

      // 3. Reorder (use real IDs in draft order).
      const orderedIds = drafts.map((d) => idMap.get(d.id) || d.id)
      const reorderRes = await fetch(
        `/api/funnel-views/${clientId}/reorder`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
        }
      )
      if (!reorderRes.ok) {
        const body = await reorderRes.json().catch(() => ({}))
        throw new Error(body?.error || `Reorder failed (${reorderRes.status})`)
      }

      // Preserve draft order on the outgoing list.
      const finalOrdered = orderedIds
        .map((id) => persisted.find((p) => p.id === id))
        .filter((v): v is FunnelView => !!v)
        .map((v, i) => ({ ...v, sort_order: i }))

      onSaved(finalOrdered, cmVal)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
      setSaving(false)
    }
  }

  const available = active
    ? FUNNEL_STEP_ORDER.filter((k) => !active.funnel_steps.includes(k))
    : []
  const availableAmplitude = active
    ? amplitudeCharts.filter(
        (c) =>
          !active.funnel_steps.includes(`${AMPLITUDE_STEP_PREFIX}${c.chart_id}`)
      )
    : []

  const linkedSet = new Set(active?.linked_campaign_ids ?? [])
  const deactivatedLinked = active
    ? active.linked_campaign_ids.filter(
        (id) => !campaigns.some((c) => c.id === id)
      )
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-medium">Configure Funnel Views</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Each view defines its own funnel steps, key action, and linked Meta campaigns.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left rail: view list */}
          <div className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/60">
            <div className="flex-1 overflow-y-auto py-2">
              {drafts.map((d, i) => {
                const isActive = d.id === activeId
                return (
                  <div
                    key={d.id}
                    className={`mx-2 mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition ${
                      isActive
                        ? "bg-brand-lime/10 text-brand-lime"
                        : "text-neutral-400 hover:bg-neutral-800/50 hover:text-white"
                    }`}
                  >
                    <div className="flex flex-col">
                      <button
                        onClick={() => moveView(d.id, -1)}
                        disabled={i === 0}
                        className="text-neutral-600 transition hover:text-white disabled:opacity-20"
                        title="Move up"
                      >
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveView(d.id, 1)}
                        disabled={i === drafts.length - 1}
                        className="text-neutral-600 transition hover:text-white disabled:opacity-20"
                        title="Move down"
                      >
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    <button
                      onClick={() => setActiveId(d.id)}
                      className="flex-1 truncate text-left"
                    >
                      <span className="truncate">{d.name || "Untitled"}</span>
                    </button>
                    {d.is_default && (
                      <span className="ml-1 rounded bg-neutral-800 px-1 text-[9px] uppercase tracking-wider text-neutral-500">
                        Default
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <button
              onClick={addView}
              className="mx-2 mb-2 flex items-center justify-center gap-1 rounded-md border border-dashed border-neutral-700 py-1.5 text-xs text-neutral-400 transition hover:border-brand-lime/60 hover:text-brand-lime"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New view
            </button>
          </div>

          {/* Right pane */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {active ? (
              <>
                {/* Name */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                    View name
                  </label>
                  <input
                    value={active.name}
                    onChange={(e) => renameActive(e.target.value)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-white focus:border-brand-lime focus:outline-none"
                  />
                </div>

                {/* Active steps */}
                <div className="mb-4">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                    Funnel steps ({active.funnel_steps.length})
                  </h3>
                  {active.funnel_steps.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-neutral-700 p-3 text-center text-xs text-neutral-500">
                      No steps yet — pick one below
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {active.funnel_steps.map((key, i) => {
                        const isAmp = isAmplitudeStep(key)
                        const def = isAmp ? null : FUNNEL_STEP_DEFS[key]
                        if (!isAmp && !def) return null
                        const label = isAmp ? amplitudeStepLabel(key) : def!.label
                        const subLabel = isAmp
                          ? "Amplitude · count only"
                          : `${def!.rateLabel} · ${def!.costLabel}`
                        const isKey = active.key_action === key
                        return (
                          <div
                            key={key}
                            className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800/50 px-3 py-2"
                          >
                            <div className="flex flex-col">
                              <button
                                onClick={() => moveStep(key, -1)}
                                disabled={i === 0}
                                className="text-neutral-600 transition hover:text-white disabled:opacity-30"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => moveStep(key, 1)}
                                disabled={i === active.funnel_steps.length - 1}
                                className="text-neutral-600 transition hover:text-white disabled:opacity-30"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                            <div className="flex-1">
                              <span className="text-sm">{label}</span>
                              <span className="ml-2 text-[10px] text-neutral-500">
                                {subLabel}
                              </span>
                            </div>
                            <button
                              onClick={() => toggleKeyAction(key)}
                              className={`rounded p-0.5 transition ${
                                isKey ? "text-brand-lime" : "text-neutral-600 hover:text-neutral-400"
                              }`}
                              title={isKey ? "Key action (click to unset)" : "Set as key action (CPA denominator)"}
                            >
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill={isKey ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
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

                {available.length > 0 && (
                  <div className="mb-4">
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

                {availableAmplitude.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                      Amplitude ({availableAmplitude.length})
                    </h3>
                    <div className="space-y-1">
                      {availableAmplitude.map((c) => {
                        const key = `${AMPLITUDE_STEP_PREFIX}${c.chart_id}`
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
                              <span className="text-sm">
                                {c.title?.trim() || `Amplitude: ${c.chart_id}`}
                              </span>
                              <span className="ml-2 text-[10px] text-neutral-500">
                                Count only · no rate
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Linked campaigns */}
                {campaigns.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-neutral-500">
                      <span>
                        Linked Meta campaigns ({active.linked_campaign_ids.length})
                      </span>
                      <span className="text-[9px] font-normal normal-case text-neutral-600">
                        Empty = all campaigns
                      </span>
                    </h3>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/50 p-2">
                      {campaigns.map((c) => {
                        const checked = linkedSet.has(c.id)
                        return (
                          <label
                            key={c.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800/60"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleLinkedCampaign(c.id)}
                              className="h-3.5 w-3.5 accent-brand-lime"
                            />
                            <span className="flex-1 truncate">{c.name}</span>
                            {c.active === false && (
                              <span className="text-[9px] text-neutral-600">inactive</span>
                            )}
                          </label>
                        )
                      })}
                      {deactivatedLinked.map((id) => (
                        <label
                          key={id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-800/60"
                        >
                          <input
                            type="checkbox"
                            checked
                            onChange={() => toggleLinkedCampaign(id)}
                            className="h-3.5 w-3.5 accent-brand-lime"
                          />
                          <span className="flex-1 truncate">{id}</span>
                          <span className="rounded bg-neutral-800 px-1 text-[9px] uppercase tracking-wider text-neutral-500">
                            deactivated
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Default + delete */}
                <div className="flex items-center justify-between border-t border-neutral-800 pt-4">
                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={active.is_default}
                      onChange={() => setAsDefault()}
                      className="h-3.5 w-3.5 accent-brand-lime"
                    />
                    Set as default view
                  </label>
                  <button
                    onClick={deleteActive}
                    disabled={drafts.length <= 1}
                    className="text-xs text-red-400 transition hover:text-red-300 disabled:opacity-30"
                  >
                    Delete view
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-500">No view selected.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800 px-6 py-4">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-800/30 px-3 py-2">
            <div>
              <span className="text-xs font-medium text-neutral-400">Contribution Margin %</span>
              <p className="mt-0.5 text-[10px] text-neutral-600">
                Client-wide. CM3 = Revenue &times; CM% &minus; Ad Spend
              </p>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={cmPct}
                onChange={(e) => setCmPct(e.target.value)}
                placeholder="—"
                className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-sm text-white placeholder-neutral-600 focus:border-brand-lime focus:outline-none"
              />
              <span className="text-xs text-neutral-500">%</span>
            </div>
          </div>

          {error && (
            <p className="mb-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3">
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
    </div>
  )
}
