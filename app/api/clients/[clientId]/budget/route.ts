import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * PUT /api/clients/[clientId]/budget — set monthly budget for a client
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const body = await request.json()
  const { monthly_budget } = body

  // Validate: must be a positive number or null
  if (monthly_budget !== null && monthly_budget !== undefined) {
    const val = Number(monthly_budget)
    if (isNaN(val) || val < 0) {
      return NextResponse.json(
        { error: "monthly_budget must be a positive number or null" },
        { status: 400 }
      )
    }
  }

  const budgetValue = monthly_budget === null || monthly_budget === undefined
    ? null
    : Number(monthly_budget)

  // Use service client for the write
  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .update({ monthly_budget: budgetValue })
    .eq("id", params.clientId)
    .select("id, monthly_budget")
    .single()

  if (error) return safeError(error)
  return NextResponse.json(data)
}
