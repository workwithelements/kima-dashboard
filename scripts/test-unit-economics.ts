/**
 * Verification for the unit-economics scorer against the validated
 * acceptance numbers, plus aggregation edge cases.
 *
 * Run: npm run test:unit-economics   (or: npx tsx scripts/test-unit-economics.ts)
 */

import {
  scoreAd,
  aggregateAdEcon,
  DEFAULT_LTV_ASSUMPTIONS,
  type EconDailyRow,
} from "../lib/utils/unit-economics"

let failures = 0

function check(name: string, pass: boolean, detail?: string) {
  if (pass) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function approx(actual: number | null, expected: number, tol = 0.51): boolean {
  return actual !== null && Math.abs(actual - expected) <= tol
}

const cfg = DEFAULT_LTV_ASSUMPTIONS

// ── Acceptance case: cpa=175, annualMix=0.30, conversions=100 ──
console.log("Acceptance case (cpa 175, mix 0.30, 100 conversions):")
const s = scoreAd({ cpa: 175, annualMix: 0.3, conversions: 100 }, cfg)
check("blendedLTV ≈ 231", approx(s.blendedLTV, 231.25), `got ${s.blendedLTV}`)
check("maxCAC ≈ 185", approx(s.maxCAC, 185), `got ${s.maxCAC}`)
check("midCAC ≈ 166", approx(s.midCAC, 166), `got ${s.midCAC}`)
check("immCAC ≈ 67", approx(s.immCAC, 66.59, 0.6), `got ${s.immCAC}`)
check("ltvCac ≈ 1.3", approx(s.ltvCac, 1.32, 0.05), `got ${s.ltvCac}`)
check("payback ≈ month 11", s.paybackMonth !== null && s.paybackMonth >= 11 && s.paybackMonth < 12, `got ${s.paybackMonth}`)
check("status = acceptable", s.status === "acceptable", `got ${s.status}`)
check("estTotalValue ≈ $23,100", approx(s.estTotalValue, 23125, 60), `got ${s.estTotalValue}`)
check("estTotalNet ≈ $5,600", approx(s.estTotalNet, 5625, 60), `got ${s.estTotalNet}`)
check("curve has horizon+1 points", s.curve.length === cfg.horizonMonths + 1, `got ${s.curve.length}`)
check("curve[0] = day-0 cash (immCAC)", approx(s.curve[0], s.immCAC, 0.01), `got ${s.curve[0]}`)

// ── Verdict boundaries ──
console.log("Verdict boundaries:")
const cheap = scoreAd({ cpa: 50, annualMix: 0.3 }, cfg) // below immCAC 66.6
check("cpa ≤ immCAC → self_funding", cheap.status === "self_funding", `got ${cheap.status}`)
check("self_funding pays back day 0", cheap.paybackMonth === 0, `got ${cheap.paybackMonth}`)
const mid = scoreAd({ cpa: 150, annualMix: 0.3 }, cfg) // between imm 66.6 and mid 166
check("immCAC < cpa ≤ midCAC → healthy", mid.status === "healthy", `got ${mid.status}`)
const huge = scoreAd({ cpa: 500, annualMix: 0.3 }, cfg)
check("cpa > maxCAC → over_ceiling", huge.status === "over_ceiling", `got ${huge.status}`)
check("unreachable payback → null (>24 mo)", huge.paybackMonth === null, `got ${huge.paybackMonth}`)

// ── Mix bounds ──
console.log("Mix bounds:")
const allMonthly = scoreAd({ cpa: 100, annualMix: 0 }, cfg)
check("mix 0 → blendedLTV = monthlyMedianLTV", approx(allMonthly.blendedLTV, cfg.monthlyMedianLTV, 0.01), `got ${allMonthly.blendedLTV}`)
const allAnnual = scoreAd({ cpa: 100, annualMix: 1 }, cfg)
const annualFull = cfg.annualY1Upfront + (cfg.year2RenewalRate + cfg.year3RenewalRate) * cfg.annualRenewalPrice
check("mix 1 → blendedLTV = annualFullLTV (≈397.48)", approx(allAnnual.blendedLTV, annualFull, 0.01), `got ${allAnnual.blendedLTV}`)
check("mix 1 → day-0 cash = annualY1Upfront", approx(allAnnual.immCAC, cfg.annualY1Upfront, 0.01), `got ${allAnnual.immCAC}`)

// ── Aggregation ──
console.log("Aggregation:")
const day = (over: Partial<EconDailyRow>): EconDailyRow => ({
  date: "2026-07-01",
  ad_id: "a",
  ad_name: "Ad A",
  campaign_name: "Camp",
  spend: 0,
  purchases: 0,
  applications_submitted: null,
  ...over,
})

// Two ads with apps data, one without → account-average fallback
const withData = aggregateAdEcon(
  [
    day({ ad_id: "a", spend: 500, purchases: 10, applications_submitted: 4 }),
    day({ ad_id: "a", date: "2026-07-02", spend: 500, purchases: 10, applications_submitted: 2 }),
    day({ ad_id: "b", spend: 300, purchases: 10, applications_submitted: 0 }),
    day({ ad_id: "c", spend: 200, purchases: 5 }),
  ],
  cfg
)
const adA = withData.rows.find((r) => r.adId === "a")!
const adB = withData.rows.find((r) => r.adId === "b")!
const adC = withData.rows.find((r) => r.adId === "c")!
check("ad days summed (spend 1000, purchases 20)", adA.spend === 1000 && adA.purchases === 20)
check("own mix from apps/purchases (6/20 = 0.3)", approx(adA.annualMix, 0.3, 0.001), `got ${adA.annualMix}`)
check("zero apps is real data, not fallback", adB.annualMix === 0 && !adB.usedFallbackMix)
check("account average = Σapps/Σpurchases (6/30 = 0.2)", approx(withData.accountAnnualMix, 0.2, 0.001), `got ${withData.accountAnnualMix}`)
check("no-apps ad falls back to account average", adC.mixSource === "account_average" && approx(adC.annualMix, 0.2, 0.001))
check("fallback flagged", adC.usedFallbackMix && withData.summary.fallbackCount === 1)
check("applicationsDataAvailable = true", withData.applicationsDataAvailable)

// No apps data anywhere → manual fallback from settings
const noData = aggregateAdEcon(
  [day({ ad_id: "a", spend: 500, purchases: 10 })],
  { ...cfg, fallbackAnnualMix: 0.25 }
)
check("no apps anywhere → manual fallback mix", noData.rows[0].mixSource === "manual_fallback" && approx(noData.rows[0].annualMix, 0.25, 0.001))
check("applicationsDataAvailable = false", !noData.applicationsDataAvailable)

// purchases = 0 → no-data row, never scored
const zero = aggregateAdEcon([day({ ad_id: "a", spend: 100, purchases: 0 })], cfg)
check("purchases 0 → noData, no score", zero.rows[0].noData && zero.rows[0].score === null)
check("noData excluded from status counts", Object.values(zero.summary.statusCounts).every((c) => c === 0))

// apps > purchases (attribution lag) → clamped to 100% and flagged
const clamped = aggregateAdEcon([day({ ad_id: "a", spend: 100, purchases: 2, applications_submitted: 5 })], cfg)
check("apps > purchases clamped to mix 1", clamped.rows[0].annualMix === 1 && clamped.rows[0].mixClamped)

// Weighted summary mix: 20 conv @ 0.3 + 10 conv @ 0 = 6/30 = 0.2
check(
  "summary mix is conversion-weighted",
  approx(withData.summary.blendedAnnualMix, (0.3 * 20 + 0 * 10 + 0.2 * 5) / 35, 0.001),
  `got ${withData.summary.blendedAnnualMix}`
)

console.log("")
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`)
  process.exit(1)
}
console.log("All checks passed ✓")
