import { Card } from "@/components/ui/card"
import KpiBar from "@/components/messaging/kpi-bar"
import RoasByJobSection from "@/components/messaging/roas-by-job-section"
import RoasHeatmap from "@/components/messaging/roas-heatmap"
import JobAdsTable from "@/components/messaging/job-ads-table"
import TopAdsTable from "@/components/messaging/top-ads-table"
import InsightsBlock from "@/components/messaging/insights-block"
import { JOB_ADS, DATE_RANGE_LABEL } from "@/lib/messaging/data"

export default function MessagingAnalysisPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">W&amp;B Messaging JOB Analysis</h1>
        <p className="text-sm text-neutral-400">
          Meta Ads Performance by Messaging House JOB — {DATE_RANGE_LABEL}
        </p>
      </div>

      <KpiBar />

      <RoasByJobSection />

      <RoasHeatmap />

      <Card>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">
            All JOB-Tagged Ads ({JOB_ADS.length})
          </h2>
          <p className="text-xs text-neutral-400">
            Click any column header to sort.
          </p>
        </div>
        <JobAdsTable rows={JOB_ADS} />
      </Card>

      <Card>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">Top 15 Ads by ROAS</h2>
          <p className="text-xs text-neutral-400">
            Minimum £50 spend, all ads including untagged.
          </p>
        </div>
        <TopAdsTable />
      </Card>

      <InsightsBlock />
    </div>
  )
}
