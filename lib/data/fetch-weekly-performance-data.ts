/**
 * Server-side data fetching for the Ezra "Weekly Performance" tab.
 *
 * Reads public.v_attribution_weekly_performance from the KIMA V2 attribution
 * model. The model is Ezra-only, so this tab is gated to the Ezra client.
 *
 * PostgREST returns numeric columns as strings, so every numeric field is
 * coerced here — the view component can rely on real numbers / nulls.
 */

import { unstable_cache } from "next/cache"
import { createServiceClient } from "@/lib/supabase/server"
import type { WeeklyPerformanceRow } from "@/lib/utils/types"

const CACHE_TTL_SECONDS = 300

/** Coerce a PostgREST numeric (string | number | null) to number, defaulting to 0. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === "number" ? v : Number(v)
  return isFinite(n) ? n : 0
}

/** Coerce to number, preserving null (for fields where null is meaningful). */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === "number" ? v : Number(v)
  return isFinite(n) ? n : null
}

async function fetchWeeklyPerformanceDataUncached(): Promise<WeeklyPerformanceRow[]> {
  const db = createServiceClient()

  const { data, error } = await db
    .from("v_attribution_weekly_performance")
    .select("*")
    .eq("outcome", "Booking")
    .order("week_start", { ascending: true })

  if (error || !data) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r): WeeklyPerformanceRow => ({
    outcome: r.outcome,
    week_start: String(r.week_start).slice(0, 10),
    actual: numOrNull(r.actual),
    predicted: numOrNull(r.predicted),
    modeled_total: num(r.modeled_total),
    modeled_low: num(r.modeled_low),
    modeled_high: num(r.modeled_high),
    meta: num(r.meta),
    meta_low: num(r.meta_low),
    meta_high: num(r.meta_high),
    organic_nonbranded: num(r.organic_nonbranded),
    organic_branded: num(r.organic_branded),
    organic_social: num(r.organic_social),
    paid_search_brand: num(r.paid_search_brand),
    paid_search_nonbrand: num(r.paid_search_nonbrand),
    pr: num(r.pr),
    paid_spend: num(r.paid_spend),
    blended_cac: numOrNull(r.blended_cac),
    meta_cpa: numOrNull(r.meta_cpa),
    meta_maturity_pct: num(r.meta_maturity_pct),
  }))
}

/**
 * Cached wrapper — 5 min TTL. The view is global to the Ezra attribution model
 * (not per-client-id), but we key/tag on clientId to stay consistent with the
 * rest of the dashboard's cache invalidation.
 */
export const fetchWeeklyPerformanceData = (clientId: string) =>
  unstable_cache(
    () => fetchWeeklyPerformanceDataUncached(),
    ["weekly-performance", clientId],
    { revalidate: CACHE_TTL_SECONDS, tags: [`weekly-performance:${clientId}`] },
  )()
