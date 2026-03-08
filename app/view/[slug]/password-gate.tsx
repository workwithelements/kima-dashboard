"use client"

import { useState } from "react"
import Logo from "@/components/ui/logo"

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
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <Logo className="text-white" />
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="text-center">
            <h1 className="text-lg font-semibold">{clientName}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              Enter the password to view your report
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none focus:ring-1 focus:ring-brand-lime"
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
        </div>

        <p className="text-center text-[10px] text-neutral-600">
          Powered by Elements
        </p>
      </div>
    </div>
  )
}
