import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/clients/[clientId]/weekly-bookings — fetch weekly bookings for a client
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } },
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("weekly_bookings")
    .select("week_start_date, bookings, revenue, notes")
    .eq("client_id", params.clientId)
    .order("week_start_date", { ascending: true })

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * POST /api/clients/[clientId]/weekly-bookings — upload CSV data
 * Expects multipart/form-data with a "file" field containing a CSV.
 * Columns: week_start_date (aliases: week, week_starting, week_start, date),
 *          bookings (required), revenue (optional), notes (optional).
 * week_start_date values are snapped to Monday of the ISO week.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } },
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
    return NextResponse.json(
      { error: "CSV must have a header row and at least one data row" },
      { status: 400 },
    )
  }

  const header = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"))

  const aliases: Record<string, string[]> = {
    week_start_date: ["week_start_date", "week", "week_starting", "week_start", "date"],
    bookings: ["bookings", "count", "total_bookings"],
    revenue: ["revenue", "gross_revenue", "total_revenue"],
    notes: ["notes", "comments"],
  }

  const colMap: Record<string, number> = {}
  for (const [field, names] of Object.entries(aliases)) {
    const idx = header.findIndex((h) => names.includes(h))
    if (idx !== -1) colMap[field] = idx
  }

  const missing = ["week_start_date", "bookings"].filter(
    (f) => colMap[f] === undefined,
  )
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required columns: ${missing.join(", ")}. Found: ${header.join(", ")}` },
      { status: 400 },
    )
  }

  const rows: Array<{
    client_id: string
    week_start_date: string
    bookings: number
    revenue: number | null
    notes: string | null
    uploaded_by: string | null
  }> = []
  const errors: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 2) continue

    const rawDate = cols[colMap.week_start_date]?.trim()
    const rawBookings = cols[colMap.bookings]?.trim()
    const rawRevenue = colMap.revenue !== undefined ? cols[colMap.revenue]?.trim() : ""
    const rawNotes = colMap.notes !== undefined ? cols[colMap.notes]?.trim() : ""

    if (!rawDate) {
      errors.push(`Row ${i + 1}: missing week_start_date`)
      continue
    }

    const weekStart = parseWeekStart(rawDate)
    if (!weekStart) {
      errors.push(`Row ${i + 1}: could not parse date "${rawDate}"`)
      continue
    }

    const bookings = parseInt(rawBookings, 10)
    if (isNaN(bookings)) {
      errors.push(`Row ${i + 1}: invalid bookings value "${rawBookings}"`)
      continue
    }

    let revenue: number | null = null
    if (rawRevenue) {
      const parsed = parseFloat(rawRevenue.replace(/[$,]/g, ""))
      if (!isNaN(parsed)) revenue = parsed
    }

    rows.push({
      client_id: params.clientId,
      week_start_date: weekStart,
      bookings,
      revenue,
      notes: rawNotes || null,
      uploaded_by: user?.id ?? null,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found", details: errors },
      { status: 400 },
    )
  }

  const db = createServiceClient()
  const batchSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await db
      .from("weekly_bookings")
      .upsert(batch, { onConflict: "client_id,week_start_date" })
    if (error) return safeError(error)
    inserted += batch.length
  }

  return NextResponse.json(
    { inserted, errors: errors.length > 0 ? errors.slice(0, 10) : undefined },
    { status: 201 },
  )
}

/**
 * Accept YYYY-MM-DD, M/D/YYYY, or "YYYY W##" (ISO week) and return the Monday
 * of the ISO week containing that date as a YYYY-MM-DD string.
 */
function parseWeekStart(input: string): string | null {
  const trimmed = input.trim()

  // Try "2026 W17" / "2026-W17" (ISO week notation)
  const wkMatch = trimmed.match(/^(\d{4})[\s-]?W(\d{1,2})$/i)
  if (wkMatch) {
    const year = parseInt(wkMatch[1], 10)
    const week = parseInt(wkMatch[2], 10)
    return isoWeekToMonday(year, week)
  }

  // Try YYYY-MM-DD first (unambiguous)
  let d: Date | null = null
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    d = new Date(trimmed + "T00:00:00Z")
  }
  // Fall back to US-style M/D/YYYY
  if (!d || isNaN(d.getTime())) {
    const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (slash) {
      const m = parseInt(slash[1], 10)
      const day = parseInt(slash[2], 10)
      const y = parseInt(slash[3], 10)
      d = new Date(Date.UTC(y, m - 1, day))
    }
  }
  if (!d || isNaN(d.getTime())) return null

  return isoWeekMonday(d)
}

/** Monday of the ISO week containing date `d` (UTC), as YYYY-MM-DD. */
function isoWeekMonday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay() || 7 // Sunday = 7
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1))
  return x.toISOString().slice(0, 10)
}

/** Convert (ISO-year, ISO-week) to the Monday of that week, YYYY-MM-DD. */
function isoWeekToMonday(year: number, week: number): string | null {
  if (week < 1 || week > 53) return null
  // ISO week 1 contains Jan 4th. Find that week's Monday, then add (week-1) weeks.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))
  const target = new Date(week1Monday)
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  return target.toISOString().slice(0, 10)
}

/** Simple CSV line parser that handles quoted fields. */
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
