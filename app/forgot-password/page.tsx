"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import Logo from "@/components/ui/logo"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm`,
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <Logo size="large" className="text-white" />
          <p className="text-sm text-neutral-400">Reset your password</p>
        </div>

        {sent ? (
          <div className="space-y-4 text-center">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-6">
              <p className="text-sm text-neutral-200">
                Check your email for a reset link.
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                If you don&apos;t see it, check your spam folder.
              </p>
            </div>
            <Link
              href="/login"
              className="inline-block text-sm text-brand-lime hover:underline"
            >
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none focus:ring-1 focus:ring-brand-lime"
            />

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-lime px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>

            <div className="text-center">
              <Link
                href="/login"
                className="text-sm text-neutral-500 hover:text-neutral-300"
              >
                Back to login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
