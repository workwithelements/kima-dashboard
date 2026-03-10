/**
 * Configurable metric definitions for creative cards and tables.
 *
 * Each metric knows how to extract its value from a ClassifiedAd,
 * format it for display, and what sort key to use.
 */

import type { ClassifiedAd } from "./creative-classification"
import { fmtCurrency, fmtNumber, fmtPercent } from "./format"

export type CreativeMetricKey =
  | "spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "cpa"
  | "cvr"
  | "roas"
  | "revenue"
  | "spendShare"

export type CreativeMetricDef = {
  key: CreativeMetricKey
  label: string
  shortLabel: string
  /** Extract raw numeric value (for sorting) */
  getValue: (ad: ClassifiedAd) => number | null
  /** Format value for display */
  format: (ad: ClassifiedAd, currency: string) => string
  /** Right-align in table? */
  align: "left" | "right"
}

export const CREATIVE_METRICS: Record<CreativeMetricKey, CreativeMetricDef> = {
  spend: {
    key: "spend",
    label: "Spend",
    shortLabel: "Spend",
    getValue: (ad) => ad.spend,
    format: (ad, c) => fmtCurrency(ad.spend, c),
    align: "right",
  },
  impressions: {
    key: "impressions",
    label: "Impressions",
    shortLabel: "Impr.",
    getValue: (ad) => ad.impressions,
    format: (ad) => fmtNumber(ad.impressions),
    align: "right",
  },
  clicks: {
    key: "clicks",
    label: "Clicks",
    shortLabel: "Clicks",
    getValue: (ad) => ad.clicks,
    format: (ad) => fmtNumber(ad.clicks),
    align: "right",
  },
  conversions: {
    key: "conversions",
    label: "Conversions",
    shortLabel: "Conv",
    getValue: (ad) => ad.conversions,
    format: (ad) => fmtNumber(ad.conversions),
    align: "right",
  },
  cpa: {
    key: "cpa",
    label: "CPA",
    shortLabel: "CPA",
    getValue: (ad) => ad.cpa,
    format: (ad, c) => (ad.cpa !== null ? fmtCurrency(ad.cpa, c) : "—"),
    align: "right",
  },
  cvr: {
    key: "cvr",
    label: "CVR",
    shortLabel: "CVR",
    getValue: (ad) => ad.cvr,
    format: (ad) => fmtPercent(ad.cvr * 100, 2),
    align: "right",
  },
  roas: {
    key: "roas",
    label: "ROAS",
    shortLabel: "ROAS",
    getValue: (ad) => (ad.spend > 0 ? ad.revenue / ad.spend : 0),
    format: (ad) => {
      const roas = ad.spend > 0 ? ad.revenue / ad.spend : 0
      return roas > 0 ? `${roas.toFixed(1)}x` : "—"
    },
    align: "right",
  },
  revenue: {
    key: "revenue",
    label: "Revenue",
    shortLabel: "Rev",
    getValue: (ad) => ad.revenue,
    format: (ad, c) => fmtCurrency(ad.revenue, c),
    align: "right",
  },
  spendShare: {
    key: "spendShare",
    label: "Spend Share",
    shortLabel: "Share",
    getValue: (ad) => ad.spendShare,
    format: (ad) => fmtPercent(ad.spendShare, 1),
    align: "right",
  },
}

/** Ordered list of all metric keys for the picker UI */
export const CREATIVE_METRIC_ORDER: CreativeMetricKey[] = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "cpa",
  "cvr",
  "roas",
  "revenue",
  "spendShare",
]

/** Default metrics shown on cards (6 to fill the 3×2 grid) */
export const DEFAULT_CARD_METRICS: CreativeMetricKey[] = [
  "spend",
  "conversions",
  "cpa",
  "cvr",
  "roas",
  "spendShare",
]

/** Default metrics shown in table columns */
export const DEFAULT_TABLE_METRICS: CreativeMetricKey[] = [
  "spend",
  "impressions",
  "conversions",
  "cpa",
  "cvr",
  "spendShare",
]
