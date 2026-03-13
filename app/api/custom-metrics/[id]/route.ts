import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * PUT /api/custom-metrics/[id] — update a custom metric
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    .update({
      name,
      numerator,
      denominator,
      multiplier: multiplier ?? 1,
      format: format ?? "number",
      decimals: decimals ?? 2,
      description: description || null,
    })
    .eq("id", params.id)
    .select()
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * DELETE /api/custom-metrics/[id] — delete a custom metric (preset metrics cannot be deleted)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = createClient()

  // Check if preset
  const { data: metric } = await supabase
    .from("custom_metrics")
    .select("is_preset")
    .eq("id", params.id)
    .single()

  if (!metric) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (metric.is_preset) {
    return NextResponse.json({ error: "Preset metrics cannot be deleted" }, { status: 403 })
  }

  const { error } = await supabase
    .from("custom_metrics")
    .delete()
    .eq("id", params.id)

  if (error) return safeError(error)
  return NextResponse.json({ ok: true })
}
