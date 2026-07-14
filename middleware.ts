import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

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
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Protect admin routes — redirect to login if not authenticated
  if (!user && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Redirect logged-in users away from login
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Protect API routes (except public endpoints) — return 401 if not authenticated.
  // /api/thumbnail and /api/ad-preview do their own auth (admin session OR
  // share-view session) so creative previews also load on public share pages.
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/view-auth") &&
    !pathname.startsWith("/api/cron/") &&
    !pathname.startsWith("/api/thumbnail") &&
    !pathname.startsWith("/api/ad-preview")
  ) {
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // CSRF protection: verify Origin on state-changing API requests
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/cron/") && ["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
    const origin = request.headers.get("origin")
    const host = request.headers.get("host")
    if (origin && host) {
      const originHost = new URL(origin).host
      if (originHost !== host) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }
  }

  return response
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/api/:path*"],
}
