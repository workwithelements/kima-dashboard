/**
 * Ad-volume calculator logic — a faithful port of Nest Commerce's
 * "Meta Andromeda / Ad Volume" calculator:
 * https://nestcommerce.co/resources/meta-ad-volume-calculator/
 *
 * The model: creative is training data for Meta's algorithm. Ring-fence a % of
 * monthly spend for creative testing; each tested ad needs ~CPA × multiplier of
 * spend to reach a verdict; ~10–20% of tested ads graduate into scaling
 * campaigns. Every coefficient below mirrors the original calculator's JS so it
 * can be retuned in one place.
 *
 * NOTE: the CPA-multiplier thresholds (100 / 200) and the high-spend floor
 * (50,000) are GBP-denominated in the source tool. We keep them as-is rather
 * than converting per account currency — they're heuristics, not hard numbers.
 */

/** Share of monthly spend ring-fenced for creative testing (source default + bounds). */
export const DEFAULT_TESTING_PCT = 25
export const MIN_TESTING_PCT = 10
export const MAX_TESTING_PCT = 40

/** Accounts at/above this monthly spend get a floor on recommended test volume. */
export const HIGH_SPEND_THRESHOLD = 50_000
export const MIN_ADS_AT_HIGH_SPEND = 50

/** Fraction of tested ads expected to graduate into scaling campaigns. */
export const WINNER_RATE_LOW = 0.1
export const WINNER_RATE_HIGH = 0.2

/** ROAS uplift Nest reports when clients close the volume gap. */
export const ROAS_UPLIFT_PCT = 0.38

/** Static client-result benchmarks shown alongside the report (percentages). */
export const NEST_BENCHMARKS = {
  roasUpliftPct: 38, // ROAS when ads-per-ad-set are maxed
  revenueUpliftPct: 19, // Revenue at higher volume & variance
  yoyLiftPct: 36, // Performance lift YoY vs the market
}

/** Spend (in account currency) to give one test ad a fair read ≈ CPA × this. */
export function spendPerTestMultiplier(cpa: number): number {
  if (cpa < 100) return 10
  if (cpa <= 200) return 7
  return 5
}

export type AdVolumePackage = "starter" | "growth" | "scale"

export const PACKAGES: Record<AdVolumePackage, { label: string; adsPerMonth: number }> = {
  starter: { label: "50 ads / month", adsPerMonth: 50 },
  growth: { label: "100 ads / month", adsPerMonth: 100 },
  scale: { label: "200 ads / month", adsPerMonth: 200 },
}

export function getPackage(adsNeeded: number): AdVolumePackage {
  if (adsNeeded <= 62) return "starter"
  if (adsNeeded <= 125) return "growth"
  return "scale"
}

export type AdVolumeInputs = {
  /** Monthly Meta ad spend, in the account's currency. */
  monthlySpend: number
  /** Average cost per (key) action, in the account's currency. */
  cpa: number
  /** % of monthly spend ring-fenced for creative testing (10–40). */
  testingPct: number
  /** Distinct new creatives the account is currently launching per month. */
  currentCreativePerMonth: number
}

export type AdVolumeResult = {
  /** Monthly spend × testing %. */
  testingBudget: number
  /** CPA × multiplier — spend needed to read one test ad. */
  spendPerTestAd: number
  /** Recommended distinct creatives to launch/test per month. */
  adsToTestPerMonth: number
  winnersLow: number
  winnersHigh: number
  /** How many more creatives/month are needed vs. what's going in now (≥ 0). */
  gap: number
  onTrack: boolean
  pkg: AdVolumePackage
  /** Rough additional monthly return if the gap is closed (spend × ROAS uplift). */
  estimatedMonthlyUplift: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function computeAdVolume(input: AdVolumeInputs): AdVolumeResult {
  const monthlySpend = Math.max(0, input.monthlySpend || 0)
  const cpa = input.cpa > 0 ? input.cpa : 1
  const testingPct = clamp(input.testingPct || DEFAULT_TESTING_PCT, MIN_TESTING_PCT, MAX_TESTING_PCT)
  const currentCreative = Math.max(0, Math.round(input.currentCreativePerMonth || 0))

  const testingBudget = monthlySpend * (testingPct / 100)
  const spendPerTestAd = cpa * spendPerTestMultiplier(cpa)
  const adsRaw = Math.round(testingBudget / spendPerTestAd)
  const adsToTestPerMonth =
    monthlySpend >= HIGH_SPEND_THRESHOLD ? Math.max(MIN_ADS_AT_HIGH_SPEND, adsRaw) : adsRaw

  const winnersLow = Math.round(adsToTestPerMonth * WINNER_RATE_LOW)
  const winnersHigh = Math.round(adsToTestPerMonth * WINNER_RATE_HIGH)
  const gap = Math.max(0, adsToTestPerMonth - currentCreative)

  return {
    testingBudget,
    spendPerTestAd,
    adsToTestPerMonth,
    winnersLow,
    winnersHigh,
    gap,
    onTrack: gap <= 0,
    pkg: getPackage(adsToTestPerMonth),
    estimatedMonthlyUplift: monthlySpend * ROAS_UPLIFT_PCT,
  }
}

/** Spend tiers shown in the comparison table (account-currency amounts). */
export const AD_VOLUME_TIERS = [50_000, 75_000, 100_000, 150_000, 200_000, 300_000] as const

export type AdVolumeTierRow = AdVolumeResult & {
  spend: number
  /** True for the open-ended top tier ("£300k+"). */
  isTopTier: boolean
  /** True for the row matching the account's current spend (within −20% / +40%). */
  isCurrent: boolean
}

export function buildTierTable(
  currentSpend: number,
  cpa: number,
  testingPct: number,
  currentCreativePerMonth: number,
): AdVolumeTierRow[] {
  return AD_VOLUME_TIERS.map((spend, i) => ({
    spend,
    isTopTier: i === AD_VOLUME_TIERS.length - 1,
    isCurrent: currentSpend >= spend * 0.8 && currentSpend < spend * 1.4,
    ...computeAdVolume({ monthlySpend: spend, cpa, testingPct, currentCreativePerMonth }),
  }))
}
