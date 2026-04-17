/**
 * Hardcoded data for the W&B Messaging JOB Analysis dashboard.
 * Source: Windsor.ai / Meta Ads API (act_12589706), 15 Mar – 13 Apr 2026.
 */

import type { AdRow } from "@/components/messaging/job-ads-table"

export const DATE_RANGE_LABEL = "15 Mar to 13 Apr 2026"

export const SUMMARY_KPIS = {
  totalSpend: 123033.63,
  totalRevenue: 382277.97,
  overallRoas: 3.11,
  totalAds: 166,
  taggedAds: 34,
  taggedPct: 20.5,
  untaggedAds: 132,
}

export type JobSummary = {
  job: string
  spend: number
  revenue: number
  purchases: number
  roas: number
  ads: number
}

export const JOB_SUMMARY: JobSummary[] = [
  { job: "Conscious Consumer", spend: 1106.23, revenue: 5536.44, purchases: 43, roas: 5.0, ads: 11 },
  { job: "Considered Shopper", spend: 3668.06, revenue: 14005.31, purchases: 108, roas: 3.82, ads: 8 },
  { job: "Bold Trendsetter", spend: 9708.31, revenue: 33105.34, purchases: 237, roas: 3.41, ads: 15 },
  { job: "Untagged", spend: 108551.03, revenue: 329630.88, purchases: 1851, roas: 3.04, ads: 132 },
]

export type HeatmapRow = {
  job: string
  uk: { roas: number; spend: number }
  us: { roas: number; spend: number }
  au: { roas: number; spend: number }
}

export const HEATMAP: HeatmapRow[] = [
  {
    job: "Conscious Consumer",
    uk: { roas: 6.04, spend: 886.3 },
    us: { roas: 0.85, spend: 219.76 },
    au: { roas: 0.0, spend: 0.17 },
  },
  {
    job: "Considered Shopper",
    uk: { roas: 3.73, spend: 3256.8 },
    us: { roas: 4.66, spend: 234.28 },
    au: { roas: 4.41, spend: 176.98 },
  },
  {
    job: "Bold Trendsetter",
    uk: { roas: 4.15, spend: 5836.1 },
    us: { roas: 2.19, spend: 2749.3 },
    au: { roas: 2.57, spend: 1122.91 },
  },
  {
    job: "Untagged",
    uk: { roas: 3.56, spend: 29737.72 },
    us: { roas: 2.86, spend: 68325.16 },
    au: { roas: 2.68, spend: 10488.15 },
  },
]

export const HEATMAP_CALLOUTS = [
  "Conscious Consumer UK is the standout at 6.04x ROAS, but on low spend (£886).",
  "Considered Shopper performs well across all markets (3.73x–4.66x) — most consistent JOB.",
  "Bold Trendsetter is strong in UK (4.15x) but drops in US (2.19x) and AU (2.57x).",
  "Conscious Consumer has almost zero spend outside UK — needs scaling test.",
]

export const JOB_ADS: AdRow[] = [
  { name: "Test - 0226_Motion_ugc-trendsetterstylist_V1&2_Flex", job: "Bold Trendsetter", market: "UK", spend: 36.7, roas: 16.81 },
  { name: "0226_Motion_UGC_Conscious Consumer_Hook1&2_Flex", job: "Conscious Consumer", market: "UK", spend: 886.08, roas: 6.04 },
  { name: "Landing Page Test - 0326_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex_Edit", job: "Considered Shopper", market: "UK", spend: 1405.47, roas: 5.06 },
  { name: "Test - 0226_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex", job: "Considered Shopper", market: "UK", spend: 142.34, roas: 5.05 },
  { name: "Test - 0226_Motion_UGC_Trendsetter_Stylist_V1&2_Flex", job: "Bold Trendsetter", market: "UK", spend: 2620.02, roas: 4.87 },
  { name: "0226_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex", job: "Considered Shopper", market: "US", spend: 128.59, roas: 4.77 },
  { name: "0226_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex", job: "Considered Shopper", market: "US", spend: 105.69, roas: 4.52 },
  { name: "Test - 0226_motion-FOSbag_Bold Trendsetter_Hook1-3_Flex", job: "Bold Trendsetter", market: "UK", spend: 23.06, roas: 4.51 },
  { name: "0226_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex", job: "Considered Shopper", market: "AU", spend: 176.98, roas: 4.41 },
  { name: "Test - 0226_Motion_UGC_Trendsetter_Bike_1&2_Flex", job: "Bold Trendsetter", market: "UK", spend: 320.43, roas: 4.12 },
  { name: "0226_Motion_UGC_Trendsetter_Bike_1&2_Flex", job: "Bold Trendsetter", market: "AU", spend: 68.27, roas: 3.75 },
  { name: "Test - 0226_Motion_Full Of Shit Bag_Bold Trendsetter_Hook1-3_Flex", job: "Bold Trendsetter", market: "UK", spend: 2831.05, roas: 3.31 },
  { name: "Test - 0226_Motion_UGC_Trendsetter_Stylist_V1&2_Flex", job: "Bold Trendsetter", market: "US", spend: 608.64, roas: 3.05 },
  { name: "0226_Motion_ugc-trendsetterstylist_V1&2_Flex", job: "Bold Trendsetter", market: "AU", spend: 523.42, roas: 2.72 },
  { name: "Landing Page Test - 0226_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex_Ad Landing Page", job: "Considered Shopper", market: "UK", spend: 1540.37, roas: 2.65 },
  { name: "0226_motion-FOSbag_Bold Trendsetter_Hook1-3_Flex", job: "Bold Trendsetter", market: "US", spend: 850.2, roas: 2.55 },
  { name: "0226_motion-FOSbag_Bold Trendsetter_Hook1-3_Flex", job: "Bold Trendsetter", market: "AU", spend: 531.22, roas: 2.26 },
  { name: "0226_Motion_Full Of Shit Bag_Bold Trendsetter_Hook1-3_Flex", job: "Bold Trendsetter", market: "US", spend: 711.62, roas: 2.1 },
  { name: "Test - 0226_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex", job: "Considered Shopper", market: "UK", spend: 164.12, roas: 1.4 },
  { name: "0226_Motion_UGC_Conscious Consumer_Hook1&2_Flex", job: "Conscious Consumer", market: "US", spend: 176.2, roas: 1.06 },
  { name: "Test - 0226_Motion_ugc-trendsetterstylist_V1&2_Flex", job: "Bold Trendsetter", market: "US", spend: 373.66, roas: 1.01 },
  { name: "0226_Motion_UGC_Trendsetter_Bike_1&2_Flex", job: "Bold Trendsetter", market: "US", spend: 134.69, roas: 1.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_3", job: "Conscious Consumer", market: "US", spend: 43.21, roas: 0.0 },
  { name: "0226_Motion_UGC_Trendsetter_Bike_1&2_Flex", job: "Bold Trendsetter", market: "US", spend: 70.49, roas: 0.0 },
  { name: "Test - 0226_Motion_UGC_Trendsetter_Bike_1&2_Flex", job: "Bold Trendsetter", market: "UK", spend: 4.84, roas: 0.0 },
  { name: "Test - 0226_Motion_UGC_Avoid Disappointment_Considered Shopper_Hook1&2_Flex", job: "Considered Shopper", market: "UK", spend: 4.5, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_1 (UK)", job: "Conscious Consumer", market: "UK", spend: 0.1, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_1 (US)", job: "Conscious Consumer", market: "US", spend: 0.25, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_1 (AU)", job: "Conscious Consumer", market: "AU", spend: 0.13, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_2 (UK)", job: "Conscious Consumer", market: "UK", spend: 0.01, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_2 (US)", job: "Conscious Consumer", market: "US", spend: 0.1, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_2 (AU)", job: "Conscious Consumer", market: "AU", spend: 0.03, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_3 (UK)", job: "Conscious Consumer", market: "UK", spend: 0.11, roas: 0.0 },
  { name: "0226_Static_Annotated_Review_Conscious Consumer_3 (AU)", job: "Conscious Consumer", market: "AU", spend: 0.01, roas: 0.0 },
]

export type TopAd = {
  name: string
  job: string
  market: "UK" | "US" | "AU"
  spend: number
  revenue: number
  purchases: number
  roas: number
}

export const TOP_ADS: TopAd[] = [
  { name: "New Season First Batch // Bags // Creative 4 // Flex", job: "Untagged", market: "US", spend: 175.61, revenue: 2515.5, purchases: 10, roas: 14.32 },
  { name: "New Season First Batch // Bags // Creative 4 // Flex", job: "Untagged", market: "UK", spend: 80.02, revenue: 1078.5, purchases: 4, roas: 13.48 },
  { name: "0226_Motion_Faux_Scrapbook_1&2_Flex", job: "Untagged", market: "US", spend: 150.74, revenue: 1803.27, purchases: 4, roas: 11.96 },
  { name: "0326_Motion_UGC_bf-styling_Hook1-3_Flex", job: "Untagged", market: "AU", spend: 57.57, revenue: 590.59, purchases: 2, roas: 10.26 },
  { name: "New Season First Batch // LA Shoot // Flex", job: "Untagged", market: "UK", spend: 949.65, revenue: 7656.08, purchases: 43, roas: 8.06 },
  { name: "Test - Occasionwear // Graduation // Image & Video Flex", job: "Untagged", market: "UK", spend: 254.47, revenue: 1896.8, purchases: 8, roas: 7.45 },
  { name: "Product Curated Ads // Lee Renee_Pendant Necklace_Search Bar // Static // Flex", job: "Untagged", market: "AU", spend: 106.34, revenue: 784.52, purchases: 4, roas: 7.38 },
  { name: "Test - 0226_motion-scrollingugcopener_V1&2_Flex", job: "Untagged", market: "US", spend: 306.71, revenue: 2083.44, purchases: 5, roas: 6.79 },
  { name: "0326_Motion_UGC_bf-styling_Hook1-3_Flex", job: "Untagged", market: "UK", spend: 161.64, revenue: 1075.1, purchases: 9, roas: 6.65 },
  { name: "Test - 0326_motion-ugcgrid_V1&2_Flex", job: "Untagged", market: "UK", spend: 194.36, revenue: 1287.2, purchases: 10, roas: 6.62 },
  { name: "0226_Motion_UGC_Conscious Consumer_Hook1&2_Flex", job: "Conscious Consumer", market: "UK", spend: 886.08, revenue: 5350.29, purchases: 42, roas: 6.04 },
  { name: "New Season First Batch // All ads grouped // Flex", job: "Untagged", market: "UK", spend: 3021.76, revenue: 16995.57, purchases: 91, roas: 5.62 },
  { name: "New Season First Batch // Jewellery // Creative 2 and 3 // Flex", job: "Untagged", market: "US", spend: 288.03, revenue: 1607.4, purchases: 7, roas: 5.58 },
  { name: "Test - Occasionwear // Wedding Guest // Image & Video Flex", job: "Untagged", market: "UK", spend: 1556.92, revenue: 8484.7, purchases: 43, roas: 5.45 },
  { name: "Test - Core Messaging Quality // Category Mix // Video", job: "Untagged", market: "UK", spend: 212.56, revenue: 1108.8, purchases: 11, roas: 5.22 },
]

export const INSIGHTS: { title: string; body: string }[] = [
  {
    title: "Only 20% of ads are JOB-tagged",
    body: "34 of 166 ads explicitly reference a messaging house JOB (Bold Trendsetter, Considered Shopper, or Conscious Consumer). The remaining 80% are untagged.",
  },
  {
    title: "All 3 JOBs outperform untagged ads on ROAS",
    body: "Conscious Consumer (5.00x), Considered Shopper (3.82x), and Bold Trendsetter (3.41x) all beat the Untagged average of 3.04x.",
  },
  {
    title: "Conscious Consumer is highest ROAS but lowest spend",
    body: "At just £1,106 total spend (mostly UK), it returned 5.00x. This JOB has barely been tested in US/AU markets.",
  },
  {
    title: "Considered Shopper is the most consistent performer",
    body: "Returns 3.73x–4.66x across all three markets with relatively even performance.",
  },
  {
    title: "Bold Trendsetter has the most spend among tagged ads (£9,708)",
    body: "But shows a significant UK vs US gap — 4.15x in UK vs 2.19x in US.",
  },
  {
    title: "Top performing individual JOB ad",
    body: "\"0226_Motion_UGC_Conscious Consumer_Hook1&2_Flex\" in UK at 6.04x ROAS on £886 spend (42 purchases).",
  },
  {
    title: "Landing page test insight",
    body: "The Considered Shopper LP test edit variant (5.06x) significantly outperformed the ad LP variant (2.65x) on comparable spend.",
  },
]

export const METHOD_NOTE =
  'Ads containing "Trendsetter" (without "Bold") were included under Bold Trendsetter — confirm if this should be tightened.'

export const DATA_NOTES = [
  "Source: Windsor.ai / Meta Ads API",
  "Account: Wolf & Badger (act_12589706)",
  "Date range: 15 March – 13 April 2026",
  "Currency: GBP",
  "Ad sets included: UK Consolidated, UK UGC Only, US Consolidated, US UGC Only, AU Consolidated",
  "ROAS = Revenue / Spend (action_values_offsite_conversion_fb_pixel_purchase / spend)",
  "JOB classification: Strict name-matching only (Bold Trendsetter/Trendsetter, Considered Shopper, Conscious Consumer)",
]
