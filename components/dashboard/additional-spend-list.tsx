import { Card } from "@/components/ui/card"
import { fmtCurrency, fmtDateShort } from "@/lib/utils/format"
import type { AdditionalSpendEntry } from "@/lib/utils/types"

type Props = {
  entries: AdditionalSpendEntry[]
  currency: string
}

export default function AdditionalSpendList({ entries, currency }: Props) {
  if (entries.length === 0) return null

  return (
    <Card>
      <div className="mb-3">
        <h2 className="text-sm font-medium text-white">Additional Spend</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Off-platform spend included in the pacing totals above.
        </p>
      </div>
      <ul className="divide-y divide-neutral-800">
        {entries.map((entry) => {
          const days =
            Math.round(
              (Date.parse(entry.end_date + "T00:00:00Z") -
                Date.parse(entry.start_date + "T00:00:00Z")) /
                86_400_000
            ) + 1
          const perDay = days > 0 ? entry.amount / days : entry.amount
          return (
            <li key={entry.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium tabular-nums text-white">
                  {fmtCurrency(entry.amount, currency)}
                </span>
                <span className="text-xs text-neutral-400">
                  {entry.start_date === entry.end_date
                    ? fmtDateShort(entry.start_date)
                    : `${fmtDateShort(entry.start_date)} – ${fmtDateShort(entry.end_date)}`}
                </span>
                {days > 1 && (
                  <span className="text-[11px] text-neutral-500">
                    ({days} days · {fmtCurrency(perDay, currency)}/day)
                  </span>
                )}
              </div>
              {entry.note && (
                <p className="mt-1 text-xs text-neutral-400">{entry.note}</p>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
