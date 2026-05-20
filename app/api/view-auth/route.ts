import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import bcrypt from "bcryptjs"
import { isRateLimited, recordFailedAttempt } from "@/lib/auth/rate-limit"

export async function POST(request: NextRequest) {
  // Rate limit by IP — check only; we only increment on failures so legit
  // re-auths (e.g. after session expiry) don't burn through the budget.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (isRateLimited(ip)) {
    console.warn(`[Auth] Rate limited: ${ip}`)
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    )
  }

  const { slug, password } = await request.json()

  if (!slug || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: client } = await supabase
    .from("clients")
    .select("view_password_hash")
    .eq("slug", slug)
    .single()

  if (!client || !client.view_password_hash) {
    recordFailedAttempt(ip)
    console.warn(`[Auth] Failed login for slug="${slug}" from ${ip} — not found`)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  // Compare with bcrypt
  const isValid = await bcrypt.compare(password, client.view_password_hash)

  if (!isValid) {
    recordFailedAttempt(ip)
    console.warn(`[Auth] Failed login for slug="${slug}" from ${ip} — wrong password`)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  // Generate opaque session token
  const sessionToken = crypto.randomUUID()

  // Store session token in the database
  await supabase.from("view_sessions").insert({
    token: sessionToken,
    slug,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  // Set auth cookie. Path is "/" rather than `/view/${slug}` because the
  // slug may contain characters that URL-encode (e.g. an apostrophe) — the
  // browser would then see a mismatch between the cookie path (decoded
  // slug) and the request URL path (encoded slug) and drop the cookie on
  // client-side navigations like the date-range picker. The session is
  // already bound to the slug via the DB lookup in page.tsx, so widening
  // the cookie path does not weaken auth.
  const response = NextResponse.json({ ok: true })
  response.cookies.set(`kima_view_${slug}`, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  })

  return response
}
