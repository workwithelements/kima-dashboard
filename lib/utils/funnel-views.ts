/**
 * Shared types + helpers for client funnel views. A funnel view defines a
 * named funnel (e.g. "Ecomm", "App") with its own step list, key action, and
 * optional linked Meta campaigns. See supabase-funnel-views.sql.
 */

export type FunnelView = {
  id: string
  name: string
  sort_order: number
  funnel_steps: string[]
  key_action: string | null
  linked_campaign_ids: string[]
  is_default: boolean
}

export const SYNTHESISED_DEFAULT_ID = "__default__"

/**
 * Synthesise a transient default view from the legacy scorecard config fields,
 * used when a client has no rows in client_funnel_views yet. The returned
 * view has id=SYNTHESISED_DEFAULT_ID so the UI can detect and bootstrap real
 * rows on first save.
 */
export function synthesiseDefaultView(
  funnelSteps: string[] | null | undefined,
  keyAction: string | null | undefined
): FunnelView {
  return {
    id: SYNTHESISED_DEFAULT_ID,
    name: "Main",
    sort_order: 0,
    funnel_steps: funnelSteps || [],
    key_action: keyAction || null,
    linked_campaign_ids: [],
    is_default: true,
  }
}

export function pickActiveView(
  views: FunnelView[],
  requestedId: string | null | undefined
): FunnelView | null {
  if (views.length === 0) return null
  if (requestedId) {
    const found = views.find((v) => v.id === requestedId)
    if (found) return found
  }
  const def = views.find((v) => v.is_default)
  return def || views[0]
}
