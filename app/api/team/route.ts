import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

const ADMIN_EMAIL = "tom@workwithelements.com"

/** Verify the caller is the admin user */
async function verifyAdmin(request: NextRequest) {
  const supabase = createServiceClient()

  // Get the current user from the auth cookie
  const authHeader = request.headers.get("x-user-email")
  if (authHeader !== ADMIN_EMAIL) {
    return null
  }
  return supabase
}

/** GET /api/team — list all auth users */
export async function GET(request: NextRequest) {
  const callerEmail = request.headers.get("x-user-email")
  if (callerEmail !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.auth.admin.listUsers()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const users = data.users.map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }))

  return NextResponse.json(users)
}

/** POST /api/team — invite a new team member */
export async function POST(request: NextRequest) {
  const callerEmail = request.headers.get("x-user-email")
  if (callerEmail !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json()
  const { email } = body

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Generate a random temporary password
  const tempPassword =
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6).toUpperCase() +
    "!"

  const { data, error } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: tempPassword,
    email_confirm: true,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({
    id: data.user.id,
    email: data.user.email,
    temp_password: tempPassword,
  })
}

/** DELETE /api/team — remove a team member */
export async function DELETE(request: NextRequest) {
  const callerEmail = request.headers.get("x-user-email")
  if (callerEmail !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("id")

  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Don't allow deleting the admin
  const { data: targetUser } = await supabase.auth.admin.getUserById(userId)
  if (targetUser?.user?.email === ADMIN_EMAIL) {
    return NextResponse.json({ error: "Cannot remove admin user" }, { status: 400 })
  }

  const { error } = await supabase.auth.admin.deleteUser(userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
