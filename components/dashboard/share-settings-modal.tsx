"use client"

import { useState, useEffect, useCallback } from "react"

type Props = {
  clientId: string
  slug: string
  onClose: () => void
}

function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => chars[b % chars.length]).join("")
}

export default function ShareSettingsModal({ clientId, slug, onClose }: Props) {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedPw, setCopiedPw] = useState(false)

  const shareUrl = `https://kimadash.netlify.app/view/${slug}`

  const handleClose = useCallback(() => onClose(), [onClose])

  // Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [handleClose])

  // Fetch current state
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/share-settings`)
        if (res.ok) {
          const data = await res.json()
          setHasPassword(data.hasPassword)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clientId])

  async function handleSetPassword() {
    setSaving(true)
    const password = generatePassword()
    try {
      const res = await fetch(`/api/clients/${clientId}/share-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        setHasPassword(true)
        setGeneratedPassword(password)
      } else {
        const errBody = await res.json().catch(() => ({}))
        alert(`Failed to set password: ${errBody?.error || res.status}`)
      }
    } finally {
      setSaving(false)
    }
  }

  function copyToClipboard(text: string, type: "url" | "pw") {
    navigator.clipboard.writeText(text)
    if (type === "url") {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } else {
      setCopiedPw(true)
      setTimeout(() => setCopiedPw(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Share Settings</h2>
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
          Share a read-only dashboard link with your client.
        </p>

        {loading ? (
          <div className="mt-6 flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-brand-lime" />
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {/* Share URL */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Share URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 outline-none"
                />
                <button
                  onClick={() => copyToClipboard(shareUrl, "url")}
                  className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                >
                  {copiedUrl ? (
                    <span className="text-brand-lime">Copied!</span>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Password section */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-800/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Password Protection</h3>
                  {hasPassword ? (
                    <p className="mt-0.5 text-xs text-green-400">Password is set ✓</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-neutral-500">
                      No password set — sharing is disabled
                    </p>
                  )}
                </div>
                <button
                  onClick={handleSetPassword}
                  disabled={saving}
                  className="rounded-lg bg-brand-lime px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-brand-lime/90 disabled:opacity-50"
                >
                  {saving
                    ? "Setting..."
                    : hasPassword
                      ? "Reset Password"
                      : "Set Password"}
                </button>
              </div>

              {/* Generated password display */}
              {generatedPassword && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedPassword}
                      className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm text-white outline-none"
                    />
                    <button
                      onClick={() =>
                        copyToClipboard(generatedPassword, "pw")
                      }
                      className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                    >
                      {copiedPw ? (
                        <span className="text-brand-lime">Copied!</span>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-amber-400">
                    ⚠ Copy this password now — it won&apos;t be shown again.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Close button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleClose}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
