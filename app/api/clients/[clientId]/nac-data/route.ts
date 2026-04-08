import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/clients/[clientId]/nac-data — fetch NAC data for a client
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("nac_data")
    .select("date, region, channel, campaign, first_product, nacs")
    .eq("client_id", params.clientId)
    .order("date", { ascending: true })

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * POST /api/clients/[clientId]/nac-data — upload CSV data
 * Expects multipart/form-data with a "file" field containing a CSV.
 * CSV columns: Date, Region, Channel, Campaign, First Product, NACs
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const formData = await request.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
  }

  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim())

  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 })
  }

  // Parse header to find column indices (case-insensitive, flexible naming)
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"))

  const colMap: Record<string, number> = {}
  const aliases: Record<string, string[]> = {
    date: ["date"],
    region: ["region"],
    channel: ["channel"],
    campaign: ["campaign"],
    first_product: ["first_product", "firstproduct", "product", "first_product_type"],
    nacs: ["nacs", "nac", "newly_acquired_customers"],
  }

  for (const [field, names] of Object.entries(aliases)) {
    const idx = header.findIndex((h) => names.includes(h))
    if (idx !== -1) colMap[field] = idx
  }

  // Validate required columns
  const required = ["date", "region", "channel", "first_product", "nacs"]
  const missing = required.filter((f) => colMap[f] === undefined)
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required columns: ${missing.join(", ")}. Found: ${header.join(", ")}` },
      { status: 400 }
    )
  }

  // Parse rows
  const rows: Array<{
    client_id: string
    date: string
    region: string
    channel: string
    campaign: string
    first_product: string
    nacs: number
  }> = []

  const errors: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < header.length) continue

    const date = cols[colMap.date]?.trim()
    const region = cols[colMap.region]?.trim()
    const channel = cols[colMap.channel]?.trim()
    const campaign = colMap.campaign !== undefined ? cols[colMap.campaign]?.trim() || "" : ""
    const firstProduct = cols[colMap.first_product]?.trim()
    const nacsVal = parseInt(cols[colMap.nacs]?.trim(), 10)

    if (!date || !region || !firstProduct) {
      errors.push(`Row ${i + 1}: missing required field`)
      continue
    }
    if (isNaN(nacsVal)) {
      errors.push(`Row ${i + 1}: invalid NACs value`)
      continue
    }

    rows.push({
      client_id: params.clientId,
      date,
      region,
      channel: channel || "Unattributed",
      campaign,
      first_product: firstProduct,
      nacs: nacsVal,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found", details: errors },
      { status: 400 }
    )
  }

  // Upsert in batches of 500
  const db = createServiceClient()
  const batchSize = 500
  let inserted = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await db
      .from("nac_data")
      .upsert(batch, {
        onConflict: "client_id,date,region,channel,campaign,first_product",
      })

    if (error) return safeError(error)
    inserted += batch.length
  }

  return NextResponse.json({
    inserted,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  }, { status: 201 })
}

/** Simple CSV line parser that handles quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
