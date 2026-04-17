import { MetricCard } from "@/components/ui/card"
import { fmtCurrencyFull, fmtNumber, fmtRoas } from "@/lib/utils/format"
import { SUMMARY_KPIS } from "@/lib/messaging/data"

export default function KpiBar() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <MetricCard label="Total Spend" value={fmtCurrencyFull(SUMMARY_KPIS.totalSpend)} />
      <MetricCard label="Total Revenue" value={fmtCurrencyFull(SUMMARY_KPIS.totalRevenue)} />
      <MetricCard label="Overall ROAS" value={fmtRoas(SUMMARY_KPIS.overallRoas)} />
      <MetricCard label="Total Ads" value={fmtNumber(SUMMARY_KPIS.totalAds)} />
      <MetricCard
        label="JOB-Tagged Ads"
        value={fmtNumber(SUMMARY_KPIS.taggedAds)}
        subValue={`${SUMMARY_KPIS.taggedPct}% of total`}
      />
      <MetricCard label="Untagged Ads" value={fmtNumber(SUMMARY_KPIS.untaggedAds)} />
    </div>
  )
}
