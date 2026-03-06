import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
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

  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Simple hash comparison — the password is stored as a SHA-256 hex hash
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  if (hashHex !== client.view_password_hash) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 })
  }

  // Set auth cookie (7 day expiry)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(`kima_view_${slug}`, hashHex, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: `/view/${slug}`,
  })

  return response
}
