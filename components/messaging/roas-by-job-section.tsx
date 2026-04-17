import { Card } from "@/components/ui/card"
import { fmtCurrencyFull, fmtNumber, fmtRoas } from "@/lib/utils/format"
import { JOB_SUMMARY } from "@/lib/messaging/data"
import RoasByJobChart from "@/components/messaging/roas-by-job-chart"

export default function RoasByJobSection() {
  const chartData = JOB_SUMMARY.filter((r) => r.job !== "Untagged").map((r) => ({
    job: r.job,
    roas: r.roas,
    spend: r.spend,
  }))

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">ROAS by JOB</h2>
          <p className="text-xs text-neutral-400">Blended across all markets</p>
        </div>
      </div>

      <RoasByJobChart data={chartData} />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 font-medium">JOB</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 text-right font-medium">Revenue</th>
              <th className="px-3 py-2 text-right font-medium">Purchases</th>
              <th className="px-3 py-2 text-right font-medium">ROAS</th>
              <th className="px-3 py-2 text-right font-medium"># Ads</th>
            </tr>
          </thead>
          <tbody>
            {JOB_SUMMARY.map((r) => (
              <tr
                key={r.job}
                className={`border-b border-neutral-900 ${
                  r.job === "Untagged" ? "text-neutral-400" : "text-neutral-200"
                }`}
              >
                <td className="px-3 py-2 font-medium">{r.job}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCurrencyFull(r.spend)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCurrencyFull(r.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.purchases)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtRoas(r.roas)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
