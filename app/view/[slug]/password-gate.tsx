"use client"

import { useState } from "react"

export default function PasswordGate({
  slug,
  clientName,
}: {
  slug: string
  clientName: string
}) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const res = await fetch("/api/view-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, password }),
    })

    if (res.ok) {
      window.location.reload()
    } else {
      setError("Incorrect password")
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{clientName}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Enter the password to view your report
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none focus:ring-1 focus:ring-brand-lime"
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-lime px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? "Checking..." : "View Report"}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-600">
          Powered by <span className="text-brand-lime">X</span> elements
        </p>
      </div>
    </div>
  )
}
