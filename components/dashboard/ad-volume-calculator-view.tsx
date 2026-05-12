"use client"

import { useMemo, useState } from "react"
import { Card, MetricCard } from "@/components/ui/card"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import {
  computeAdVolume,
  spendPerTestMultiplier,
  DEFAULT_TESTING_PCT,
  MIN_TESTING_PCT,
  MAX_TESTING_PCT,
} from "@/lib/utils/ad-volume"

type Props = {
  clientName: string
  currency: string
  /** Projected monthly Meta spend (forward run-rate). */
  monthlySpend: number
  dailyRunRate: number
  runRateDays: number
  /** Trailing-30-day CPA on the client's prioritised event (0 if none recorded). */
  cpa: number
  keyAction: string
  newCreativePerMonth: number
  activeAdsNow: number
}

const KEY_ACTION_LABELS: Record<string, string> = {
  purchases: "purchase",
  unique_link_clicks: "link click",
  landing_page_views: "landing page view",
  adds_to_cart: "add to cart",
  checkouts_initiated: "checkout initiated",
  registrations_completed: "registration",
  trials_started: "trial started",
  app_installs: "app install",
  mobile_app_registrations: "app registration",
}

function roundTo(n: number, step: number) {
  return Math.max(step, Math.ceil(n / step) * step)
}

export default function AdVolumeCalculatorView({
  clientName,
  currency,
  monthlySpend,
  dailyRunRate,
  runRateDays,
  cpa,
  keyAction,
  newCreativePerMonth,
  activeAdsNow,
}: Props) {
  const hasSpend = monthlySpend > 0
  const hasCpa = cpa > 0
  const dataSpend = hasSpend ? Math.round(monthlySpend) : 150_000
  const dataCpa = hasCpa ? Math.round(cpa * 100) / 100 : 25
  const dataCreative = Math.max(0, Math.round(newCreativePerMonth))
  const eventLabel = KEY_ACTION_LABELS[keyAction] || keyAction.replace(/_/g, " ")

  const [spend, setSpend] = useState(dataSpend)
  const [cpaInput, setCpaInput] = useState(dataCpa)
  const [testingPct, setTestingPct] = useState(DEFAULT_TESTING_PCT)
  const [current, setCurrent] = useState(dataCreative)

  function resetToAccount() {
    setSpend(dataSpend)
    setCpaInput(dataCpa)
    setTestingPct(DEFAULT_TESTING_PCT)
    setCurrent(dataCreative)
  }

  const result = useMemo(
    () =>
      computeAdVolume({
        monthlySpend: spend,
        cpa: cpaInput,
        testingPct,
        currentCreativePerMonth: current,
      }),
    [spend, cpaInput, testingPct, current],
  )

  const fillPct =
    result.adsToTestPerMonth > 0
      ? Math.min(100, Math.round((current / result.adsToTestPerMonth) * 100))
      : 0

  const cur = (n: number) => fmtCurrency(n, currency)
  const multiplier = spendPerTestMultiplier(cpaInput)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <Card>
        <h1 className="text-2xl font-semibold">Ad Volume Calculator</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          How many ads should {clientName} be running on Meta each month? In Meta&apos;s current
          algorithm (Andromeda) creative is the main lever — ring-fence a slice of spend for testing,
          feed the algorithm enough fresh, varied creative, and it surfaces winners that are
          otherwise invisible to the account. Inputs are pre-filled from recent data; adjust them and
          the outputs update live.
        </p>
      </Card>

      {!hasSpend && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          No recent Meta spend for this client — showing example values. Edit the inputs below to
          model a scenario.
        </div>
      )}

      {/* ── Inputs ── */}
      <Card>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-neutral-300">Your account</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
              {hasSpend ? (
                <>
                  Spend projected from the last {runRateDays} days (≈{cur(dailyRunRate)}/day) ·{" "}
                  {hasCpa
                    ? <>CPA on {eventLabel}s over the last 30 days</>
                    : <>CPA defaulted — no {eventLabel}s recorded in the last 30 days</>}{" "}
                  · {fmtNumber(dataCreative)} new creatives launched in the last 30 days ·{" "}
                  {fmtNumber(activeAdsNow)} ads delivering in the last 7 days
                </>
              ) : (
                <>Defaults shown — no recent Meta data to pre-fill from.</>
              )}
            </p>
          </div>
          <button
            onClick={resetToAccount}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-white"
          >
            Reset to account data
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <SliderField
            label="Expected monthly ad spend"
            value={spend}
            onChange={setSpend}
            min={10_000}
            max={Math.max(500_000, roundTo(spend, 50_000))}
            step={5_000}
            display={cur(spend)}
          />
          <SliderField
            label={`Average CPA (per ${eventLabel})`}
            value={cpaInput}
            onChange={setCpaInput}
            min={1}
            max={Math.max(500, roundTo(cpaInput, 5))}
            step={1}
            display={cur(cpaInput)}
          />
          <SliderField
            label="Creative testing budget"
            value={testingPct}
            onChange={setTestingPct}
            min={MIN_TESTING_PCT}
            max={MAX_TESTING_PCT}
            step={1}
            display={`${testingPct}% of spend`}
          />
          <SliderField
            label="New creative going in / month"
            value={current}
            onChange={setCurrent}
            min={0}
            max={Math.max(200, roundTo(current, 10))}
            step={1}
            display={`${fmtNumber(current)} ads / month`}
          />
        </div>
      </Card>

      {/* ── Headline result ── */}
      <Card>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-500">
              What Andromeda wants from this account
            </p>
            <p className="mt-2 text-4xl font-semibold tabular-nums text-brand-lime">
              {fmtNumber(result.adsToTestPerMonth)}{" "}
              <span className="text-2xl font-normal text-neutral-400">ads / month to test</span>
            </p>
            <p className="mt-2 text-sm text-neutral-400">
              {fmtNumber(result.winnersLow)}–{fmtNumber(result.winnersHigh)} expected winners / month
              (~10–20% of tested ads)
            </p>
          </div>
          <div className="lg:w-80">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Currently going in</span>
              <span className="tabular-nums">
                {fmtNumber(current)} / {fmtNumber(result.adsToTestPerMonth)}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full rounded-full ${result.onTrack ? "bg-brand-lime" : "bg-brand-lime/70"}`}
                style={{ width: `${Math.max(2, fillPct)}%` }}
              />
            </div>
            <p className="mt-2 text-sm">
              {result.onTrack ? (
                <span className="font-medium text-brand-lime">
                  ✓ On track — feeding the volume Andromeda wants
                </span>
              ) : (
                <span className="text-neutral-300">
                  <span className="font-semibold text-white">+{fmtNumber(result.gap)} ads / month</span>{" "}
                  short of the recommended volume
                </span>
              )}
            </p>
          </div>
        </div>
      </Card>

      {/* ── Supporting metrics ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Monthly testing budget" value={cur(result.testingBudget)} subValue={`${testingPct}% of spend`} />
        <MetricCard label="Spend per test ad" value={cur(result.spendPerTestAd)} subValue={`CPA × ${multiplier}`} />
        <MetricCard
          label="Expected winners / month"
          value={`${fmtNumber(result.winnersLow)}–${fmtNumber(result.winnersHigh)}`}
          subValue="10–20% of tested ads"
        />
        <MetricCard
          label="Gap vs. current volume"
          value={result.onTrack ? "On track" : `+${fmtNumber(result.gap)}`}
          subValue={result.onTrack ? "no gap" : "more creative needed / month"}
        />
      </div>

      {/* ── Formula ── */}
      <Card>
        <h2 className="mb-3 text-sm font-medium text-neutral-300">How the number is built</h2>
        <div className="rounded-lg bg-neutral-950 px-4 py-3 font-mono text-xs leading-relaxed text-neutral-400">
          <div>
            <span className="text-brand-lime">ads to test / month</span> = round( (monthly spend ×
            testing %) ÷ (CPA × multiplier) )
          </div>
          <div className="mt-1 text-neutral-500">
            = round( ( {cur(spend)} × {testingPct}% ) ÷ ( {cur(cpaInput)} × {multiplier} ) ) ={" "}
            {fmtNumber(Math.round(result.testingBudget / result.spendPerTestAd))}
            {spend >= 50_000 && <> → floored to a minimum of 50 at ≥{cur(50_000)} spend</>}
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-600">
          The CPA multiplier is the spend each test ad needs to reach a verdict: ×10 below{" "}
          {fmtCurrency(100, currency)} CPA, ×7 up to {fmtCurrency(200, currency)}, ×5 above. From
          every batch, roughly 10–20% earn a place in scaling campaigns.
        </p>
      </Card>
    </div>
  )
}

/* ── Small building blocks ─────────────────────────────────────────────── */

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  display,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  display: string
}) {
  function handle(raw: string) {
    if (raw === "") {
      onChange(0)
      return
    }
    const v = Number(raw)
    if (!Number.isNaN(v)) onChange(v)
  }
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </label>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => handle(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-medium text-white outline-none focus:border-brand-lime"
      />
      <input
        type="range"
        value={Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full accent-brand-lime"
      />
      <p className="mt-1.5 text-[11px] text-neutral-500">{display}</p>
    </div>
  )
}
