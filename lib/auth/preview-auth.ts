import type { NextRequest } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

/**
 * Authorisation for creative-preview endpoints (/api/thumbnail,
 * /api/ad-preview). These are exempted from the middleware's blanket API
 * auth so previews also load on public share pages — each request must be
 * either a logged-in admin session or a valid password-gated share-view
 * session (kima_view_<slug> cookie).
 */
export async function isPreviewAuthorized(
  request: NextRequest,
  supabase: ReturnType<typeof createServiceClient>
): Promise<boolean> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (user) return true

  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.startsWith("kima_view_") || !cookie.value) continue
    const slug = cookie.name.slice("kima_view_".length)
    const { data: session } = await supabase
      .from("view_sessions")
      .select("expires_at")
      .eq("token", cookie.value)
      .eq("slug", slug)
      .single()
    if (session && new Date(session.expires_at) > new Date()) return true
  }
  return false
}
