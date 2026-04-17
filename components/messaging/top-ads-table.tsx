import { fmtCurrencyFull, fmtNumber, fmtRoas } from "@/lib/utils/format"
import { TOP_ADS } from "@/lib/messaging/data"

export default function TopAdsTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Ad Name</th>
            <th className="px-3 py-2 font-medium">JOB</th>
            <th className="px-3 py-2 font-medium">Market</th>
            <th className="px-3 py-2 text-right font-medium">Spend</th>
            <th className="px-3 py-2 text-right font-medium">Revenue</th>
            <th className="px-3 py-2 text-right font-medium">Purchases</th>
            <th className="px-3 py-2 text-right font-medium">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {TOP_ADS.map((r, i) => (
            <tr
              key={`${r.name}-${r.market}-${i}`}
              className="border-b border-neutral-900 text-neutral-200 hover:bg-neutral-800/40"
            >
              <td className="px-3 py-2 text-neutral-500 tabular-nums">{i + 1}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
              <td className="px-3 py-2 text-neutral-400">{r.job}</td>
              <td className="px-3 py-2">{r.market}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtCurrencyFull(r.spend)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtCurrencyFull(r.revenue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.purchases)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-400">
                {fmtRoas(r.roas)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
