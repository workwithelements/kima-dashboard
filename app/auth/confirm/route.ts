import { NextRequest, NextResponse } from "next/server"
import { createServerClient, type CookieOptions } from "@supabase/ssr"

/**
 * GET /auth/confirm — handles Supabase email confirmation links
 * (invite, magic link, password recovery, email change)
 *
 * Supabase sends links like:
 *   /auth/confirm?token_hash=abc123&type=invite
 *   /auth/confirm?token_hash=abc123&type=recovery
 *   /auth/confirm?token_hash=abc123&type=email
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as
    | "invite"
    | "signup"
    | "recovery"
    | "email"
    | "magiclink"
    | null

  const redirectTo = new URL("/login", request.url)

  if (!token_hash || !type) {
    redirectTo.searchParams.set("error", "Missing confirmation parameters")
    return NextResponse.redirect(redirectTo)
  }

  // Recovery links should redirect to the reset-password page, not the dashboard
  const destination = type === "recovery" ? "/reset-password" : "/dashboard"
  const response = NextResponse.redirect(new URL(destination, request.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { error } = await supabase.auth.verifyOtp({ token_hash, type })

  if (error) {
    redirectTo.searchParams.set("error", "Invalid or expired link. Please request a new one.")
    return NextResponse.redirect(redirectTo)
  }

  return response
}
