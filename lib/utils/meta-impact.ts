/**
 * Meta Impact analytics for Mooncup.
 *
 * Compares Meta Ads spend against Shopify revenue to estimate the
 * incremental impact of Meta on total business revenue.
 *
 * Inputs:
 *  - Daily Shopify total revenue (excluding B2B) — from Weekly_orders_less_B2B.csv
 *  - Daily Shopify last-click paid revenue — from Paid_orders.csv
 *  - Monthly Meta spend — hard-coded or from Windsor.ai
 *  - Monthly Meta-tracked purchases — hard-coded
 *  - Fixed monthly management fee (£2,200)
 */

// ── Types ──

export type DailyRevenueRow = {
  date: string // YYYY-MM-DD
  orders: number
  netSales: number
}

/** A daily Meta spend point — one entry per day */
export type DailyMetaSpend = {
  date: string // YYYY-MM-DD
  spend: number
  purchases: number
}

export type MonthlyMetaSpend = {
  month: string // YYYY-MM
  spend: number
  purchases: number
}

export type MonthlySummary = {
  month: string // YYYY-MM
  monthLabel: string // "Jan 2026"
  metaSpend: number
  managementFee: number
  totalCost: number
  totalRevenue: number
  paidRevenue: number
  metaPurchases: number
  totalOrders: number
  paidOrders: number
  roasHeadline: number // total revenue / Meta spend
  roasTrue: number // total revenue / total cost
  roasLastClick: number // paid revenue / Meta spend
}

export type WeeklyPoint = {
  weekStart: string // YYYY-MM-DD (Monday)
  weekLabel: string // "W14 2026"
  revenue: number
  paidRevenue: number
  metaSpend: number
}

export type LagCorrelation = {
  lagWeeks: number
  r: number
  rSquared: number
  n: number
}

export type RegressionResult = {
  slope: number
  intercept: number
  r: number
  rSquared: number
  n: number
}

/** A daily Amazon sales point */
export type DailyAmazonRow = {
  date: string // YYYY-MM-DD
  sales: number // revenue in GBP
  units: number // units sold
}

/** A daily GSC search data point */
export type DailySearchRow = {
  date: string // YYYY-MM-DD
  impressions: number
  clicks: number
}

/** A daily Shopify sessions point */
export type DailySessionsRow = {
  date: string // YYYY-MM-DD
  sessions: number
}

/** Extended weekly point with all channel data */
export type ExtendedWeeklyPoint = WeeklyPoint & {
  amazonSales: number
  searchImpressions: number
  searchClicks: number
  shopifySessions: number
  adstockedSpend: number
}

export type CorrelationEntry = {
  xLabel: string
  yLabel: string
  r: number
  n: number
}

export type MultivariateResult = {
  coefficients: number[] // [intercept, β1, β2, ...]
  rSquared: number
  n: number
}

export type DecompositionResult = {
  baseline: number
  metaDriven: number
  searchDriven: number
  residual: number
  totalRevenue: number
  rSquared: number
  n: number
}

export type SaturationFit = {
  a: number // coefficient of ln(x)
  b: number // constant
  rSquared: number
}

// ── Constants ──

export const MANAGEMENT_FEE_MONTHLY = 2200

/** Hard-coded Meta spend data — replace with Windsor when integrated */
export const DEFAULT_META_SPEND: MonthlyMetaSpend[] = [
  { month: "2026-01", spend: 6346.22, purchases: 126 },
  { month: "2026-02", spend: 5457.77, purchases: 68 },
  { month: "2026-03", spend: 4549.32, purchases: 86 },
]

// ── CSV parsing ──

/** Simple CSV parser — handles quoted fields with commas */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  for (const line of lines) {
    const cells: string[] = []
    let cur = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        inQuotes = !inQuotes
      } else if (c === "," && !inQuotes) {
        cells.push(cur.trim())
        cur = ""
      } else {
        cur += c
      }
    }
    cells.push(cur.trim())
    rows.push(cells)
  }
  return rows
}

/** Parse "Day" column to YYYY-MM-DD. Accepts: 2026-01-15, 15/01/2026, Jan 15, 2026 */
export function parseDate(s: string): string | null {
  if (!s) return null
  const trimmed = s.replace(/^"|"$/g, "").trim()

  // ISO format
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // DD/MM/YYYY
  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const d = dmy[1].padStart(2, "0")
    const m = dmy[2].padStart(2, "0")
    return `${dmy[3]}-${m}-${d}`
  }

  // Try Date.parse
  const t = Date.parse(trimmed)
  if (!isNaN(t)) {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }
  return null
}

/** Parse a numeric cell — strips currency symbols, commas, etc. */
export function parseNumber(s: string): number {
  if (!s) return 0
  const cleaned = s.replace(/^"|"$/g, "").replace(/[£$,€\s]/g, "")
  const n = parseFloat(cleaned)
  return isFinite(n) ? n : 0
}

/**
 * Parse a Shopify "Weekly orders" CSV.
 * Expected columns: Day, Orders, Quantity ordered per order, AOV, Quantity returned, Net sales
 */
export function parseShopifyDaily(csvText: string): DailyRevenueRow[] {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return []

  // Find column indices from header
  const header = rows[0].map((h) => h.toLowerCase())
  const dayIdx = header.findIndex((h) => h.includes("day") || h.includes("date"))
  const ordersIdx = header.findIndex((h) => h.includes("order") && !h.includes("aov") && !h.includes("returned"))
  const netSalesIdx = header.findIndex((h) => h.includes("net sales") || h.includes("net_sales"))

  if (dayIdx === -1 || netSalesIdx === -1) {
    console.warn("[parseShopifyDaily] missing required columns", { dayIdx, netSalesIdx, header })
    return []
  }

  const out: DailyRevenueRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const date = parseDate(row[dayIdx])
    if (!date) continue
    out.push({
      date,
      orders: ordersIdx >= 0 ? parseNumber(row[ordersIdx]) : 0,
      netSales: parseNumber(row[netSalesIdx]),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Parse an Amazon sales CSV.
 * Handles both daily reports (Day/Date column) and weekly ASIN reports
 * (Week start column). Prefers "Ordered" over "Dispatched" revenue/units
 * so the signal reflects demand at the point of purchase.
 */
export function parseAmazonDaily(csvText: string): DailyAmazonRow[] {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return []

  const header = rows[0].map((h) => h.toLowerCase())
  const dayIdx = header.findIndex(
    (h) => h.includes("day") || h.includes("date") || h.includes("week start")
  )
  // Prefer "ordered" columns over "dispatched" — ordered reflects demand
  // at the moment of purchase, which is what ad spend influences.
  let salesIdx = header.findIndex(
    (h) => h.includes("ordered revenue") || h.includes("ordered product") || h.includes("ordered sales")
  )
  if (salesIdx === -1) {
    salesIdx = header.findIndex((h) => h.includes("sales") || h.includes("revenue"))
  }
  let unitsIdx = header.findIndex((h) => h.includes("ordered unit"))
  if (unitsIdx === -1) {
    unitsIdx = header.findIndex((h) => h.includes("unit"))
  }

  if (dayIdx === -1 || salesIdx === -1) {
    console.warn("[parseAmazonDaily] missing required columns", { dayIdx, salesIdx, header })
    return []
  }

  const out: DailyAmazonRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const date = parseDate(row[dayIdx])
    if (!date) continue
    out.push({
      date,
      sales: parseNumber(row[salesIdx]),
      units: unitsIdx >= 0 ? parseNumber(row[unitsIdx]) : 0,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Parse a Google Search Console CSV.
 * Expected columns: Date/Day, Impressions, Clicks
 */
export function parseGscDaily(csvText: string): DailySearchRow[] {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return []

  const header = rows[0].map((h) => h.toLowerCase())
  const dayIdx = header.findIndex((h) => h.includes("day") || h.includes("date"))
  const impressionsIdx = header.findIndex((h) => h.includes("impression"))
  const clicksIdx = header.findIndex((h) => h.includes("click"))

  if (dayIdx === -1 || (impressionsIdx === -1 && clicksIdx === -1)) {
    console.warn("[parseGscDaily] missing required columns", { dayIdx, impressionsIdx, clicksIdx, header })
    return []
  }

  const out: DailySearchRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const date = parseDate(row[dayIdx])
    if (!date) continue
    out.push({
      date,
      impressions: impressionsIdx >= 0 ? parseNumber(row[impressionsIdx]) : 0,
      clicks: clicksIdx >= 0 ? parseNumber(row[clicksIdx]) : 0,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Parse a Shopify store sessions CSV.
 * Expected columns: Day/Date, Sessions
 */
export function parseSessionsDaily(csvText: string): DailySessionsRow[] {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return []

  const header = rows[0].map((h) => h.toLowerCase())
  // Accept "Day", "Date", "Week" (exact), "Week start", or "Week ending"
  const dayIdx = header.findIndex(
    (h) => h.includes("day") || h.includes("date") || h === "week" || h.includes("week start") || h.includes("week ending")
  )
  // Accept "sessions", "visits", or common Shopify variants
  const sessionsIdx = header.findIndex(
    (h) => h.includes("session") || h.includes("visit")
  )

  if (dayIdx === -1 || sessionsIdx === -1) {
    console.warn("[parseSessionsDaily] missing required columns", { dayIdx, sessionsIdx, header })
    return []
  }

  const out: DailySessionsRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const date = parseDate(row[dayIdx])
    if (!date) continue
    out.push({
      date,
      sessions: parseNumber(row[sessionsIdx]),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Date / week helpers ──

/** Get the Monday of the ISO week containing the given date */
export function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z")
  const dow = d.getUTCDay() || 7 // Sunday = 7
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

/** Get ISO week label e.g. "W14 2026" */
export function isoWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `W${String(week).padStart(2, "0")} ${d.getUTCFullYear()}`
}

/** Month key for a date, e.g. "2026-01" */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** Number of days in a given month YYYY-MM */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number)
  return new Date(y, m, 0).getDate()
}

/** Pretty month label "Jan 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

// ── Aggregation ──

export function aggregateMonthly(rows: DailyRevenueRow[]): Map<string, { revenue: number; orders: number }> {
  const map = new Map<string, { revenue: number; orders: number }>()
  for (const r of rows) {
    const key = monthKey(r.date)
    const cur = map.get(key) || { revenue: 0, orders: 0 }
    cur.revenue += r.netSales
    cur.orders += r.orders
    map.set(key, cur)
  }
  return map
}

export function aggregateWeekly(rows: DailyRevenueRow[]): Map<string, { revenue: number; orders: number; weekLabel: string }> {
  const map = new Map<string, { revenue: number; orders: number; weekLabel: string }>()
  for (const r of rows) {
    const wk = isoWeekStart(r.date)
    const cur = map.get(wk) || { revenue: 0, orders: 0, weekLabel: isoWeekLabel(r.date) }
    cur.revenue += r.netSales
    cur.orders += r.orders
    map.set(wk, cur)
  }
  return map
}

/** Aggregate daily Meta spend into monthly totals */
export function dailyToMonthlyMetaSpend(daily: DailyMetaSpend[]): MonthlyMetaSpend[] {
  const map = new Map<string, { spend: number; purchases: number }>()
  for (const d of daily) {
    const key = monthKey(d.date)
    const cur = map.get(key) || { spend: 0, purchases: 0 }
    cur.spend += d.spend
    cur.purchases += d.purchases
    map.set(key, cur)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, spend: v.spend, purchases: v.purchases }))
}

// ── Combined monthly summary ──

export function buildMonthlySummaries(
  totalRows: DailyRevenueRow[],
  paidRows: DailyRevenueRow[],
  metaSpend: MonthlyMetaSpend[]
): MonthlySummary[] {
  const totalMonthly = aggregateMonthly(totalRows)
  const paidMonthly = aggregateMonthly(paidRows)

  // Build set of all months across both sources
  const allMonths = new Set<string>()
  metaSpend.forEach((m) => allMonths.add(m.month))
  totalMonthly.forEach((_, k) => allMonths.add(k))
  paidMonthly.forEach((_, k) => allMonths.add(k))

  const summaries: MonthlySummary[] = []
  Array.from(allMonths)
    .sort()
    .forEach((month) => {
      const meta = metaSpend.find((m) => m.month === month)
      const totalAgg = totalMonthly.get(month)
      const paidAgg = paidMonthly.get(month)

      const metaSpendVal = meta?.spend ?? 0
      const metaPurchases = meta?.purchases ?? 0
      const totalRevenue = totalAgg?.revenue ?? 0
      const paidRevenue = paidAgg?.revenue ?? 0
      const totalOrders = totalAgg?.orders ?? 0
      const paidOrders = paidAgg?.orders ?? 0
      const totalCost = metaSpendVal + MANAGEMENT_FEE_MONTHLY

      summaries.push({
        month,
        monthLabel: monthLabel(month),
        metaSpend: metaSpendVal,
        managementFee: MANAGEMENT_FEE_MONTHLY,
        totalCost,
        totalRevenue,
        paidRevenue,
        metaPurchases,
        totalOrders,
        paidOrders,
        roasHeadline: metaSpendVal > 0 ? totalRevenue / metaSpendVal : 0,
        roasTrue: totalCost > 0 ? totalRevenue / totalCost : 0,
        roasLastClick: metaSpendVal > 0 ? paidRevenue / metaSpendVal : 0,
      })
    })
  return summaries
}

// ── Weekly merged series ──

/**
 * Build weekly points combining Shopify revenue with weekly Meta spend.
 * Accepts either daily Meta spend (preferred — real granularity) or monthly
 * spend (which gets spread evenly across the days of each month as a fallback).
 */
export function buildWeeklyPoints(
  totalRows: DailyRevenueRow[],
  paidRows: DailyRevenueRow[],
  metaSpend: MonthlyMetaSpend[],
  dailyMetaSpend?: DailyMetaSpend[]
): WeeklyPoint[] {
  // Build a date → spend map. Prefer real daily data if provided; otherwise
  // fall back to spreading monthly totals evenly across the month.
  const dailyMeta = new Map<string, number>()
  if (dailyMetaSpend && dailyMetaSpend.length > 0) {
    for (const d of dailyMetaSpend) {
      dailyMeta.set(d.date, (dailyMeta.get(d.date) || 0) + d.spend)
    }
  } else {
    for (const m of metaSpend) {
      const days = daysInMonth(m.month)
      const daily = m.spend / days
      for (let d = 1; d <= days; d++) {
        const dateStr = `${m.month}-${String(d).padStart(2, "0")}`
        dailyMeta.set(dateStr, daily)
      }
    }
  }

  const totalWk = aggregateWeekly(totalRows)
  const paidWk = aggregateWeekly(paidRows)

  // Aggregate daily meta to weekly
  const metaWk = new Map<string, number>()
  dailyMeta.forEach((spend, date) => {
    const wk = isoWeekStart(date)
    metaWk.set(wk, (metaWk.get(wk) || 0) + spend)
  })

  // Only include weeks where we have Shopify revenue data. Including
  // weeks where Meta spent but Shopify has no data (because the CSV
  // doesn't cover that period) would inject artificial zero-revenue
  // points that poison the regression.
  const allWeeks = new Set<string>()
  totalWk.forEach((_, k) => allWeeks.add(k))
  paidWk.forEach((_, k) => allWeeks.add(k))

  const points: WeeklyPoint[] = []
  Array.from(allWeeks)
    .sort()
    .forEach((wk) => {
      const t = totalWk.get(wk)
      points.push({
        weekStart: wk,
        weekLabel: t?.weekLabel ?? isoWeekLabel(wk),
        revenue: t?.revenue ?? 0,
        paidRevenue: paidWk.get(wk)?.revenue ?? 0,
        metaSpend: metaWk.get(wk) ?? 0,
      })
    })
  return points
}

// ── Extended weekly points (multi-channel) ──

/**
 * Build extended weekly points combining all channel data with adstock.
 */
export function buildExtendedWeeklyPoints(
  totalRows: DailyRevenueRow[],
  paidRows: DailyRevenueRow[],
  metaSpend: MonthlyMetaSpend[],
  dailyMetaSpend: DailyMetaSpend[] | undefined,
  searchRows: DailySearchRow[],
  sessionsRows: DailySessionsRow[],
  amazonRows: DailyAmazonRow[],
  adstockDecay: number
): ExtendedWeeklyPoint[] {
  // Start with the base weekly points
  const base = buildWeeklyPoints(totalRows, paidRows, metaSpend, dailyMetaSpend)

  // Aggregate search data weekly
  const searchWk = new Map<string, { impressions: number; clicks: number }>()
  for (const r of searchRows) {
    const wk = isoWeekStart(r.date)
    const cur = searchWk.get(wk) || { impressions: 0, clicks: 0 }
    cur.impressions += r.impressions
    cur.clicks += r.clicks
    searchWk.set(wk, cur)
  }

  // Aggregate sessions data weekly
  const sessionsWk = new Map<string, number>()
  for (const r of sessionsRows) {
    const wk = isoWeekStart(r.date)
    sessionsWk.set(wk, (sessionsWk.get(wk) || 0) + r.sessions)
  }

  // Aggregate Amazon data weekly
  const amazonWk = new Map<string, number>()
  for (const r of amazonRows) {
    const wk = isoWeekStart(r.date)
    amazonWk.set(wk, (amazonWk.get(wk) || 0) + r.sales)
  }

  // Apply adstock to the spend series
  const rawSpend = base.map((p) => p.metaSpend)
  const adstocked = applyAdstock(rawSpend, adstockDecay)

  return base.map((p, i) => {
    const s = searchWk.get(p.weekStart)
    return {
      ...p,
      amazonSales: amazonWk.get(p.weekStart) ?? 0,
      searchImpressions: s?.impressions ?? 0,
      searchClicks: s?.clicks ?? 0,
      shopifySessions: sessionsWk.get(p.weekStart) ?? 0,
      adstockedSpend: adstocked[i],
    }
  })
}

// ── Statistics ──

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** Pearson correlation coefficient between two equal-length arrays */
export function pearsonR(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  const den = Math.sqrt(denX * denY)
  return den === 0 ? 0 : num / den
}

/** Simple linear regression y = slope*x + intercept */
export function linearRegression(xs: number[], ys: number[]): RegressionResult {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return { slope: 0, intercept: 0, r: 0, rSquared: 0, n }
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    num += dx * (ys[i] - my)
    den += dx * dx
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = my - slope * mx
  const r = pearsonR(xs.slice(0, n), ys.slice(0, n))
  return { slope, intercept, r, rSquared: r * r, n }
}

/**
 * Compute Pearson r between weekly Meta spend and weekly Shopify revenue,
 * with the revenue series shifted forward by `lagWeeks` (i.e. spend in week N
 * vs revenue in week N+lag).
 */
export function lagCorrelation(weekly: WeeklyPoint[], lagWeeks: number): LagCorrelation {
  const spend: number[] = []
  const revenue: number[] = []
  for (let i = 0; i < weekly.length - lagWeeks; i++) {
    spend.push(weekly[i].metaSpend)
    revenue.push(weekly[i + lagWeeks].revenue)
  }
  const r = pearsonR(spend, revenue)
  return { lagWeeks, r, rSquared: r * r, n: spend.length }
}

/** Run lag correlations for lags 0..maxLag */
export function lagCorrelationSeries(weekly: WeeklyPoint[], maxLag = 3): LagCorrelation[] {
  const out: LagCorrelation[] = []
  for (let lag = 0; lag <= maxLag; lag++) {
    out.push(lagCorrelation(weekly, lag))
  }
  return out
}

/** Run linear regression of revenue on spend with optional lag */
export function laggedRegression(weekly: WeeklyPoint[], lagWeeks: number): RegressionResult {
  const spend: number[] = []
  const revenue: number[] = []
  for (let i = 0; i < weekly.length - lagWeeks; i++) {
    spend.push(weekly[i].metaSpend)
    revenue.push(weekly[i + lagWeeks].revenue)
  }
  return linearRegression(spend, revenue)
}

// ── Adstock ──

/** Apply geometric decay adstock transformation: adstock[t] = spend[t] + decay * adstock[t-1] */
export function applyAdstock(series: number[], decay: number): number[] {
  if (series.length === 0) return []
  const out: number[] = [series[0]]
  for (let i = 1; i < series.length; i++) {
    out.push(series[i] + decay * out[i - 1])
  }
  return out
}

// ── Multi-channel correlation ──

/** Generalised lag correlation for any two number arrays */
export function lagCorrelationMulti(
  xs: number[],
  ys: number[],
  maxLag = 4
): LagCorrelation[] {
  const out: LagCorrelation[] = []
  for (let lag = 0; lag <= maxLag; lag++) {
    const x: number[] = []
    const y: number[] = []
    for (let i = 0; i < xs.length - lag; i++) {
      x.push(xs[i])
      y.push(ys[i + lag])
    }
    const r = pearsonR(x, y)
    out.push({ lagWeeks: lag, r, rSquared: r * r, n: x.length })
  }
  return out
}

/** Compute pairwise Pearson r for a set of named series */
export function correlationMatrix(
  series: Record<string, number[]>
): CorrelationEntry[] {
  const keys = Object.keys(series)
  const entries: CorrelationEntry[] = []
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const xs = series[keys[i]]
      const ys = series[keys[j]]
      const n = Math.min(xs.length, ys.length)
      if (n < 3) continue
      const r = pearsonR(xs.slice(0, n), ys.slice(0, n))
      entries.push({ xLabel: keys[i], yLabel: keys[j], r, n })
    }
  }
  return entries
}

// ── Multivariate regression ──

/**
 * OLS multivariate regression via normal equations: β = (X'X)^-1 X'y
 * Supports 1-3 predictors. First coefficient is the intercept.
 */
export function multivariateRegression(
  y: number[],
  xs: number[][] // each inner array is one predictor column
): MultivariateResult {
  const n = y.length
  const p = xs.length // number of predictors
  if (n < p + 2) return { coefficients: Array(p + 1).fill(0), rSquared: 0, n }

  // Build X matrix with intercept column [1, x1, x2, ...]
  const cols = p + 1
  // X'X (cols x cols)
  const xtx: number[][] = Array.from({ length: cols }, () => Array(cols).fill(0))
  // X'y (cols)
  const xty: number[] = Array(cols).fill(0)

  for (let i = 0; i < n; i++) {
    const row = [1, ...xs.map((x) => x[i])]
    for (let j = 0; j < cols; j++) {
      xty[j] += row[j] * y[i]
      for (let k = 0; k < cols; k++) {
        xtx[j][k] += row[j] * row[k]
      }
    }
  }

  // Solve via Gaussian elimination
  const aug: number[][] = xtx.map((row, i) => [...row, xty[i]])
  for (let i = 0; i < cols; i++) {
    // Partial pivot
    let maxRow = i
    for (let r = i + 1; r < cols; r++) {
      if (Math.abs(aug[r][i]) > Math.abs(aug[maxRow][i])) maxRow = r
    }
    ;[aug[i], aug[maxRow]] = [aug[maxRow], aug[i]]

    const pivot = aug[i][i]
    if (Math.abs(pivot) < 1e-12) return { coefficients: Array(cols).fill(0), rSquared: 0, n }

    for (let j = i; j <= cols; j++) aug[i][j] /= pivot
    for (let r = 0; r < cols; r++) {
      if (r === i) continue
      const f = aug[r][i]
      for (let j = i; j <= cols; j++) aug[r][j] -= f * aug[i][j]
    }
  }

  const coefficients = aug.map((row) => row[cols])

  // R-squared
  const yMean = mean(y)
  let ssTot = 0
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const predicted = coefficients[0] + xs.reduce((s, x, j) => s + coefficients[j + 1] * x[i], 0)
    ssTot += (y[i] - yMean) ** 2
    ssRes += (y[i] - predicted) ** 2
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  return { coefficients, rSquared, n }
}

/** Decompose revenue into baseline + Meta-driven + search-driven + residual */
export function decomposeRevenue(points: ExtendedWeeklyPoint[]): DecompositionResult {
  const n = points.length
  if (n < 5) {
    return { baseline: 0, metaDriven: 0, searchDriven: 0, residual: 0, totalRevenue: 0, rSquared: 0, n }
  }

  const y = points.map((p) => p.revenue)
  const x1 = points.map((p) => p.adstockedSpend)
  const x2 = points.map((p) => p.searchClicks)

  // Only use search clicks as predictor if we have non-zero data
  const hasSearch = x2.some((v) => v > 0)
  const xs = hasSearch ? [x1, x2] : [x1]

  const reg = multivariateRegression(y, xs)
  const totalRevenue = y.reduce((s, v) => s + v, 0)
  const baseline = reg.coefficients[0] * n
  const metaDriven = reg.coefficients[1] * x1.reduce((s, v) => s + v, 0)
  const searchDriven = hasSearch ? reg.coefficients[2] * x2.reduce((s, v) => s + v, 0) : 0
  const residual = totalRevenue - baseline - metaDriven - searchDriven

  return {
    baseline: Math.max(0, baseline),
    metaDriven: Math.max(0, metaDriven),
    searchDriven: Math.max(0, searchDriven),
    residual,
    totalRevenue,
    rSquared: reg.rSquared,
    n,
  }
}

/** Fit log saturation curve: y = a·ln(x) + b */
export function fitLogSaturation(xs: number[], ys: number[]): SaturationFit {
  const validPairs: { lnx: number; y: number }[] = []
  const n = Math.min(xs.length, ys.length)
  for (let i = 0; i < n; i++) {
    if (xs[i] > 0) validPairs.push({ lnx: Math.log(xs[i]), y: ys[i] })
  }
  if (validPairs.length < 3) return { a: 0, b: 0, rSquared: 0 }

  const lnxArr = validPairs.map((p) => p.lnx)
  const yArr = validPairs.map((p) => p.y)
  const reg = linearRegression(lnxArr, yArr)
  return { a: reg.slope, b: reg.intercept, rSquared: reg.rSquared }
}

/** Correlation strength label (aligned with LiftR thresholds) */
export function correlationStrength(r: number): "strong" | "moderate" | "weak" {
  const abs = Math.abs(r)
  if (abs >= 0.6) return "strong"
  if (abs >= 0.3) return "moderate"
  return "weak"
}
