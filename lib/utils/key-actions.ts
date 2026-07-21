/**
 * Shared conversion "key action" definitions.
 *
 * A key action names a conversion column on meta_daily_performance. Creative
 * tests resolve their optimisation event per ad set: the ad set's own Meta
 * optimisation goal is the default, with an optional per-test override and
 * the client-level config as the final fallback.
 */

export type KeyAction =
  | "purchases"
  | "adds_to_cart"
  | "checkouts_initiated"
  | "registrations_completed"
  | "landing_page_views"
  | "unique_link_clicks"
  | "app_installs"
  | "trials_started"

export const KEY_ACTIONS: { value: KeyAction; label: string; short: string }[] = [
  { value: "purchases", label: "Purchases", short: "Purchases" },
  { value: "adds_to_cart", label: "Adds to Cart", short: "ATCs" },
  { value: "checkouts_initiated", label: "Checkouts Initiated", short: "Checkouts" },
  { value: "registrations_completed", label: "Registrations", short: "Regs" },
  { value: "landing_page_views", label: "Landing Page Views", short: "LPVs" },
  { value: "unique_link_clicks", label: "Unique Link Clicks", short: "Clicks" },
  { value: "app_installs", label: "App Installs", short: "Installs" },
  { value: "trials_started", label: "Trials Started", short: "Trials" },
]

export function isKeyAction(value: string): value is KeyAction {
  return KEY_ACTIONS.some((a) => a.value === value)
}

export function keyActionLabel(value: string | null | undefined): string {
  const found = KEY_ACTIONS.find((a) => a.value === value)
  return found ? found.label : value ? value.replace(/_/g, " ") : "—"
}

export function keyActionShort(value: string | null | undefined): string {
  const found = KEY_ACTIONS.find((a) => a.value === value)
  return found ? found.short : value ? value.replace(/_/g, " ") : "—"
}

/**
 * Map a Meta ad set's optimisation goal (and, for OFFSITE_CONVERSIONS, the
 * promoted object's custom_event_type) to a key action column. Returns null
 * when the goal has no equivalent column — callers fall back to the client
 * config's key action.
 */
export function metaGoalToKeyAction(
  optimizationGoal: string | null,
  customEventType: string | null
): KeyAction | null {
  switch (optimizationGoal) {
    case "OFFSITE_CONVERSIONS":
    case "CONVERSIONS":
      switch (customEventType) {
        case "PURCHASE": return "purchases"
        case "ADD_TO_CART": return "adds_to_cart"
        case "INITIATED_CHECKOUT": return "checkouts_initiated"
        case "COMPLETE_REGISTRATION": return "registrations_completed"
        case "CONTENT_VIEW": return "landing_page_views"
        case "START_TRIAL": return "trials_started"
        default: return null
      }
    case "VALUE": return "purchases"
    case "LANDING_PAGE_VIEWS": return "landing_page_views"
    case "LINK_CLICKS": return "unique_link_clicks"
    case "APP_INSTALLS": return "app_installs"
    default: return null
  }
}
