"use client"

import { useMemo, useState } from "react"
import { Card, MetricCard } from "@/components/ui/card"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import {
  computeAdVolume,
  buildTierTable,
  spendPerTestMultiplier,
  PACKAGES,
  NEST_BENCHMARKS,
  DEFAULT_TESTING_PCT,
  MIN_TESTING_PCT,
  MAX_TESTING_PCT,
} from "@/lib/utils/ad-volume"

type Props = {
  clientName: string
  currency: string
  monthlySpend: number
  cpa: number
  keyAction: string
  newCreativePerMonth: number
  activeAdsNow: number
}

const KEY_ACTION_LABELS: Record<string, string> = {
  purchases: "purchases",
  unique_link_clicks: "link clicks",
  landing_page_views: "landing page views",
  adds_to_cart: "adds to cart",
  checkouts_initiated: "checkouts initiated",
  registrations_completed: "registrations",
  trials_started: "trials started",
  app_installs: "app installs",
  mobile_app_registrations: "app registrations",
}

function roundTo(n: number, step: number) {
  return Math.max(step, Math.ceil(n / step) * step)
}

export default function AdVolumeCalculatorView({
  clientName,
  currency,
  monthlySpend,
  cpa,
  keyAction,
  newCreativePerMonth,
  activeAdsNow,
}: Props) {
  const hasData = monthlySpend > 0
  const dataSpend = hasData ? Math.round(monthlySpend) : 150_000
  const dataCpa = cpa > 0 ? Math.round(cpa * 100) / 100 : 25
  const dataCreative = Math.max(0, Math.round(newCreativePerMonth))

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

  const tiers = useMemo(
    () => buildTierTable(spend, cpaInput, testingPct, current),
    [spend, cpaInput, testingPct, current],
  )

  const fillPct =
    result.adsToTestPerMonth > 0
      ? Math.min(100, Math.round((current / result.adsToTestPerMonth) * 100))
      : 0

  const cur = (n: number) => fmtCurrency(n, currency)
  const keyActionLabel = KEY_ACTION_LABELS[keyAction] || keyAction.replace(/_/g, " ")
  const multiplier = spendPerTestMultiplier(cpaInput)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <Card className="bg-neutral-900">
        <p className="text-xs uppercase tracking-widest text-brand-lime">Meta Andromeda</p>
        <h1 className="mt-2 text-2xl font-semibold">Ad Volume Calculator</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          How many ads should {clientName} be running on Meta? In the Andromeda era creative is
          training data for the algorithm — ring-fence a slice of spend for testing, feed it enough
          diverse creative, and it finds winners that are otherwise invisible to your account.
          Inputs are pre-filled from the last 30 days; adjust them and the outputs update live.
        </p>
        <p className="mt-3 text-xs text-neutral-600">
          Model adapted from Nest Commerce&apos;s{" "}
          <a
            href="https://nestcommerce.co/resources/meta-ad-volume-calculator/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-neutral-400"
          >
            Meta Ad Volume Calculator
          </a>
          .
        </p>
      </Card>

      {!hasData && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          No Meta spend in the last 30 days for this client — showing example values. Edit the
          inputs below to model a scenario.
        </div>
      )}

      {/* ── Inputs ── */}
      <Card className="bg-neutral-900">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-neutral-300">Your account</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {hasData ? (
                <>
                  Auto-filled from the last 30 days: {cur(monthlySpend)} spend, {cur(cpa)} CPA on{" "}
                  {keyActionLabel}, {fmtNumber(dataCreative)} new creative,{" "}
                  {fmtNumber(activeAdsNow)} ads delivering in the last 7 days.
                </>
              ) : (
                <>Defaults shown — no recent Meta data to auto-fill from.</>
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
            label="Monthly ad spend"
            value={spend}
            onChange={setSpend}
            min={10_000}
            max={Math.max(500_000, roundTo(spend, 50_000))}
            step={5_000}
            display={cur(spend)}
          />
          <SliderField
            label={`Average CPA (${keyActionLabel})`}
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
      <Card className="bg-neutral-900">
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
              Recommended package:{" "}
              <span className="font-medium text-white">{PACKAGES[result.pkg].label}</span> ·{" "}
              {fmtNumber(result.winnersLow)}–{fmtNumber(result.winnersHigh)} expected winners / month
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
      <Card className="bg-neutral-900">
        <h2 className="mb-3 text-sm font-medium text-neutral-300">How the number is built</h2>
        <div className="rounded-lg bg-neutral-950 px-4 py-3 font-mono text-xs leading-relaxed text-neutral-400">
          <div>
            <span className="text-brand-lime">ads to test / month</span> = round( (monthly spend ×
            testing %) ÷ (CPA × multiplier) )
          </div>
          <div className="mt-1 text-neutral-500">
            = round( ( {cur(spend)} × {testingPct}% ) ÷ ( {cur(cpaInput)} × {multiplier} ) ) ={" "}
            {fmtNumber(Math.round(result.testingBudget / result.spendPerTestAd))}
            {spend >= 50_000 && (
              <> → floored to a minimum of 50 at ≥{cur(50_000)} spend</>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-600">
          The CPA multiplier is the spend each test ad needs to reach a verdict: ×10 below{" "}
          {fmtCurrency(100, currency)} CPA, ×7 up to {fmtCurrency(200, currency)}, ×5 above. From
          every batch, roughly 10–20% earn a place in scaling campaigns.
        </p>
      </Card>

      {/* ── Tier table ── */}
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-medium text-neutral-300">Volume by spend level</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Recalculated at this account&apos;s CPA ({cur(cpaInput)}) and testing budget ({testingPct}%).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-5 py-3 font-medium">Monthly spend</th>
                <th className="px-5 py-3 font-medium">Testing budget</th>
                <th className="px-5 py-3 font-medium">Ads to test</th>
                <th className="px-5 py-3 font-medium">Winners</th>
                <th className="px-5 py-3 font-medium">Package</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr
                  key={t.spend}
                  className={`border-t border-neutral-800 ${t.isCurrent ? "bg-brand-lime/[0.07]" : ""}`}
                >
                  <td className="px-5 py-3 font-medium text-white">
                    {cur(t.spend)}
                    {t.isTopTier && "+"}
                    {t.isCurrent && (
                      <span className="ml-2 rounded bg-brand-lime/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-brand-lime">
                        This client
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-neutral-300">{cur(t.testingBudget)}</td>
                  <td className="px-5 py-3 text-neutral-300">{fmtNumber(t.adsToTestPerMonth)}</td>
                  <td className="px-5 py-3 text-neutral-300">
                    {fmtNumber(t.winnersLow)}–{fmtNumber(t.winnersHigh)}
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                      {PACKAGES[t.pkg].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Impact ── */}
      <Card className="bg-neutral-900">
        <h2 className="text-sm font-medium text-neutral-300">What closing the gap looks like</h2>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          {result.onTrack ? (
            <>
              At {fmtNumber(result.adsToTestPerMonth)} ads/month this account is running the volume
              Andromeda wants. The next levers are variance and velocity — keeping the creative
              varied enough and the optimisation cycles fast enough to compound gains.
            </>
          ) : (
            <>
              This account is <span className="font-medium text-white">{fmtNumber(result.gap)} ads/month short</span> of
              what Andromeda rewards at {cur(spend)} spend. When Nest clients closed this gap they
              saw revenue and ROAS jump within the first optimisation cycle — on this spend that&apos;s
              roughly <span className="font-medium text-white">{cur(result.estimatedMonthlyUplift)}</span> of
              additional monthly return, driven by the algorithm finally having enough signal to find
              winners it couldn&apos;t before.
            </>
          )}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <BenchmarkStat value={`+${NEST_BENCHMARKS.roasUpliftPct}%`} label="ROAS when ads per ad set are maxed" />
          <BenchmarkStat value={`+${NEST_BENCHMARKS.revenueUpliftPct}%`} label="Revenue at higher volume & variance" />
          <BenchmarkStat value={`+${NEST_BENCHMARKS.yoyLiftPct}%`} label="Performance lift YoY vs the market" />
        </div>
        <p className="mt-3 text-xs text-neutral-600">
          Benchmarks are Nest Commerce&apos;s reported client results, not a forecast for this account.
        </p>
      </Card>

      {/* ── Principles ── */}
      <Card className="bg-neutral-900">
        <h2 className="text-sm font-medium text-neutral-300">The principles</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Built on how Meta&apos;s Andromeda system actually works — ads are evaluated at the
          individual-user level, and the algorithm learns from diversity.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Principle
            title="Allocate 20–30% to creative testing"
            body="This is the budget that finds your next winners. Without dedicated testing spend you're just scaling ads that are already fatiguing."
          />
          <Principle
            title="Launch ads every 1–2 weeks"
            body="Consistent velocity keeps the algorithm fed with fresh signals. Irregular launches cause performance troughs."
          />
          <Principle
            title="Expect 10–20% of ads to scale"
            body="From every batch of test ads a small set earn their place in scaling campaigns. Volume is how you find them."
          />
        </div>
      </Card>

      {/* ── Why volume wins ── */}
      <Card className="bg-neutral-900">
        <h2 className="text-sm font-medium text-neutral-300">Why creative volume wins</h2>
        <p className="mt-1 text-xs text-neutral-500">Creative is training data for the algorithm.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <WorldCard
            eyebrow="Old world"
            title="5 ads per ad set"
            body="Advertisers controlled delivery through audiences, bids and placements. A handful of hero ads ran indefinitely."
          />
          <WorldCard
            eyebrow="New world"
            title="50+ ads per ad set as the baseline"
            body="The platform decides delivery. Your job is to feed it the most diverse, high-volume creative possible. Volume = signal."
          />
          <WorldCard
            eyebrow="The bottleneck"
            title="Organisational speed"
            body="The constraint isn't the platform — it's how fast you can produce and test creative."
            highlight
          />
        </div>
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

function BenchmarkStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-neutral-950 px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums text-brand-lime">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{label}</p>
    </div>
  )
}

function Principle({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg bg-neutral-950 px-4 py-4">
      <h3 className="text-sm font-medium text-white">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{body}</p>
    </div>
  )
}

function WorldCard({
  eyebrow,
  title,
  body,
  highlight,
}: {
  eyebrow: string
  title: string
  body: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-lg px-4 py-4 ${
        highlight ? "border border-brand-lime/30 bg-brand-lime/[0.06]" : "bg-neutral-950"
      }`}
    >
      <p className={`text-[10px] font-medium uppercase tracking-wider ${highlight ? "text-brand-lime" : "text-neutral-500"}`}>
        {eyebrow}
      </p>
      <h3 className="mt-1 text-sm font-medium text-white">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{body}</p>
    </div>
  )
}
