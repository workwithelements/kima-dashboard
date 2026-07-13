/**
 * Formatting utilities — currency, numbers, percentages, dates.
 * Uses GBP (£) as default currency since most Elements clients are UK-based.
 */

/** Display symbol for a client currency code. */
export function currencySymbol(currency = "GBP"): string {
  return currency === "GBP" ? "£" : currency === "USD" ? "$" : "€"
}

export function fmtCurrency(n: number, currency = "GBP"): string {
  if (!isFinite(n)) return "—"
  const symbol = currencySymbol(currency)
  if (Math.abs(n) >= 1_000_000) {
    return `${symbol}${(n / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(n) >= 10_000) {
    return `${symbol}${(n / 1_000).toFixed(1)}k`
  }
  return `${symbol}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Compact currency: abbreviates from 1k up ("£5.1k", "£1.2M"), 2dp below. */
export function fmtCurrencyCompact(n: number, currency = "GBP"): string {
  if (!isFinite(n)) return "—"
  const symbol = currencySymbol(currency)
  if (Math.abs(n) >= 1_000_000) {
    return `${symbol}${(n / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(n) >= 1_000) {
    return `${symbol}${(n / 1_000).toFixed(1)}k`
  }
  return `${symbol}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Whole-currency-unit display ("$1,234"), abbreviated from 100k up. */
export function fmtCurrencyWhole(n: number, currency = "GBP"): string {
  if (!isFinite(n)) return "—"
  const symbol = currencySymbol(currency)
  const sign = n < 0 ? "−" : ""
  const abs = Math.abs(n)
  // 999,950+ would render as "1000.0k" in the k branch — promote to M
  if (abs >= 999_950) {
    return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`
  }
  if (abs >= 100_000) {
    return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k`
  }
  return `${sign}${symbol}${Math.round(abs).toLocaleString("en-GB")}`
}

export function fmtCurrencyFull(n: number, currency = "GBP"): string {
  if (!isFinite(n)) return "—"
  const symbol = currencySymbol(currency)
  return `${symbol}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtNumber(n: number, decimals = 0): string {
  if (!isFinite(n)) return "—"
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(n) >= 10_000) {
    return `${(n / 1_000).toFixed(1)}k`
  }
  return n.toLocaleString("en-GB", { maximumFractionDigits: decimals })
}

export function fmtPercent(n: number, decimals = 1): string {
  if (!isFinite(n)) return "—"
  return `${n.toFixed(decimals)}%`
}

export function fmtRoas(n: number): string {
  if (!isFinite(n)) return "—"
  return `${n.toFixed(2)}x`
}

/**
 * Format a delta percentage for comparison display.
 * Returns e.g. "+12.3%" or "−5.1%"
 */
export function fmtDelta(current: number, previous: number): { text: string; positive: boolean } {
  if (!previous || !isFinite(current) || !isFinite(previous)) {
    return { text: "—", positive: true }
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const sign = pct >= 0 ? "+" : ""
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    positive: pct >= 0,
  }
}

/** Short date: "6 Mar" */
export function fmtDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/** Full date: "6 March 2026" */
export function fmtDateFull(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}
