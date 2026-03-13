import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Authenticate the current request via Supabase session cookie.
 * Returns the user object or a 401 NextResponse.
 */
export async function requireAuth() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  return { user, error: null }
}

/**
 * Generic safe error response — never leaks DB details to the client.
 * Logs the real error server-side for debugging.
 */
export function safeError(error: { message: string; code?: string }, status = 500) {
  console.error("[API Error]", error.message, error.code || "")

  // Surface known safe error codes as friendly messages
  if (error.code === "PGRST116") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (error.code === "23505") {
    return NextResponse.json({ error: "Duplicate entry" }, { status: 409 })
  }

  return NextResponse.json({ error: "Internal server error" }, { status })
}
