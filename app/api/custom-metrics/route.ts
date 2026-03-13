import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/custom-metrics — list all custom metrics
 */
export async function GET() {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = createClient()
  const { data, error } = await supabase
    .from("custom_metrics")
    .select("*")
    .order("is_preset", { ascending: false })
    .order("name")

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * POST /api/custom-metrics — create a new custom metric
 */
export async function POST(request: NextRequest) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = createClient()

  const body = await request.json()
  const { name, numerator, denominator, multiplier, format, decimals, description } = body

  if (!name || !numerator || !denominator) {
    return NextResponse.json({ error: "Name, numerator, and denominator are required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("custom_metrics")
    .insert({
      name,
      numerator,
      denominator,
      multiplier: multiplier ?? 1,
      format: format ?? "number",
      decimals: decimals ?? 2,
      description: description || null,
      is_preset: false,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data, { status: 201 })
}
