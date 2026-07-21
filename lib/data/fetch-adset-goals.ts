import { createServiceClient } from "@/lib/supabase/server"
import { metaGoalToKeyAction } from "@/lib/utils/key-actions"

const META_GRAPH_URL = "https://graph.facebook.com/v21.0"
const GRAPH_TIMEOUT_MS = 5000
/** Refresh cached goals weekly — optimisation goals rarely change. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Graph ?ids= batch limit. */
const BATCH_SIZE = 50

export type AdsetGoal = {
  adsetId: string
  optimizationGoal: string | null
  customEventType: string | null
  /** Mapped meta_daily_performance column, null when no equivalent exists. */
  keyAction: string | null
}

/**
 * Resolve the Meta optimisation goal for a set of ad sets, used as the
 * default optimisation event for creative tests in each ad set.
 *
 * Reads the meta_adset_goals cache first, then batch-fetches missing/stale
 * entries from the Graph API and upserts them back. Fully graceful: with no
 * META_ACCESS_TOKEN, an unapplied migration, or Meta errors it returns
 * whatever it has (possibly {}), and callers fall back to the client-level
 * key action.
 */
export async function fetchAdsetGoals(
  clientId: string,
  adsetIds: string[]
): Promise<Record<string, AdsetGoal>> {
  const uniq = Array.from(new Set(adsetIds.filter(Boolean)))
  if (uniq.length === 0) return {}

  const supabase = createServiceClient()
  const goals: Record<string, AdsetGoal> = {}
  const stale = new Set(uniq)

  try {
    const { data, error } = await supabase
      .from("meta_adset_goals")
      .select("adset_id, optimization_goal, custom_event_type, key_action, fetched_at")
      .in("adset_id", uniq)
    if (error) return {} // table likely missing — migration not applied yet
    for (const row of data ?? []) {
      goals[row.adset_id] = {
        adsetId: row.adset_id,
        optimizationGoal: row.optimization_goal,
        customEventType: row.custom_event_type,
        keyAction: row.key_action,
      }
      const age = Date.now() - new Date(row.fetched_at).getTime()
      if (age < CACHE_TTL_MS) stale.delete(row.adset_id)
    }
  } catch {
    return {}
  }

  const accessToken = process.env.META_ACCESS_TOKEN
  if (!accessToken || stale.size === 0) return goals

  const toFetch = Array.from(stale)
  const upserts: Record<string, unknown>[] = []

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const chunk = toFetch.slice(i, i + BATCH_SIZE)
    try {
      const url =
        `${META_GRAPH_URL}/?ids=${chunk.join(",")}` +
        `&fields=${encodeURIComponent("name,optimization_goal,promoted_object{custom_event_type}")}` +
        `&access_token=${accessToken}`
      const res = await fetch(url, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok || !json) {
        console.warn(
          `[adset-goals] batch failed status=${res.status} msg=${json?.error?.message ?? "unparseable"}`
        )
        continue
      }
      for (const adsetId of chunk) {
        const entry = json[adsetId]
        if (!entry || entry.error) continue
        const optimizationGoal: string | null = entry.optimization_goal ?? null
        const customEventType: string | null =
          entry.promoted_object?.custom_event_type ?? null
        const keyAction = metaGoalToKeyAction(optimizationGoal, customEventType)
        goals[adsetId] = { adsetId, optimizationGoal, customEventType, keyAction }
        upserts.push({
          adset_id: adsetId,
          client_id: clientId,
          adset_name: entry.name ?? null,
          optimization_goal: optimizationGoal,
          custom_event_type: customEventType,
          key_action: keyAction,
          fetched_at: new Date().toISOString(),
        })
      }
    } catch (e: any) {
      console.warn(`[adset-goals] batch threw: ${e?.message ?? "unknown"}`)
    }
  }

  if (upserts.length > 0) {
    const { error } = await supabase.from("meta_adset_goals").upsert(upserts)
    if (error) console.warn(`[adset-goals] cache upsert failed: ${error.message}`)
  }

  return goals
}
