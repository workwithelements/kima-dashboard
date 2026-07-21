import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"
import { isKeyAction } from "@/lib/utils/key-actions"

/**
 * PATCH /api/creative-tests/[testId] — manual resolution for flagged/unmatched tests
 *
 * Body options:
 *   { notion_page_url: string }        — link a Notion card manually
 *   { dismiss: true }                  — clear flagged state (legacy "un-flag")
 *   { dismissed: true | false }        — soft-hide / restore the test in the UI
 *   { key_action: string | null }      — override the test's optimisation event
 *                                        (null restores the ad set default)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { testId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const db = createServiceClient()
  const now = new Date().toISOString()

  if ("key_action" in body) {
    if (body.key_action !== null && !isKeyAction(body.key_action)) {
      return NextResponse.json({ error: "Invalid key_action" }, { status: 400 })
    }
    const { data, error } = await db
      .from("creative_tests")
      .update({
        key_action_override: body.key_action,
        updated_at: now,
      })
      .eq("id", params.testId)
      .select()
      .single()

    if (error) return safeError(error)
    return NextResponse.json(data)
  }

  if (typeof body.dismissed === "boolean") {
    const { data, error } = await db
      .from("creative_tests")
      .update({
        dismissed_at: body.dismissed ? now : null,
        updated_at: now,
      })
      .eq("id", params.testId)
      .select()
      .single()

    if (error) return safeError(error)
    return NextResponse.json(data)
  }

  if (body.notion_page_url) {
    // Extract page ID from URL if possible
    const url = body.notion_page_url.trim()
    const { data, error } = await db
      .from("creative_tests")
      .update({
        notion_page_url: url,
        notion_matched: true,
        flag_reason: null,
        status: "analysed",
        updated_at: now,
      })
      .eq("id", params.testId)
      .select()
      .single()

    if (error) return safeError(error)
    return NextResponse.json(data)
  }

  if (body.dismiss) {
    const { data, error } = await db
      .from("creative_tests")
      .update({
        status: "monitoring",
        flag_reason: null,
        updated_at: now,
      })
      .eq("id", params.testId)
      .select()
      .single()

    if (error) return safeError(error)
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
}
