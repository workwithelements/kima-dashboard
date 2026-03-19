"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

/* ─── colour tokens (KIMA brand-adapted from the original deploy) ─── */
const C = {
  control: "#8B85AD",   // muted lavender for control
  email: "#CDFF00",     // brand-lime
  meta: "#FF69B4",      // brand-pink
  both: "#C8B8F0",      // brand-lavender
  grid: "#262626",      // neutral-800
  axis: "#737373",      // neutral-500
  tooltipBg: "#171717", // neutral-900
  tooltipBorder: "#262626",
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: C.tooltipBg,
    border: `1px solid ${C.tooltipBorder}`,
    borderRadius: "8px",
    fontSize: "13px",
  },
  labelStyle: { color: "#a3a3a3" },
}

/* ─── data ─── */

const h1Rates = [
  { group: "G1 Control", rate: 1.85, fill: C.control },
  { group: "G2 Email+Push", rate: 2.02, fill: C.email },
  { group: "G3 Meta Only", rate: 1.86, fill: C.meta },
  { group: "G4 Email+Meta", rate: 1.94, fill: C.both },
]

const h1Lift = [
  { group: "Email+Push", lift: 8.9, fill: C.email, sig: "p=0.02 *" },
  { group: "Meta Only", lift: 0.4, fill: C.meta, sig: "p=0.91 n.s." },
  { group: "Email+Meta", lift: 4.9, fill: C.both, sig: "p=0.20 n.s." },
]

const seasonalData = [
  { period: "Baseline (19-25 Jan)", control: 0.28, email: 0.30, meta: 0.30, both: 0.27 },
  { period: "Valentine's lead-up", control: 0.37, email: 0.33, meta: 0.32, both: 0.36 },
  { period: "Valentine's weekend", control: 0.12, email: 0.15, meta: 0.13, both: 0.12 },
  { period: "Post-Valentine's", control: 0.46, email: 0.52, meta: 0.43, both: 0.46 },
  { period: "Early Mar (1-7)", control: 0.32, email: 0.31, meta: 0.30, both: 0.32 },
  { period: "Mother's Day lead-up", control: 0.38, email: 0.48, meta: 0.43, both: 0.49 },
]

const orderData = [
  { segment: "1 order", emailLift: 10.0, metaLift: -20.8, bothLift: 21.8 },
  { segment: "2-4 orders", emailLift: 43.7, metaLift: 9.9, bothLift: 15.8 },
  { segment: "5+ orders", emailLift: 5.4, metaLift: 1.1, bothLift: 3.2 },
]

const recencyData = [
  { segment: "≤6 months (16.53% base)", emailLift: 5.7, metaLift: -5.5, bothLift: 3.3 },
  { segment: "≥12 months (0.35% base)", emailLift: 17.3, metaLift: 9.2, bothLift: 11.3 },
]

const cohortData = [
  { segment: "2025 · 1 order", emailLift: -22.8, metaLift: -37.5 },
  { segment: "2025 · 2+ orders", emailLift: 23.6, metaLift: 8.9 },
  { segment: "2024 · 1 order", emailLift: 72.3, metaLift: -12.4 },
  { segment: "2024 · 2+ orders", emailLift: 8.1, metaLift: -0.6 },
  { segment: "2023", emailLift: 13.0, metaLift: -12.9 },
]

const costData = [
  { channel: "Email+Push", cost: 0 },
  { channel: "Meta", cost: 666 },
]

const incrData = [
  { channel: "Email+Push", purchases: 128 },
  { channel: "Meta", purchases: 8 },
]

/* ─── sub-components ─── */

function VerdictCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string
  value: string
  detail: string
  accent: string
}) {
  return (
    <div
      className="flex-1 min-w-[180px] rounded-xl border p-5"
      style={{ borderColor: accent, backgroundColor: accent + "12" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
        {label}
      </p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-neutral-400">{detail}</p>
    </div>
  )
}

function InsightBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-r-lg border-l-[3px] border-brand-lime bg-neutral-800/50 px-4 py-3 text-sm leading-relaxed text-neutral-300">
      {children}
    </div>
  )
}

function SegmentTabs({
  active,
  onChange,
}: {
  active: string
  onChange: (t: string) => void
}) {
  const tabs = [
    { key: "orders", label: "By Order Count (H2a)" },
    { key: "recency", label: "By Recency (H2b)" },
    { key: "cohort", label: "By Cohort (H2c)" },
  ]
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            active === t.key
              ? "border-brand-lime bg-brand-lime/10 text-brand-lime"
              : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ─── formatters ─── */

const pctTick = (v: number) => `${v > 0 ? "+" : ""}${v}%`
const pctTickPlain = (v: number) => `${v}%`
const gbpTick = (v: number) => `£${v}`

/* ─── main view ─── */

export default function RetentionLiftTestView() {
  const [segTab, setSegTab] = useState("orders")

  return (
    <div className="space-y-6">
      {/* header */}
      <div>
        <h2 className="text-lg font-semibold">Retention Lift Test Results</h2>
        <p className="text-sm text-neutral-400">
          19 Jan – 13 Mar 2026 · ~75,500 per group · £7,481 Meta spend · 4-cell factorial design
        </p>
      </div>

      {/* verdict cards */}
      <div className="flex flex-wrap gap-4">
        <VerdictCard
          label="Email + Push"
          value="+8.9% lift"
          detail="p=0.02 – Statistically significant"
          accent={C.email}
        />
        <VerdictCard
          label="Meta Only"
          value="+0.4% lift"
          detail="p=0.91 – No effect"
          accent={C.meta}
        />
        <VerdictCard
          label="Email + Meta"
          value="+4.9% lift"
          detail="p=0.20 – Not significant"
          accent={C.both}
        />
        <VerdictCard
          label="Interaction"
          value="-4.3%"
          detail="Overlap / cannibalisation"
          accent={C.control}
        />
      </div>

      {/* H1: topline charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <p className="text-sm font-semibold">H1: Purchase Rate by Group</p>
          <p className="mb-4 text-xs text-neutral-500">
            Primary metric – % with ≥1 purchase during test window
          </p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={h1Rates} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="group"
                tick={{ fill: C.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: C.grid }}
              />
              <YAxis
                tick={{ fill: C.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={pctTickPlain}
                domain={[0, 2.5]}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(v: number) => [`${v}%`, "Purchase Rate"]}
              />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {h1Rates.map((d, i) => (
                  <rect key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <p className="text-sm font-semibold">H1: Relative Lift vs Control</p>
          <p className="mb-4 text-xs text-neutral-500">
            Percentage lift with significance markers
          </p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={h1Lift} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="group"
                tick={{ fill: C.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: C.grid }}
              />
              <YAxis
                tick={{ fill: C.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={pctTick}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(v: number, _: string, entry: { payload?: { sig?: string } }) => [
                  `+${v}% (${entry.payload?.sig ?? ""})`,
                  "Lift vs Control",
                ]}
              />
              <Bar dataKey="lift" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {h1Lift.map((d, i) => (
                  <rect key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <InsightBox>
            Email is the only channel that moved the needle. Adding Meta to Email actually
            diluted performance, suggesting overlap rather than synergy.
          </InsightBox>
        </Card>
      </div>

      {/* seasonal breakdown */}
      <Card>
        <p className="text-sm font-semibold">Seasonal Breakdown – Weekly Purchase Rates</p>
        <p className="mb-4 text-xs text-neutral-500">
          Email lift concentrated entirely around Mother's Day, not Valentine's
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={seasonalData}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="period"
              tick={{ fill: C.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
            />
            <YAxis
              tick={{ fill: C.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={pctTickPlain}
              domain={[0, "auto"]}
            />
            <Tooltip
              {...tooltipStyle}
              formatter={(v: number) => [`${v}%`]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: C.axis }}
              iconType="circle"
              iconSize={8}
            />
            <Line
              type="monotone"
              dataKey="control"
              name="G1 Control"
              stroke={C.control}
              strokeWidth={2}
              dot={{ r: 4, fill: C.control }}
            />
            <Line
              type="monotone"
              dataKey="email"
              name="G2 Email+Push"
              stroke={C.email}
              strokeWidth={2.5}
              dot={{ r: 4, fill: C.email }}
            />
            <Line
              type="monotone"
              dataKey="meta"
              name="G3 Meta Only"
              stroke={C.meta}
              strokeWidth={2}
              dot={{ r: 4, fill: C.meta }}
            />
            <Line
              type="monotone"
              dataKey="both"
              name="G4 Email+Meta"
              stroke={C.both}
              strokeWidth={2}
              dot={{ r: 4, fill: C.both }}
            />
          </LineChart>
        </ResponsiveContainer>
        <InsightBox>
          Mother's Day (8-13 Mar) drove the entire Email lift: +26.8% (p=0.003). Valentine's
          showed no incremental effect for any group. This suggests Email works as a seasonal
          reminder, not a general retention nudge.
        </InsightBox>
      </Card>

      {/* segment analysis */}
      <Card>
        <p className="text-sm font-semibold">Segment Analysis</p>
        <p className="mb-4 text-xs text-neutral-500">
          H2a–c: Which customers respond to which channels?
        </p>
        <SegmentTabs active={segTab} onChange={setSegTab} />

        {segTab === "orders" && (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={orderData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="segment"
                  tick={{ fill: C.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: C.grid }}
                />
                <YAxis
                  tick={{ fill: C.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={pctTick}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: number) => [`${v > 0 ? "+" : ""}${v}%`]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                <Bar dataKey="emailLift" name="Email Lift" fill={C.email} radius={[4, 4, 0, 0]} />
                <Bar dataKey="metaLift" name="Meta Lift" fill={C.meta} radius={[4, 4, 0, 0]} />
                <Bar dataKey="bothLift" name="Both Lift" fill={C.both} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <InsightBox>
              Prediction was wrong: 1-order customers were unresponsive. The sweet spot is
              2-4 order customers where Email drove +43.7% lift (p&lt;0.01). These are
              customers with some loyalty but not yet habitual – Email tips them over.
            </InsightBox>
          </>
        )}

        {segTab === "recency" && (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={recencyData} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="segment"
                  tick={{ fill: C.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: C.grid }}
                />
                <YAxis
                  tick={{ fill: C.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={pctTick}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: number) => [`${v > 0 ? "+" : ""}${v}%`]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                <Bar dataKey="emailLift" name="Email Lift" fill={C.email} radius={[4, 4, 0, 0]} />
                <Bar dataKey="metaLift" name="Meta Lift" fill={C.meta} radius={[4, 4, 0, 0]} />
                <Bar dataKey="bothLift" name="Both Lift" fill={C.both} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <InsightBox>
              Neither recency segment reached significance individually. Recent customers
              (≤6 months) have a 16.5% baseline purchase rate vs 0.35% for lapsed (≥12 months)
              – a 47x difference. The sheer gap in baseline rates means even large relative
              lifts for lapsed customers translate to tiny absolute numbers.
            </InsightBox>
          </>
        )}

        {segTab === "cohort" && (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={cohortData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="segment"
                  tick={{ fill: C.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: C.grid }}
                />
                <YAxis
                  tick={{ fill: C.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={pctTick}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: number) => [`${v > 0 ? "+" : ""}${v}%`]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                <Bar dataKey="emailLift" name="Email Lift" fill={C.email} radius={[4, 4, 0, 0]} />
                <Bar dataKey="metaLift" name="Meta Lift" fill={C.meta} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <InsightBox>
              Concerning finding: Meta showed a significant <em>negative</em> effect for 2025
              single-order customers (-37.5%, p=0.03). Small cell sizes (n~800-3,000) limit
              power elsewhere. Directionally, Email shows promise for 2024 single-order
              reactivation (+72.3%) but needs more data.
            </InsightBox>
          </>
        )}
      </Card>

      {/* cost effectiveness */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <p className="text-sm font-semibold">Cost per Incremental Purchase</p>
          <p className="mb-4 text-xs text-neutral-500">Meta vs Email efficiency comparison</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={costData} layout="vertical" barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: C.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: C.grid }}
                tickFormatter={gbpTick}
              />
              <YAxis
                type="category"
                dataKey="channel"
                tick={{ fill: C.axis, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={90}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(v: number) => [
                  v === 0 ? "~£0 (near-zero marginal cost)" : `£${v}+`,
                  "Cost / Incr. Purchase",
                ]}
              />
              <Bar dataKey="cost" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {costData.map((d, i) => (
                  <rect key={i} fill={i === 0 ? C.email : C.meta} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <p className="text-sm font-semibold">Incremental Purchases Generated</p>
          <p className="mb-4 text-xs text-neutral-500">Absolute impact from each channel</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={incrData} layout="vertical" barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: C.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: C.grid }}
              />
              <YAxis
                type="category"
                dataKey="channel"
                tick={{ fill: C.axis, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={90}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(v: number) => [`~${v} incremental purchases`]}
              />
              <Bar dataKey="purchases" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {incrData.map((d, i) => (
                  <rect key={i} fill={i === 0 ? C.email : C.meta} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <InsightBox>
            Email generated ~128 incremental purchases at near-zero marginal cost. Meta
            generated ~8 (not statistically different from zero) at £7,481 spend – implying
            £666+ per incremental purchase.
          </InsightBox>
        </Card>
      </div>

      {/* conclusions */}
      <Card>
        <p className="text-sm font-semibold">Conclusions</p>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm leading-relaxed text-neutral-300">
          <li>
            <strong className="text-white">Email is a proven incremental retention channel</strong>{" "}
            (+9% relative lift, p=0.02). Meta is not (0.4% lift, p=0.91).
          </li>
          <li>
            <strong className="text-white">The channels overlap rather than compound</strong> –
            adding Meta to Email made it worse, not better.
          </li>
          <li>
            <strong className="text-white">Email's value is seasonal:</strong> the entire lift
            was concentrated around Mother's Day (8-13 Mar). Valentine's showed no incremental
            effect.
          </li>
          <li>
            <strong className="text-white">2-4 order customers are the sweet spot</strong> for
            Email retention (+44% relative lift, p&lt;0.01). 1-order customers were unresponsive.
          </li>
          <li>
            <strong className="text-white">Meta retention spend of £7.5k</strong> over 8 weeks
            generated no measurable incremental value. Recommend reallocating to acquisition or
            Email-driven seasonal campaigns.
          </li>
          <li>
            <strong className="text-white">Follow-up:</strong> test Email frequency/timing
            around seasonal moments; test whether Meta works at higher frequency or with
            retention-specific creative.
          </li>
        </ol>
      </Card>
    </div>
  )
}
