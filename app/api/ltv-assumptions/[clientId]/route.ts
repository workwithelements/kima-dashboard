import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError, isAdminEmail } from "@/lib/auth/authorize"
import {
  DEFAULT_LTV_ASSUMPTIONS,
  assumptionsFromRow,
  assumptionsToRow,
  type LtvAssumptions,
} from "@/lib/utils/unit-economics"

/**
 * GET /api/ltv-assumptions/[clientId]
 * Returns `{ assumptions, updated_at, updated_by, isDefault }`. Falls back
 * to the seeded defaults when no row has been saved yet.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_ltv_assumptions")
    .select("*")
    .eq("client_id", params.clientId)
    .single()

  if (error && error.code !== "PGRST116") return safeError(error)

  if (!data) {
    return NextResponse.json({
      assumptions: DEFAULT_LTV_ASSUMPTIONS,
      updated_at: null,
      updated_by: null,
      isDefault: true,
    })
  }

  return NextResponse.json({
    assumptions: assumptionsFromRow(data),
    updated_at: data.updated_at ?? null,
    updated_by: data.updated_by ?? null,
    isDefault: false,
  })
}

/** Fields validated as fractions in [0, 1]. */
const FRACTION_FIELDS: (keyof LtvAssumptions)[] = [
  "year2RenewalRate",
  "year3RenewalRate",
  "firstMonthDiscount",
  "targetMargin",
  "fallbackAnnualMix",
]

/** Fields validated as non-negative amounts. */
const AMOUNT_FIELDS: (keyof LtvAssumptions)[] = [
  "annualY1Upfront",
  "annualRenewalPrice",
  "monthlyPrice",
  "monthlyMedianLTV",
]

/**
 * PUT /api/ltv-assumptions/[clientId] — upsert the assumptions row.
 * Admin only: these numbers drive every ad's verdict in the Unit Economics
 * view, so edits are restricted the same way as team management.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError
  if (!isAdminEmail(user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const cfg: LtvAssumptions = { ...DEFAULT_LTV_ASSUMPTIONS }
  for (const key of Object.keys(cfg) as (keyof LtvAssumptions)[]) {
    // Strict number check — Number(null) is 0, which would silently zero a price
    const v = body[key]
    if (typeof v !== "number" || !isFinite(v)) {
      return NextResponse.json({ error: `Invalid number for ${key}` }, { status: 400 })
    }
    cfg[key] = v
  }

  for (const key of AMOUNT_FIELDS) {
    if (cfg[key] < 0) {
      return NextResponse.json({ error: `${key} must be ≥ 0` }, { status: 400 })
    }
  }
  for (const key of FRACTION_FIELDS) {
    if (cfg[key] < 0 || cfg[key] > 1) {
      return NextResponse.json({ error: `${key} must be between 0 and 1` }, { status: 400 })
    }
  }
  if (cfg.ltvCacTarget <= 0) {
    return NextResponse.json({ error: "ltvCacTarget must be > 0" }, { status: 400 })
  }
  if (!Number.isInteger(cfg.horizonMonths) || cfg.horizonMonths < 1 || cfg.horizonMonths > 60) {
    return NextResponse.json({ error: "horizonMonths must be an integer between 1 and 60" }, { status: 400 })
  }

  const payload = {
    ...assumptionsToRow(cfg),
    client_id: params.clientId,
    updated_at: new Date().toISOString(),
    updated_by: user?.email ?? null,
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from("client_ltv_assumptions")
    .upsert(payload, { onConflict: "client_id" })
    .select()
    .single()

  if (error) return safeError(error)

  return NextResponse.json({
    assumptions: assumptionsFromRow(data),
    updated_at: data.updated_at ?? null,
    updated_by: data.updated_by ?? null,
    isDefault: false,
  })
}
