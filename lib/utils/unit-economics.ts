/**
 * Unit-economics scoring for the per-ad LTV / payback view (Alexia only).
 *
 * The model blends an annual plan (paid upfront, renewal tail in years 2-3)
 * with a monthly plan (discounted first month, capped at a median LTV) using
 * each ad's annual mix — the share of its conversions that bought annual.
 * From CPA + mix it derives blended LTV, three affordable-CAC ceilings, a
 * cash-payback month, and a four-way verdict.
 *
 * The scoreAd math is a validated reference implementation ported verbatim —
 * do not "improve" it. All outputs are modelled estimates (median LTVs,
 * sampled renewal rates), not booked revenue.
 */

export type LtvAssumptions = {
  /** Annual plan cash collected on day 0 (paid upfront). */
  annualY1Upfront: number
  /** Year 2+ renewal price. */
  annualRenewalPrice: number
  /** Share of annual starters who bill a 2nd year (0-1). */
  year2RenewalRate: number
  /** Share who bill a 3rd year (0-1). */
  year3RenewalRate: number
  /** Monthly plan price. */
  monthlyPrice: number
  /** Acquisition offer on the first month (0-1). */
  firstMonthDiscount: number
  /** Full median lifetime value of a monthly customer. */
  monthlyMedianLTV: number
  /** Margin to keep after CAC (0-1). */
  targetMargin: number
  /** Reference LTV:CAC target. */
  ltvCacTarget: number
  /** Payback timeline horizon in months. */
  horizonMonths: number
  /** Account-level annual mix used when an ad has no applications data (0-1). */
  fallbackAnnualMix: number
}

export const DEFAULT_LTV_ASSUMPTIONS: LtvAssumptions = {
  annualY1Upfront: 180.0,
  annualRenewalPrice: 249.99,
  year2RenewalRate: 0.55,
  year3RenewalRate: 0.32,
  monthlyPrice: 29.99,
  firstMonthDiscount: 0.4,
  monthlyMedianLTV: 160.0,
  targetMargin: 0.2,
  ltvCacTarget: 3.0,
  horizonMonths: 24,
  fallbackAnnualMix: 0,
}

/** DB row (client_ltv_assumptions, snake_case) → LtvAssumptions. */
export function assumptionsFromRow(row: Record<string, unknown>): LtvAssumptions {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v)
    return isFinite(n) ? n : fallback
  }
  const d = DEFAULT_LTV_ASSUMPTIONS
  return {
    annualY1Upfront: num(row.annual_y1_upfront, d.annualY1Upfront),
    annualRenewalPrice: num(row.annual_renewal_price, d.annualRenewalPrice),
    year2RenewalRate: num(row.year2_renewal_rate, d.year2RenewalRate),
    year3RenewalRate: num(row.year3_renewal_rate, d.year3RenewalRate),
    monthlyPrice: num(row.monthly_price, d.monthlyPrice),
    firstMonthDiscount: num(row.first_month_discount, d.firstMonthDiscount),
    monthlyMedianLTV: num(row.monthly_median_ltv, d.monthlyMedianLTV),
    targetMargin: num(row.target_margin, d.targetMargin),
    ltvCacTarget: num(row.ltv_cac_target, d.ltvCacTarget),
    horizonMonths: Math.round(num(row.horizon_months, d.horizonMonths)),
    fallbackAnnualMix: num(row.fallback_annual_mix, d.fallbackAnnualMix),
  }
}

/** LtvAssumptions → DB column payload (snake_case). */
export function assumptionsToRow(cfg: LtvAssumptions): Record<string, number> {
  return {
    annual_y1_upfront: cfg.annualY1Upfront,
    annual_renewal_price: cfg.annualRenewalPrice,
    year2_renewal_rate: cfg.year2RenewalRate,
    year3_renewal_rate: cfg.year3RenewalRate,
    monthly_price: cfg.monthlyPrice,
    first_month_discount: cfg.firstMonthDiscount,
    monthly_median_ltv: cfg.monthlyMedianLTV,
    target_margin: cfg.targetMargin,
    ltv_cac_target: cfg.ltvCacTarget,
    horizon_months: cfg.horizonMonths,
    fallback_annual_mix: cfg.fallbackAnnualMix,
  }
}

export type AdStatus = "self_funding" | "healthy" | "acceptable" | "over_ceiling"

export type ScoreResult = {
  blendedLTV: number
  maxCAC: number
  midCAC: number
  immCAC: number
  ltvCac: number
  netPerCustomer: number
  /** First month cumulative cash covers CPA (interpolated, 1dp); null if never within horizon. */
  paybackMonth: number | null
  status: AdStatus
  estTotalValue: number
  estTotalSpend: number
  estTotalNet: number
  /** Cumulative blended cash per customer for months 0..horizonMonths. */
  curve: number[]
}

/**
 * Score one ad from its CPA and annual mix. Reference implementation —
 * ported verbatim from the validated model.
 */
export function scoreAd(
  { cpa, annualMix, conversions = 0 }: { cpa: number; annualMix: number; conversions?: number },
  cfg: LtvAssumptions
): ScoreResult {
  const monthlyMix = 1 - annualMix
  const monthlyFirst = cfg.monthlyPrice * (1 - cfg.firstMonthDiscount)
  const annualFullLTV =
    cfg.annualY1Upfront +
    cfg.year2RenewalRate * cfg.annualRenewalPrice +
    cfg.year3RenewalRate * cfg.annualRenewalPrice

  // per-customer blended value
  const blendedLTV = annualMix * annualFullLTV + monthlyMix * cfg.monthlyMedianLTV

  // three CAC ceilings
  const maxCAC = blendedLTV * (1 - cfg.targetMargin) // full LTV, keep margin
  const midCAC = annualMix * cfg.annualY1Upfront + monthlyMix * cfg.monthlyMedianLTV // annual yr1 + monthly full
  const immCAC = annualMix * cfg.annualY1Upfront + monthlyMix * monthlyFirst // day-0 cash only

  // cumulative blended cash per customer, month 0..horizon
  const annualCum = (m: number) =>
    m < 12
      ? cfg.annualY1Upfront
      : m < 24
        ? cfg.annualY1Upfront + cfg.year2RenewalRate * cfg.annualRenewalPrice
        : cfg.annualY1Upfront + (cfg.year2RenewalRate + cfg.year3RenewalRate) * cfg.annualRenewalPrice
  const monthlyCum = (m: number) =>
    m === 0 ? monthlyFirst : Math.min(cfg.monthlyMedianLTV, monthlyFirst + cfg.monthlyPrice * m)
  const blendedCum = (m: number) => annualMix * annualCum(m) + monthlyMix * monthlyCum(m)

  // payback month = first month cumulative cash covers CPA (interpolated); null if never within horizon
  let paybackMonth: number | null = null
  if (blendedCum(0) >= cpa) paybackMonth = 0
  else
    for (let m = 1; m <= cfg.horizonMonths; m++) {
      if (blendedCum(m) >= cpa) {
        const prev = blendedCum(m - 1)
        paybackMonth = Math.round((m - 1 + (cpa - prev) / (blendedCum(m) - prev)) * 10) / 10
        break
      }
    }

  const ltvCac = blendedLTV / cpa
  const netPerCustomer = blendedLTV - cpa

  // verdict by which ceiling the CPA clears
  let status: AdStatus
  if (cpa <= immCAC) status = "self_funding" // recovered day 0
  else if (cpa <= midCAC) status = "healthy" // recovers within ~a quarter, no renewal risk
  else if (cpa <= maxCAC) status = "acceptable" // within margin, ~12mo payback, leans on renewals
  else status = "over_ceiling" // erodes target margin / unprofitable

  return {
    blendedLTV,
    maxCAC,
    midCAC,
    immCAC,
    ltvCac,
    netPerCustomer,
    paybackMonth,
    status,
    // rolled up
    estTotalValue: blendedLTV * conversions,
    estTotalSpend: cpa * conversions,
    estTotalNet: netPerCustomer * conversions,
    curve: Array.from({ length: cfg.horizonMonths + 1 }, (_, m) => blendedCum(m)),
  }
}

/** Daily row shape needed from meta_daily_performance. */
export type EconDailyRow = {
  date: string
  ad_id: string
  ad_name: string
  campaign_name: string
  spend: number
  purchases: number
  /** NULL/undefined = not synced for that day; a number (incl. 0) = real data. */
  applications_submitted?: number | null
}

/** Where an ad's annual mix came from. */
export type MixSource = "ad" | "account_average" | "manual_fallback"

export type ScoredAdRow = {
  adId: string
  adName: string
  campaignName: string
  spend: number
  purchases: number
  conversions: number
  /** Summed applications, or null when no day in range had synced data. */
  applicationsSubmitted: number | null
  cpa: number | null
  annualMix: number | null
  mixSource: MixSource | null
  usedFallbackMix: boolean
  /** True when applications > purchases forced a clamp to 100%. */
  mixClamped: boolean
  /** purchases = 0 (or cpa unusable) — excluded from scoring and totals. */
  noData: boolean
  score: ScoreResult | null
}

export type EconSummary = {
  totalSpend: number
  totalConversions: number
  /** Conversion-weighted annual mix across scored ads; null if none scored. */
  blendedAnnualMix: number | null
  aggEstValue: number
  aggEstNet: number
  statusCounts: Record<AdStatus, number>
  noDataCount: number
  fallbackCount: number
}

export type AdEconResult = {
  rows: ScoredAdRow[]
  summary: EconSummary
  /** Account-average mix computed from ads that have real applications data. */
  accountAnnualMix: number | null
  /** False when no ad in range has any synced applications data. */
  applicationsDataAvailable: boolean
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/**
 * Group daily rows into per-ad inputs, resolve each ad's annual mix
 * (own data → account average → manual fallback), and score every ad.
 */
export function aggregateAdEcon(dailyRows: EconDailyRow[], cfg: LtvAssumptions): AdEconResult {
  type Acc = {
    adId: string
    adName: string
    campaignName: string
    latestDate: string
    spend: number
    purchases: number
    apps: number
    hasAppsData: boolean
  }
  const byAd = new Map<string, Acc>()

  for (const r of dailyRows) {
    if (!r.ad_id) continue
    let acc = byAd.get(r.ad_id)
    if (!acc) {
      acc = {
        adId: r.ad_id,
        adName: r.ad_name || r.ad_id,
        campaignName: r.campaign_name || "",
        latestDate: r.date,
        spend: 0,
        purchases: 0,
        apps: 0,
        hasAppsData: false,
      }
      byAd.set(r.ad_id, acc)
    }
    acc.spend += Number(r.spend) || 0
    acc.purchases += Number(r.purchases) || 0
    if (r.applications_submitted !== null && r.applications_submitted !== undefined) {
      acc.apps += Number(r.applications_submitted) || 0
      acc.hasAppsData = true
    }
    // Names can change mid-range — keep the latest
    if (r.date >= acc.latestDate) {
      acc.latestDate = r.date
      if (r.ad_name) acc.adName = r.ad_name
      if (r.campaign_name) acc.campaignName = r.campaign_name
    }
  }

  const ads = Array.from(byAd.values())

  // Account-average mix over ads with real applications data
  let appsSum = 0
  let purchasesWithAppsSum = 0
  for (const a of ads) {
    if (a.hasAppsData && a.purchases > 0) {
      appsSum += a.apps
      purchasesWithAppsSum += a.purchases
    }
  }
  const accountAnnualMix = purchasesWithAppsSum > 0 ? clamp01(appsSum / purchasesWithAppsSum) : null
  const applicationsDataAvailable = ads.some((a) => a.hasAppsData)

  const rows: ScoredAdRow[] = ads.map((a) => {
    const conversions = a.purchases
    // spend can be 0 with attributed purchases (lag) — cpa 0 breaks ltvCac, treat as no data
    const noData = conversions <= 0 || a.spend <= 0
    if (noData) {
      return {
        adId: a.adId,
        adName: a.adName,
        campaignName: a.campaignName,
        spend: a.spend,
        purchases: a.purchases,
        conversions,
        applicationsSubmitted: a.hasAppsData ? a.apps : null,
        cpa: null,
        annualMix: null,
        mixSource: null,
        usedFallbackMix: false,
        mixClamped: false,
        noData: true,
        score: null,
      }
    }

    const cpa = a.spend / conversions
    let annualMix: number
    let mixSource: MixSource
    let mixClamped = false
    if (a.hasAppsData) {
      const raw = a.apps / conversions
      annualMix = clamp01(raw)
      mixClamped = raw > 1
      mixSource = "ad"
    } else if (accountAnnualMix !== null) {
      annualMix = accountAnnualMix
      mixSource = "account_average"
    } else {
      annualMix = clamp01(cfg.fallbackAnnualMix)
      mixSource = "manual_fallback"
    }

    return {
      adId: a.adId,
      adName: a.adName,
      campaignName: a.campaignName,
      spend: a.spend,
      purchases: a.purchases,
      conversions,
      applicationsSubmitted: a.hasAppsData ? a.apps : null,
      cpa,
      annualMix,
      mixSource,
      usedFallbackMix: mixSource !== "ad",
      mixClamped,
      noData: false,
      score: scoreAd({ cpa, annualMix, conversions }, cfg),
    }
  })

  const scored = rows.filter((r) => !r.noData && r.score)
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0)
  const totalConversions = rows.reduce((s, r) => s + r.conversions, 0)
  const scoredConversions = scored.reduce((s, r) => s + r.conversions, 0)
  const statusCounts: Record<AdStatus, number> = {
    self_funding: 0,
    healthy: 0,
    acceptable: 0,
    over_ceiling: 0,
  }
  for (const r of scored) statusCounts[r.score!.status]++

  const summary: EconSummary = {
    totalSpend,
    totalConversions,
    blendedAnnualMix:
      scoredConversions > 0
        ? scored.reduce((s, r) => s + (r.annualMix ?? 0) * r.conversions, 0) / scoredConversions
        : null,
    aggEstValue: scored.reduce((s, r) => s + r.score!.estTotalValue, 0),
    aggEstNet: scored.reduce((s, r) => s + r.score!.estTotalNet, 0),
    statusCounts,
    noDataCount: rows.filter((r) => r.noData).length,
    fallbackCount: scored.filter((r) => r.usedFallbackMix).length,
  }

  return { rows, summary, accountAnnualMix, applicationsDataAvailable }
}

export const STATUS_META: Record<AdStatus, { label: string; explanation: string }> = {
  self_funding: {
    label: "Self-funding",
    explanation: "CPA ≤ day-0 cash — spend recovered immediately",
  },
  healthy: {
    label: "Healthy",
    explanation: "Recovers within ~a quarter, no renewal risk",
  },
  acceptable: {
    label: "Acceptable",
    explanation: "Within margin but ~12mo payback, relies on renewals",
  },
  over_ceiling: {
    label: "Over ceiling",
    explanation: "Above max CAC — erodes target margin",
  },
}
