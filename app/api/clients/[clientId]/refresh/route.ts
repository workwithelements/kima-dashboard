import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * POST /api/clients/[clientId]/refresh — trigger a data refresh for a client.
 *
 * Dispatches a workflow_dispatch event to kima-sync on GitHub,
 * which runs the daily sync for just this client.
 *
 * Requires GITHUB_PAT env var with repo scope for workwithelements/kima-sync.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const githubPat = process.env.GITHUB_PAT
  if (!githubPat) {
    return NextResponse.json(
      { error: "GITHUB_PAT not configured" },
      { status: 500 }
    )
  }

  // Look up client name
  const db = createServiceClient()
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("name")
    .eq("id", params.clientId)
    .single()

  if (clientErr || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  // Trigger kima-sync workflow via GitHub API
  const res = await fetch(
    "https://api.github.com/repos/workwithelements/kima-sync/actions/workflows/daily-sync.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `token ${githubPat}`,
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          client: client.name.toLowerCase(),
        },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    console.error("[refresh] GitHub API error:", res.status, body)
    return NextResponse.json(
      { error: "Failed to trigger sync" },
      { status: 502 }
    )
  }

  return NextResponse.json({ message: `Sync triggered for ${client.name}` })
}
