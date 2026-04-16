"use client"

import { useMemo, useState } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { STAGE_MAP, getDimensionValue } from "@/lib/utils/ad-name-parser"
import {
  CLASSIFICATIONS,
  type ClassifiedAd,
  type ClassificationType,
} from "@/lib/utils/creative-classification"
import { fmtCurrency } from "@/lib/utils/format"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CoverageStatus = "covered" | "weak" | "gap"

type CoverageEntry = {
  value: string
  adCount: number
  activeAdCount: number
  spend: number
  classifications: Partial<Record<ClassificationType, number>>
  status: CoverageStatus
}

type MatrixCell = {
  adCount: number
  spend: number
  status: CoverageStatus
}

type Props = {
  ads: ClassifiedAd[]
  currency?: string
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const KNOWN_STAGES = Object.values(STAGE_MAP) // ["Problem Unaware", "Problem Aware", "Solution Aware"]

const WINNER_TYPES: ClassificationType[] = [
  "DIRECT_WINNER",
  "INDIRECT_WINNER",
  "VIABLE_UNDERSCALED",
]

function deriveStatus(
  classifications: Partial<Record<ClassificationType, number>>,
  adCount: number
): CoverageStatus {
  if (adCount === 0) return "gap"
  const hasPerformer = WINNER_TYPES.some((t) => (classifications[t] || 0) > 0)
  return hasPerformer ? "covered" : "weak"
}

function buildCoverageData(ads: ClassifiedAd[]) {
  // --- Stage grouping (always include all 3 known stages) ---
  const stageMap = new Map<string, CoverageEntry>()
  for (const stage of KNOWN_STAGES) {
    stageMap.set(stage, {
      value: stage,
      adCount: 0,
      activeAdCount: 0,
      spend: 0,
      classifications: {},
      status: "gap",
    })
  }

  // --- Job grouping ---
  const jobMap = new Map<string, CoverageEntry>()

  // --- Matrix: job -> stage -> cell ---
  const matrix = new Map<string, Map<string, MatrixCell>>()

  for (const ad of ads) {
    const stage = getDimensionValue(ad.parsed, "stage")
    const job = getDimensionValue(ad.parsed, "job")
    const ct = ad.classification.type

    // Stage
    if (stage) {
      let entry = stageMap.get(stage)
      if (!entry) {
        entry = {
          value: stage,
          adCount: 0,
          activeAdCount: 0,
          spend: 0,
          classifications: {},
          status: "gap",
        }
        stageMap.set(stage, entry)
      }
      entry.adCount++
      if (ad.impressions > 0) entry.activeAdCount++
      entry.spend += ad.spend
      entry.classifications[ct] = (entry.classifications[ct] || 0) + 1
    }

    // Job
    if (job) {
      let entry = jobMap.get(job)
      if (!entry) {
        entry = {
          value: job,
          adCount: 0,
          activeAdCount: 0,
          spend: 0,
          classifications: {},
          status: "gap",
        }
        jobMap.set(job, entry)
      }
      entry.adCount++
      if (ad.impressions > 0) entry.activeAdCount++
      entry.spend += ad.spend
      entry.classifications[ct] = (entry.classifications[ct] || 0) + 1
    }

    // Matrix cell
    if (job && stage) {
      if (!matrix.has(job)) matrix.set(job, new Map())
      const row = matrix.get(job)!
      let cell = row.get(stage)
      if (!cell) {
        cell = { adCount: 0, spend: 0, status: "gap" }
        row.set(stage, cell)
      }
      cell.adCount++
      cell.spend += ad.spend
    }
  }

  // Derive status for stages and jobs
  Array.from(stageMap.values()).forEach((entry) => {
    entry.status = deriveStatus(entry.classifications, entry.adCount)
  })
  Array.from(jobMap.values()).forEach((entry) => {
    entry.status = deriveStatus(entry.classifications, entry.adCount)
  })

  // Derive matrix cell statuses
  // We need classification info per cell, so re-scan
  const matrixClassifications = new Map<string, Partial<Record<ClassificationType, number>>>()
  for (const ad of ads) {
    const stage = getDimensionValue(ad.parsed, "stage")
    const job = getDimensionValue(ad.parsed, "job")
    if (job && stage) {
      const key = `${job}::${stage}`
      const cls = matrixClassifications.get(key) || {}
      cls[ad.classification.type] = (cls[ad.classification.type] || 0) + 1
      matrixClassifications.set(key, cls)
    }
  }
  Array.from(matrix.entries()).forEach(([job, row]) => {
    Array.from(row.entries()).forEach(([stage, cell]) => {
      const cls = matrixClassifications.get(`${job}::${stage}`) || {}
      cell.status = deriveStatus(cls, cell.adCount)
    })
  })

  const stages = KNOWN_STAGES.map((s) => stageMap.get(s)!).concat(
    Array.from(stageMap.values()).filter((e) => !KNOWN_STAGES.includes(e.value))
  )
  const jobs = Array.from(jobMap.values()).sort((a, b) => b.spend - a.spend)

  // All stages for matrix columns (known first, then any extras)
  const allStages = [...KNOWN_STAGES]
  Array.from(stageMap.values()).forEach((e) => {
    if (!allStages.includes(e.value)) allStages.push(e.value)
  })

  return { stages, jobs, matrix, allStages }
}

/* ------------------------------------------------------------------ */
/*  Status styling                                                     */
/* ------------------------------------------------------------------ */

const STATUS_STYLES: Record<
  CoverageStatus,
  { border: string; bg: string; icon: string; iconColor: string }
> = {
  covered: {
    border: "border-green-500/40",
    bg: "bg-green-500/5",
    icon: "✓",
    iconColor: "text-green-400",
  },
  weak: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    icon: "!",
    iconColor: "text-amber-400",
  },
  gap: {
    border: "border-red-500/40 border-dashed",
    bg: "bg-red-500/5",
    icon: "✕",
    iconColor: "text-red-400",
  },
}

const STATUS_LABELS: Record<CoverageStatus, string> = {
  covered: "Covered",
  weak: "Weak — no winners",
  gap: "Gap — no ads",
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ClassificationDots({
  classifications,
}: {
  classifications: Partial<Record<ClassificationType, number>>
}) {
  const entries = Object.entries(classifications) as [ClassificationType, number][]
  if (entries.length === 0) return null
  return (
    <div className="flex gap-1 flex-wrap mt-1.5">
      {entries.map(([type, count]) => (
        <span
          key={type}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
          style={{
            backgroundColor: `${CLASSIFICATIONS[type].color}20`,
            color: CLASSIFICATIONS[type].color,
          }}
        >
          {count} {CLASSIFICATIONS[type].label}
        </span>
      ))}
    </div>
  )
}

function StageCoverageCards({
  stages,
  currency,
}: {
  stages: CoverageEntry[]
  currency: string
}) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-400 mb-3">Awareness Stage</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stages.map((entry) => {
          const style = STATUS_STYLES[entry.status]
          return (
            <div
              key={entry.value}
              className={`rounded-lg border ${style.border} ${style.bg} p-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-neutral-200">{entry.value}</p>
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${style.iconColor} ${
                    entry.status === "gap"
                      ? "bg-red-500/15"
                      : entry.status === "weak"
                      ? "bg-amber-500/15"
                      : "bg-green-500/15"
                  }`}
                >
                  {style.icon}
                </span>
              </div>
              {entry.status === "gap" ? (
                <p className="text-[11px] text-neutral-500 mt-2">
                  No active ads targeting this stage
                </p>
              ) : (
                <>
                  <div className="flex gap-4 mt-1">
                    <div>
                      <p className="text-[10px] text-neutral-500">Ads</p>
                      <p className="text-sm font-semibold text-neutral-200">
                        {entry.adCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-500">Spend</p>
                      <p className="text-sm font-semibold text-neutral-200">
                        {fmtCurrency(entry.spend, currency)}
                      </p>
                    </div>
                  </div>
                  <ClassificationDots classifications={entry.classifications} />
                </>
              )}
              <p className={`text-[10px] mt-2 ${style.iconColor}`}>
                {STATUS_LABELS[entry.status]}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function JobCoverageChart({
  jobs,
  currency,
}: {
  jobs: CoverageEntry[]
  currency: string
}) {
  const [showAll, setShowAll] = useState(false)
  const MAX_VISIBLE = 12
  const displayed = showAll ? jobs : jobs.slice(0, MAX_VISIBLE)
  const hasMore = jobs.length > MAX_VISIBLE

  const barColor = (entry: CoverageEntry) => {
    if (entry.status === "covered") return "#22c55e"
    if (entry.status === "weak") return "#f59e0b"
    return "#ef4444"
  }

  const chartHeight = Math.max(displayed.length * 36, 80)

  return (
    <div>
      <p className="text-xs font-medium text-neutral-400 mb-3">Job / Persona</p>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={displayed}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="value"
            width={120}
            tick={{ fontSize: 11, fill: "#a3a3a3" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as CoverageEntry
              return (
                <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-xl">
                  <p className="font-medium text-white">{d.value}</p>
                  <p className="text-neutral-400">
                    {d.adCount} ads · {fmtCurrency(d.spend, currency)}
                  </p>
                  <p className={STATUS_STYLES[d.status].iconColor}>
                    {STATUS_LABELS[d.status]}
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="spend" radius={[0, 4, 4, 0]} barSize={20}>
            {displayed.map((entry, i) => (
              <Cell key={i} fill={barColor(entry)} fillOpacity={0.7} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-[11px] text-neutral-500 hover:text-neutral-300 transition"
        >
          {showAll ? "Show less" : `Show all ${jobs.length} jobs`}
        </button>
      )}
    </div>
  )
}

function CoverageMatrix({
  jobs,
  allStages,
  matrix,
  currency,
}: {
  jobs: CoverageEntry[]
  allStages: string[]
  matrix: Map<string, Map<string, MatrixCell>>
  currency: string
}) {
  const [expanded, setExpanded] = useState(jobs.length <= 8)

  // Total spend across all matrix cells, used to compute % share per cell
  const totalMatrixSpend = useMemo(() => {
    let total = 0
    matrix.forEach((row) => {
      row.forEach((cell) => {
        total += cell.spend
      })
    })
    return total
  }, [matrix])

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-medium text-neutral-400 hover:text-neutral-200 transition mb-3"
      >
        <span
          className="inline-block transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▸
        </span>
        Job × Stage Matrix
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-2 text-neutral-500 font-medium">
                  Job
                </th>
                {allStages.map((stage) => (
                  <th
                    key={stage}
                    className="text-center py-1.5 px-2 text-neutral-500 font-medium min-w-[110px]"
                  >
                    {stage}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const row = matrix.get(job.value)
                return (
                  <tr key={job.value} className="border-t border-neutral-800/50">
                    <td className="py-2 px-2 text-neutral-300 font-medium whitespace-nowrap">
                      {job.value}
                    </td>
                    {allStages.map((stage) => {
                      const cell = row?.get(stage)
                      if (!cell || cell.adCount === 0) {
                        return (
                          <td key={stage} className="py-2 px-2 text-center">
                            <span className="inline-block rounded border border-dashed border-red-500/30 bg-red-500/5 px-2 py-1 text-red-400/60">
                              —
                            </span>
                          </td>
                        )
                      }
                      const cellStyle = STATUS_STYLES[cell.status]
                      const pct = totalMatrixSpend > 0
                        ? (cell.spend / totalMatrixSpend) * 100
                        : 0
                      return (
                        <td key={stage} className="py-2 px-2 text-center">
                          <span
                            className={`inline-block rounded border ${cellStyle.border} ${cellStyle.bg} px-2 py-1`}
                            title={fmtCurrency(cell.spend, currency)}
                          >
                            <span className="text-neutral-300">{cell.adCount} ads</span>
                            <span className="text-neutral-500 ml-1">
                              {pct.toFixed(1)}%
                            </span>
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main export                                                        */
/* ------------------------------------------------------------------ */

export default function CoverageAnalysis({ ads, currency = "GBP" }: Props) {
  const data = useMemo(() => buildCoverageData(ads), [ads])

  const hasStages = data.stages.some((s) => s.adCount > 0) || data.stages.length > 0
  const hasJobs = data.jobs.length > 0
  const hasMatrix = hasJobs && data.stages.some((s) => s.adCount > 0)

  if (!hasStages && !hasJobs) return null

  // Summary counts
  const gaps = data.stages.filter((s) => s.status === "gap").length
  const weakStages = data.stages.filter((s) => s.status === "weak").length
  const weakJobs = data.jobs.filter((j) => j.status === "weak").length

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-neutral-200">Coverage Analysis</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Identify gaps in creative strategy across awareness stages and jobs
          </p>
        </div>
        {(gaps > 0 || weakStages > 0 || weakJobs > 0) && (
          <div className="flex gap-2">
            {gaps > 0 && (
              <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-medium text-red-400">
                {gaps} stage gap{gaps !== 1 ? "s" : ""}
              </span>
            )}
            {(weakStages > 0 || weakJobs > 0) && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-medium text-amber-400">
                {weakStages + weakJobs} weak
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stage cards */}
      {hasStages && (
        <StageCoverageCards stages={data.stages} currency={currency} />
      )}

      {/* Job bar chart */}
      {hasJobs && <JobCoverageChart jobs={data.jobs} currency={currency} />}

      {/* Matrix */}
      {hasMatrix && (
        <CoverageMatrix
          jobs={data.jobs}
          allStages={data.allStages}
          matrix={data.matrix}
          currency={currency}
        />
      )}
    </div>
  )
}
