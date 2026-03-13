/**
 * Ad Name Parser — ported from KIMA v1 AdNameParser.jsx
 *
 * Parses underscore-delimited ad names into structured fields:
 *   Format_LandingPage_LaunchDate_Concept_Copy_Creator_StyleCode_Campaign_Version
 *
 * Supports client-specific naming configs (NamingConfig) for custom
 * position→dimension mappings. Falls back to the hardcoded convention
 * when no config is provided.
 *
 * Tolerant: handles non-conforming names gracefully (null fields).
 */

// --- Naming Config Types ---

export type NamingPosition = { index: number; key: string; label: string }

export type NamingConfig = {
  positions: NamingPosition[]
  valueMaps: Record<string, Record<string, string>>
}

// --- Landing Page Codes ---

export const LANDING_PAGE_MAP: Record<string, string> = {
  PP: "Product Page",
  SP: "Special Page",
  HP: "Homepage",
  CP: "Collection Page",
}

// --- Style Codes ---

export const STYLE_MAP: Record<string, string> = {
  SC1: "UGC",
  SC2: "Influencer",
  SC3: "Stop Motion",
  SC4: "Collage",
  SC5: "Studio Shoot",
  SC6: "Product Demo",
  SC7: "Animated Static",
  SC8: "Static Text",
  SC9: "Lo-fi",
  SC10: "Customer Review",
  SC11: "Behind The Scenes",
}

// --- Parsed Result Type ---

export type ParsedAdName = {
  format: string | null
  landingPage: string | null
  landingPageCode: string | null
  launchDate: string | null
  conceptName: string | null
  conceptCopy: string | null
  creator: string | null
  styleOfContent: string | null
  styleOfContentCode: string | null
  campaign: string | null
  version: string | null
  originalName: string
  /** Custom dimensions from client naming config (non-standard keys) */
  customDimensions?: Record<string, string>
}

/** Standard dimension keys that can be extracted from parsed ad names */
export type AdDimension =
  | "format"
  | "landingPage"
  | "conceptName"
  | "conceptCopy"
  | "creator"
  | "styleOfContent"
  | "campaign"
  | "version"

/** Standard (hardcoded) dimension keys */
const STANDARD_KEYS: readonly string[] = [
  "format",
  "landingPage",
  "landingPageCode",
  "launchDate",
  "conceptName",
  "conceptCopy",
  "creator",
  "styleOfContent",
  "styleOfContentCode",
  "campaign",
  "version",
]

export const DIMENSION_LABELS: Record<AdDimension, string> = {
  format: "Format",
  landingPage: "Landing Page",
  conceptName: "Concept",
  conceptCopy: "Copy",
  creator: "Creator",
  styleOfContent: "Style",
  campaign: "Campaign",
  version: "Version",
}

/**
 * Get display label for a dimension key.
 * Checks config positions first (custom label), falls back to DIMENSION_LABELS.
 */
export function getDimensionLabel(dim: string, config?: NamingConfig): string {
  if (config) {
    const pos = config.positions.find((p) => p.key === dim)
    if (pos) return pos.label
  }
  return (DIMENSION_LABELS as Record<string, string>)[dim] || dim
}

// --- Parser ---

/**
 * Parse an ad name into structured fields.
 *
 * @param adName  The raw ad name string
 * @param config  Optional client-specific naming config.
 *                When provided, positions from config are used instead of hardcoded mapping.
 *                When omitted, the legacy hardcoded convention is used (backward compatible).
 */
export function parseAdName(adName: string, config?: NamingConfig): ParsedAdName {
  const result: ParsedAdName = {
    format: null,
    landingPage: null,
    landingPageCode: null,
    launchDate: null,
    conceptName: null,
    conceptCopy: null,
    creator: null,
    styleOfContent: null,
    styleOfContentCode: null,
    campaign: null,
    version: null,
    originalName: adName,
  }

  if (!adName || !adName.includes("_")) {
    result.conceptName = adName || null
    return result
  }

  const parts = adName.split("_")
  const get = (idx: number): string | null =>
    idx < parts.length && parts[idx] ? parts[idx] : null

  // --- Config-aware parsing ---
  if (config && config.positions.length > 0) {
    const customDimensions: Record<string, string> = {}

    for (const pos of config.positions) {
      const rawValue = get(pos.index)
      if (!rawValue) continue

      // Apply value maps if configured for this dimension
      const valueMap = config.valueMaps[pos.key]
      const mappedValue = valueMap?.[rawValue] || rawValue

      // If the key is a standard ParsedAdName field, set it directly
      if (STANDARD_KEYS.includes(pos.key)) {
        // Handle special cases for standard fields
        switch (pos.key) {
          case "landingPage":
            result.landingPageCode = rawValue
            result.landingPage = mappedValue
            break
          case "styleOfContent":
            result.styleOfContentCode = rawValue.startsWith("SC") ? rawValue : null
            result.styleOfContent = mappedValue
            break
          default:
            ;(result as any)[pos.key] = mappedValue
            break
        }
      } else {
        // Non-standard dimension → store in customDimensions
        customDimensions[pos.key] = mappedValue
      }
    }

    if (Object.keys(customDimensions).length > 0) {
      result.customDimensions = customDimensions
    }

    return result
  }

  // --- Legacy hardcoded parsing (no config) ---

  // Position 0: Format
  result.format = get(0)

  // Position 1: Landing Page
  const lpCode = get(1)
  result.landingPageCode = lpCode
  result.landingPage = lpCode ? LANDING_PAGE_MAP[lpCode] || lpCode : null

  // Position 2: Launch Date
  result.launchDate = get(2)

  // Position 3: Concept Name
  result.conceptName = get(3)

  // Position 4: Concept Copy
  result.conceptCopy = get(4)

  // Position 5: Creator
  result.creator = get(5)

  // Position 6: Style Code — also search other parts if not found at 6
  let styleCode = get(6)
  let styleFound = false

  if (styleCode && styleCode.startsWith("SC")) {
    styleFound = true
  } else {
    const scPart = parts.find((p) => /^SC\d+$/.test(p))
    if (scPart) {
      styleCode = scPart
      styleFound = true
    }
  }

  if (styleFound && styleCode) {
    result.styleOfContentCode = styleCode
    result.styleOfContent = STYLE_MAP[styleCode] || styleCode
  } else if (styleCode) {
    result.styleOfContent = styleCode
  }

  // Position 7: Campaign
  result.campaign = get(7)

  // Position 8: Version
  result.version = get(8)

  return result
}

/**
 * Returns which dimensions have actual data across a set of parsed ads.
 * Only returns dimensions where at least 2 distinct values exist.
 *
 * When config is provided, iterates config position keys (including custom ones).
 * When no config, uses the standard hardcoded dimension list.
 */
export function getAvailableDimensions(
  parsedAds: ParsedAdName[],
  config?: NamingConfig
): string[] {
  // Determine which dimension keys to check
  const dimensions: string[] = config && config.positions.length > 0
    ? config.positions.map((p) => p.key)
    : [
        "format",
        "landingPage",
        "conceptName",
        "conceptCopy",
        "creator",
        "styleOfContent",
        "campaign",
        "version",
      ]

  return dimensions.filter((dim) => {
    const values = new Set<string>()
    for (const ad of parsedAds) {
      let val: string | null = null

      // Check standard fields first
      if (STANDARD_KEYS.includes(dim)) {
        val = (ad as any)[dim] as string | null
      } else {
        // Check customDimensions
        val = ad.customDimensions?.[dim] || null
      }

      if (val) values.add(val)
    }
    return values.size >= 2
  })
}

/**
 * Get the value of a dimension from a parsed ad name.
 * Handles both standard fields and custom dimensions.
 */
export function getDimensionValue(
  parsed: ParsedAdName | undefined,
  dim: string
): string | null {
  if (!parsed) return null

  // Standard field
  if (STANDARD_KEYS.includes(dim)) {
    return (parsed as any)[dim] as string | null
  }

  // Custom dimension
  return parsed.customDimensions?.[dim] || null
}
