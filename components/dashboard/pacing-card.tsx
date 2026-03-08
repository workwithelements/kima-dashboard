"use client"

import type { PacingResult } from "@/lib/utils/pacing"
import { PACING_STATUS_CONFIG } from "@/lib/utils/types"
import { fmtCurrency, fmtPercent } from "@/lib/utils/format"

export default function PacingCard({ pacing }: { pacing: PacingResult }) {
  const statusConfig = PACING_STATUS_CONFIG[pacing.status]

  // Progress bar percentage (capped at 100% for display)
  const progressPct = pacing.budget
    ? Math.min(100, (pacing.spentToDate / pacing.budget) * 100)
    : 0

  const expectedPct = pacing.budget
    ? Math.min(100, (pacing.expectedSpend / pacing.budget) * 100)
    : 0

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-300">Budget Pacing</h3>
        <span className={`text-xs font-medium ${statusConfig.color}`}>
          {statusConfig.icon} {statusConfig.label}
        </span>
      </div>

      {/* Budget and spend */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Monthly Budget</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {pacing.budget ? fmtCurrency(pacing.budget) : "Not set"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Spent to Date</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {fmtCurrency(pacing.spentToDate)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {pacing.budget && (
        <div className="mt-4">
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-neutral-800">
            {/* Actual spend */}
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                pacing.status === "on_track"
                  ? "bg-green-500"
                  : pacing.status === "slightly_over" || pacing.status === "slightly_under"
                    ? "bg-amber-500"
                    : pacing.status === "no_budget"
                      ? "bg-neutral-600"
                      : "bg-red-500"
              }`}
              style={{ width: `${progressPct}%` }}
            />
            {/* Expected marker */}
            <div
              className="absolute inset-y-0 w-0.5 bg-white/40"
              style={{ left: `${expectedPct}%` }}
              title={`Expected: ${fmtCurrency(pacing.expectedSpend)}`}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-neutral-500">
            <span>{fmtPercent(progressPct, 0)} of budget</span>
            <span>
              Day {pacing.daysElapsed}/{pacing.daysTotal}
            </span>
          </div>
        </div>
      )}

      {/* Projection details */}
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-neutral-800 pt-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Projected</p>
          <p className="mt-0.5 text-sm font-medium tabular-nums text-neutral-200">
            {fmtCurrency(pacing.projectedSpend)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Pacing</p>
          <p className={`mt-0.5 text-sm font-medium tabular-nums ${statusConfig.color}`}>
            {pacing.pacingPct !== null ? fmtPercent(pacing.pacingPct, 1) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Ideal Daily</p>
          <p className="mt-0.5 text-sm font-medium tabular-nums text-neutral-200">
            {pacing.idealDailySpend ? fmtCurrency(pacing.idealDailySpend) : "—"}
          </p>
        </div>
      </div>
    </div>
  )
}
