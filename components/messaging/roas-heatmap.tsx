import { Card } from "@/components/ui/card"
import { fmtCurrencyFull, fmtRoas } from "@/lib/utils/format"
import { HEATMAP, HEATMAP_CALLOUTS } from "@/lib/messaging/data"

/** Map a ROAS value to a tailwind background opacity — higher = greener. */
function roasCellClass(roas: number): string {
  if (roas >= 5) return "bg-emerald-500/40"
  if (roas >= 4) return "bg-emerald-500/30"
  if (roas >= 3) return "bg-emerald-500/20"
  if (roas >= 2) return "bg-amber-500/20"
  if (roas >= 1) return "bg-amber-500/10"
  if (roas > 0) return "bg-red-500/20"
  return "bg-neutral-800/40"
}

export default function RoasHeatmap() {
  const markets: Array<"uk" | "us" | "au"> = ["uk", "us", "au"]
  const marketLabels: Record<"uk" | "us" | "au", string> = {
    uk: "UK",
    us: "US",
    au: "AU",
  }

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">ROAS by JOB × Market</h2>
        <p className="text-xs text-neutral-400">
          Colour intensity reflects ROAS; secondary value is spend.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 text-left font-medium">JOB</th>
              {markets.map((m) => (
                <th key={m} className="px-3 py-2 text-center font-medium">
                  {marketLabels[m]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEATMAP.map((row) => (
              <tr key={row.job}>
                <td
                  className={`rounded-lg bg-neutral-800/40 px-3 py-2 text-left font-medium ${
                    row.job === "Untagged" ? "text-neutral-400" : "text-neutral-100"
                  }`}
                >
                  {row.job}
                </td>
                {markets.map((m) => {
                  const cell = row[m]
                  return (
                    <td
                      key={m}
                      className={`rounded-lg px-3 py-3 text-center ${roasCellClass(cell.roas)}`}
                    >
                      <div className="text-base font-semibold tabular-nums text-white">
                        {fmtRoas(cell.roas)}
                      </div>
                      <div className="text-[11px] text-neutral-300/80 tabular-nums">
                        {fmtCurrencyFull(cell.spend)}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-5 space-y-2 border-t border-neutral-800 pt-4 text-sm text-neutral-300">
        {HEATMAP_CALLOUTS.map((c, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-brand-lime">•</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
