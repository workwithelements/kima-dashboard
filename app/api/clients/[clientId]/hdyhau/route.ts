import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/clients/[clientId]/hdyhau — fetch weekly HDYHAU allocations
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } },
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()
  const { data, error } = await db
    .from("weekly_hdyhau")
    .select("week_start_date, channel, dollars")
    .eq("client_id", params.clientId)
    .order("week_start_date", { ascending: true })

  if (error) return safeError(error)
  return NextResponse.json(data)
}

/**
 * POST /api/clients/[clientId]/hdyhau — upload CSV data
 *
 * Accepts either shape:
 *   1. Wide (matches the "How did you hear about us" weekly pivot export):
 *        WEEK_NAME, advertising, blogOrNewsArticle, directMailOrFlyer, socialMedia, ...
 *      The route pivots into one row per (week, channel).
 *   2. Long:
 *        week_start_date, channel, dollars
 *
 * WEEK_NAME values like "2026 W17" are parsed to the Monday of that ISO week.
 * Dollars are parsed stripping $ and commas.
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

  // Preserve original header names (for wide-format channel labels)
  const rawHeader = lines[0].split(",").map((h) => h.trim())
  const normHeader = rawHeader.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "_"))

  const weekIdx = normHeader.findIndex((h) =>
    ["week_name", "week_start_date", "week", "week_starting", "week_start", "date"].includes(h),
  )
  if (weekIdx === -1) {
    return NextResponse.json(
      { error: `No week column found. Expected one of: WEEK_NAME, week_start_date, week. Found: ${rawHeader.join(", ")}` },
      { status: 400 },
    )
  }

  const channelIdx = normHeader.findIndex((h) => h === "channel")
  const dollarsIdx = normHeader.findIndex((h) =>
    ["dollars", "amount", "value", "spend"].includes(h),
  )
  const isLong = channelIdx !== -1 && dollarsIdx !== -1

  const rows: Array<{
    client_id: string
    week_start_date: string
    channel: string
    dollars: number
    uploaded_by: string | null
  }> = []
  const errors: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 2) continue

    const rawWeek = cols[weekIdx]?.trim()
    const weekStart = rawWeek ? parseWeekStart(rawWeek) : null
    if (!weekStart) {
      errors.push(`Row ${i + 1}: could not parse week "${rawWeek}"`)
      continue
    }

    if (isLong) {
      const channel = cols[channelIdx]?.trim()
      const dollars = parseDollars(cols[dollarsIdx]?.trim())
      if (!channel) {
        errors.push(`Row ${i + 1}: missing channel`)
        continue
      }
      if (dollars === null) {
        errors.push(`Row ${i + 1}: invalid dollars`)
        continue
      }
      rows.push({
        client_id: params.clientId,
        week_start_date: weekStart,
        channel,
        dollars,
        uploaded_by: user?.id ?? null,
      })
    } else {
      // Wide: every column except the week column is a channel
      for (let c = 0; c < rawHeader.length; c++) {
        if (c === weekIdx) continue
        const channel = rawHeader[c]
        if (!channel) continue
        const dollars = parseDollars(cols[c]?.trim())
        if (dollars === null) continue
        rows.push({
          client_id: params.clientId,
          week_start_date: weekStart,
          channel,
          dollars,
          uploaded_by: user?.id ?? null,
        })
      }
    }
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
      .from("weekly_hdyhau")
      .upsert(batch, { onConflict: "client_id,week_start_date,channel" })
    if (error) return safeError(error)
    inserted += batch.length
  }

  return NextResponse.json(
    { inserted, errors: errors.length > 0 ? errors.slice(0, 10) : undefined },
    { status: 201 },
  )
}

/** Parse "$6,049", "6049", "0", "", etc. Returns null on failure. */
function parseDollars(input: string | undefined): number | null {
  if (input == null) return null
  const cleaned = input.replace(/[$,\s]/g, "")
  if (!cleaned) return 0
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? null : parsed
}

/** Accept YYYY-MM-DD, M/D/YYYY, or "YYYY W##". Snap to Monday of ISO week. */
function parseWeekStart(input: string): string | null {
  const trimmed = input.trim()

  const wkMatch = trimmed.match(/^(\d{4})[\s-]?W(\d{1,2})$/i)
  if (wkMatch) {
    const year = parseInt(wkMatch[1], 10)
    const week = parseInt(wkMatch[2], 10)
    return isoWeekToMonday(year, week)
  }

  let d: Date | null = null
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    d = new Date(trimmed + "T00:00:00Z")
  }
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

function isoWeekMonday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay() || 7
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1))
  return x.toISOString().slice(0, 10)
}

function isoWeekToMonday(year: number, week: number): string | null {
  if (week < 1 || week > 53) return null
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))
  const target = new Date(week1Monday)
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  return target.toISOString().slice(0, 10)
}

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
