/**
 * Ad Name Parser — ported from KIMA v1 AdNameParser.jsx
 *
 * Parses underscore-delimited ad names into structured fields:
 *   Format_LandingPage_LaunchDate_Concept_Copy_Creator_StyleCode_Campaign_Version
 *
 * Tolerant: handles non-conforming names gracefully (null fields).
 */

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
}

/** Dimension keys that can be extracted from parsed ad names */
export type AdDimension =
  | "format"
  | "landingPage"
  | "conceptName"
  | "conceptCopy"
  | "creator"
  | "styleOfContent"
  | "campaign"
  | "version"

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

// --- Parser ---

export function parseAdName(adName: string): ParsedAdName {
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
 */
export function getAvailableDimensions(
  parsedAds: ParsedAdName[]
): AdDimension[] {
  const dimensions: AdDimension[] = [
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
      const val = ad[dim]
      if (val) values.add(val)
    }
    return values.size >= 2
  })
}
