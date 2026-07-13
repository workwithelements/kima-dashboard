"use client"

import { useState } from "react"
import { ADMIN_EMAIL } from "@/lib/auth/admin"

type TeamMember = {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
}

export default function TeamManager({
  initialMembers,
  currentUserEmail,
}: {
  initialMembers: TeamMember[]
  currentUserEmail: string
}) {
  const [members, setMembers] = useState<TeamMember[]>(initialMembers)
  const [newEmail, setNewEmail] = useState("")
  const [inviting, setInviting] = useState(false)
  const [tempCreds, setTempCreds] = useState<{ email: string; password: string } | null>(null)
  const [error, setError] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)

  const isAdmin = currentUserEmail === ADMIN_EMAIL

  if (!isAdmin) return null

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setError("")
    setTempCreds(null)

    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUserEmail,
        },
        body: JSON.stringify({ email: newEmail }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Failed to invite user")
      } else {
        setTempCreds({ email: data.email, password: data.temp_password })
        setMembers([
          ...members,
          {
            id: data.id,
            email: data.email,
            created_at: new Date().toISOString(),
            last_sign_in_at: null,
          },
        ])
        setNewEmail("")
      }
    } catch {
      setError("Network error")
    }
    setInviting(false)
  }

  async function handleRemove(userId: string) {
    if (!confirm("Remove this team member? They will lose access immediately.")) return

    setRemoving(userId)
    try {
      const res = await fetch(`/api/team?id=${userId}`, {
        method: "DELETE",
        headers: { "x-user-email": currentUserEmail },
      })

      if (res.ok) {
        setMembers(members.filter((m) => m.id !== userId))
      } else {
        const data = await res.json()
        setError(data.error || "Failed to remove user")
      }
    } catch {
      setError("Network error")
    }
    setRemoving(null)
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "Never"
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
      <div className="border-b border-neutral-800 px-5 py-4">
        <h2 className="text-sm font-semibold text-neutral-100">Team Members</h2>
        <p className="mt-1 text-[11px] text-neutral-500">
          Invite team members to access the dashboard. They&apos;ll receive temporary
          credentials to log in.
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Members list */}
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-800/50 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-200 truncate">
                    {m.email}
                  </span>
                  {m.email === ADMIN_EMAIL && (
                    <span className="shrink-0 rounded bg-brand-lime/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-lime">
                      Admin
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Last login: {formatDate(m.last_sign_in_at)}
                </p>
              </div>

              {m.email !== ADMIN_EMAIL && (
                <button
                  onClick={() => handleRemove(m.id)}
                  disabled={removing === m.id}
                  className="shrink-0 rounded px-2 py-1 text-xs text-neutral-500 transition hover:text-red-400 disabled:opacity-50"
                >
                  {removing === m.id ? "Removing..." : "Remove"}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Temp credentials banner */}
        {tempCreds && (
          <div className="rounded-lg border border-brand-lime/30 bg-brand-lime/5 px-4 py-3 space-y-1">
            <p className="text-xs font-medium text-brand-lime">
              Account created — share these credentials:
            </p>
            <div className="flex flex-col gap-0.5 font-mono text-xs text-neutral-200">
              <span>Email: {tempCreds.email}</span>
              <span>Password: {tempCreds.password}</span>
            </div>
            <p className="text-[10px] text-neutral-500">
              They can reset their password via &quot;Forgot password?&quot; on the login page.
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `Email: ${tempCreds.email}\nPassword: ${tempCreds.password}\nLogin: ${window.location.origin}/login`
                )
              }}
              className="mt-1 rounded bg-neutral-800 px-3 py-1 text-[11px] text-neutral-300 transition hover:bg-neutral-700"
            >
              Copy to clipboard
            </button>
          </div>
        )}

        {/* Invite form */}
        <form onSubmit={handleInvite} className="flex items-center gap-2">
          <input
            type="email"
            placeholder="team@workwithelements.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-brand-lime focus:outline-none"
          />
          <button
            type="submit"
            disabled={inviting}
            className="shrink-0 rounded-lg bg-brand-lime px-4 py-2 text-xs font-semibold text-black transition hover:bg-brand-lime/90 disabled:opacity-50"
          >
            {inviting ? "Inviting..." : "Invite"}
          </button>
        </form>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </section>
  )
}
