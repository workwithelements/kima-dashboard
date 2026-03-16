"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import Logo from "@/components/ui/logo"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setDone(true)
      setTimeout(() => {
        router.push("/dashboard")
        router.refresh()
      }, 2000)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <Logo size="large" className="text-white" />
          <p className="text-sm text-neutral-400">Set a new password</p>
        </div>

        {done ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-6 text-center">
            <p className="text-sm text-green-400">Password updated</p>
            <p className="mt-2 text-xs text-neutral-500">
              Redirecting to dashboard...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none focus:ring-1 focus:ring-brand-lime"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none focus:ring-1 focus:ring-brand-lime"
            />

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-lime px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
