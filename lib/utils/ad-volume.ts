/**
 * Ad-volume calculator logic — how many ads/month an account should be testing
 * on Meta given its spend, CPA, and creative-testing budget.
 *
 * The model: creative is training data for Meta's algorithm. Ring-fence a % of
 * monthly spend for creative testing; each tested ad needs ~CPA × multiplier of
 * spend to reach a verdict; ~10–20% of tested ads graduate into scaling
 * campaigns.
 *
 * NOTE: the CPA-multiplier thresholds (100 / 200) and the high-spend floor
 * (50,000) are GBP-denominated heuristics — kept as-is rather than converted
 * per account currency.
 */

export const DEFAULT_TESTING_PCT = 25
export const MIN_TESTING_PCT = 10
export const MAX_TESTING_PCT = 40

/** Accounts at/above this monthly spend get a floor on recommended test volume. */
export const HIGH_SPEND_THRESHOLD = 50_000
export const MIN_ADS_AT_HIGH_SPEND = 50

/** Fraction of tested ads expected to graduate into scaling campaigns. */
export const WINNER_RATE_LOW = 0.1
export const WINNER_RATE_HIGH = 0.2

/** Spend (in account currency) to give one test ad a fair read ≈ CPA × this. */
export function spendPerTestMultiplier(cpa: number): number {
  if (cpa < 100) return 10
  if (cpa <= 200) return 7
  return 5
}

export type AdVolumeInputs = {
  /** Expected monthly Meta ad spend, in the account's currency. */
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

  return { testingBudget, spendPerTestAd, adsToTestPerMonth, winnersLow, winnersHigh, gap, onTrack: gap <= 0 }
}
