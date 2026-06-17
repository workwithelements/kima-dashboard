"use client"

import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ReferenceLine,
  ComposedChart,
} from "recharts"
import { fmtNumber, fmtPercent } from "@/lib/utils/format"
import { bucketStart, formatBucketLabel, type Granularity, type PreparedReachPoint } from "@/lib/utils/reach"
import type { ReachEvent } from "@/lib/utils/reach-events"

type NoteMarker = { date: string; text: string }

type ReachChartProps = {
  data: PreparedReachPoint[]
  /** Bucket granularity — controls axis labels and the % line meaning */
  granularity?: Granularity
  /** Number of consecutive declining buckets (for fatigue warning) */
  fatigueDays?: number
  height?: number
  /** Auto-detected reach-change events (bucket-snapped dates) */
  events?: ReachEvent[]
  /** Manual annotations (raw dates; snapped to buckets here) */
  annotations?: NoteMarker[]
}

type ChartPoint = {
  date: string
  existingReach: number
  newReach: number
  rollingNewPct: number
  _events: string[]
  _notes: string[]
}

const AUTO_COLOR = "#60A5FA"
const NOTE_COLOR = "#CDFF00"

export default function ReachChart({
  data,
  granularity = "day",
  fatigueDays = 0,
  height = 300,
  events = [],
  annotations = [],
}: ReachChartProps) {
  const isDaily = granularity === "day"

  // Group markers by bucket date so each bucket renders one flag per kind.
  const eventsByBucket = new Map<string, string[]>()
  for (const e of events) {
    const arr = eventsByBucket.get(e.date) || []
    arr.push(e.summary)
    eventsByBucket.set(e.date, arr)
  }
  const notesByBucket = new Map<string, string[]>()
  for (const a of annotations) {
    const key = bucketStart(a.date, granularity)
    const arr = notesByBucket.get(key) || []
    arr.push(a.text)
    notesByBucket.set(key, arr)
  }

  // For daily view, smooth the new-reach % with a 7-day rolling average.
  // For week/month buckets, each point already represents the whole period's
  // new reach as a share of lifetime cumulative reach, so show it directly.
  const chartData: ChartPoint[] = data.map((d, i) => {
    let pct = d.newReachPct
    if (isDaily) {
      const windowSize = Math.min(7, i + 1)
      const windowSlice = data.slice(Math.max(0, i - windowSize + 1), i + 1)
      pct = windowSlice.reduce((sum, p) => sum + p.newReachPct, 0) / windowSlice.length
    }
    return {
      date: d.date,
      existingReach: d.previousReach,
      newReach: d.newReach,
      rollingNewPct: pct,
      _events: eventsByBucket.get(d.date) || [],
      _notes: notesByBucket.get(d.date) || [],
    }
  })

  const pctLabel = isDaily ? "New Reach % (7d avg)" : "New Reach % of lifetime"
  const tickFormatter = (s: string) => formatBucketLabel(s, granularity)

  return (
    <div>
      {fatigueDays >= 7 && isDaily && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-400">
          <span>⚠️</span>
          <span>
            New reach declining for {fatigueDays} consecutive days — audience fatigue detected
          </span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#262626" }}
            tickFormatter={tickFormatter}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmtNumber(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: "#737373", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            domain={[0, "auto"]}
          />
          <Tooltip
            content={<ReachTooltip granularity={granularity} pctLabel={pctLabel} />}
          />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="rect"
            iconSize={10}
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                existingReach: "Existing Reach",
                newReach: "New Reach",
                rollingNewPct: pctLabel,
              }
              return (
                <span className="text-xs text-neutral-400">
                  {labels[value] || value}
                </span>
              )
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="existingReach"
            stackId="reach"
            fill="#1A1A4E"
            fillOpacity={0.8}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            yAxisId="left"
            dataKey="newReach"
            stackId="reach"
            fill="#CDFF00"
            fillOpacity={0.7}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="rollingNewPct"
            stroke="#FF69B4"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />

          {/* Auto-detected reach-change flags */}
          {Array.from(eventsByBucket.keys()).map((d) => (
            <ReferenceLine
              key={`ev-${d}`}
              yAxisId="left"
              x={d}
              stroke={AUTO_COLOR}
              strokeDasharray="3 3"
              strokeOpacity={0.6}
              label={{ value: "◆", position: "top", fill: AUTO_COLOR, fontSize: 10 }}
            />
          ))}
          {/* Manual notes */}
          {Array.from(notesByBucket.keys()).map((d) => (
            <ReferenceLine
              key={`note-${d}`}
              yAxisId="left"
              x={d}
              stroke={NOTE_COLOR}
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              label={{ value: "▼", position: "top", fill: NOTE_COLOR, fontSize: 10 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Custom tooltip: reach series + a "What changed" / "Notes" section for the bucket. */
function ReachTooltip({
  active,
  payload,
  label,
  granularity,
  pctLabel,
}: {
  active?: boolean
  payload?: { payload: ChartPoint }[]
  label?: string
  granularity: Granularity
  pctLabel: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-[#262626] bg-[#171717] px-3 py-2 text-xs">
      <p className="mb-1 text-neutral-400">{formatBucketLabel(label ?? p.date, granularity)}</p>
      <p className="text-neutral-200">Existing Reach: {fmtNumber(p.existingReach)}</p>
      <p className="text-neutral-200">New Reach: {fmtNumber(p.newReach)}</p>
      <p className="text-neutral-200">
        {pctLabel}: {fmtPercent(p.rollingNewPct, 1)}
      </p>
      {p._events.length > 0 && (
        <div className="mt-1.5 border-t border-neutral-800 pt-1.5">
          <p className="mb-0.5 font-medium" style={{ color: AUTO_COLOR }}>
            ◆ What changed
          </p>
          {p._events.map((t, i) => (
            <p key={i} className="max-w-[240px] text-neutral-300">
              {t}
            </p>
          ))}
        </div>
      )}
      {p._notes.length > 0 && (
        <div className="mt-1.5 border-t border-neutral-800 pt-1.5">
          <p className="mb-0.5 font-medium" style={{ color: NOTE_COLOR }}>
            ▼ Notes
          </p>
          {p._notes.map((t, i) => (
            <p key={i} className="max-w-[240px] text-neutral-300">
              {t}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
