"use client"

import { useState, useEffect, useCallback } from "react"
import TagManagerModal, { type Tag } from "@/components/dashboard/tag-manager-modal"

/* ── Types ── */
type NamingPosition = { index: number; key: string; label: string }

type AlertConfig = {
  id?: string
  metric: string
  threshold_pct: number
  direction: "increase" | "decrease" | "either"
  slack_channel: string
  enabled: boolean
}

const ALERT_METRIC_OPTIONS = [
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "reach", label: "Reach" },
  { value: "unique_link_clicks", label: "Link Clicks" },
  { value: "landing_page_views", label: "Landing Page Views" },
  { value: "purchases", label: "Purchases" },
  { value: "purchase_value", label: "Revenue" },
  { value: "adds_to_cart", label: "Add to Carts" },
  { value: "checkouts_initiated", label: "Checkouts" },
  { value: "trials_started", label: "Trials Started" },
  { value: "cpa", label: "CPA" },
  { value: "roas", label: "ROAS" },
  { value: "ctr", label: "CTR" },
  { value: "cpm", label: "CPM" },
]

const DIRECTION_OPTIONS = [
  { value: "either", label: "Changes by" },
  { value: "increase", label: "Increases by" },
  { value: "decrease", label: "Decreases by" },
]

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
  const [separator, setSeparator] = useState<string>("_")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showValueMaps, setShowValueMaps] = useState(false)

  /* ── Alerts state ── */
  const [alerts, setAlerts] = useState<AlertConfig[]>([])
  const [alertsLoading, setAlertsLoading] = useState(true)
  const [alertsSaving, setAlertsSaving] = useState(false)
  const [alertsSaved, setAlertsSaved] = useState(false)

  /* ── Creative Tests config state ── */
  const [testConfig, setTestConfig] = useState({
    enabled: false,
    min_days_live: 5,
    min_spend: 100,
    min_conversions: 10,
    high_spend_alert: 150,
    notion_board_id: "",
    slack_channel_id: "",
    test_key_action: "",
  })
  const [testConfigLoading, setTestConfigLoading] = useState(true)
  const [testConfigSaving, setTestConfigSaving] = useState(false)
  const [testConfigSaved, setTestConfigSaved] = useState(false)

  /* ── Shopify config state ── */
  const [shopifyEnabled, setShopifyEnabled] = useState(false)
  const [shopifyDomain, setShopifyDomain] = useState("")
  const [shopifyLoading, setShopifyLoading] = useState(true)
  const [shopifySaving, setShopifySaving] = useState(false)
  const [shopifySaved, setShopifySaved] = useState(false)

  /* ── Marketing Impact config state ── */
  const [marketingImpactEnabled, setMarketingImpactEnabled] = useState(false)
  const [marketingImpactLoading, setMarketingImpactLoading] = useState(true)
  const [marketingImpactSaving, setMarketingImpactSaving] = useState(false)
  const [marketingImpactSaved, setMarketingImpactSaved] = useState(false)

  /* ── Amplitude config state ── */
  const [amplitudeEnabled, setAmplitudeEnabled] = useState(false)
  const [amplitudeOrg, setAmplitudeOrg] = useState("")
  const [amplitudeApiKey, setAmplitudeApiKey] = useState("")
  const [amplitudeSecretKey, setAmplitudeSecretKey] = useState("")
  const [amplitudeApiKeyPreview, setAmplitudeApiKeyPreview] = useState("")
  const [amplitudeHasCredentials, setAmplitudeHasCredentials] = useState(false)
  const [amplitudeEvents, setAmplitudeEvents] = useState<
    Array<{ event_name: string; display_title: string }>
  >([])
  const [amplitudeLoading, setAmplitudeLoading] = useState(true)
  const [amplitudeSaving, setAmplitudeSaving] = useState(false)
  const [amplitudeSaved, setAmplitudeSaved] = useState(false)
  const [amplitudeTesting, setAmplitudeTesting] = useState(false)
  const [amplitudeTestResult, setAmplitudeTestResult] = useState<
    | null
    | {
        ok: boolean
        event_name?: string
        window?: { from: string; to: string }
        status?: number
        code?: string
        reason?: string
        total?: number
        days_with_data?: number
        sample_points?: Array<{ date: string; value: number }>
        warning?: string
      }
  >(null)

  /* ── Creative tags state ── */
  const [tags, setTags] = useState<Tag[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [showTagManager, setShowTagManager] = useState(false)
  const loadTags = useCallback(async () => {
    setTagsLoading(true)
    try {
      const res = await fetch("/api/creative-tags")
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setTags(data)
      }
    } catch {
      /* ignore */
    }
    setTagsLoading(false)
  }, [])
  useEffect(() => {
    loadTags()
  }, [loadTags])

  /* ── Load existing config ── */
  useEffect(() => {
    async function load() {
      try {
        const [namingRes, alertsRes, testConfigRes, shopifyRes, marketingImpactRes, amplitudeRes] = await Promise.all([
          fetch(`/api/naming-config/${clientId}`),
          fetch(`/api/alert-config/${clientId}`),
          fetch(`/api/creative-test-config/${clientId}`),
          fetch(`/api/clients/${clientId}/shopify`),
          fetch(`/api/clients/${clientId}/marketing-impact`),
          fetch(`/api/clients/${clientId}/amplitude`),
        ])
        if (namingRes.ok) {
          const data = await namingRes.json()
          if (data) {
            setPositions(data.positions || [])
            setValueMaps(data.value_maps || {})
            if (data.separator) setSeparator(data.separator)
          }
        }
        if (alertsRes.ok) {
          const data = await alertsRes.json()
          if (Array.isArray(data)) setAlerts(data)
        }
        if (testConfigRes.ok) {
          const data = await testConfigRes.json()
          if (data) {
            setTestConfig({
              enabled: data.enabled ?? false,
              min_days_live: data.min_days_live ?? 5,
              min_spend: data.min_spend ?? 100,
              min_conversions: data.min_conversions ?? 10,
              high_spend_alert: data.high_spend_alert ?? 150,
              notion_board_id: data.notion_board_id ?? "",
              slack_channel_id: data.slack_channel_id ?? "",
              test_key_action: data.test_key_action ?? "",
            })
          }
        }
        if (shopifyRes.ok) {
          const data = await shopifyRes.json()
          if (data) {
            setShopifyEnabled(data.enabled ?? false)
            setShopifyDomain(data.store_domain ?? "")
          }
        }
        if (marketingImpactRes.ok) {
          const data = await marketingImpactRes.json()
          if (data) {
            setMarketingImpactEnabled(data.enabled ?? false)
          }
        }
        if (amplitudeRes.ok) {
          const data = await amplitudeRes.json()
          if (data) {
            setAmplitudeEnabled(data.enabled ?? false)
            setAmplitudeOrg(data.org ?? "")
            setAmplitudeHasCredentials(data.has_credentials ?? false)
            setAmplitudeApiKeyPreview(data.api_key_preview ?? "")
            setAmplitudeEvents(
              Array.isArray(data.events)
                ? data.events.map(
                    (e: { event_name: string; display_title: string | null }) => ({
                      event_name: e.event_name,
                      display_title: e.display_title ?? "",
                    })
                  )
                : []
            )
          }
        }
      } catch {
        /* ignore */
      }
      setLoading(false)
      setAlertsLoading(false)
      setTestConfigLoading(false)
      setShopifyLoading(false)
      setMarketingImpactLoading(false)
      setAmplitudeLoading(false)
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
        body: JSON.stringify({ positions, value_maps: valueMaps, separator }),
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

  /* ── Alert CRUD ── */
  function addAlert() {
    setAlerts([
      ...alerts,
      { metric: "spend", threshold_pct: 20, direction: "either", slack_channel: "", enabled: true },
    ])
    setAlertsSaved(false)
  }

  function updateAlert(idx: number, field: keyof AlertConfig, value: unknown) {
    const next = [...alerts]
    next[idx] = { ...next[idx], [field]: value }
    setAlerts(next)
    setAlertsSaved(false)
  }

  async function deleteAlert(idx: number) {
    const alert = alerts[idx]
    if (alert.id) {
      try {
        await fetch(`/api/alert-config/${clientId}?id=${alert.id}`, { method: "DELETE" })
      } catch { /* ignore */ }
    }
    setAlerts(alerts.filter((_, i) => i !== idx))
  }

  async function toggleAlert(idx: number) {
    const alert = alerts[idx]
    const newEnabled = !alert.enabled
    const next = [...alerts]
    next[idx] = { ...next[idx], enabled: newEnabled }
    setAlerts(next)
    if (alert.id) {
      try {
        await fetch(`/api/alert-config/${clientId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: alert.id, enabled: newEnabled }),
        })
      } catch { /* ignore */ }
    }
  }

  async function handleSaveAlerts() {
    setAlertsSaving(true)
    try {
      const updated: AlertConfig[] = []
      for (const alert of alerts) {
        if (!alert.slack_channel.trim()) continue
        if (alert.id) {
          const res = await fetch(`/api/alert-config/${clientId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: alert.id,
              metric: alert.metric,
              threshold_pct: alert.threshold_pct,
              direction: alert.direction,
              slack_channel: alert.slack_channel,
              enabled: alert.enabled,
            }),
          })
          if (res.ok) updated.push(await res.json())
          else updated.push(alert)
        } else {
          const res = await fetch(`/api/alert-config/${clientId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              metric: alert.metric,
              threshold_pct: alert.threshold_pct,
              direction: alert.direction,
              slack_channel: alert.slack_channel,
            }),
          })
          if (res.ok) updated.push(await res.json())
          else updated.push(alert)
        }
      }
      setAlerts(updated)
      setAlertsSaved(true)
      setTimeout(() => setAlertsSaved(false), 3000)
    } catch { /* ignore */ }
    setAlertsSaving(false)
  }

  /* ── Save creative test config ── */
  async function handleSaveTestConfig() {
    setTestConfigSaving(true)
    try {
      const res = await fetch(`/api/creative-test-config/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testConfig),
      })
      if (res.ok) {
        setTestConfigSaved(true)
        setTimeout(() => setTestConfigSaved(false), 3000)
      }
    } catch { /* ignore */ }
    setTestConfigSaving(false)
  }

  /* ── Save Shopify config ── */
  async function handleSaveShopify() {
    setShopifySaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/shopify`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: shopifyEnabled, store_domain: shopifyDomain }),
      })
      if (res.ok) {
        setShopifySaved(true)
        setTimeout(() => setShopifySaved(false), 3000)
      }
    } catch { /* ignore */ }
    setShopifySaving(false)
  }

  /* ── Save Amplitude config ── */
  async function handleSaveAmplitude() {
    setAmplitudeSaving(true)
    try {
      const body: Record<string, unknown> = {
        enabled: amplitudeEnabled,
        org: amplitudeOrg,
        events: amplitudeEvents.filter((e) => e.event_name.trim().length > 0),
      }
      // Only send credential fields when the user typed something — empty
      // strings would clobber stored values via the PUT semantics.
      if (amplitudeApiKey.trim()) body.api_key = amplitudeApiKey.trim()
      if (amplitudeSecretKey.trim()) body.secret_key = amplitudeSecretKey.trim()

      const res = await fetch(`/api/clients/${clientId}/amplitude`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setAmplitudeHasCredentials(data.has_credentials ?? false)
        setAmplitudeApiKeyPreview(data.api_key_preview ?? "")
        setAmplitudeApiKey("")
        setAmplitudeSecretKey("")
        setAmplitudeSaved(true)
        setTimeout(() => setAmplitudeSaved(false), 3000)
      }
    } catch { /* ignore */ }
    setAmplitudeSaving(false)
  }

  /* ── Test Amplitude connection ── */
  async function handleTestAmplitude() {
    setAmplitudeTesting(true)
    setAmplitudeTestResult(null)
    try {
      // If the user typed new credentials but hasn't saved yet, send them
      // along so they can validate before persisting.
      const body: Record<string, unknown> = {}
      if (amplitudeApiKey.trim()) body.api_key = amplitudeApiKey.trim()
      if (amplitudeSecretKey.trim()) body.secret_key = amplitudeSecretKey.trim()
      if (amplitudeEvents[0]?.event_name.trim()) {
        body.event_name = amplitudeEvents[0].event_name.trim()
      }
      const res = await fetch(`/api/clients/${clientId}/amplitude/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setAmplitudeTestResult(data)
    } catch (e) {
      setAmplitudeTestResult({
        ok: false,
        reason: e instanceof Error ? e.message : "Test request failed",
      })
    }
    setAmplitudeTesting(false)
  }

  /* ── Save Marketing Impact config ── */
  async function handleSaveMarketingImpact() {
    setMarketingImpactSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/marketing-impact`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: marketingImpactEnabled }),
      })
      if (res.ok) {
        setMarketingImpactSaved(true)
        setTimeout(() => setMarketingImpactSaved(false), 3000)
      }
    } catch { /* ignore */ }
    setMarketingImpactSaving(false)
  }

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
            Define how delimited ad names map to dimensions. This powers
            filters and grouping on the Performance and Creative tabs.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-6 p-5">
            {/* ── Separator ── */}
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-400">
                Separator
              </p>
              <p className="mb-2 text-[10px] text-neutral-500">
                The delimiter between segments in your ad names. Default is
                underscore (<code className="text-neutral-400">_</code>). Use
                <code className="mx-1 text-neutral-400"> // </code>
                (with surrounding spaces) for the W&amp;B convention.
              </p>
              <input
                type="text"
                value={separator}
                onChange={(e) => {
                  setSeparator(e.target.value)
                  setSaved(false)
                }}
                placeholder="_"
                className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-white focus:border-brand-lime focus:outline-none"
              />
            </div>

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

      {/* ── Creative Tags Section ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">Creative Tags</h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Tags are shared across clients. Use them to group creatives by theme
            (e.g. offer, hook, angle) in the Performance drill-down.
          </p>
        </div>
        {tagsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {tags.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-700 px-4 py-6 text-center text-xs text-neutral-500">
                No tags yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-200"
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    {t.name}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-end border-t border-neutral-800 pt-4">
              <button
                onClick={() => setShowTagManager(true)}
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90"
              >
                Manage Tags
              </button>
            </div>
          </div>
        )}
      </section>

      {showTagManager && (
        <TagManagerModal
          tags={tags}
          onClose={() => setShowTagManager(false)}
          onTagsChanged={loadTags}
        />
      )}

      {/* ── Alerts Section ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Performance Alerts
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Get Slack notifications when a metric deviates from its 7-day average
            by more than a set threshold.
          </p>
        </div>

        {alertsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {alerts.length === 0 && (
              <p className="rounded-lg border border-dashed border-neutral-700 px-4 py-6 text-center text-xs text-neutral-500">
                No alerts configured. Add alerts to get Slack notifications when
                metrics deviate from their 7-day average.
              </p>
            )}

            {alerts.map((alert, idx) => (
              <div
                key={alert.id || `new-${idx}`}
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 ${
                  alert.enabled
                    ? "border-neutral-800 bg-neutral-800/50"
                    : "border-neutral-800/50 bg-neutral-900/30 opacity-60"
                }`}
              >
                {/* Metric */}
                <select
                  value={alert.metric}
                  onChange={(e) => updateAlert(idx, "metric", e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 focus:border-brand-lime focus:outline-none"
                >
                  {ALERT_METRIC_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {/* Direction */}
                <select
                  value={alert.direction}
                  onChange={(e) =>
                    updateAlert(idx, "direction", e.target.value)
                  }
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 focus:border-brand-lime focus:outline-none"
                >
                  {DIRECTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {/* Threshold */}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={alert.threshold_pct}
                    onChange={(e) =>
                      updateAlert(
                        idx,
                        "threshold_pct",
                        Math.max(1, parseInt(e.target.value) || 1)
                      )
                    }
                    min={1}
                    className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-center text-xs text-white focus:border-brand-lime focus:outline-none"
                  />
                  <span className="text-[10px] text-neutral-500">%</span>
                </div>

                {/* Slack channel */}
                <input
                  type="text"
                  value={alert.slack_channel}
                  onChange={(e) =>
                    updateAlert(idx, "slack_channel", e.target.value)
                  }
                  placeholder="#channel"
                  className="w-32 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-brand-lime focus:outline-none sm:flex-none"
                />

                {/* Enable/disable toggle */}
                <button
                  onClick={() => toggleAlert(idx)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    alert.enabled ? "bg-brand-lime" : "bg-neutral-700"
                  }`}
                  title={alert.enabled ? "Enabled" : "Disabled"}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      alert.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                    }`}
                  />
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteAlert(idx)}
                  className="rounded p-0.5 text-neutral-500 transition hover:text-red-400"
                  title="Remove alert"
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

            {/* Add alert button */}
            <button
              onClick={addAlert}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:text-brand-lime"
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
              Add Alert
            </button>

            {/* Save */}
            <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
              {alertsSaved && (
                <span className="text-xs font-medium text-green-400">
                  Saved
                </span>
              )}
              <button
                onClick={handleSaveAlerts}
                disabled={alertsSaving || alerts.length === 0}
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
              >
                {alertsSaving ? "Saving..." : "Save Alerts"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Creative Tests Config Section ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Creative Tests
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Automatically detect and analyse A/B tests from your ad naming convention.
            Results appear in the Creative Tests tab.
          </p>
        </div>

        {testConfigLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-neutral-300">Enable scanning</p>
                <p className="text-[11px] text-neutral-500">Runs daily after data sync</p>
              </div>
              <button
                onClick={() => setTestConfig((c) => ({ ...c, enabled: !c.enabled }))}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  testConfig.enabled ? "bg-brand-lime" : "bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    testConfig.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </div>

            {/* Test optimisation event */}
            <div>
              <label className="mb-1 block text-[11px] text-neutral-500">Test optimisation event</label>
              <select
                value={testConfig.test_key_action}
                onChange={(e) => setTestConfig((c) => ({ ...c, test_key_action: e.target.value }))}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
              >
                <option value="">Not set (required)</option>
                <option value="unique_link_clicks">Link Clicks</option>
                <option value="landing_page_views">Landing Page Views</option>
                <option value="adds_to_cart">Add to Carts</option>
                <option value="checkouts_initiated">Checkouts Initiated</option>
                <option value="registrations_completed">Registrations</option>
                <option value="trials_started">Trials Started</option>
                <option value="app_installs">App Installs</option>
                <option value="purchases">Purchases</option>
              </select>
              <p className="mt-1 text-[10px] text-neutral-600">
                The conversion event tests are measured against. Required for the Creative Tests tab.
              </p>
            </div>

            {/* Thresholds */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-[11px] text-neutral-500">Min days live</label>
                <input
                  type="number"
                  value={testConfig.min_days_live}
                  onChange={(e) => setTestConfig((c) => ({ ...c, min_days_live: parseInt(e.target.value) || 5 }))}
                  min={1}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-neutral-500">Min spend</label>
                <input
                  type="number"
                  value={testConfig.min_spend}
                  onChange={(e) => setTestConfig((c) => ({ ...c, min_spend: parseFloat(e.target.value) || 100 }))}
                  min={0}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-neutral-500">Min conversions</label>
                <input
                  type="number"
                  value={testConfig.min_conversions}
                  onChange={(e) => setTestConfig((c) => ({ ...c, min_conversions: parseInt(e.target.value) || 10 }))}
                  min={0}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-neutral-500">High spend alert</label>
                <input
                  type="number"
                  value={testConfig.high_spend_alert}
                  onChange={(e) => setTestConfig((c) => ({ ...c, high_spend_alert: parseFloat(e.target.value) || 150 }))}
                  min={0}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                />
              </div>
            </div>

            {/* Notion Board ID */}
            <div>
              <label className="mb-1 block text-[11px] text-neutral-500">
                Notion Creative Board ID
              </label>
              <input
                type="text"
                value={testConfig.notion_board_id}
                onChange={(e) => setTestConfig((c) => ({ ...c, notion_board_id: e.target.value }))}
                placeholder="e.g. abc123def456..."
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
              />
              <p className="mt-1 text-[10px] text-neutral-600">
                The database ID from your Notion creative board URL
              </p>
            </div>

            {/* Slack channel override */}
            <div>
              <label className="mb-1 block text-[11px] text-neutral-500">
                Slack channel (optional override)
              </label>
              <input
                type="text"
                value={testConfig.slack_channel_id}
                onChange={(e) => setTestConfig((c) => ({ ...c, slack_channel_id: e.target.value }))}
                placeholder="e.g. C087TGJERS5"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
              />
            </div>

            {/* Save */}
            <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
              {testConfigSaved && (
                <span className="text-xs font-medium text-green-400">
                  Saved
                </span>
              )}
              <button
                onClick={handleSaveTestConfig}
                disabled={testConfigSaving}
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
              >
                {testConfigSaving ? "Saving..." : "Save Config"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Marketing Impact Section ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Marketing Impact
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Enable the Marketing Impact tab to analyse the relationship between Meta spend
            and business outcomes across channels (Shopify, organic search, sessions, Amazon).
          </p>
        </div>

        {marketingImpactLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-neutral-300">Enable Marketing Impact tab</p>
                <p className="text-[11px] text-neutral-500">Shows multi-channel impact analysis with correlation, adstock, and decomposition</p>
              </div>
              <button
                onClick={() => setMarketingImpactEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  marketingImpactEnabled ? "bg-brand-lime" : "bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    marketingImpactEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
              {marketingImpactSaved && (
                <span className="text-xs font-medium text-green-400">
                  Saved
                </span>
              )}
              <button
                onClick={handleSaveMarketingImpact}
                disabled={marketingImpactSaving}
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
              >
                {marketingImpactSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Shopify Integration Section ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Shopify Integration
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Connect a Shopify store to show real revenue, CM3, and attribution comparison data
            on the Performance tab.
          </p>
        </div>

        {shopifyLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-neutral-300">Enable Shopify data</p>
                <p className="text-[11px] text-neutral-500">Shows Shopify metrics on Performance tab when synced</p>
              </div>
              <button
                onClick={() => setShopifyEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  shopifyEnabled ? "bg-brand-lime" : "bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    shopifyEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </div>

            {/* Store domain (shown when enabled) */}
            {shopifyEnabled && (
              <div>
                <label className="mb-1 block text-[11px] text-neutral-500">
                  Store domain
                </label>
                <input
                  type="text"
                  value={shopifyDomain}
                  onChange={(e) => setShopifyDomain(e.target.value)}
                  placeholder="your-store.myshopify.com"
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                />
                <p className="mt-1 text-[10px] text-neutral-600">
                  Your Shopify store domain (e.g. my-store.myshopify.com)
                </p>
              </div>
            )}

            {/* Sync instructions (shown when enabled) */}
            {shopifyEnabled && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
                <p className="text-[11px] font-medium text-neutral-400">Sync data</p>
                <p className="mt-1 text-[10px] text-neutral-500">
                  After saving, run the sync script in your terminal to pull Shopify order data:
                </p>
                <code className="mt-2 block rounded bg-neutral-900 px-2 py-1.5 text-[10px] text-neutral-300">
                  npm run sync:shopify -- --client-id {clientId}
                </code>
              </div>
            )}

            {/* Save */}
            <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
              {shopifySaved && (
                <span className="text-xs font-medium text-green-400">
                  Saved
                </span>
              )}
              <button
                onClick={handleSaveShopify}
                disabled={shopifySaving || (shopifyEnabled && !shopifyDomain.trim())}
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
              >
                {shopifySaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Amplitude Integration Section ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Amplitude Integration
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Track Amplitude events as funnel steps on the client dashboard. We
            query Amplitude&apos;s <code className="text-neutral-400">/events/segmentation</code>{" "}
            API directly, so values stay aligned with the dashboard date range.
          </p>
        </div>

        {amplitudeLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-lime border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-neutral-300">Enable Amplitude data</p>
                <p className="text-[11px] text-neutral-500">
                  Adds tracked Amplitude events as selectable funnel steps
                </p>
              </div>
              <button
                onClick={() => setAmplitudeEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  amplitudeEnabled ? "bg-brand-lime" : "bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    amplitudeEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </div>

            {amplitudeEnabled && (
              <>
                {/* Org slug */}
                <div>
                  <label className="mb-1 block text-[11px] text-neutral-500">
                    Org slug
                  </label>
                  <input
                    type="text"
                    value={amplitudeOrg}
                    onChange={(e) => setAmplitudeOrg(e.target.value)}
                    placeholder="leafe"
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                  />
                  <p className="mt-1 text-[10px] text-neutral-600">
                    Found in the Amplitude URL: app.amplitude.com/analytics/<strong>&lt;org&gt;</strong>/chart/...
                  </p>
                </div>

                {/* API Key */}
                <div>
                  <label className="mb-1 block text-[11px] text-neutral-500">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={amplitudeApiKey}
                    onChange={(e) => setAmplitudeApiKey(e.target.value)}
                    placeholder={
                      amplitudeHasCredentials
                        ? `Stored (${amplitudeApiKeyPreview}) — leave blank to keep`
                        : "Amplitude project API key"
                    }
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                  />
                </div>

                {/* Secret Key */}
                <div>
                  <label className="mb-1 block text-[11px] text-neutral-500">
                    Secret Key
                  </label>
                  <input
                    type="password"
                    value={amplitudeSecretKey}
                    onChange={(e) => setAmplitudeSecretKey(e.target.value)}
                    placeholder={
                      amplitudeHasCredentials
                        ? "Stored — leave blank to keep"
                        : "Amplitude project secret key"
                    }
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand-lime"
                  />
                  <p className="mt-1 text-[10px] text-neutral-600">
                    Settings → Projects → API Keys in Amplitude. Stored server-side; never sent back to the browser.
                  </p>
                </div>

                {/* Tracked events */}
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-medium text-neutral-400">
                      Tracked events ({amplitudeEvents.length})
                    </p>
                    <button
                      onClick={() =>
                        setAmplitudeEvents((rows) => [
                          ...rows,
                          { event_name: "", display_title: "" },
                        ])
                      }
                      className="text-[11px] text-brand-lime hover:underline"
                    >
                      + Add event
                    </button>
                  </div>
                  <p className="mb-3 text-[10px] text-neutral-500">
                    Paste the event name exactly as it appears in your Amplitude
                    taxonomy (case + spaces matter). Each event becomes a
                    selectable funnel step.
                  </p>
                  {amplitudeEvents.length === 0 && (
                    <p className="text-[10px] text-neutral-600">
                      No events yet. Add one to surface it on the dashboard.
                    </p>
                  )}
                  <div className="space-y-2">
                    {amplitudeEvents.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={row.event_name}
                          onChange={(e) =>
                            setAmplitudeEvents((rows) =>
                              rows.map((r, idx) =>
                                idx === i
                                  ? { ...r, event_name: e.target.value }
                                  : r
                              )
                            )
                          }
                          placeholder="event name (e.g. Trial Started)"
                          className="w-48 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] outline-none focus:border-brand-lime"
                        />
                        <input
                          type="text"
                          value={row.display_title}
                          onChange={(e) =>
                            setAmplitudeEvents((rows) =>
                              rows.map((r, idx) =>
                                idx === i
                                  ? { ...r, display_title: e.target.value }
                                  : r
                              )
                            )
                          }
                          placeholder="display title (optional)"
                          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] outline-none focus:border-brand-lime"
                        />
                        <button
                          onClick={() =>
                            setAmplitudeEvents((rows) =>
                              rows.filter((_, idx) => idx !== i)
                            )
                          }
                          className="text-[11px] text-neutral-500 hover:text-red-400"
                          aria-label="Remove event"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Test connection result */}
            {amplitudeEnabled && amplitudeTestResult && (
              <div
                className={`rounded-lg border px-3 py-2 text-[11px] ${
                  amplitudeTestResult.ok
                    ? "border-green-900/50 bg-green-950/30 text-green-300"
                    : "border-red-900/50 bg-red-950/30 text-red-300"
                }`}
              >
                {amplitudeTestResult.ok ? (
                  <>
                    <p className="font-medium">
                      Connection OK ({amplitudeTestResult.event_name})
                    </p>
                    <p className="mt-0.5 text-[10px] text-green-400/80">
                      {amplitudeTestResult.window?.from} →{" "}
                      {amplitudeTestResult.window?.to} · total{" "}
                      {amplitudeTestResult.total ?? 0} ·{" "}
                      {amplitudeTestResult.days_with_data ?? 0} day
                      {amplitudeTestResult.days_with_data === 1 ? "" : "s"} with
                      data
                    </p>
                    {amplitudeTestResult.sample_points &&
                      amplitudeTestResult.sample_points.length > 0 && (
                        <p className="mt-0.5 break-all font-mono text-[10px] text-green-400/80">
                          last:{" "}
                          {amplitudeTestResult.sample_points
                            .map((p) => `${p.date}=${p.value}`)
                            .join(", ")}
                        </p>
                      )}
                    {(amplitudeTestResult.total ?? 0) === 0 && (
                      <p className="mt-1 text-[10px] text-amber-300">
                        Auth worked, but the event returned 0 over the last 30
                        days. Check the spelling/casing of the event name
                        against your Amplitude taxonomy.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-medium">
                      {amplitudeTestResult.code ?? "Failed"}
                      {amplitudeTestResult.status
                        ? ` (HTTP ${amplitudeTestResult.status})`
                        : ""}
                    </p>
                    {amplitudeTestResult.reason && (
                      <p className="mt-0.5 break-all text-[10px] text-red-400/80">
                        {amplitudeTestResult.reason}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Save + Test */}
            <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
              {amplitudeSaved && (
                <span className="text-xs font-medium text-green-400">Saved</span>
              )}
              {amplitudeEnabled && (
                <button
                  onClick={handleTestAmplitude}
                  disabled={
                    amplitudeTesting ||
                    (!amplitudeHasCredentials &&
                      (!amplitudeApiKey.trim() || !amplitudeSecretKey.trim()))
                  }
                  className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-300 transition hover:border-neutral-600 hover:text-white disabled:opacity-50"
                >
                  {amplitudeTesting ? "Testing..." : "Test connection"}
                </button>
              )}
              <button
                onClick={handleSaveAmplitude}
                disabled={
                  amplitudeSaving ||
                  (amplitudeEnabled &&
                    !amplitudeHasCredentials &&
                    (!amplitudeApiKey.trim() || !amplitudeSecretKey.trim()))
                }
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
              >
                {amplitudeSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
